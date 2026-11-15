import { createHash } from "node:crypto";
import { metrics } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";

type SafeLogValue = string | number | boolean | null | undefined;
const allowedAttributes = new Set([
  "event",
  "code",
  "retryable",
  "result",
  "duration_ms",
  "stage",
  "fields.actor_id",
  "fields.thread_id",
  "fields.operation_id",
  "fields.plugin_version",
  "fields.mailbox_ref",
  "fields.refreshed_count",
  "fields.failed_count",
  "fields.file_count",
  "fields.byte_count",
  "fields.asset_version_id",
  "fields.tool_name",
  "fields.response_bytes",
]);
const meter = metrics.getMeter("fields.company-runtime");
const pluginOperations = meter.createCounter("fields.plugin.operations", {
  description: "Fields Core Plugin materialization, installation, and verification operations.",
});
const pluginOperationDuration = meter.createHistogram("fields.plugin.operation.duration", {
  description: "Duration of Fields Core Plugin operations.",
  unit: "ms",
});
const roomContextResolutions = meter.createCounter("fields.room_context.resolutions", {
  description: "Fields Room Context resolution outcomes.",
});
const roomToolCalls = meter.createCounter("fields.room_messages.tool.calls", {
  description: "Fields Room Messages Tool outcomes.",
});
const roomToolDuration = meter.createHistogram("fields.room_messages.tool.duration", {
  description: "Duration of Fields Room Messages Tool calls.",
  unit: "ms",
});
const memberActivations = meter.createCounter("fields.member.activation.operations", {
  description: "Member App Server activation outcomes.",
});
const memberActivationDuration = meter.createHistogram("fields.member.activation.duration", {
  description: "Member App Server activation duration.",
  unit: "ms",
});
const memberAssetOperations = meter.createCounter("fields.member_assets.operations", {
  description: "Member asset apply and credential refresh outcomes.",
});
const assetMcpToolOperations = meter.createCounter("fields.asset_mcp.tool.operations", {
  description: "Company MCP asset tool discovery and invocation outcomes.",
});
const assetMcpToolOperationDuration = meter.createHistogram("fields.asset_mcp.tool.duration", {
  description: "Duration of Company MCP asset tool discovery and invocation.",
  unit: "ms",
});
const mailIndexRefreshes = meter.createCounter("fields.mail.index.refreshes", {
  description: "Continuous Mail index refresh outcomes.",
});
const mailIndexRefreshDuration = meter.createHistogram("fields.mail.index.refresh.duration", {
  description: "Continuous Mail index refresh duration.",
  unit: "ms",
});

export function emitLifecycleEvent(
  event: string,
  attributes: Record<string, SafeLogValue> = {},
  severity: SeverityNumber = SeverityNumber.INFO,
): void {
  const safe: Record<string, string | number | boolean> = { event };
  for (const [key, value] of Object.entries(attributes)) {
    if (allowedAttributes.has(key) && value !== null && value !== undefined) safe[key] = value;
  }
  logs.getLogger("fields.company-runtime").emit({ eventName: event, severityNumber: severity, body: event, attributes: safe });
}

export function recordPluginOperation(input: {
  operation: "materialize" | "install" | "verify";
  result: "succeeded" | "failed";
  durationMs: number;
  version?: string | null;
  code?: string | null;
}): void {
  const attributes = {
    operation: input.operation,
    result: input.result,
    ...(input.version ? { version: input.version } : {}),
    ...(input.code ? { code: input.code } : {}),
  };
  pluginOperations.add(1, attributes);
  pluginOperationDuration.record(input.durationMs, attributes);
  emitLifecycleEvent(`codex.plugin.${input.operation}`, {
    result: input.result,
    duration_ms: input.durationMs,
    code: input.code,
    "fields.plugin_version": input.version,
    retryable: input.result === "failed",
  }, input.result === "failed" ? SeverityNumber.ERROR : SeverityNumber.INFO);
}

export function recordMemberActivation(input: {
  memberId: string;
  result: "succeeded" | "failed";
  stage: string;
  durationMs: number;
  code?: string | null;
}): void {
  const attributes = {
    result: input.result,
    stage: input.stage,
    ...(input.code ? { code: input.code } : {}),
  };
  memberActivations.add(1, attributes);
  memberActivationDuration.record(input.durationMs, attributes);
  emitLifecycleEvent("codex.member.activation", {
    result: input.result,
    stage: input.stage,
    duration_ms: input.durationMs,
    code: input.code,
    retryable: input.result === "failed",
    "fields.actor_id": input.memberId,
  }, input.result === "failed" ? SeverityNumber.ERROR : SeverityNumber.INFO);
}

export function recordMemberAssetOperation(input: {
  memberId: string;
  operationId: string;
  result: "succeeded" | "failed";
  code?: string | null;
}): void {
  const attributes = {
    result: input.result,
    ...(input.code ? { code: input.code } : {}),
  };
  memberAssetOperations.add(1, attributes);
  emitLifecycleEvent("codex.member_assets.apply", {
    result: input.result,
    code: input.code,
    retryable: input.result === "failed",
    "fields.actor_id": input.memberId,
    "fields.operation_id": input.operationId,
  }, input.result === "failed" ? SeverityNumber.ERROR : SeverityNumber.INFO);
}

export function recordAssetMcpToolOperation(input: {
  actorId: string;
  versionId: string;
  operation: "list" | "call";
  toolName?: string;
  result: "succeeded" | "failed" | "unknown";
  durationMs: number;
  responseBytes?: number;
  code?: string | null;
}): void {
  const attributes = {
    operation: input.operation,
    result: input.result,
    ...(input.code ? { code: input.code } : {}),
  };
  assetMcpToolOperations.add(1, attributes);
  assetMcpToolOperationDuration.record(input.durationMs, attributes);
  emitLifecycleEvent(`mcp.asset.tools.${input.operation}`, {
    result: input.result,
    code: input.code,
    duration_ms: input.durationMs,
    retryable: false,
    "fields.actor_id": input.actorId,
    "fields.asset_version_id": input.versionId,
    "fields.tool_name": input.toolName,
    "fields.response_bytes": input.responseBytes,
  }, input.result === "succeeded" ? SeverityNumber.INFO : SeverityNumber.WARN);
}

export function recordRoomContextResolution(
  result: "resolved" | "unavailable" | "ambiguous" | "mismatch",
  threadId: string,
): void {
  roomContextResolutions.add(1, { result });
  emitLifecycleEvent("codex.room_context.resolve", {
    result,
    "fields.thread_id": threadId,
    retryable: result !== "resolved",
  }, result === "resolved" ? SeverityNumber.INFO : SeverityNumber.WARN);
}

export function recordRoomMessagesToolCall(input: {
  result: "succeeded" | "failed";
  code?: string | null;
  durationMs: number;
}): void {
  const attributes = {
    result: input.result,
    ...(input.code ? { code: input.code } : {}),
  };
  roomToolCalls.add(1, attributes);
  roomToolDuration.record(input.durationMs, attributes);
  emitLifecycleEvent("mcp.room_messages.read", {
    result: input.result,
    code: input.code,
    duration_ms: input.durationMs,
    retryable: input.result === "failed",
  }, input.result === "failed" ? SeverityNumber.WARN : SeverityNumber.INFO);
}

export type MailIndexRefreshTelemetryInput = {
  refreshedMailboxIds: string[];
  failedMailboxIds: string[];
  durationMs: number;
  cycleFailed?: boolean;
};

export function mailIndexRefreshTelemetry(input: MailIndexRefreshTelemetryInput): {
  summary: {
    result: "succeeded" | "partial" | "failed";
    duration_ms: number;
    refreshed_count: number;
    failed_count: number;
  };
  mailboxes: Array<{
    result: "succeeded" | "failed";
    mailbox_ref: string;
  }>;
} {
  const result = input.cycleFailed
    ? "failed"
    : input.failedMailboxIds.length > 0
      ? "partial"
      : "succeeded";
  return {
    summary: {
      result,
      duration_ms: Math.max(0, input.durationMs),
      refreshed_count: input.refreshedMailboxIds.length,
      failed_count: input.failedMailboxIds.length,
    },
    mailboxes: [
      ...input.refreshedMailboxIds.map((mailboxId) => ({
        result: "succeeded" as const,
        mailbox_ref: opaqueRef(mailboxId),
      })),
      ...input.failedMailboxIds.map((mailboxId) => ({
        result: "failed" as const,
        mailbox_ref: opaqueRef(mailboxId),
      })),
    ],
  };
}

export function recordMailIndexRefresh(input: MailIndexRefreshTelemetryInput): void {
  const telemetry = mailIndexRefreshTelemetry(input);
  const attributes = {
    result: telemetry.summary.result,
    refreshed_count: telemetry.summary.refreshed_count,
    failed_count: telemetry.summary.failed_count,
  };
  mailIndexRefreshes.add(1, attributes);
  mailIndexRefreshDuration.record(telemetry.summary.duration_ms, attributes);
  emitLifecycleEvent("mail.index.refresh", {
    result: telemetry.summary.result,
    duration_ms: telemetry.summary.duration_ms,
    retryable: telemetry.summary.result !== "succeeded",
    "fields.refreshed_count": telemetry.summary.refreshed_count,
    "fields.failed_count": telemetry.summary.failed_count,
  }, telemetry.summary.result === "succeeded" ? SeverityNumber.INFO : SeverityNumber.WARN);
  for (const mailbox of telemetry.mailboxes) {
    emitLifecycleEvent("mail.index.mailbox_refresh", {
      result: mailbox.result,
      retryable: mailbox.result === "failed",
      "fields.mailbox_ref": mailbox.mailbox_ref,
    }, mailbox.result === "failed" ? SeverityNumber.WARN : SeverityNumber.INFO);
  }
}

function opaqueRef(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
