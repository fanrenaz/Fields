import assert from "node:assert/strict";
import test from "node:test";

import {
  deliveryOrderingKey,
  EVENT_MAX_ATTEMPTS,
  EVENT_MAX_RETRY_DELAY_MS,
  isDeadLetterAttempt,
  retryDelayMs,
} from "../../../../src/application/eventing/retry-policy.js";

test("event retry backoff follows the approved capped exponential schedule", () => {
  assert.equal(retryDelayMs(1), 1_000);
  assert.equal(retryDelayMs(2), 2_000);
  assert.equal(retryDelayMs(10), EVENT_MAX_RETRY_DELAY_MS);
  assert.throws(() => retryDelayMs(0), RangeError);
});

test("the tenth delivery failure is the first dead-letter attempt", () => {
  assert.equal(isDeadLetterAttempt(EVENT_MAX_ATTEMPTS - 1), false);
  assert.equal(isDeadLetterAttempt(EVENT_MAX_ATTEMPTS), true);
});

test("delivery ordering is scoped to one consumer and aggregate", () => {
  const event = { aggregateType: "room", aggregateId: "room_1" };
  assert.equal(
    deliveryOrderingKey("runtime.agent-room-execution", event),
    "runtime.agent-room-execution:room:room_1",
  );
});
