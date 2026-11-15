import { useTranslation } from "react-i18next";

import { FloatingChatPanel } from "../../vendor/lobehub/floating-chat/FloatingChatPanel";
import { useRoomSideChat } from "./use-room-side-chat";

export function RoomSideChatPanel({
  active,
  roomId,
}: {
  active: boolean;
  roomId: string | null;
}) {
  const { t } = useTranslation();
  const chat = useRoomSideChat({ active, roomId });
  if (!roomId) {
    return (
      <div style={{
        alignItems: "center",
        color: "var(--ant-color-text-tertiary)",
        display: "flex",
        flex: 1,
        fontSize: 13,
        justifyContent: "center",
      }}>
        {t("room.sideChatNoRoom")}
      </div>
    );
  }
  return (
    <FloatingChatPanel
      draft={chat.draft}
      error={chat.error}
      generatingMessageIds={chat.generatingMessageIds}
      loading={chat.loading}
      messages={chat.messages}
      roomId={roomId}
      store={chat.store}
      submitting={chat.submitting}
      onDraft={chat.onDraft}
      onSend={chat.onSend}
    />
  );
}
