import {
  agentSessionSnapshotEventSchema,
  agentTurnEventSchema,
  type AgentSessionSnapshotEvent,
  type AgentTurnEvent,
  type AgentTurnScope,
} from "@fields/contracts/public/agent-activity";
import {
  codexAgentRuntimeEventSchema,
  codexAgentRuntimeSessionSnapshotSchema,
  codexAgentRuntimeSnapshotSchema,
  type CodexAgentRuntimeEvent,
  type CodexAgentRuntimeSessionSnapshot,
  type CodexAgentRuntimeSnapshot,
} from "@fields/contracts/internal/agent-runtime";
import type { Turn } from "@fields/contracts/codex-app-server-protocol/v2";

import { CodexActivityAdapter } from "./codex-activity-adapter.js";
import type { AgentActivityProjection } from "./types.js";

export type CodexSessionProjection = {
  scope: AgentTurnScope | null;
  turns: Map<string, AgentActivityProjection>;
};

export function createCodexSessionProjection(): CodexSessionProjection {
  return { scope: null, turns: new Map() };
}

export function convertCodexSessionEnvelope(
  adapter: CodexActivityAdapter,
  session: CodexSessionProjection,
  value: unknown,
  expectedRoomId: string,
): AgentSessionSnapshotEvent | AgentTurnEvent[] {
  const type = eventType(value);
  if (type === "agent_runtime.session_snapshot") {
    const event = codexAgentRuntimeSessionSnapshotSchema.parse(value);
    assertAuthorizedScope(session, event, expectedRoomId);
    return convertSessionSnapshot(adapter, session, event);
  }
  if (type === "agent_runtime.snapshot") {
    const event = codexAgentRuntimeSnapshotSchema.parse(value);
    assertAuthorizedScope(session, event, expectedRoomId);
    const projection = projectionForTurn(adapter, session, event.turn_id);
    return [agentTurnEventSchema.parse(adapter.convertSnapshot(projection, event))];
  }
  const event = codexAgentRuntimeEventSchema.parse(value);
  assertAuthorizedScope(session, event, expectedRoomId);
  const projection = projectionForTurn(adapter, session, event.turn_id);
  return adapter.convertEvent(projection, event).map((item) => agentTurnEventSchema.parse(item));
}

function convertSessionSnapshot(
  adapter: CodexActivityAdapter,
  session: CodexSessionProjection,
  event: CodexAgentRuntimeSessionSnapshot,
): AgentSessionSnapshotEvent {
  session.turns.clear();
  const turns = event.payload.turns.map((turn) => {
    const projection = adapter.createProjection();
    session.turns.set(turn.id, projection);
    const projected = adapter.convertSnapshot(projection, syntheticTurnSnapshot(event, turn));
    if (projected.type !== "agent_turn.snapshot") {
      throw new Error("The authoritative Session Turn did not produce a snapshot.");
    }
    return projected.snapshot;
  });
  return agentSessionSnapshotEventSchema.parse({
    schema_version: 1,
    event_id: event.event_id,
    type: "agent_session.snapshot",
    source: "backend",
    scope: event.scope,
    occurred_at_ms: event.occurred_at_ms,
    snapshot: {
      room_thread_id: event.payload.room_thread_id,
      selected_turn_id: event.payload.selected_turn_id,
      turns,
    },
  });
}

function syntheticTurnSnapshot(event: CodexAgentRuntimeSessionSnapshot, turn: Turn): CodexAgentRuntimeSnapshot {
  return {
    schema_version: 1,
    event_id: `${event.event_id}:${turn.id}`,
    provider: "codex",
    type: "agent_runtime.snapshot",
    source: "company-runtime",
    scope: event.scope,
    turn_id: turn.id,
    method: "turn/snapshot",
    item_id: null,
    occurred_at_ms: event.occurred_at_ms,
    payload: {
      execution: {
        status: turn.status === "inProgress" ? "running" : turn.status,
        started_at_ms: null,
        completed_at_ms: null,
        duration_ms: null,
        error: null,
      },
      turn,
    },
  };
}

function projectionForTurn(
  adapter: CodexActivityAdapter,
  session: CodexSessionProjection,
  turnId: string | null,
): AgentActivityProjection {
  if (turnId === null) {
    throw new Error("Agent Session runtime events must identify a Turn.");
  }
  const existing = session.turns.get(turnId);
  if (existing) return existing;
  const created = adapter.createProjection();
  session.turns.set(turnId, created);
  return created;
}

function assertAuthorizedScope(
  session: CodexSessionProjection,
  event: CodexAgentRuntimeSessionSnapshot | CodexAgentRuntimeSnapshot | CodexAgentRuntimeEvent,
  expectedRoomId: string,
): void {
  if (event.source !== "company-runtime" || event.scope.type !== "room" || event.scope.room_id !== expectedRoomId) {
    throw new Error("The Agent Session envelope did not match the authorized Room scope.");
  }
  if (session.scope === null) {
    session.scope = event.scope;
    return;
  }
  if (scopeKey(session.scope) !== scopeKey(event.scope)) {
    throw new Error("The Agent Session scope changed within one subscription.");
  }
}

function eventType(value: unknown): string | null {
  return typeof value === "object" && value !== null && "type" in value && typeof value.type === "string"
    ? value.type
    : null;
}

function scopeKey(scope: AgentTurnScope): string {
  return scope.type === "room"
    ? `room\u0000${scope.room_id}\u0000${scope.agent_member_id}\u0000${scope.execution_id}`
    : `home\u0000${scope.member_id}\u0000${scope.thread_id}`;
}
