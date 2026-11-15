import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("fields.backend.http");
const requestCounter = meter.createCounter("fields.http.server.requests", {
  description: "Completed Backend HTTP requests.",
  unit: "{request}",
});
const requestDuration = meter.createHistogram("fields.http.server.duration", {
  description: "Completed Backend HTTP request duration.",
  unit: "ms",
});
const startedAt = new WeakMap<object, number>();

/** Metric labels remain deliberately low-cardinality and product-ID free. */
export function startHttpMetric(request: object): void {
  startedAt.set(request, Date.now());
}

export function completeHttpMetric(
  request: object,
  route: string,
  statusCode: number,
  clientKind: "web" | "desktop" | "unknown",
): void {
  const durationMs = Math.max(0, Date.now() - (startedAt.get(request) ?? Date.now()));
  const attributes = {
    "http.route": route,
    "http.response.status_code": statusCode,
    "fields.client_kind": clientKind,
  };
  requestCounter.add(1, attributes);
  requestDuration.record(durationMs, attributes);
  startedAt.delete(request);
}
