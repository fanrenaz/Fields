import type {
  CodexAgentRuntimeInteractionRequest,
} from "@fields/contracts/internal/agent-runtime";
import { agentQuestionInteractionSchema } from "@fields/contracts/public/agent-activity";
import type { RoomMessageInteraction } from "@fields/contracts/public/room";

export function projectCodexInteraction(
  event: CodexAgentRuntimeInteractionRequest,
): RoomMessageInteraction {
  if (event.method !== "item/tool/requestUserInput") {
    return {
      id: event.event_id,
      kind: "delegation_check",
      label: projectCodexInteractionLabel(event),
      status: "pending",
      responses: [
        { value: "approve", label: "Approve" },
        { value: "reject", label: "Reject" },
      ],
    };
  }
  const payload = asRecord(event.payload);
  const questions = Array.isArray(payload?.questions) ? payload.questions.flatMap((entry) => {
    const question = asRecord(entry);
    if (typeof question?.id !== "string" || typeof question.question !== "string") return [];
    return [{
      id: question.id,
      header: typeof question.header === "string" ? question.header : "",
      question: question.question,
      allow_other: question.isOther === true,
      secret: question.isSecret === true,
      options: question.options === null ? null : Array.isArray(question.options)
        ? question.options.flatMap((entry) => {
          const option = asRecord(entry);
          return typeof option?.label === "string"
            ? [{ label: option.label, description: typeof option.description === "string" ? option.description : "" }]
            : [];
        })
        : null,
    }];
  }) : [];
  return {
    ...agentQuestionInteractionSchema.parse({
      id: event.event_id,
      item_id: event.item_id ?? event.event_id,
      status: "pending",
      questions,
      answers: {},
      resolution: null,
      deadline_at_ms: event.occurred_at_ms + 90_000,
      created_at_ms: event.occurred_at_ms,
      completed_at_ms: null,
    }),
    kind: "request_user_input",
  };
}

/**
 * Projects an in-flight provider request to a provider-neutral label. Request
 * ids and raw payloads deliberately stay outside the returned value.
 */
export function projectCodexInteractionLabel(
  event: CodexAgentRuntimeInteractionRequest,
): string {
  const payload = asRecord(event.payload);
  const reason = safeText(payload?.reason);
  const command = commandText(payload?.command);
  const fallback = event.method === "item/fileChange/requestApproval"
    || event.method === "applyPatchApproval"
    ? "Approve the proposed file changes?"
    : event.method === "item/permissions/requestApproval"
      ? "Approve the requested permissions?"
      : "Approve the requested command?";
  return truncate(reason ?? command ?? fallback, 500);
}

function commandText(value: unknown): string | null {
  if (Array.isArray(value)) {
    return safeText(value.filter((entry): entry is string => typeof entry === "string").join(" "));
  }
  return safeText(value);
}

function safeText(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  return value.trim()
    .replace(/(["']?(?:access|refresh|execution)[_-]?token["']?\s*[:=]\s*)\S+/giu, "$1[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/giu, "Bearer [redacted]");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}
