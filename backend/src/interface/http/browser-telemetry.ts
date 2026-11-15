import {
  SpanKind,
  SpanStatusCode,
  context,
  trace,
  type SpanContext,
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import {
  browserTelemetryBatchSchema,
  type BrowserTelemetryBatch,
  type BrowserTelemetryRecord,
} from "@fields/contracts/public/observability";
import {
  type ProductSession,
} from "@fields/contracts/public/company";
import type { ClientTelemetryContext } from "./client-telemetry.js";

const MAX_BATCH_BYTES = 256 * 1024;
const MAX_BATCHES_PER_MINUTE = 60;
const RATE_WINDOW_MS = 60_000;

export type BrowserTelemetryHttpResult =
  | { statusCode: 202; body: { accepted: number } }
  | { statusCode: 400 | 401 | 403 | 413 | 429; body: { code: string } };

/** Browser telemetry remains ephemeral: validation, rate limiting, OTLP relay. */
export class BrowserTelemetryRelay {
  private readonly rateWindows = new Map<string, number[]>();
  private readonly forwarder: BrowserTelemetryForwarder | null;
  private readonly now: () => number;

  constructor(options: { env?: NodeJS.ProcessEnv; now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
    this.forwarder = browserTelemetryForwarder(options.env ?? process.env);
  }

  accept(input: {
    body: unknown;
    session: ProductSession | null;
    sessionKey: string | null;
    client: ClientTelemetryContext;
  }): BrowserTelemetryHttpResult {
    if (!input.session || input.session.company_status !== "active" || !input.sessionKey) {
      return rejected(401, "OBSERVABILITY_UNAUTHENTICATED");
    }
    if (jsonByteLength(input.body) > MAX_BATCH_BYTES) {
      return rejected(413, "OBSERVABILITY_BATCH_TOO_LARGE");
    }
    const parsed = browserTelemetryBatchSchema.safeParse(input.body);
    if (!parsed.success) {
      return rejected(400, "OBSERVABILITY_BATCH_INVALID");
    }
    if (!this.withinRateLimit(input.sessionKey)) {
      return rejected(429, "OBSERVABILITY_RATE_LIMITED");
    }
    if (!belongsToSession(parsed.data, input.session)) {
      return rejected(403, "OBSERVABILITY_SCOPE_DENIED");
    }
    this.forwarder?.forward(parsed.data, input.session, input.client);
    return { statusCode: 202, body: { accepted: parsed.data.records.length } };
  }

  private withinRateLimit(sessionKey: string): boolean {
    const now = this.now();
    const values = (this.rateWindows.get(sessionKey) ?? []).filter((value) => value > now - RATE_WINDOW_MS);
    if (values.length >= MAX_BATCHES_PER_MINUTE) {
      this.rateWindows.set(sessionKey, values);
      return false;
    }
    values.push(now);
    this.rateWindows.set(sessionKey, values);
    return true;
  }
}

function rejected(statusCode: 400 | 401 | 403 | 413 | 429, code: string): BrowserTelemetryHttpResult {
  return { statusCode, body: { code } };
}

function jsonByteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return MAX_BATCH_BYTES + 1;
  }
}

function belongsToSession(batch: BrowserTelemetryBatch, session: ProductSession): boolean {
  return batch.records.every((record) => (
    (record.company_id === null || record.company_id === session.company_id)
    && (record.actor_id === null || record.actor_id === session.actor_id)
  ));
}

class BrowserTelemetryForwarder {
  private readonly provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      "service.name": "fields-web",
      "service.namespace": "fields",
    }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter(), {
      maxQueueSize: 2_048,
      maxExportBatchSize: 64,
      scheduledDelayMillis: 1_000,
      exportTimeoutMillis: 5_000,
    })],
  });
  private readonly tracer = this.provider.getTracer("fields.browser.relay");

  forward(
    batch: BrowserTelemetryBatch,
    session: ProductSession,
    client: ClientTelemetryContext,
  ): void {
    for (const record of batch.records) {
      const span = this.tracer.startSpan(record.name, {
        kind: SpanKind.CLIENT,
        startTime: record.occurred_at_ms,
        attributes: browserAttributes(record, session, client),
      }, trace.setSpanContext(context.active(), remoteParent(record)));
      if (record.status === "error") span.setStatus({ code: SpanStatusCode.ERROR });
      if (record.status === "ok") span.setStatus({ code: SpanStatusCode.OK });
      span.end(record.occurred_at_ms + record.duration_ms);
    }
  }
}

function browserTelemetryForwarder(env: NodeJS.ProcessEnv): BrowserTelemetryForwarder | null {
  return env.OTEL_SDK_DISABLED === "true" || !env.OTEL_EXPORTER_OTLP_ENDPOINT
    ? null
    : new BrowserTelemetryForwarder();
}

function remoteParent(record: BrowserTelemetryRecord): SpanContext {
  return {
    traceId: record.trace_id,
    spanId: record.parent_span_id ?? record.span_id,
    traceFlags: 1,
    isRemote: true,
  };
}

function browserAttributes(
  record: BrowserTelemetryRecord,
  session: ProductSession,
  client: ClientTelemetryContext,
): Record<string, string | number> {
  const attributes: Record<string, string | number> = {
    "fields.event": record.name,
    "fields.route": record.route,
    "fields.operation_category": "browser_api",
    "fields.company_id": record.company_id ?? session.company_id,
    "fields.actor_id": record.actor_id ?? session.actor_id,
    "fields.client_kind": client.kind,
  };
  if (client.version) attributes["fields.client_version"] = client.version;
  if (client.runtimeRelease) attributes["fields.runtime_release_sha"] = client.runtimeRelease;
  if (record.error_class) attributes["fields.error_class"] = record.error_class;
  for (const [key, value] of Object.entries({
    room_id: record.room_id,
    sandbox_id: record.sandbox_id,
    thread_id: record.thread_id,
    turn_id: record.turn_id,
    operation_id: record.operation_id,
  })) {
    if (value) attributes[`fields.${key}`] = value;
  }
  return attributes;
}
