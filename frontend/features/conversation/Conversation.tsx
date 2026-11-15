import type { UIChatMessage } from "@lobechat/types";
import { Alert, copyToClipboard, Flexbox, Icon } from "@lobehub/ui";
import { Button, Tooltip } from "@lobehub/ui/base-ui";
import {
  Check,
  Copy,
  GitBranch,
  LoaderCircle,
  MessageSquare,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { translateMessage, type UiMessageValue } from "../../shared/i18n";
import {
  MarkdownMessageBody,
  fieldsMarkdownProps,
} from "./MarkdownMessageBody";
import {
  ReplyPreview,
  type ConversationReplyPreview,
} from "./ReplyPreview";
import AssistantGroup from "../../vendor/lobehub/components/AssistantGroup";
import { ConversationChatItem as ChatItem } from "../../vendor/lobehub/components/ConversationChatItem";
import MessageBranch from "../../vendor/lobehub/components/MessageBranch";
import {
  ConversationProvider,
  type ConversationStoreApi,
  useConversationStore,
  useConversationStoreApi,
} from "../../vendor/lobehub/store";
import {
  ChatContentRail,
  type ChatContentWidth,
} from "./ChatContentRail";

export type ConversationMessageAction =
  | "branch"
  | "copy"
  | "delete"
  | "edit"
  | "regenerate"
  | "reply";

export type ConversationProps = {
  context: {
    id: string;
    surface: "home" | "room";
  };
  contentWidth?: ChatContentWidth;
  messages: UIChatMessage[];
  store?: ConversationStoreApi;
  generatingMessageIds?: string[];
  loading?: boolean;
  error?: UiMessageValue;
  onBranchSwitch?: (messageId: string, branchIndex: number) => Promise<void> | void;
  onLinkPress?: (url: string) => void;
  onMessageAction?: (action: Exclude<ConversationMessageAction, "copy">, message: UIChatMessage) => void;
  messageActions?: (message: UIChatMessage) => readonly ConversationMessageAction[];
  renderBelowMessage?: (message: UIChatMessage) => ReactNode;
};

export function Conversation(props: ConversationProps) {
  return (
    <ConversationProvider
      key={`${props.context.surface}:${props.context.id}`}
      options={{
        context: props.context,
        initialMessages: props.messages,
        onBranchSwitch: props.onBranchSwitch,
      }}
      store={props.store}
    >
      <ConversationBody {...props} />
    </ConversationProvider>
  );
}

function ConversationBody({
  contentWidth = "compact",
  messages,
  store: externalStore,
  generatingMessageIds = [],
  loading = false,
  error = null,
  onBranchSwitch,
  onLinkPress = () => undefined,
  onMessageAction,
  messageActions = defaultActions,
  renderBelowMessage,
}: ConversationProps) {
  const { t } = useTranslation();
  const store = useConversationStoreApi();
  const displayMessages = useConversationStore((state) => state.displayMessages);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLatest, setShowLatest] = useState(false);
  const translatedError = translateMessage(t, error);

  useEffect(() => {
    if (!externalStore) store.getState().replaceMessages(messages);
  }, [externalStore, messages, store]);
  useEffect(() => {
    store.getState().setBranchSwitchHandler(onBranchSwitch);
    return () => store.getState().setBranchSwitchHandler(undefined);
  }, [onBranchSwitch, store]);
  useEffect(() => {
    if (externalStore) return;
    const current = new Set(store.getState().generatingMessageIds);
    const next = new Set(generatingMessageIds);
    for (const id of current) {
      if (!next.has(id)) store.getState().setGenerating(id, false);
    }
    for (const id of next) {
      if (!current.has(id)) store.getState().setGenerating(id, true);
    }
  }, [externalStore, generatingMessageIds, store]);
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const nearLatest = node.scrollHeight - node.scrollTop - node.clientHeight < 120;
    if (nearLatest) requestAnimationFrame(() => node.scrollTo({ top: node.scrollHeight }));
  }, [displayMessages]);

  if (loading && displayMessages.length === 0) {
    return (
      <div style={centered}>
        <Icon icon={LoaderCircle} size="large" spin />
      </div>
    );
  }

  return (
    <section style={{
      background: "var(--ant-color-bg-layout)",
      display: "flex",
      flex: 1,
      minHeight: 0,
      position: "relative",
    }}>
      <div
        aria-label={t("timeline.chatTimeline")}
        onScroll={(event) => {
          const node = event.currentTarget;
          setShowLatest(node.scrollHeight - node.scrollTop - node.clientHeight > 120);
        }}
        ref={scrollRef}
        style={{ flex: 1, minHeight: 0, overflow: "auto" }}
      >
        <ChatContentRail contentWidth={contentWidth} style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          padding: "24px 0 40px",
        }}>
          {translatedError ? <Alert message={translatedError} showIcon type="error" /> : null}
          {displayMessages.map((message) => (
            <ConversationItem
              actions={messageActions(message)}
              key={message.id}
              message={message}
              onAction={onMessageAction}
              onLinkPress={onLinkPress}
              renderBelowMessage={renderBelowMessage}
            />
          ))}
        </ChatContentRail>
      </div>
      {showLatest ? (
        <Button
          onClick={() => scrollRef.current?.scrollTo({
            behavior: "smooth",
            top: scrollRef.current.scrollHeight,
          })}
          style={{ bottom: 16, position: "absolute", right: 18 }}
        >
          {t("timeline.jumpToLatest")}
        </Button>
      ) : null}
    </section>
  );
}

function ConversationItem({
  message,
  actions,
  onAction,
  onLinkPress,
  renderBelowMessage,
}: {
  message: UIChatMessage;
  actions: readonly ConversationMessageAction[];
  onAction?: ConversationProps["onMessageAction"];
  onLinkPress: (url: string) => void;
  renderBelowMessage?: ConversationProps["renderBelowMessage"];
}) {
  const { t } = useTranslation();
  const switchBranch = useConversationStore((state) => state.switchMessageBranch);
  const generating = useConversationStore((state) => state.generatingMessageIds.includes(message.id));
  const markdownProps = fieldsMarkdownProps([], onLinkPress);
  const isSelf = message.metadata?.fieldsIsSelf === true
    || (message.role === "user" && message.metadata?.fieldsIsSelf !== false);
  const deleted = Boolean(message.metadata?.fieldsDeletedAt);
  const content = deleted ? t("timeline.messageDeleted") : message.content;
  const hasTurnProcess = message.role === "assistant"
    && (Array.isArray(message.metadata?.fieldsProcessBlocks) || generating);
  const replyPreview = isConversationReplyPreview(message.metadata?.fieldsReplyPreview)
    ? message.metadata.fieldsReplyPreview
    : null;
  const branch = message.branch ? (
    <MessageBranch
      activeBranchIndex={message.branch.activeBranchIndex}
      count={message.branch.count}
      messageId={message.id}
      onSwitch={(messageId, branchIndex) => void switchBranch(messageId, branchIndex)}
    />
  ) : null;
  const below = (
    <>
      {renderBelowMessage?.(message)}
      {branch}
    </>
  );
  const actionBar = deleted ? null : (
    <MessageActions
      actions={actions}
      message={message}
      onAction={onAction}
    />
  );
  if (message.role === "assistantGroup" || message.role === "supervisor") {
    return (
      <div id={`conversation-message-${message.id}`}>
        <ChatItem
          actions={actionBar}
          avatar={{ title: message.sender?.fullName ?? t("timeline.agent") }}
          belowMessage={below}
          message=""
          placement="left"
          renderMessage={() => <AssistantGroup message={message} onLinkPress={onLinkPress} />}
          time={message.createdAt}
        />
      </div>
    );
  }
  if (message.role === "system") {
    return (
      <ChatItem
        avatar={{ title: t("timeline.system") }}
        markdownProps={markdownProps}
        message={content}
        placement="left"
        showAvatar={false}
        showTitle={false}
        time={message.createdAt}
        variant="docs"
      />
    );
  }
  return (
    <div id={`conversation-message-${message.id}`}>
      <ChatItem
        actions={actionBar}
        avatar={{
          avatar: message.sender?.username ?? undefined,
          title: message.sender?.fullName ?? (isSelf ? t("timeline.you") : t("timeline.agent")),
        }}
        belowMessage={below}
        markdownProps={markdownProps}
        message={content}
        placement={isSelf ? "right" : "left"}
        primary={isSelf}
        renderMessage={hasTurnProcess
          ? () => (
            <Flexbox gap={8}>
              {replyPreview ? <ReplyPreview reply={replyPreview} /> : null}
              <AssistantGroup message={message} onLinkPress={onLinkPress} />
            </Flexbox>
          )
          : replyPreview
            ? () => (
              <Flexbox gap={8}>
                <ReplyPreview reply={replyPreview} />
                <MarkdownMessageBody
                  markdown={content}
                  mentions={[]}
                  onLinkPress={onLinkPress}
                />
              </Flexbox>
            )
            : undefined}
        time={message.createdAt}
      />
    </div>
  );
}

function isConversationReplyPreview(value: unknown): value is ConversationReplyPreview {
  if (typeof value !== "object" || value === null) return false;
  const reply = value as Partial<ConversationReplyPreview>;
  return Number.isInteger(reply.count) && Number(reply.count) > 0;
}

function MessageActions({
  actions,
  message,
  onAction,
}: {
  actions: readonly ConversationMessageAction[];
  message: UIChatMessage;
  onAction?: ConversationProps["onMessageAction"];
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  if (actions.length === 0) return null;
  const definitions: Record<ConversationMessageAction, { icon: ReactNode; label: string }> = {
    branch: { icon: <GitBranch size={15} />, label: t("timeline.branch") },
    copy: { icon: copied ? <Check size={15} /> : <Copy size={15} />, label: t("timeline.copyMessage") },
    delete: { icon: <Trash2 size={15} />, label: t("common.delete") },
    edit: { icon: <Pencil size={15} />, label: t("common.edit") },
    regenerate: { icon: <RefreshCw size={15} />, label: t("timeline.regenerate") },
    reply: { icon: <MessageSquare size={15} />, label: t("timeline.reply") },
  };
  return (
    <Flexbox gap={4} horizontal>
      {actions.map((action) => (
        <Tooltip key={action} title={definitions[action].label}>
          <Button
            aria-label={definitions[action].label}
            icon={definitions[action].icon}
            onClick={() => {
              if (action === "copy") {
                void copyToClipboard(message.content).then(() => setCopied(true));
                return;
              }
              onAction?.(action, message);
            }}
            shape="circle"
            size="small"
            type="text"
          />
        </Tooltip>
      ))}
    </Flexbox>
  );
}

function defaultActions(message: UIChatMessage): readonly ConversationMessageAction[] {
  if (message.role === "system") return [];
  return message.role === "user"
    ? ["edit", "copy", "delete"]
    : ["regenerate", "copy"];
}

const centered = {
  alignItems: "center",
  display: "flex",
  flex: 1,
  justifyContent: "center",
  minHeight: 0,
};
