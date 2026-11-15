import type {
  ScheduledTaskCreateTarget,
  ScheduledTaskRunSummary,
  ScheduledTaskSchedule,
  ScheduledTaskSummary,
} from "@fields/contracts/public/scheduled-task";
import type { RoomReferenceTarget } from "@fields/contracts/public/room";
import { Alert, Drawer, Flexbox, InputNumber, Text } from "@lobehub/ui";
import { Button, Input, Select, TabsRoot, TabsList, TabsTab } from "@lobehub/ui/base-ui";
import { ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { backendTrpc } from "../../data/boundary/backend-trpc";
import { Composer } from "../conversation/Composer";
import { SchedulerForm } from "../../vendor/lobehub/scheduled-task/SchedulerForm";
import { fiveFieldCron } from "../../vendor/lobehub/scheduled-task/CronConfig";
import {
  scheduledTaskTargetFromValue,
  scheduledTaskTargetLabel,
  scheduledTaskTargetSelectOptions,
  scheduledTaskTargetToValue,
  type ScheduledTaskTargetOptions,
} from "./target";

export type { ScheduledTaskTargetOptions } from "./target";

export type ScheduledTaskSeed = {
  lockedTarget?: boolean;
  target: ScheduledTaskCreateTarget;
  markdown: string;
  references?: RoomReferenceTarget[];
  replyToMessageIds?: string[];
};

export function ScheduledTaskDrawer({ mode, onClose, onOpenHomeThread, onOpenRoomMessage, onSaved, open, seed, targetOptions, task }: {
  mode: "create" | "edit" | "copy";
  onClose: () => void;
  onOpenHomeThread?: (threadId: string) => void;
  onOpenRoomMessage?: (roomId: string, messageId: string) => void;
  onSaved: (task: ScheduledTaskSummary) => void;
  open: boolean;
  seed?: ScheduledTaskSeed | null;
  targetOptions: ScheduledTaskTargetOptions;
  task?: ScheduledTaskSummary | null;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"config" | "history">("config");
  const [targetValue, setTargetValue] = useState("home:new");
  const [name, setName] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [schedule, setSchedule] = useState<ScheduledTaskSchedule>(() => defaultSchedule());
  const [maxExecutions, setMaxExecutions] = useState<number | null>(null);
  const [history, setHistory] = useState<ScheduledTaskRunSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const immutableTarget = mode === "edit" || seed?.lockedTarget === true;
  useEffect(() => {
    if (!open) return;
    const sourceTarget = mode === "edit" ? task?.target : seed?.target ?? (mode === "copy" ? task?.target : null);
    const sourceContent = mode === "edit" || mode === "copy" ? task?.content : null;
    setTargetValue(sourceTarget ? scheduledTaskTargetToValue(sourceTarget) : "home:new");
    setName(mode === "copy" ? t("scheduledTasks.copyName", { name: task?.name ?? "" }) : task?.name ?? "");
    setMarkdown(sourceContent?.kind === "home" ? sourceContent.prompt : sourceContent?.kind === "room" ? sourceContent.markdown : seed?.markdown ?? "");
    setSchedule(task?.schedule ?? defaultSchedule());
    setMaxExecutions(task?.max_executions ?? null);
    setTab("config");
    setHistory([]);
    setError("");
  }, [mode, open, seed, t, task]);

  useEffect(() => {
    if (!open || tab !== "history" || !task || mode === "copy") return;
    setHistoryLoading(true);
    void backendTrpc.scheduledTasks.runs.list.query({ task_id: task.task_id, cursor: null, limit: 100 })
      .then((result) => setHistory(result.items))
      .catch(() => setError(t("scheduledTasks.historyLoadFailed")))
      .finally(() => setHistoryLoading(false));
  }, [mode, open, tab, t, task]);

  const target = useMemo<ScheduledTaskCreateTarget | null>(() => scheduledTaskTargetFromValue(targetValue), [targetValue]);
  const scheduleValid = schedule.type !== "cron" || (fiveFieldCron(schedule.expression) && schedule.timezone.trim().length > 0);
  const canSave = Boolean(target && markdown.trim() && scheduleValid && (mode !== "edit" || name.trim()));

  async function save() {
    if (!target || !canSave || saving) return;
    setSaving(true);
    setError("");
    try {
      const taskRoomContent = task?.target.kind === "room"
        && target.kind === "room"
        && task.target.room_id === target.room_id
        && task.content.kind === "room"
        ? task.content
        : null;
      const seededRoomContent = target.kind === "room"
        && seed?.target.kind === "room"
        && seed.target.room_id === target.room_id
        ? seed
        : null;
      const content = target.kind === "home"
        ? { kind: "home" as const, prompt: markdown.trim() }
        : {
          kind: "room" as const,
          markdown: markdown.trim(),
          references: taskRoomContent?.references ?? seededRoomContent?.references ?? [],
          reply_to_message_ids: taskRoomContent?.reply_to_message_ids ?? seededRoomContent?.replyToMessageIds ?? [],
        };
      const saved = mode === "edit" && task
        ? await backendTrpc.scheduledTasks.update.mutate({
          task_id: task.task_id,
          name: name.trim(),
          content,
          schedule,
          max_executions: schedule.type === "once" ? 1 : maxExecutions,
          expected_version: task.version,
          idempotency_key: mutationKey("update"),
        })
        : await backendTrpc.scheduledTasks.create.mutate({
          ...(name.trim() ? { name: name.trim() } : {}),
          target,
          content,
          schedule,
          max_executions: schedule.type === "once" ? 1 : maxExecutions,
          idempotency_key: mutationKey("create"),
        });
      onSaved(saved);
      onClose();
    } catch {
      setError(t("scheduledTasks.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  const title = mode === "edit" ? t("scheduledTasks.edit") : mode === "copy" ? t("scheduledTasks.copy") : t("scheduledTasks.create");
  return <Drawer destroyOnHidden extra={tab === "config" ? <Button disabled={!canSave} loading={saving} onClick={() => void save()} type="primary">{t("common.save")}</Button> : null} onClose={onClose} open={open} placement="right" title={title} width="min(640px, 100vw)">
    <TabsRoot value={tab} onValueChange={(value) => setTab(value as "config" | "history")}><TabsList><TabsTab value="config">{t("scheduledTasks.config")}</TabsTab><TabsTab disabled={!task || mode === "copy"} value="history">{t("scheduledTasks.history")}</TabsTab></TabsList></TabsRoot>
    <div style={{ marginTop: 20 }}>
      {error ? <Alert message={error} showIcon type="error" /> : null}
      {tab === "history" ? <RunHistory loading={historyLoading} onOpenHomeThread={onOpenHomeThread} onOpenRoomMessage={onOpenRoomMessage} runs={history} /> : (
        <Flexbox gap={18}>
          {task?.status === "blocked" ? <Alert message={`${task.blocked_reason ? t(`scheduledTasks.blockedReasons.${task.blocked_reason}`) : ""} ${t("scheduledTasks.blockedHelp")}`.trim()} showIcon type="warning" /> : null}
          <Field label={t("scheduledTasks.name")}><Input maxLength={255} placeholder={t("scheduledTasks.nameDefault")} value={name} onChange={(event) => setName(event.target.value)} /></Field>
          <Field label={t("scheduledTasks.deliveryTarget")}>
            <TargetEditor immutable={immutableTarget} onChange={setTargetValue} options={targetOptions} target={target} value={targetValue} />
          </Field>
          <Field label={t("scheduledTasks.taskContent")}>
            <Composer draft={markdown} hideSendButton mentionOptions={[]} minimal={false} onClearReply={() => undefined} onDraft={setMarkdown} onSearch={() => undefined} onSend={() => undefined} referenceOptions={[]} replyAnchor={null} showMentionButton={false} showReferenceActions={false} surface="floating" />
          </Field>
          <SchedulerForm labels={{
            frequency: t("scheduledTasks.frequency"),
            frequencies: {
              once: t("scheduledTasks.frequencies.once"), hourly: t("scheduledTasks.frequencies.hourly"), daily: t("scheduledTasks.frequencies.daily"), weekdays: t("scheduledTasks.frequencies.weekdays"), weekly: t("scheduledTasks.frequencies.weekly"), advanced: t("scheduledTasks.frequencies.advanced"), heartbeat: t("scheduledTasks.frequencies.heartbeat"),
            },
            time: t("scheduledTasks.time"), weekday: t("scheduledTasks.weekday"), timezone: t("scheduledTasks.timezone"), cron: t("scheduledTasks.cron"), interval: t("scheduledTasks.interval"), minutes: t("scheduledTasks.minutes"), hours: t("scheduledTasks.hours"), invalidCron: t("scheduledTasks.invalidCron"), weekdays: [0, 1, 2, 3, 4, 5, 6].map((day) => t(`scheduledTasks.weekdayNames.${day}`)),
          }} schedule={schedule} onChange={setSchedule} />
          {schedule.type !== "once" ? <Field label={t("scheduledTasks.maxExecutions")}><InputNumber min={1} placeholder={t("scheduledTasks.continuous")} value={maxExecutions ?? undefined} onChange={(value) => setMaxExecutions(typeof value === "number" ? Math.max(1, Math.floor(value)) : null)} /></Field> : null}
          <div style={{ background: "var(--ant-color-fill-quaternary)", borderRadius: 12, padding: 12 }}><Text type="secondary">{t("scheduledTasks.nextPreview")}</Text><div style={{ fontWeight: 600, marginTop: 4 }}>{schedulePreview(schedule, t)}</div></div>
        </Flexbox>
      )}
    </div>
  </Drawer>;
}

function TargetEditor({ immutable, onChange, options, target, value }: {
  immutable: boolean;
  onChange: (value: string) => void;
  options: ScheduledTaskTargetOptions;
  target: ScheduledTaskCreateTarget | null;
  value: string;
}) {
  const { t } = useTranslation();
  if (immutable) {
    return <div style={{ background: "var(--ant-color-fill-quaternary)", borderRadius: 8, padding: "9px 12px" }}><Text>{target ? scheduledTaskTargetLabel(target, options, t) : "—"}</Text></div>;
  }
  return <Select options={scheduledTaskTargetSelectOptions(options, t)} value={value} onChange={onChange} />;
}

function RunHistory({ loading, onOpenHomeThread, onOpenRoomMessage, runs }: { loading: boolean; onOpenHomeThread?: (threadId: string) => void; onOpenRoomMessage?: (roomId: string, messageId: string) => void; runs: ScheduledTaskRunSummary[] }) {
  const { t } = useTranslation();
  if (loading) return <Text type="secondary">{t("shell.loading")}</Text>;
  if (runs.length === 0) return <Text type="secondary">{t("scheduledTasks.noHistory")}</Text>;
  return <Flexbox gap={8}>{runs.map((run) => <div key={run.run_id} style={{ border: "1px solid var(--ant-color-border-secondary)", borderRadius: 10, padding: 12 }}><Flexbox align="center" horizontal justify="space-between"><div><strong>{t(`scheduledTasks.runStatuses.${run.status}`)}</strong><div style={{ color: "var(--ant-color-text-secondary)", fontSize: 12 }}>{new Date(run.created_at_ms).toLocaleString()} · {run.attempt_count}</div>{run.error_reason ? <details style={{ color: "var(--ant-color-error)", fontSize: 12, marginTop: 4 }}><summary>{t("scheduledTasks.failureDetails")}</summary>{t(`scheduledTasks.blockedReasons.${run.error_reason}`)}</details> : null}</div>{run.room_id && run.room_message_id && onOpenRoomMessage ? <Button icon={<ExternalLink size={14} />} onClick={() => onOpenRoomMessage(run.room_id!, run.room_message_id!)} size="small" type="text" /> : run.home_thread_id && onOpenHomeThread ? <Button icon={<ExternalLink size={14} />} onClick={() => onOpenHomeThread(run.home_thread_id!)} size="small" type="text" /> : null}</Flexbox></div>)}</Flexbox>;
}

function Field({ children, label }: { children: React.ReactNode; label: string }) { return <Flexbox gap={6}><Text fontSize={12} type="secondary">{label}</Text>{children}</Flexbox>; }
function defaultSchedule(): ScheduledTaskSchedule { return { type: "cron", expression: "0 9 * * *", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" }; }
function mutationKey(operation: string): string { return `${operation}:${crypto.randomUUID()}`; }
function schedulePreview(schedule: ScheduledTaskSchedule, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (schedule.type === "once") return new Date(schedule.at_ms).toLocaleString();
  if (schedule.type === "heartbeat") return t("scheduledTasks.heartbeatSummary", { count: schedule.interval_minutes });
  return `${schedule.expression} · ${schedule.timezone}`;
}
