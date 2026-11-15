import assert from "node:assert/strict";
import test from "node:test";

import type { CodexAgentRuntimeEnvelope, CodexAgentRuntimeEvent } from "@fields/contracts/internal/agent-runtime";

import {
  projectCodexHomeTurnEvents,
} from "../../src/infrastructure/runtime/codex-activity/codex-home-stream-projector.js";

test("Home Turn streams project Runtime Codex envelopes into public Agent Turn events", async () => {
  const events = projectCodexHomeTurnEvents({
    events: source(runtimeEvent("turn/started", {
      turn: {
        id: "turn-one",
        items: [],
        itemsView: "full",
        status: "inProgress",
        error: null,
        startedAt: 1,
        completedAt: null,
        durationMs: null,
      },
    })),
    memberId: "member-one",
    threadId: "thread-one",
  });

  const projected = [];
  for await (const event of events) projected.push(event);

  assert.equal(projected.length, 1);
  assert.equal(projected[0]?.type, "agent_turn.snapshot");
  assert.equal(projected[0]?.source, "backend");
  assert.deepEqual(projected[0]?.scope, {
    type: "home",
    member_id: "member-one",
    thread_id: "thread-one",
  });
});

test("Home question requests become provider-neutral interaction events", async () => {
  const request: CodexAgentRuntimeEnvelope = {
    ...runtimeEvent("unused", null),
    type: "agent_runtime.interaction_request",
    method: "item/tool/requestUserInput",
    request_id: 7,
    item_id: "question-item",
    payload: {
      questions: [{
        id: "environment",
        header: "Environment",
        question: "Where should this run?",
        isOther: true,
        isSecret: false,
        options: [{ label: "Production", description: "Use the live environment." }],
      }],
      autoResolutionMs: 5,
    },
  };
  const projected = [];
  for await (const event of projectCodexHomeTurnEvents({
    events: source(request),
    memberId: "member-one",
    threadId: "thread-one",
  })) projected.push(event);
  assert.equal(projected[0]?.type, "agent_turn.question_interaction");
  if (projected[0]?.type !== "agent_turn.question_interaction") assert.fail("missing question interaction");
  assert.equal(projected[0].interaction.questions[0]?.allow_other, true);
  assert.equal(projected[0].interaction.deadline_at_ms, null);
});

function runtimeEvent(method: string, payload: unknown): CodexAgentRuntimeEvent {
  return {
    schema_version: 1,
    event_id: "runtime-event",
    provider: "codex",
    source: "company-runtime",
    scope: {
      type: "home",
      member_id: "member-one",
      thread_id: "thread-one",
    },
    turn_id: "turn-one",
    occurred_at_ms: 1_000,
    type: "agent_runtime.event",
    method,
    item_id: null,
    payload,
  };
}

async function* source(event: CodexAgentRuntimeEnvelope): AsyncGenerator<CodexAgentRuntimeEnvelope> {
  yield event;
}
