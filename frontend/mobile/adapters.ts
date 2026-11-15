import type { HomeThreadListPanelItem } from "../features/home/HomeThreadListPanel";
import type { RoomRecord } from "../features/room";

export type MobileConversationRow = {
  id: string;
  title: string;
  preview: string;
  meta: string;
  unreadCount: number;
};

export function mobileHomeRow(item: HomeThreadListPanelItem): MobileConversationRow {
  return {
    id: item.id,
    title: item.title,
    preview: item.preview ?? item.sourceLabel ?? "",
    meta: [item.sourceLabel, item.timeLabel].filter(Boolean).join(" · "),
    unreadCount: item.unreadCount ?? (item.unread ? 1 : 0),
  };
}

export function mobileRoomRow(item: RoomRecord): MobileConversationRow {
  return {
    id: item.id,
    title: item.title,
    preview: item.subtitle,
    meta: mobileTimeLabel(item.updatedAtMs),
    unreadCount: item.unreadCount,
  };
}

export function mobileTimeLabel(value: number, now = Date.now()): string {
  if (!value) return "";
  const delta = Math.max(0, now - value);
  if (delta < 60_000) return "now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(value);
}
