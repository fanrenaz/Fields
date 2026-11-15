import type { ScheduledTaskSchedule } from "@fields/contracts/public/scheduled-task";

export type SchedulerFrequency = "once" | "hourly" | "daily" | "weekdays" | "weekly" | "advanced" | "heartbeat";

export const TIMEZONE_OPTIONS = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Taipei",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;

export function fiveFieldCron(expression: string): boolean {
  const value = expression.trim();
  return !value.startsWith("@") && value.split(/\s+/u).length === 5;
}

export function cronFromBasic(
  frequency: Exclude<SchedulerFrequency, "once" | "advanced" | "heartbeat">,
  hour: number,
  minute: number,
  weekday: number,
): string {
  const safeMinute = Math.max(0, Math.min(50, Math.floor(minute / 10) * 10));
  const safeHour = Math.max(0, Math.min(23, Math.floor(hour)));
  if (frequency === "hourly") return `${safeMinute} * * * *`;
  if (frequency === "weekdays") return `${safeMinute} ${safeHour} * * 1-5`;
  if (frequency === "weekly") return `${safeMinute} ${safeHour} * * ${Math.max(0, Math.min(6, weekday))}`;
  return `${safeMinute} ${safeHour} * * *`;
}

export function frequencyFromSchedule(schedule: ScheduledTaskSchedule): SchedulerFrequency {
  if (schedule.type === "once" || schedule.type === "heartbeat") return schedule.type;
  if (/^\d+ \* \* \* \*$/u.test(schedule.expression)) return "hourly";
  if (/^\d+ \d+ \* \* 1-5$/u.test(schedule.expression)) return "weekdays";
  if (/^\d+ \d+ \* \* \d$/u.test(schedule.expression)) return "weekly";
  if (/^\d+ \d+ \* \* \*$/u.test(schedule.expression)) return "daily";
  return "advanced";
}

export function scheduleSummary(schedule: ScheduledTaskSchedule): string {
  if (schedule.type === "once") return new Date(schedule.at_ms).toLocaleString();
  if (schedule.type === "heartbeat") return `↻ ${schedule.interval_minutes} min`;
  return `${schedule.expression} · ${schedule.timezone}`;
}
