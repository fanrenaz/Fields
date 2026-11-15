import type { ScheduledTaskStatus, ScheduledTaskSummary } from "@fields/contracts/public/scheduled-task";
import { Block, Flexbox, Tag, Text } from "@lobehub/ui";
import { Button, DropdownMenu, type DropdownItem } from "@lobehub/ui/base-ui";
import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";

export function TaskStatusGroup({ label, labels, tasks, renderMenu, onOpen }: {
  label: string;
  tasks: ScheduledTaskSummary[];
  renderMenu: (task: ScheduledTaskSummary) => DropdownItem[];
  onOpen: (task: ScheduledTaskSummary) => void;
  labels: (task: ScheduledTaskSummary) => { actions: string; next: string; remaining: string; schedule: string; status: string; target: string };
}) {
  if (tasks.length === 0) return null;
  return <section style={{ display: "flex", flexDirection: "column", gap: 6 }}><Text fontSize={13} type="secondary" weight={600}>{label} · {tasks.length}</Text><Flexbox gap={4}>{tasks.map((task) => <TaskItem key={task.task_id} labels={labels(task)} menu={renderMenu(task)} onOpen={() => onOpen(task)} task={task} />)}</Flexbox></section>;
}

function TaskItem({ labels, menu, onOpen, task }: { labels: { actions: string; next: string; remaining: string; schedule: string; status: string; target: string }; menu: DropdownItem[]; onOpen: () => void; task: ScheduledTaskSummary }) {
  return <Block clickable padding={12} variant="outlined" onClick={onOpen}><Flexbox align="center" gap={12} horizontal justify="space-between"><Flexbox gap={5} style={{ minWidth: 0 }}><Flexbox align="center" gap={8} horizontal><Text ellipsis weight={600}>{task.name}</Text><StatusTag label={labels.status} status={task.status} /></Flexbox><Text ellipsis fontSize={12} type="secondary">{labels.target}</Text><Text fontSize={12} type="secondary">{labels.schedule} · {labels.next}: {task.next_run_at_ms ? new Date(task.next_run_at_ms).toLocaleString() : "—"} · {labels.remaining}: {task.remaining_executions ?? "∞"}</Text></Flexbox><DropdownMenu items={menu}><Button aria-label={labels.actions} icon={<MoreHorizontal size={16} />} onClick={(event) => event.stopPropagation()} shape="circle" size="small" type="text" /></DropdownMenu></Flexbox></Block>;
}

function StatusTag({ label, status }: { label: string; status: ScheduledTaskStatus }): ReactNode {
  const color = status === "active" ? "green" : status === "blocked" ? "red" : status === "paused" ? "orange" : "default";
  return <Tag color={color}>{label}</Tag>;
}
