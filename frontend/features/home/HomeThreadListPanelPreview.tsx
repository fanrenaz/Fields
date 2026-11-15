import { useState } from "react";
import { useTranslation } from "react-i18next";
import { HomeThreadListPanel } from "./HomeThreadListPanel";

const previewThreads = [
  { id: "streaming", title: "检查 Home streaming 链路", timeLabel: "今天", active: true, unread: true },
  { id: "thread-list", title: "准备 thread list 右侧面板", timeLabel: "今天" },
  { id: "ws", title: "切换 desktop tRPC 全 WS", timeLabel: "1天前", unread: true },
  { id: "room-bridge", title: "完成 Room Sandbox WS Bridge", timeLabel: "1天前" },
  { id: "sandbox", title: "检查 SandboxAgent 服务", timeLabel: "1天前" },
] as const;

export function HomeThreadListPanelPreview() { const { t } = useTranslation(); const [expanded, setExpanded] = useState(false); return <HomeThreadListPanel expanded={expanded} items={[...previewThreads]} moreLabel={t("home.more")} onExpand={() => setExpanded(true)} />; }
