import assert from "node:assert/strict";
import test from "node:test";

import {
  agentTurnEventSchema,
  homeAgentTurnEventStreamSchema,
  roomAgentTurnEventSchema,
  roomAgentTurnEventStreamSchema,
} from "../dist/public/agent-activity.js";
import {
  homeModelOptionsResultSchema,
  homeThreadListInputSchema,
  homeThreadListResultSchema,
  homeThreadReadInputSchema,
  homeThreadSettingsResultSchema,
  homeTurnSubmitInputSchema,
} from "../dist/public/home.js";
import {
  codexAgentRuntimeInteractionRequestSchema,
  codexAgentRuntimeEventSchema,
  codexAgentRuntimeEventStreamSchema,
} from "../dist/internal/agent-runtime.js";

function rejected(schema, value) {
  assert.equal(schema.safeParse(value).success, false);
}

const snapshot = {
  schema_version: 2,
  event_id: "event_one",
  source: "backend",
  scope: {
    type: "room",
    room_id: "room_one",
    agent_member_id: "agent_one",
    execution_id: "execution_one",
  },
  turn_id: "turn_one",
  occurred_at_ms: 10,
  type: "agent_turn.snapshot",
  snapshot: {
    turn_id: "turn_one",
    status: "running",
    started_at_ms: 10,
    completed_at_ms: null,
    duration_ms: null,
    error: null,
    narrative_items: [],
    activity_items: [],
  },
};

test("public Agent activity is Backend-owned and keyed by execution", () => {
  assert.deepEqual(agentTurnEventSchema.parse(snapshot), snapshot);
  assert.deepEqual(roomAgentTurnEventSchema.parse(snapshot), snapshot);
  rejected(agentTurnEventSchema, {
    ...snapshot,
    source: "company-runtime",
  });
  rejected(roomAgentTurnEventSchema, {
    ...snapshot,
    scope: { type: "room", room_id: "room_one", actor_id: "legacy" },
  });
});

test("Room Agent activity stream starts with an authoritative snapshot", async () => {
  const events = [];
  for await (const event of roomAgentTurnEventStreamSchema.parse((async function* () {
    yield snapshot;
  })())) {
    events.push(event);
  }
  assert.deepEqual(events, [snapshot]);

  await assert.rejects(async () => {
    for await (const _event of roomAgentTurnEventStreamSchema.parse((async function* () {
      yield {
        ...snapshot,
        type: "agent_turn.status",
        status: "running",
        started_at_ms: 10,
        completed_at_ms: null,
        duration_ms: null,
        error: null,
      };
    })())) {
      // Consume the validated stream.
    }
  });
});

test("internal Codex events come only from Company Runtime", () => {
  const event = {
    schema_version: 1,
    event_id: "runtime_event",
    provider: "codex",
    source: "company-runtime",
    scope: {
      type: "room",
      room_id: "room_one",
      agent_member_id: "agent_one",
      execution_id: "execution_one",
    },
    turn_id: "turn_one",
    occurred_at_ms: 10,
    type: "agent_runtime.event",
    method: "turn/started",
    item_id: null,
    payload: {},
  };
  assert.deepEqual(codexAgentRuntimeEventSchema.parse(event), event);
  rejected(codexAgentRuntimeEventSchema, { ...event, source: "room-client" });
  rejected(codexAgentRuntimeEventSchema, { ...event, source: "home-client" });
});

test("Home Runtime streams accept raw Codex envelopes while public Home streams reject them", async () => {
  const rawEvent = {
    schema_version: 1,
    event_id: "runtime_home_event",
    provider: "codex",
    source: "company-runtime",
    scope: {
      type: "home",
      member_id: "member_one",
      thread_id: "thread_one",
    },
    turn_id: "turn_one",
    occurred_at_ms: 10,
    type: "agent_runtime.event",
    method: "turn/started",
    item_id: null,
    payload: {},
  };
  const internalEvents = [];
  for await (const event of codexAgentRuntimeEventStreamSchema.parse((async function* () {
    yield rawEvent;
  })())) {
    internalEvents.push(event);
  }
  assert.deepEqual(internalEvents, [rawEvent]);

  await assert.rejects(async () => {
    for await (const _event of homeAgentTurnEventStreamSchema.parse((async function* () {
      yield rawEvent;
    })())) {
      // Consume the validated stream.
    }
  });

  const publicEvent = {
    ...snapshot,
    event_id: "projected_home_event",
    scope: {
      type: "home",
      member_id: "member_one",
      thread_id: "thread_one",
    },
  };
  const publicEvents = [];
  for await (const event of homeAgentTurnEventStreamSchema.parse((async function* () {
    yield publicEvent;
  })())) {
    publicEvents.push(event);
  }
  assert.deepEqual(publicEvents, [publicEvent]);

  await assert.rejects(async () => {
    for await (const _event of codexAgentRuntimeEventStreamSchema.parse((async function* () {
      yield publicEvent;
    })())) {
      // Consume the validated stream.
    }
  });
});

test("internal interactive Codex requests retain the transient JSON-RPC request id", () => {
  const request = {
    schema_version: 1,
    event_id: "request_event",
    provider: "codex",
    source: "company-runtime",
    scope: {
      type: "room",
      room_id: "room_one",
      agent_member_id: "agent_one",
      execution_id: "execution_one",
    },
    turn_id: "turn_one",
    occurred_at_ms: 10,
    type: "agent_runtime.interaction_request",
    method: "execCommandApproval",
    request_id: "json_rpc_request_one",
    item_id: null,
    payload: { command: ["pnpm", "test"] },
  };
  assert.deepEqual(codexAgentRuntimeInteractionRequestSchema.parse(request), request);
  rejected(codexAgentRuntimeEventSchema, request);
  rejected(codexAgentRuntimeInteractionRequestSchema, {
    ...request,
    request_id: null,
  });
});

test("Home contracts address the authenticated Human directly", () => {
  assert.deepEqual(homeThreadListInputSchema.parse({ limit: 20 }), { limit: 20 });
  assert.deepEqual(homeThreadReadInputSchema.parse({ thread_id: "thread_one" }), { thread_id: "thread_one" });
  assert.deepEqual(homeTurnSubmitInputSchema.parse({
    thread_id: "thread_one",
    prompt: "Continue",
    model: "gpt-5.4",
    reasoning_effort: "high",
  }), {
    thread_id: "thread_one",
    prompt: "Continue",
    model: "gpt-5.4",
    reasoning_effort: "high",
  });
  assert.deepEqual(homeModelOptionsResultSchema.parse({
    items: [{
      model: "gpt-5.4",
      display_name: "GPT-5.4",
      is_default: true,
      default_reasoning_effort: "medium",
      supported_reasoning_efforts: ["low", "medium", "high"],
    }],
    new_thread_default: {
      model: "gpt-5.4",
      reasoning_effort: "medium",
    },
  }).new_thread_default, {
    model: "gpt-5.4",
    reasoning_effort: "medium",
  });
  assert.deepEqual(homeThreadSettingsResultSchema.parse({
    thread_id: "thread_one",
    model: "gpt-5.4",
    reasoning_effort: "high",
  }), {
    thread_id: "thread_one",
    model: "gpt-5.4",
    reasoning_effort: "high",
  });
  rejected(homeThreadListInputSchema, { actor_id: "paired_home_agent" });
  rejected(homeThreadReadInputSchema, { actor_id: "paired_home_agent", thread_id: "thread_one" });

  const result = {
    items: [{
      thread_id: "thread_one",
      title: "Home",
      preview: "Continue",
      created_at_ms: 1,
      updated_at_ms: 2,
      status: "idle",
      unread_count: 0,
      read_through: null,
    }],
    page: { next_cursor: null, backwards_cursor: null },
  };
  assert.deepEqual(homeThreadListResultSchema.parse(result), result);
  rejected(homeThreadListResultSchema, { ...result, actor_id: "paired_home_agent" });
});
