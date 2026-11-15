import assert from "node:assert/strict";
import test from "node:test";

import { ApplicationError } from "../../../../../src/application/platform/errors.js";
import { eventHealthProjection, eventWorkerErrorLog } from "../../../../../src/interface/worker/event/app.js";

test("Event health exposes exactly the approved six safe fields", () => {
  const projection = eventHealthProjection({
    workerId: "event_test",
    running: true,
    consecutiveFailures: 0,
    lastSuccessfulTickAtMs: 100,
    pendingCount: 4,
    deadLetterCount: 0,
  });

  assert.equal(projection.statusCode, 200);
  assert.deepEqual(Object.keys(projection.body), [
    "worker_id",
    "running",
    "consecutive_failures",
    "last_successful_tick_at_ms",
    "pending_count",
    "dead_letter_count",
  ]);
});

test("Event health is degraded by stopped workers, tick failures, or dead letters only", () => {
  const healthy = {
    workerId: "event_test",
    running: true,
    consecutiveFailures: 0,
    lastSuccessfulTickAtMs: 100,
    pendingCount: 99,
    deadLetterCount: 0,
  };
  assert.equal(eventHealthProjection(healthy).statusCode, 200);
  assert.equal(eventHealthProjection({ ...healthy, running: false }).statusCode, 503);
  assert.equal(eventHealthProjection({ ...healthy, consecutiveFailures: 1 }).statusCode, 503);
  assert.equal(eventHealthProjection({ ...healthy, deadLetterCount: 1 }).statusCode, 503);
});

test("Event worker logs never serialize provider text or causes", () => {
  const error = new ApplicationError("SAFE_EVENT_CODE", false);
  const projected = eventWorkerErrorLog("event_tick_failed", error);
  assert.deepEqual(projected, {
    event: "event_tick_failed",
    code: "SAFE_EVENT_CODE",
    retryable: false,
  });
  const unknown = eventWorkerErrorLog(
    "event_tick_failed",
    new Error("access_token=event-secret-canary", { cause: new Error("cause-secret-canary") }),
  );
  assert.equal(JSON.stringify(unknown).includes("event-secret-canary"), false);
  assert.equal(JSON.stringify(unknown).includes("cause-secret-canary"), false);
});
