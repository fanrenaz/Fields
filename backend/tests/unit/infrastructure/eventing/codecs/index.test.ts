import assert from "node:assert/strict";
import test from "node:test";

import { FixedEventCodecRegistry, FixedEventConsumerRegistry } from "../../../../../src/infrastructure/eventing/codecs/index.js";

test("fixed Event registries cover the approved type/version pairs", () => {
  const codecs = new FixedEventCodecRegistry();
  const consumers = new FixedEventConsumerRegistry();

  assert.deepEqual(
    consumers.consumersFor("company.runtime_provisioning_requested.v1", 1),
    [],
  );
  assert.deepEqual(
    consumers.consumersFor("execution.agent_room_requested.v1", 1),
    ["runtime.agent-room-execution"],
  );
  assert.equal(codecs.find("company.runtime_provisioning_requested.v1", 1), null);
  assert.ok(codecs.find("execution.agent_room_requested.v1", 1));
  assert.equal(codecs.find("execution.member_runtime_reactivation_requested.v1", 1), null);
  assert.deepEqual(
    consumers.consumersFor("execution.member_runtime_reactivation_requested.v1", 1),
    [],
  );
  assert.ok(codecs.find("scheduled_task.occurrence_requested.v1", 1));
  assert.deepEqual(
    consumers.consumersFor("scheduled_task.occurrence_requested.v1", 1),
    ["runtime.scheduled-task"],
  );
  assert.equal(codecs.find("future.event.v1", 1), null);
  assert.deepEqual(consumers.consumersFor("future.event.v1", 1), []);
});

test("scheduled-task occurrence codecs keep persisted payloads provider-neutral", () => {
  const codec = new FixedEventCodecRegistry().find("scheduled_task.occurrence_requested.v1", 1);
  assert.ok(codec);
  const payload = {
    company_id: "company_one",
    task_id: "task_one",
    run_id: "run_one",
    requested_at_ms: 1,
  };
  assert.deepEqual(codec.decode(payload), payload);
  assert.throws(() => codec.decode({ ...payload, provider_payload: { secret: true } }));
});

test("Event codecs reject malformed or extra persisted payload fields", () => {
  const codec = new FixedEventCodecRegistry().find("execution.agent_room_requested.v1", 1);
  assert.ok(codec);
  assert.deepEqual(codec.decode({
    room_id: "room_one",
    company_id: "company_one",
    agent_member_id: "actor_one",
    execution_id: "execution_one",
    cascade_id: "cascade_one",
    source_message_id: "message_one",
    idempotency_key: "key_one",
    from_sequence: 1,
    through_sequence: 2,
    thread_id: null,
    requested_at_ms: 1,
  }), {
    room_id: "room_one",
    company_id: "company_one",
    agent_member_id: "actor_one",
    execution_id: "execution_one",
    cascade_id: "cascade_one",
    source_message_id: "message_one",
    idempotency_key: "key_one",
    from_sequence: 1,
    through_sequence: 2,
    thread_id: null,
    requested_at_ms: 1,
  });
  assert.throws(() => codec.decode({ room_id: "room_one" }));
  assert.throws(() => codec.decode({
    room_id: "room_one",
    company_id: "company_one",
    agent_member_id: "actor_one",
    execution_id: "execution_one",
    cascade_id: "cascade_one",
    source_message_id: "message_one",
    idempotency_key: "key_one",
    from_sequence: 1,
    through_sequence: 2,
    thread_id: null,
    requested_at_ms: 1,
    provider_payload: "forbidden",
  }));
});
