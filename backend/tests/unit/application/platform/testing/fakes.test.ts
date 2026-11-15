import assert from "node:assert/strict";
import test from "node:test";

import { FixedClock, SequenceIdGenerator } from "../../../../../src/application/platform/testing/fakes.js";

test("FixedClock changes only when a test explicitly advances it", () => {
  const clock = new FixedClock(10);
  assert.equal(clock.now(), 10);
  clock.set(25);
  assert.equal(clock.now(), 25);
});

test("SequenceIdGenerator makes identifier kinds independently deterministic", () => {
  const ids = new SequenceIdGenerator();
  assert.equal(ids.next("company"), "company_1");
  assert.equal(ids.next("actor"), "actor_1");
  assert.equal(ids.next("runtime"), "runtime_1");
  assert.equal(ids.next("executor"), "executor_1");
  assert.equal(ids.next("attempt"), "attempt_1");
  assert.equal(ids.next("company"), "company_2");
});
