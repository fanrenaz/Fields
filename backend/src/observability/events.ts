import { ROOT_CONTEXT, SpanStatusCode, context, trace } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";

type SafeLogValue = string | number | boolean | null | undefined;

const allowedAttributes = new Set([
  "event",
  "code",
  "retryable",
  "http.status_code",
  "fields.route",
  "fields.procedure",
  "fields.operation",
  "fields.company_id",
  "fields.room_id",
  "fields.actor_id",
  "fields.sandbox_id",
  "fields.thread_id",
  "fields.turn_id",
  "fields.operation_id",
  "fields.file_count",
  "fields.byte_count",
  "fields.client_kind",
  "fields.client_version",
  "fields.runtime_release_sha",
  "fields.client_platform",
  "fields.client_arch",
  "fields.desktop_session_id",
  "fields.duration_ms",
  "fields.dropped_count",
]);

/** Emits only allowlisted structured facts; never attach Error/message/stack. */
export function emitObservabilityLog(
  event: string,
  attributes: Record<string, SafeLogValue> = {},
  severity: SeverityNumber = SeverityNumber.INFO,
): void {
  const safe: Record<string, string | number | boolean> = { event };
  for (const [key, value] of Object.entries(attributes)) {
    if (allowedAttributes.has(key) && value !== null && value !== undefined) safe[key] = value;
  }
  logs.getLogger("fields.backend").emit({
    eventName: event,
    severityNumber: severity,
    body: event,
    attributes: safe,
  });
}

/**
 * A Controller/Event operation starts outside an incoming request, so it gets
 * a fresh root trace. Only stable lifecycle identifiers are admitted.
 */
export async function withLifecycleSpan<T>(
  name: string,
  attributes: Record<string, SafeLogValue>,
  operation: () => Promise<T>,
): Promise<T> {
  const span = trace.getTracer("fields.backend.lifecycle").startSpan(name, {
    attributes: {
      "fields.operation_category": "sandbox_lifecycle",
      ...safeSpanAttributes(attributes),
    },
  }, ROOT_CONTEXT);
  try {
    return await context.with(trace.setSpan(ROOT_CONTEXT, span), operation);
  } catch (error) {
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  } finally {
    span.end();
  }
}

function safeSpanAttributes(attributes: Record<string, SafeLogValue>): Record<string, string | number | boolean> {
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (allowedAttributes.has(key) && value !== null && value !== undefined) safe[key] = value;
  }
  return safe;
}
