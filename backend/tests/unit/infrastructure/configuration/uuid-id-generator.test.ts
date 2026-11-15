import assert from "node:assert/strict";
import test from "node:test";

import { UuidGenerationError, UuidIdGenerator } from "../../../../src/infrastructure/configuration/uuid-id-generator.js";

test("UUID identifier generator preserves each approved Product identifier prefix", () => {
  const generator = new UuidIdGenerator(() => "fixed-uuid");

  assert.equal(generator.next("company"), "company_fixed-uuid");
  assert.equal(generator.next("actor"), "actor_fixed-uuid");
  assert.equal(generator.next("room"), "room_fixed-uuid");
  assert.equal(generator.next("runtime"), "runtime_fixed-uuid");
  assert.equal(generator.next("executor"), "executor_fixed-uuid");
  assert.equal(generator.next("attempt"), "executor_attempt_fixed-uuid");
  assert.equal(generator.next("event"), "event_fixed-uuid");
  assert.equal(generator.next("operation"), "operation_fixed-uuid");
});

test("UUID identifier generator retains the public actor_<uuid-v4> identifier shape", () => {
  assert.match(
    new UuidIdGenerator().next("actor"),
    /^actor_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
});

test("UUID identifier generator rejects an unsafe implementation result", () => {
  const generator = new UuidIdGenerator(() => "\n");

  assert.throws(() => generator.next("company"), UuidGenerationError);
});
