import assert from "node:assert/strict";
import test from "node:test";

import {
  CodexActivityAdapter,
  convertCodexSessionEnvelope,
  createCodexSessionProjection,
} from "../../src/infrastructure/runtime/codex-activity/index.js";

const scope = {
  type: "room" as const,
  room_id: "room-1",
  agent_member_id: "agent-1",
  execution_id: "execution-1",
};

test("Codex Session snapshots project every Turn without exposing provider fields", () => {
  const projected = convertCodexSessionEnvelope(
    new CodexActivityAdapter({ warningSink: () => undefined }),
    createCodexSessionProjection(),
    {
      schema_version: 1,
      event_id: "session-1",
      provider: "codex",
      type: "agent_runtime.session_snapshot",
      source: "company-runtime",
      scope,
      turn_id: "turn-2",
      method: "thread/snapshot",
      item_id: null,
      occurred_at_ms: 30,
      payload: {
        room_thread_id: "message-root",
        selected_turn_id: "turn-2",
        turns: [
          turn("turn-1", "completed", [{
            type: "userMessage",
            id: "user-1",
            clientId: "provider-client-secret",
            content: [{
              type: "text",
              text: [
                "A Human mentioned this Actor in a Fields Room message.",
                "Use this execution_token exactly: runtime-secret",
                "Source message id: source-secret",
                "Source sender: Yifan (sender-secret)",
                "Source message:",
                "What changed?",
              ].join("\n\n"),
              text_elements: [],
            }],
          }]),
          turn("turn-2", "inProgress"),
        ],
      },
    },
    "room-1",
  );

  assert.ok(!Array.isArray(projected));
  assert.equal(projected.type, "agent_session.snapshot");
  assert.equal(projected.snapshot.selected_turn_id, "turn-2");
  assert.deepEqual(projected.snapshot.turns.map((item) => [item.turn_id, item.status]), [
    ["turn-1", "completed"],
    ["turn-2", "running"],
  ]);
  assert.deepEqual(projected.snapshot.turns[0]?.narrative_items, [{
    id: "user-1",
    type: "user_message",
    status: "completed",
    content: [{ type: "markdown", markdown: "What changed?" }],
  }]);
  const json = JSON.stringify(projected);
  assert.equal(json.includes("provider"), false);
  assert.equal(json.includes("agent_runtime"), false);
  assert.equal(json.includes("thread/snapshot"), false);
  for (const secret of ["runtime-secret", "source-secret", "sender-secret", "provider-client-secret"]) {
    assert.equal(json.includes(secret), false, secret);
  }
});

test("Codex Session live events stay bound to the authorized Room and Agent", () => {
  const adapter = new CodexActivityAdapter({ warningSink: () => undefined });
  const projection = createCodexSessionProjection();
  convertCodexSessionEnvelope(adapter, projection, sessionSnapshot(), "room-1");

  assert.throws(() => convertCodexSessionEnvelope(adapter, projection, {
    ...sessionSnapshot(),
    event_id: "wrong-agent",
    scope: { ...scope, agent_member_id: "agent-2" },
  }, "room-1"));
  assert.throws(() => convertCodexSessionEnvelope(adapter, createCodexSessionProjection(), {
    ...sessionSnapshot(),
    event_id: "wrong-room",
    scope: { ...scope, room_id: "room-2" },
  }, "room-1"));
});

function sessionSnapshot() {
  return {
    schema_version: 1,
    event_id: "session-1",
    provider: "codex",
    type: "agent_runtime.session_snapshot",
    source: "company-runtime",
    scope,
    turn_id: "turn-1",
    method: "thread/snapshot",
    item_id: null,
    occurred_at_ms: 30,
    payload: {
      room_thread_id: "message-root",
      selected_turn_id: "turn-1",
      turns: [turn("turn-1", "completed")],
    },
  };
}

function turn(id: string, status: "completed" | "inProgress", items: unknown[] = []) {
  return {
    id,
    items,
    itemsView: "full" as const,
    status,
    error: null,
    startedAt: 1,
    completedAt: status === "completed" ? 2 : null,
    durationMs: status === "completed" ? 1_000 : null,
  };
}
