import assert from "node:assert/strict";
import test from "node:test";

import type { CodexAgentRuntimeEnvelope } from "@fields/contracts/internal/agent-runtime";

import { MemberTurnEventBus } from "../src/application/sessions/event-bus.js";

const ACTOR_ID = "actor_1";
const THREAD_ID = "thread_1";

test("a completed turn replays only the bounded backlog and then closes", async () => {
  const bus = new MemberTurnEventBus({ backlogLimit: 2 });
  bus.publish(ACTOR_ID, THREAD_ID, runtimeEvent("event_started", "turn/started"));
  bus.publish(ACTOR_ID, THREAD_ID, runtimeEvent("event_delta", "item/agentMessage/delta"));
  bus.publish(ACTOR_ID, THREAD_ID, runtimeEvent("event_completed", "turn/completed"));
  bus.complete(ACTOR_ID, THREAD_ID);

  assert.deepEqual(
    (await collect(bus.subscribe(ACTOR_ID, THREAD_ID))).map((event) => event.event_id),
    ["event_delta", "event_completed"],
  );
  assert.equal(bus.listenerCount(ACTOR_ID, THREAD_ID), 0);
});

test("a live runtime failure rejects subscribers and cannot leave them waiting", async () => {
  const bus = new MemberTurnEventBus();
  const iterator = bus.subscribe(ACTOR_ID, THREAD_ID)[Symbol.asyncIterator]();
  const firstPending = iterator.next();
  bus.publish(ACTOR_ID, THREAD_ID, runtimeEvent("event_delta", "item/agentMessage/delta"));

  assert.equal((await firstPending).value?.event_id, "event_delta");
  assert.equal(bus.listenerCount(ACTOR_ID, THREAD_ID), 1);
  const terminalPending = iterator.next();
  const failure = new Error("app-server stream failed");
  bus.fail(ACTOR_ID, THREAD_ID, failure);

  await assert.rejects(terminalPending, failure);
  assert.equal(bus.listenerCount(ACTOR_ID, THREAD_ID), 0);
  const lateIterator = bus.subscribe(ACTOR_ID, THREAD_ID)[Symbol.asyncIterator]();
  assert.equal((await lateIterator.next()).value?.event_id, "event_delta");
  await assert.rejects(lateIterator.next(), failure);
});

test("subscriber cancellation removes the listener without terminating the shared stream", async () => {
  const bus = new MemberTurnEventBus();
  const abortController = new AbortController();
  const iterator = bus.subscribe(ACTOR_ID, THREAD_ID, { signal: abortController.signal })[Symbol.asyncIterator]();
  const pending = iterator.next();
  assert.equal(bus.listenerCount(ACTOR_ID, THREAD_ID), 1);

  abortController.abort();

  assert.deepEqual(await pending, { done: true, value: undefined });
  assert.equal(bus.listenerCount(ACTOR_ID, THREAD_ID), 0);
});

test("member subscriptions receive future turns across threads without replay", async () => {
  const bus = new MemberTurnEventBus();
  bus.publish(ACTOR_ID, "old-thread", runtimeEvent("old", "turn/started"));
  const abortController = new AbortController();
  const iterator = bus.subscribeMember(ACTOR_ID, { signal: abortController.signal })[Symbol.asyncIterator]();
  const first = iterator.next();
  bus.publish(ACTOR_ID, "thread-a", runtimeEvent("future-a", "turn/started", "thread-a"));
  assert.equal((await first).value?.event_id, "future-a");
  const second = iterator.next();
  bus.publish(ACTOR_ID, "thread-b", runtimeEvent("future-b", "turn/completed", "thread-b"));
  assert.equal((await second).value?.event_id, "future-b");
  abortController.abort();
  assert.deepEqual(await iterator.next(), { done: true, value: undefined });
});

function runtimeEvent(eventId: string, method: string, threadId = THREAD_ID): CodexAgentRuntimeEnvelope {
  return {
    schema_version: 1,
    event_id: eventId,
    provider: "codex",
    source: "company-runtime",
    scope: {
      type: "home",
      member_id: ACTOR_ID,
      thread_id: threadId,
    },
    turn_id: "turn_1",
    occurred_at_ms: 100,
    type: "agent_runtime.event",
    method,
    item_id: method.startsWith("item/") ? "item_1" : null,
    payload: { threadId, turnId: "turn_1" },
  };
}

async function collect(iterable: AsyncIterable<CodexAgentRuntimeEnvelope>): Promise<CodexAgentRuntimeEnvelope[]> {
  const events: CodexAgentRuntimeEnvelope[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}
