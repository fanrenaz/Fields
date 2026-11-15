import assert from "node:assert/strict";
import test from "node:test";

import { ApplicationError } from "../../../../src/application/platform/errors.js";
import {
  basicCronExpression,
  nextScheduledTaskRunAt,
  SCHEDULED_TASK_INVALID_SCHEDULE_CODE,
  validateScheduledTaskSchedule,
} from "../../../../src/application/scheduled-task/index.js";

test("scheduled tasks accept only five-field Cron schedules no faster than ten minutes", () => {
  assert.doesNotThrow(() => validateScheduledTaskSchedule({ type: "cron", expression: "*/10 * * * *", timezone: "UTC" }));
  for (const schedule of [
    { type: "cron", expression: "*/5 * * * *", timezone: "UTC" },
    { type: "cron", expression: "0 0 9 * * *", timezone: "UTC" },
    { type: "cron", expression: "@daily", timezone: "UTC" },
    { type: "cron", expression: "H * * * *", timezone: "UTC" },
    { type: "cron", expression: "0 9 * * *", timezone: "Not/AZone" },
  ] as const) {
    assert.throws(() => validateScheduledTaskSchedule(schedule), (error: unknown) => (
      error instanceof ApplicationError && error.code === SCHEDULED_TASK_INVALID_SCHEDULE_CODE
    ));
  }
});

test("basic schedule rules preserve ten-minute picker granularity", () => {
  assert.equal(basicCronExpression({ frequency: "hourly", minute: 20 }), "20 */1 * * *");
  assert.equal(basicCronExpression({ frequency: "daily", hour: 9, minute: 30 }), "30 9 * * *");
  assert.equal(basicCronExpression({ frequency: "weekdays", hour: 9, minute: 0 }), "0 9 * * 1-5");
  assert.equal(basicCronExpression({ frequency: "weekly", weekday: 1, hour: 8, minute: 10 }), "10 8 * * 1");
  assert.throws(() => basicCronExpression({ frequency: "daily", hour: 9, minute: 5 }), ApplicationError);
});

test("once, heartbeat, timezone, and DST next-run calculations use one implementation", () => {
  const now = Date.parse("2024-03-09T00:00:00.000Z");
  assert.equal(nextScheduledTaskRunAt({ type: "once", at_ms: now + 1_000 }, now), now + 1_000);
  assert.equal(nextScheduledTaskRunAt({ type: "once", at_ms: now }, now), null);
  assert.equal(nextScheduledTaskRunAt({ type: "heartbeat", interval_minutes: 10 }, now), now + 600_000);
  assert.equal(
    nextScheduledTaskRunAt({ type: "cron", expression: "30 2 * * *", timezone: "America/New_York" }, Date.parse("2024-03-10T06:00:00.000Z")),
    Date.parse("2024-03-10T07:30:00.000Z"),
  );
});
