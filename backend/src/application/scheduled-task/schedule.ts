import type { ScheduledTaskSchedule } from "@fields/contracts/public/scheduled-task";
import { CronExpressionParser } from "cron-parser";

import { ApplicationError } from "../platform/errors.js";

export const SCHEDULED_TASK_INVALID_SCHEDULE_CODE = "SCHEDULED_TASK_INVALID_SCHEDULE";
export const SCHEDULED_TASK_MINIMUM_INTERVAL_MS = 10 * 60 * 1_000;

export function validateScheduledTaskSchedule(schedule: ScheduledTaskSchedule): void {
  if (schedule.type === "once") {
    if (!Number.isSafeInteger(schedule.at_ms) || schedule.at_ms < 0) throw invalidSchedule();
    return;
  }
  if (schedule.type === "heartbeat") {
    if (!Number.isSafeInteger(schedule.interval_minutes) || schedule.interval_minutes < 10) throw invalidSchedule();
    return;
  }
  if (!isIanaTimezone(schedule.timezone)) throw invalidSchedule();
  const fields = schedule.expression.trim().split(/\s+/u);
  if (fields.length !== 5 || schedule.expression.trim().startsWith("@") || /H/iu.test(schedule.expression)) throw invalidSchedule();
  try {
    const interval = CronExpressionParser.parse(schedule.expression, {
      currentDate: new Date("2024-01-01T00:00:00.000Z"),
      tz: schedule.timezone,
    });
    let previous = interval.next().getTime();
    for (let index = 0; index < 512; index += 1) {
      const next = interval.next().getTime();
      if (next - previous < SCHEDULED_TASK_MINIMUM_INTERVAL_MS) throw invalidSchedule();
      previous = next;
    }
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw invalidSchedule();
  }
}

export function nextScheduledTaskRunAt(
  schedule: ScheduledTaskSchedule,
  afterMs: number,
): number | null {
  validateScheduledTaskSchedule(schedule);
  if (schedule.type === "once") return schedule.at_ms > afterMs ? schedule.at_ms : null;
  if (schedule.type === "heartbeat") return afterMs + schedule.interval_minutes * 60_000;
  try {
    return CronExpressionParser.parse(schedule.expression, {
      currentDate: new Date(afterMs),
      tz: schedule.timezone,
    }).next().getTime();
  } catch {
    throw invalidSchedule();
  }
}

export function basicCronExpression(input:
  | { frequency: "hourly"; minute: number; interval_hours?: number }
  | { frequency: "daily"; hour: number; minute: number }
  | { frequency: "weekdays"; hour: number; minute: number }
  | { frequency: "weekly"; weekday: number; hour: number; minute: number },
): string {
  const minute = tenMinuteValue(input.minute);
  if (input.frequency === "hourly") {
    const interval = input.interval_hours ?? 1;
    if (!Number.isInteger(interval) || interval < 1 || interval > 23) throw invalidSchedule();
    return `${minute} */${interval} * * *`;
  }
  const hour = hourValue(input.hour);
  if (input.frequency === "daily") return `${minute} ${hour} * * *`;
  if (input.frequency === "weekdays") return `${minute} ${hour} * * 1-5`;
  if (!Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6) throw invalidSchedule();
  return `${minute} ${hour} * * ${input.weekday}`;
}

function hourValue(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 23) throw invalidSchedule();
  return value;
}

function tenMinuteValue(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 59 || value % 10 !== 0) throw invalidSchedule();
  return value;
}

function isIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return value.includes("/") || value === "UTC";
  } catch {
    return false;
  }
}

function invalidSchedule(): ApplicationError {
  return new ApplicationError(SCHEDULED_TASK_INVALID_SCHEDULE_CODE, false);
}
