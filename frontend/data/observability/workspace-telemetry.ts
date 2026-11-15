import { context, trace, type Tracer } from "@opentelemetry/api";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { ExportResultCode } from "@opentelemetry/core";
import { DocumentLoadInstrumentation } from "@opentelemetry/instrumentation-document-load";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { XMLHttpRequestInstrumentation } from "@opentelemetry/instrumentation-xml-http-request";
import {
  BatchSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
  WebTracerProvider,
} from "@opentelemetry/sdk-trace-web";
import {
  browserTelemetryErrorClassSchema,
  type BrowserTelemetryErrorClass,
  BrowserTelemetryEventName,
  BrowserTelemetryRecord,
} from "@fields/contracts/public/observability";
import type {
  ProductSession,
} from "@fields/contracts/public/company";

import { backendApiUrl } from "../boundary/backend-url";

type TelemetrySession = Readonly<Pick<ProductSession, "company_id" | "actor_id">>;
type ExportCallback = (result: { code: ExportResultCode }) => void;

const RELAY_PATH = "/api/v1/observability/browser";
const RELAY_URL_PATTERN = /\/api\/v1\/observability\/browser(?:[?#]|$)/u;

class BrowserRelayExporter implements SpanExporter {
  private enabled = true;

  constructor(private readonly session: TelemetrySession) {}

  export(spans: ReadableSpan[], callback: ExportCallback): void {
    const records = spans
      .map((span) => browserRecord(span, this.enabled ? this.session : null))
      .filter((record): record is BrowserTelemetryRecord => record !== null);
    if (records.length === 0) {
      callback({ code: ExportResultCode.SUCCESS });
      return;
    }
    void this.send(records).then(
      () => callback({ code: ExportResultCode.SUCCESS }),
      () => callback({ code: ExportResultCode.FAILED }),
    );
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  disable(): void {
    this.enabled = false;
  }

  private async send(records: BrowserTelemetryRecord[]): Promise<void> {
    for (let index = 0; index < records.length; index += 64) {
      const response = await fetch(backendApiUrl(RELAY_PATH), {
        method: "POST",
        credentials: "include",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ records: records.slice(index, index + 64) }),
      });
      if (!response.ok) throw new Error("browser telemetry relay rejected batch");
    }
  }
}

class WorkspaceTelemetry {
  private run: TelemetryRun | null = null;
  private observer: PerformanceObserver | null = null;
  private readonly instrumentations = typeof window === "undefined" ? [] : [
    new DocumentLoadInstrumentation(),
    new FetchInstrumentation({
      ignoreUrls: [RELAY_URL_PATTERN],
      propagateTraceHeaderCorsUrls: [sameOriginPattern()],
    }),
    new XMLHttpRequestInstrumentation({
      ignoreUrls: [RELAY_URL_PATTERN],
      propagateTraceHeaderCorsUrls: [sameOriginPattern()],
    }),
  ];

  start(session: ProductSession): void {
    if (this.run || typeof window === "undefined") return;
    const sessionScope = { company_id: session.company_id, actor_id: session.actor_id };
    const exporter = new BrowserRelayExporter(sessionScope);
    const provider = new WebTracerProvider({
      spanProcessors: [new BatchSpanProcessor(exporter, {
        maxQueueSize: 256,
        maxExportBatchSize: 64,
        scheduledDelayMillis: 1_000,
        exportTimeoutMillis: 5_000,
      })],
    });
    this.run = {
      exporter,
      provider,
      tracer: provider.getTracer("fields.web"),
    };
    provider.register({ contextManager: new ZoneContextManager() });
    for (const instrumentation of this.instrumentations) {
      instrumentation.setTracerProvider(provider);
      instrumentation.enable();
    }
    window.addEventListener("error", this.recordWindowError, true);
    window.addEventListener("unhandledrejection", this.recordUnhandledRejection);
    this.observeWebVitals();
    void window.fieldsDesktop?.telemetry.authenticated(true).catch(() => undefined);
  }

  stop(): void {
    const run = this.run;
    this.run = null;
    if (!run) return;
    void window.fieldsDesktop?.telemetry.authenticated(false).catch(() => undefined);
    run.exporter.disable();
    window.removeEventListener("error", this.recordWindowError, true);
    window.removeEventListener("unhandledrejection", this.recordUnhandledRejection);
    this.observer?.disconnect();
    this.observer = null;
    for (const instrumentation of this.instrumentations) instrumentation.disable();
    // Disabling before shutdown makes a pending batch a local drop instead of
    // associating old workspace events with a subsequent session.
    void run.provider.shutdown();
  }

  recordReactError(): void {
    this.record("browser.react_error", "error", 0, "react_render");
  }

  recordError(errorClass: BrowserTelemetryErrorClass = "unknown"): void {
    this.record("browser.error", "error", 0, errorClass);
  }

  traceparent(): string | undefined {
    const run = this.run;
    if (!run) return undefined;
    // This short-lived context carrier is intentionally not a browser event.
    // It gives WebSocket procedures a W3C parent without representing the
    // long-lived connection itself as a slow browser span.
    const span = run.tracer.startSpan("browser.websocket_context");
    const spanContext = span.spanContext();
    span.end();
    return `00-${spanContext.traceId}-${spanContext.spanId}-01`;
  }

  private readonly recordWindowError = (event: Event): void => {
    this.record("browser.error", "error", 0, classifyWindowError(event));
  };
  private readonly recordUnhandledRejection = (): void => {
    this.record("browser.unhandled_rejection", "error", 0, "unhandled_promise");
  };

  private record(
    name: BrowserTelemetryEventName,
    status: "error" | "ok",
    durationMs = 0,
    errorClass: BrowserTelemetryErrorClass | null = null,
  ): void {
    const run = this.run;
    if (!run) return;
    const span = run.tracer.startSpan(name, {
      attributes: {
        "fields.browser.event": name,
        "fields.browser.error_class": errorClass ?? undefined,
        "fields.duration_ms": durationMs,
      },
    });
    if (status === "error") span.setStatus({ code: 2 });
    span.end();
  }

  private observeWebVitals(): void {
    if (typeof PerformanceObserver === "undefined") return;
    this.observer = new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) {
        if (entry.entryType === "paint" && entry.name !== "first-contentful-paint") continue;
        const value = "value" in entry && typeof entry.value === "number"
          ? entry.value
          : entry.entryType === "paint" || entry.entryType === "largest-contentful-paint"
            ? entry.startTime
            : entry.duration;
        this.record("browser.web_vital", "ok", Math.max(0, Math.min(value, 900_000)));
      }
    });
    const supportedEntryTypes = new Set(PerformanceObserver.supportedEntryTypes ?? []);
    for (const type of ["largest-contentful-paint", "paint", "layout-shift", "event"]) {
      if (supportedEntryTypes.size > 0 && !supportedEntryTypes.has(type)) continue;
      try {
        this.observer.observe({ type, buffered: true });
      } catch {
        // Unsupported web-vital entry types are a normal browser capability gap.
      }
    }
  }
}

type TelemetryRun = {
  exporter: BrowserRelayExporter;
  provider: WebTracerProvider;
  tracer: Tracer;
};

function browserRecord(span: ReadableSpan, session: TelemetrySession | null): BrowserTelemetryRecord | null {
  if (!session) return null;
  const event = eventName(span);
  if (!event) return null;
  const spanContext = span.spanContext();
  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
    parent_span_id: span.parentSpanContext?.spanId ?? null,
    name: event,
    occurred_at_ms: milliseconds(span.startTime),
    duration_ms: Math.max(0, Math.min(milliseconds(span.duration), 900_000)),
    status: span.status.code === 2 ? "error" : span.status.code === 1 ? "ok" : "unset",
    error_class: errorClass(span.attributes),
    route: controlledRoute(span.attributes),
    company_id: session.company_id,
    room_id: null,
    actor_id: session.actor_id,
    sandbox_id: null,
    thread_id: null,
    turn_id: null,
    operation_id: null,
  };
}

function errorClass(attributes: ReadableSpan["attributes"]): BrowserTelemetryErrorClass | null {
  const parsed = browserTelemetryErrorClassSchema.safeParse(attributes["fields.browser.error_class"]);
  return parsed.success ? parsed.data : null;
}

function classifyWindowError(event: Event): BrowserTelemetryErrorClass {
  if (!(event instanceof ErrorEvent)) return event.target instanceof Element ? "resource_load" : "unknown";
  const source = event.filename.trim();
  if (!source) return "unknown";
  try {
    const url = new URL(source, window.location.href);
    if (url.protocol === "chrome-extension:" || url.protocol === "moz-extension:") {
      return "browser_extension";
    }
    return url.origin === window.location.origin ? "first_party_script" : "external_script";
  } catch {
    return "unknown";
  }
}

function eventName(span: ReadableSpan): BrowserTelemetryEventName | null {
  const explicit = span.attributes["fields.browser.event"];
  if (typeof explicit === "string" && explicit.startsWith("browser.")) return explicit as BrowserTelemetryEventName;
  if (span.instrumentationScope.name.includes("document-load")) return "browser.document_load";
  if (span.instrumentationScope.name.includes("xml-http-request")) return "browser.xhr";
  if (span.instrumentationScope.name.includes("fetch")) return "browser.fetch";
  return null;
}

function controlledRoute(attributes: ReadableSpan["attributes"]): BrowserTelemetryRecord["route"] {
  const raw = [attributes["url.full"], attributes["http.url"], attributes["http.target"]]
    .find((value): value is string => typeof value === "string");
  if (!raw) return "app";
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return "external";
    if (url.pathname.startsWith("/api/v1/trpc")) return "trpc";
    if (url.pathname.startsWith("/api/auth")) return "auth";
    if (url.pathname.startsWith("/api/v1/embodiment") || url.pathname.startsWith("/embodiment")) return "embodiment";
    return "app";
  } catch {
    return "external";
  }
}

function milliseconds(time: readonly [number, number]): number {
  return time[0] * 1_000 + Math.floor(time[1] / 1_000_000);
}

function sameOriginPattern(): RegExp {
  if (typeof window === "undefined") return /^$/u;
  return new RegExp(`^${window.location.origin.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`);
}

export const workspaceTelemetry = new WorkspaceTelemetry();

// Keep the API context import live in bundled web builds; it is required by
// the configured Zone context manager for fetch/XHR propagation.
void context;
void trace;
