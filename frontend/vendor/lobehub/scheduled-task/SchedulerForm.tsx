import type { ScheduledTaskSchedule } from "@fields/contracts/public/scheduled-task";
import { Flexbox, Input, InputNumber, Text } from "@lobehub/ui";
import { Select } from "@lobehub/ui/base-ui";
import { useEffect, useMemo, useState } from "react";

import {
  cronFromBasic,
  fiveFieldCron,
  frequencyFromSchedule,
  TIMEZONE_OPTIONS,
  type SchedulerFrequency,
} from "./CronConfig";

export type SchedulerLabels = {
  frequency: string;
  frequencies: Record<SchedulerFrequency, string>;
  time: string;
  weekday: string;
  timezone: string;
  cron: string;
  interval: string;
  minutes: string;
  hours: string;
  invalidCron: string;
  weekdays: readonly string[];
};

export function SchedulerForm({ labels, schedule, onChange }: {
  labels: SchedulerLabels;
  schedule: ScheduledTaskSchedule;
  onChange: (schedule: ScheduledTaskSchedule) => void;
}) {
  const [frequency, setFrequency] = useState<SchedulerFrequency>(() => frequencyFromSchedule(schedule));
  const [time, setTime] = useState(() => basicTime(schedule));
  const [weekday, setWeekday] = useState(() => basicWeekday(schedule));
  const [timezone, setTimezone] = useState(() => schedule.type === "cron" ? schedule.timezone : browserTimezone());
  const [expression, setExpression] = useState(() => schedule.type === "cron" ? schedule.expression : "0 9 * * *");
  const [heartbeatUnit, setHeartbeatUnit] = useState<"minutes" | "hours">(() => schedule.type === "heartbeat" && schedule.interval_minutes % 60 === 0 ? "hours" : "minutes");

  useEffect(() => {
    if (!(frequency === "advanced" && schedule.type === "cron")) {
      setFrequency(frequencyFromSchedule(schedule));
    }
    setTime(basicTime(schedule));
    setWeekday(basicWeekday(schedule));
    if (schedule.type === "cron") {
      setTimezone(schedule.timezone);
      setExpression(schedule.expression);
    }
  }, [frequency, schedule]);

  const frequencyOptions = useMemo(() => (
    (Object.keys(labels.frequencies) as SchedulerFrequency[]).map((value) => ({ label: labels.frequencies[value], value }))
  ), [labels.frequencies]);

  function emitBasic(nextFrequency = frequency, nextTime = time, nextWeekday = weekday, nextTimezone = timezone) {
    const [hour, minute] = nextTime.split(":").map(Number);
    onChange({
      type: "cron",
      expression: cronFromBasic(nextFrequency as "hourly" | "daily" | "weekdays" | "weekly", hour || 0, minute || 0, nextWeekday),
      timezone: nextTimezone,
    });
  }

  function changeFrequency(value: SchedulerFrequency) {
    setFrequency(value);
    if (value === "once") {
      onChange({ type: "once", at_ms: Math.max(Date.now() + 600_000, nextTenMinute(Date.now())) });
    } else if (value === "heartbeat") {
      onChange({ type: "heartbeat", interval_minutes: 60 });
    } else if (value === "advanced") {
      onChange({ type: "cron", expression, timezone });
    } else {
      emitBasic(value);
    }
  }

  return (
    <Flexbox gap={14}>
      <Field label={labels.frequency}>
        <Select options={frequencyOptions} value={frequency} onChange={changeFrequency} />
      </Field>
      {frequency === "once" && schedule.type === "once" ? (
        <Field label={labels.time}>
          <Input type="datetime-local" value={localDateTime(schedule.at_ms)} onChange={(event) => {
            const value = new Date(event.target.value).getTime();
            if (Number.isFinite(value)) onChange({ type: "once", at_ms: value });
          }} />
        </Field>
      ) : null}
      {frequency === "heartbeat" && schedule.type === "heartbeat" ? (
        <Field label={labels.interval}>
          <Flexbox align="center" gap={8} horizontal>
            <InputNumber min={heartbeatUnit === "hours" ? 1 : 10} step={heartbeatUnit === "hours" ? 1 : 10} value={heartbeatUnit === "hours" ? schedule.interval_minutes / 60 : schedule.interval_minutes} onChange={(value) => {
              if (typeof value === "number") onChange({ type: "heartbeat", interval_minutes: Math.max(10, Math.floor(value * (heartbeatUnit === "hours" ? 60 : 1))) });
            }} />
            <Select options={[{ label: labels.minutes, value: "minutes" }, { label: labels.hours, value: "hours" }]} value={heartbeatUnit} onChange={(value) => {
              setHeartbeatUnit(value);
              if (value === "hours" && schedule.interval_minutes < 60) {
                onChange({ type: "heartbeat", interval_minutes: 60 });
              }
            }} />
          </Flexbox>
        </Field>
      ) : null}
      {schedule.type === "cron" && frequency !== "heartbeat" && frequency !== "once" ? (
        <>
          {frequency === "advanced" ? (
            <Field label={labels.cron} error={!fiveFieldCron(expression) ? labels.invalidCron : null}>
              <Input value={expression} onChange={(event) => {
                const value = event.target.value;
                setExpression(value);
                onChange({ type: "cron", expression: value, timezone });
              }} />
            </Field>
          ) : (
            <>
              <Field label={labels.time}>
                <Input step={600} type="time" value={time} onChange={(event) => {
                  setTime(event.target.value);
                  emitBasic(frequency, event.target.value);
                }} />
              </Field>
              {frequency === "weekly" ? (
                <Field label={labels.weekday}>
                  <Select value={weekday} options={labels.weekdays.map((label, value) => ({ label, value }))} onChange={(value) => {
                    setWeekday(value);
                    emitBasic(frequency, time, value);
                  }} />
                </Field>
              ) : null}
            </>
          )}
          <Field label={labels.timezone}>
            <Input list="fields-scheduled-task-timezones" value={timezone} onChange={(event) => {
              const value = event.target.value;
              setTimezone(value);
              onChange({ type: "cron", expression: frequency === "advanced" ? expression : schedule.expression, timezone: value });
            }} />
            <datalist id="fields-scheduled-task-timezones">
              {TIMEZONE_OPTIONS.map((value) => <option key={value} value={value} />)}
            </datalist>
          </Field>
        </>
      ) : null}
    </Flexbox>
  );
}

function Field({ children, error, label }: { children: React.ReactNode; error?: string | null; label: string }) {
  return <Flexbox gap={6}><Text fontSize={12} type="secondary">{label}</Text>{children}{error ? <Text fontSize={12} type="danger">{error}</Text> : null}</Flexbox>;
}

function basicTime(schedule: ScheduledTaskSchedule): string {
  if (schedule.type !== "cron") return "09:00";
  const [minute = "0", hour = "9"] = schedule.expression.split(/\s+/u);
  return `${String(Number(hour) || 0).padStart(2, "0")}:${String(Number(minute) || 0).padStart(2, "0")}`;
}
function basicWeekday(schedule: ScheduledTaskSchedule): number {
  if (schedule.type !== "cron") return 1;
  return Number(schedule.expression.split(/\s+/u)[4]) || 1;
}
function browserTimezone(): string { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
function nextTenMinute(nowMs: number): number { return Math.ceil(nowMs / 600_000) * 600_000; }
function localDateTime(atMs: number): string {
  const date = new Date(atMs - new Date(atMs).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}
