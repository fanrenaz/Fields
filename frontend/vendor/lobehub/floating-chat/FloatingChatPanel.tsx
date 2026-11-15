import type { UIChatMessage } from "@lobechat/types";
import { createStaticStyles } from "antd-style";

import type { UiMessageValue } from "../../../shared/i18n/message";
import { Composer } from "../../../features/conversation/Composer";
import { Conversation } from "../../../features/conversation/Conversation";
import type { ConversationStoreApi } from "../store";

const styles = createStaticStyles(({ css, cssVar }) => ({
  panel: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: ${cssVar.colorBgContainer};
  `,
  body: css`
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    position: relative;
  `,
  input: css`
    flex-shrink: 0;
    padding-block-start: 8px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    background: ${cssVar.colorBgContainer};
  `,
}));

/**
 * Presentation adapter derived from LobeHub's pinned FloatingChatPanel.
 * Fields supplies the isolated store and owns persistence and authorization.
 */
export function FloatingChatPanel({
  roomId,
  messages,
  store,
  generatingMessageIds,
  loading,
  submitting,
  error,
  draft,
  onDraft,
  onSend,
}: {
  roomId: string;
  messages: UIChatMessage[];
  store: ConversationStoreApi;
  generatingMessageIds: string[];
  loading: boolean;
  submitting: boolean;
  error: UiMessageValue;
  draft: string;
  onDraft: (value: string) => void;
  onSend: (value: string) => void;
}) {
  return (
    <aside className={styles.panel} data-testid="room-side-chat">
      <div className={styles.body}>
        <Conversation
          contentWidth="compact"
          context={{ id: roomId, surface: "home" }}
          error={error}
          generatingMessageIds={generatingMessageIds}
          loading={loading}
          messageActions={() => ["copy"]}
          messages={messages}
          store={store}
        />
      </div>
      <div className={styles.input}>
        <Composer
          contentWidth="compact"
          draft={draft}
          error={null}
          mentionOptions={[]}
          minimal
          onClearReply={() => undefined}
          onDraft={onDraft}
          onSearch={() => undefined}
          onSend={onSend}
          referenceOptions={[]}
          replyAnchor={null}
          sendDisabled={submitting}
          showMentionButton={false}
          surface="docked"
        />
      </div>
    </aside>
  );
}
