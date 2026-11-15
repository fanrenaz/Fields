import type { ScheduledTaskCreateTarget, ScheduledTaskTarget } from "@fields/contracts/public/scheduled-task";

export type ScheduledTaskTargetOptions = {
  rooms: Array<{ id: string; title: string }>;
  threads: Array<{ id: string; title: string }>;
};

type Translation = (key: string, options?: Record<string, unknown>) => string;

export function scheduledTaskTargetLabel(target: ScheduledTaskCreateTarget | ScheduledTaskTarget, options: ScheduledTaskTargetOptions, t: Translation): string {
  if (target.kind === "room") {
    return t("scheduledTasks.roomTarget", { name: options.rooms.find((room) => room.id === target.room_id)?.title ?? target.room_id });
  }
  if (target.thread_mode === "existing") {
    return t("scheduledTasks.homeThreadTarget", { name: options.threads.find((thread) => thread.id === target.thread_id)?.title ?? target.thread_id });
  }
  return t("scheduledTasks.homeNewTarget");
}

export function scheduledTaskTargetSelectOptions(options: ScheduledTaskTargetOptions, t: Translation) {
  return [
    { label: t("scheduledTasks.homeNewTarget"), value: "home:new" },
    ...options.threads.map((thread) => ({ label: t("scheduledTasks.homeThreadTarget", { name: thread.title }), value: `home:${thread.id}` })),
    ...options.rooms.map((room) => ({ label: t("scheduledTasks.roomTarget", { name: room.title }), value: `room:${room.id}` })),
  ];
}

export function scheduledTaskTargetToValue(target: ScheduledTaskCreateTarget | ScheduledTaskTarget): string {
  if (target.kind === "room") return `room:${target.room_id}`;
  return target.thread_mode === "existing" ? `home:${target.thread_id}` : "home:new";
}

export function scheduledTaskTargetFromValue(value: string): ScheduledTaskCreateTarget | null {
  if (value === "home:new") return { kind: "home", thread_mode: "new_each_run", thread_id: null };
  if (value.startsWith("home:") && value.length > 5) return { kind: "home", thread_mode: "existing", thread_id: value.slice(5) };
  if (value.startsWith("room:") && value.length > 5) return { kind: "room", room_id: value.slice(5) };
  return null;
}
