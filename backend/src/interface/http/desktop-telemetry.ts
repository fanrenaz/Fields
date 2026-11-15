import { SeverityNumber } from "@opentelemetry/api-logs";
import {
  desktopTelemetryBatchSchema,
  type DesktopTelemetryBatch,
  type DesktopTelemetryRecord,
} from "@fields/contracts/public/observability";
import type { ProductSession } from "@fields/contracts/public/company";

import { emitObservabilityLog } from "../../observability/events.js";
import type { ClientTelemetryContext } from "./client-telemetry.js";

const MAX_BATCH_BYTES = 256 * 1024;
const MAX_BATCHES_PER_MINUTE = 60;
const RATE_WINDOW_MS = 60_000;

export type DesktopTelemetryHttpResult =
  | { statusCode: 202; body: { accepted: number } }
  | { statusCode: 400 | 401 | 403 | 413 | 429; body: { code: string } };

type EmitLog = typeof emitObservabilityLog;

export class DesktopTelemetryRelay {
  private readonly rateWindows = new Map<string, number[]>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly emit: EmitLog = emitObservabilityLog,
  ) {}

  accept(input: {
    body: unknown;
    session: ProductSession | null;
    sessionKey: string | null;
    client: ClientTelemetryContext;
  }): DesktopTelemetryHttpResult {
    if (!input.session || input.session.company_status !== "active" || !input.sessionKey) {
      return rejected(401, "OBSERVABILITY_UNAUTHENTICATED");
    }
    if (input.client.kind !== "desktop" || !input.client.version) {
      return rejected(403, "OBSERVABILITY_DESKTOP_REQUIRED");
    }
    if (jsonByteLength(input.body) > MAX_BATCH_BYTES) {
      return rejected(413, "OBSERVABILITY_BATCH_TOO_LARGE");
    }
    const parsed = desktopTelemetryBatchSchema.safeParse(input.body);
    if (!parsed.success) return rejected(400, "OBSERVABILITY_BATCH_INVALID");
    if (!this.withinRateLimit(input.sessionKey)) {
      return rejected(429, "OBSERVABILITY_RATE_LIMITED");
    }
    this.forward(parsed.data, input.session, input.client);
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

  private forward(batch: DesktopTelemetryBatch, session: ProductSession, client: ClientTelemetryContext): void {
    for (const record of batch.records) this.forwardRecord(record, session, client);
    if (batch.dropped_count > 0) {
      this.emit("desktop.telemetry.dropped", {
        code: "desktop_queue_overflow",
        retryable: false,
        "fields.company_id": session.company_id,
        "fields.actor_id": session.actor_id,
        "fields.client_kind": "desktop",
        "fields.client_version": client.version,
        "fields.runtime_release_sha": client.runtimeRelease,
        "fields.dropped_count": batch.dropped_count,
      }, SeverityNumber.WARN);
    }
  }

  private forwardRecord(record: DesktopTelemetryRecord, session: ProductSession, client: ClientTelemetryContext): void {
    this.emit(record.event, {
      code: record.code ?? "desktop_event_ok",
      retryable: record.status === "error" && retryableCode(record.code),
      "fields.company_id": session.company_id,
      "fields.actor_id": session.actor_id,
      "fields.client_kind": "desktop",
      "fields.client_version": client.version,
      "fields.runtime_release_sha": client.runtimeRelease,
      "fields.client_platform": record.platform,
      "fields.client_arch": record.arch,
      "fields.desktop_session_id": record.desktop_session_id,
      "fields.duration_ms": record.duration_ms,
    }, record.status === "error" ? SeverityNumber.ERROR : SeverityNumber.INFO);
  }
}

function retryableCode(code: DesktopTelemetryRecord["code"]): boolean {
  return code === "network"
    || code === "http_error"
    || code === "proxy_unavailable"
    || code === "tunnel_connection_lost"
    || code === "unknown";
}

function rejected(
  statusCode: 400 | 401 | 403 | 413 | 429,
  code: string,
): DesktopTelemetryHttpResult {
  return { statusCode, body: { code } };
}

function jsonByteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return MAX_BATCH_BYTES + 1;
  }
}
