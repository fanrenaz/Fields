import {
  agentQuestionInteractionSchema,
  homeAgentTurnEventSchema,
  type AgentQuestionInteraction,
  type HomeAgentTurnEvent,
} from "@fields/contracts/public/agent-activity";
import {
  codexAgentRuntimeInteractionRequestSchema,
  codexAgentRuntimeEventSchema,
} from "@fields/contracts/internal/agent-runtime";

import { CodexActivityAdapter } from "./codex-activity-adapter.js";

export async function* projectCodexHomeTurnEvents(input: {
  events: AsyncIterable<unknown>;
  memberId: string;
  threadId?: string;
}): AsyncGenerator<HomeAgentTurnEvent> {
  const adapter = new CodexActivityAdapter();
  const projections = new Map<string, ReturnType<CodexActivityAdapter["createProjection"]>>();
  for await (const value of input.events) {
    const event = value && typeof value === "object" && "type" in value && value.type === "agent_runtime.interaction_request"
      ? codexAgentRuntimeInteractionRequestSchema.parse(value)
      : codexAgentRuntimeEventSchema.parse(value);
    if (
      event.scope.type !== "home"
      || event.scope.member_id !== input.memberId
      || (input.threadId !== undefined && event.scope.thread_id !== input.threadId)
    ) {
      throw new Error("Company Runtime Home Turn event scope did not match the subscription.");
    }
    const threadId = event.scope.thread_id;
    if (event.type === "agent_runtime.interaction_request") {
      if (event.method !== "item/tool/requestUserInput") continue;
      yield homeAgentTurnEventSchema.parse({
        schema_version: 2,
        event_id: event.event_id,
        type: "agent_turn.question_interaction",
        source: "backend",
        scope: event.scope,
        turn_id: event.turn_id,
        occurred_at_ms: event.occurred_at_ms,
        interaction: projectQuestionInteraction(event.event_id, event.item_id, event.payload, event.occurred_at_ms),
      }) as HomeAgentTurnEvent;
      continue;
    }
    if (event.method === "fields/questionInteractionResolved") {
      yield homeAgentTurnEventSchema.parse({
        schema_version: 2,
        event_id: event.event_id,
        type: "agent_turn.question_interaction",
        source: "backend",
        scope: event.scope,
        turn_id: event.turn_id,
        occurred_at_ms: event.occurred_at_ms,
        interaction: agentQuestionInteractionSchema.parse(event.payload),
      }) as HomeAgentTurnEvent;
      continue;
    }
    const projection = projections.get(threadId) ?? adapter.createProjection();
    projections.set(threadId, projection);
    for (const projected of adapter.convertEvent(projection, event)) {
      yield homeAgentTurnEventSchema.parse(projected) as HomeAgentTurnEvent;
      if (projected.type === "agent_turn.status" && ["completed", "failed", "interrupted"].includes(projected.status)) projections.delete(threadId);
    }
  }
}

function projectQuestionInteraction(
  id: string,
  itemId: string | null,
  value: unknown,
  createdAtMs: number,
): AgentQuestionInteraction {
  const payload = record(value);
  const questions = Array.isArray(payload.questions) ? payload.questions.flatMap((entry) => {
    const question = record(entry);
    if (typeof question.id !== "string" || typeof question.question !== "string") return [];
    return [{
      id: question.id,
      header: typeof question.header === "string" ? question.header : "",
      question: question.question,
      allow_other: question.isOther === true,
      secret: question.isSecret === true,
      options: question.options === null ? null : Array.isArray(question.options)
        ? question.options.flatMap((entry) => {
          const option = record(entry);
          return typeof option.label === "string"
            ? [{ label: option.label, description: typeof option.description === "string" ? option.description : "" }]
            : [];
        })
        : null,
    }];
  }) : [];
  return agentQuestionInteractionSchema.parse({
    id,
    item_id: itemId ?? id,
    status: "pending",
    questions,
    answers: {},
    resolution: null,
    deadline_at_ms: null,
    created_at_ms: createdAtMs,
    completed_at_ms: null,
  });
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}
