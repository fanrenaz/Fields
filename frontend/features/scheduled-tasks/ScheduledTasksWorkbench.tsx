import type { ScheduledTaskStatus, ScheduledTaskSummary } from "@fields/contracts/public/scheduled-task";
import { Alert, Empty, Flexbox, Modal, ScrollArea, Text } from "@lobehub/ui";
import { Button, type DropdownItem } from "@lobehub/ui/base-ui";
import { Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { backendTrpc } from "../../data/boundary/backend-trpc";
import { TaskStatusGroup } from "../../vendor/lobehub/scheduled-task/TaskList";
import { ScheduledTaskDrawer, type ScheduledTaskTargetOptions } from "./ScheduledTaskDrawer";
import { scheduledTaskTargetLabel } from "./target";

const STATUS_ORDER: ScheduledTaskStatus[] = ["active", "paused", "blocked", "completed"];

export function ScheduledTasksWorkbench({ onOpenHomeThread, onOpenRoomMessage, targetOptions }: {
  onOpenHomeThread: (threadId: string) => void;
  onOpenRoomMessage: (roomId: string, messageId: string) => void;
  targetOptions: ScheduledTaskTargetOptions;
}) {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<ScheduledTaskSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [drawer, setDrawer] = useState<{ mode: "create" | "edit" | "copy"; task: ScheduledTaskSummary | null } | null>(null);
  const [deleting, setDeleting] = useState<ScheduledTaskSummary | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await backendTrpc.scheduledTasks.list.query({});
      setTasks(result.items);
    } catch {
      setError(t("scheduledTasks.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  const grouped = useMemo(() => Object.fromEntries(STATUS_ORDER.map((status) => [status, tasks.filter((task) => task.status === status)])) as Record<ScheduledTaskStatus, ScheduledTaskSummary[]>, [tasks]);

  async function mutate(task: ScheduledTaskSummary, operation: "pause" | "resume" | "runNow") {
    setError("");
    try {
      await backendTrpc.scheduledTasks[operation].mutate({ task_id: task.task_id, expected_version: task.version, idempotency_key: `${operation}:${crypto.randomUUID()}` });
      await load();
    } catch {
      setError(t("scheduledTasks.actionFailed"));
    }
  }

  function menu(task: ScheduledTaskSummary): DropdownItem[] {
    return [
      ...(task.status === "active" || task.status === "paused" ? [{ key: "run", label: t("scheduledTasks.runNow"), onClick: () => void mutate(task, "runNow") }] : []),
      ...(task.status === "active" ? [{ key: "pause", label: t("scheduledTasks.pause"), onClick: () => void mutate(task, "pause") }] : []),
      ...(task.status === "paused" || task.status === "blocked" ? [{ key: "resume", label: task.status === "blocked" ? t("scheduledTasks.resumeAfterFix") : t("scheduledTasks.resume"), onClick: () => void mutate(task, "resume") }] : []),
      { key: "copy", label: t("scheduledTasks.copy"), onClick: () => setDrawer({ mode: "copy", task }) },
      { danger: true, key: "delete", label: t("common.delete"), onClick: () => setDeleting(task) },
    ];
  }

  function itemLabels(task: ScheduledTaskSummary) {
    const target = scheduledTaskTargetLabel(task.target, targetOptions, t);
    return {
      actions: t("scheduledTasks.actions"),
      next: t("scheduledTasks.nextRun"),
      remaining: t("scheduledTasks.remaining"),
      schedule: task.schedule.type === "once"
        ? new Date(task.schedule.at_ms).toLocaleString()
        : task.schedule.type === "heartbeat"
          ? t("scheduledTasks.heartbeatSummary", { count: task.schedule.interval_minutes })
          : `${task.schedule.expression} · ${task.schedule.timezone}`,
      status: t(`scheduledTasks.statuses.${task.status}`),
      target,
    };
  }

  async function remove() {
    if (!deleting) return;
    try {
      await backendTrpc.scheduledTasks.softDelete.mutate({ task_id: deleting.task_id, expected_version: deleting.version, idempotency_key: `delete:${crypto.randomUUID()}` });
      setDeleting(null);
      await load();
    } catch {
      setError(t("scheduledTasks.actionFailed"));
    }
  }

  return <div style={{ background: "var(--ant-color-bg-container)", display: "flex", flex: 1, flexDirection: "column", minHeight: 0 }}>
    <header style={{ alignItems: "center", borderBottom: "1px solid var(--ant-color-border-secondary)", display: "flex", justifyContent: "space-between", minHeight: 56, padding: "0 20px" }}><div><Text fontSize={18} weight={700}>{t("scheduledTasks.title")}</Text></div><Flexbox align="center" gap={8} horizontal><Button aria-label={t("common.refresh")} icon={<RefreshCw size={15} />} loading={loading} onClick={() => void load()} shape="circle" type="text" /><Button icon={<Plus size={16} />} onClick={() => setDrawer({ mode: "create", task: null })} type="primary">{t("scheduledTasks.create")}</Button></Flexbox></header>
    {error ? <div style={{ padding: "12px 20px 0" }}><Alert message={error} showIcon type="error" /></div> : null}
    <ScrollArea style={{ flex: 1, minHeight: 0 }}><Flexbox gap={22} style={{ margin: "0 auto", maxWidth: 960, padding: 20 }}>{!loading && tasks.length === 0 ? <Empty description={t("scheduledTasks.empty")} /> : STATUS_ORDER.map((status) => <TaskStatusGroup key={status} label={t(`scheduledTasks.statuses.${status}`)} labels={itemLabels} onOpen={(task) => setDrawer({ mode: "edit", task })} renderMenu={menu} tasks={grouped[status]} />)}</Flexbox></ScrollArea>
    <ScheduledTaskDrawer mode={drawer?.mode ?? "create"} onClose={() => setDrawer(null)} onOpenHomeThread={onOpenHomeThread} onOpenRoomMessage={onOpenRoomMessage} onSaved={() => void load()} open={drawer !== null} targetOptions={targetOptions} task={drawer?.task} />
    <Modal okButtonProps={{ danger: true }} okText={t("common.delete")} onCancel={() => setDeleting(null)} onOk={() => void remove()} open={deleting !== null} title={t("scheduledTasks.deleteTitle")}><p>{t("scheduledTasks.deleteConfirm", { name: deleting?.name ?? "" })}</p></Modal>
  </div>;
}
