import type { Context } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import {
  BatchSpanProcessor,
  type ReadableSpan,
  type Span,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";

const allowedAttributes = new Set([
  "event",
  "code",
  "retryable",
  "http.status_code",
  "http.response.status_code",
  "fields.event",
  "fields.route",
  "fields.procedure",
  "fields.operation",
  "fields.operation_category",
  "fields.company_id",
  "fields.room_id",
  "fields.actor_id",
  "fields.sandbox_id",
  "fields.thread_id",
  "fields.turn_id",
  "fields.operation_id",
  "fields.client_kind",
  "fields.client_version",
  "fields.runtime_release_sha",
]);

/**
 * OTLP exporters receive only the stable facts promised by the product
 * contract. Automatic instrumentation is useful for timing and parentage,
 * but its network and exception attributes are never browser-visible data.
 */
export class SanitizingSpanProcessor implements SpanProcessor {
  private readonly delegate = new BatchSpanProcessor(new OTLPTraceExporter());

  onStart(span: Span, parentContext: Context): void {
    redactSpan(span);
    this.delegate.onStart(span, parentContext);
  }

  onEnding(span: Span): void {
    redactSpan(span);
  }

  onEnd(span: ReadableSpan): void {
    redactSpan(span);
    this.delegate.onEnd(span);
  }

  forceFlush(): Promise<void> {
    return this.delegate.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.delegate.shutdown();
  }
}

export function redactSpan(span: Pick<ReadableSpan, "attributes" | "events" | "status">): void {
  const mutable = span as unknown as {
    attributes: Record<string, unknown>;
    events: unknown[];
    status: { code: number; message?: string };
  };
  for (const key of Object.keys(mutable.attributes)) if (!allowedAttributes.has(key)) delete mutable.attributes[key];
  // Automatic instrumentation may record an Error as an event. Product spans
  // use status and allowlisted attributes instead, so events are not needed.
  mutable.events.length = 0;
  mutable.status = { code: mutable.status.code };
}
