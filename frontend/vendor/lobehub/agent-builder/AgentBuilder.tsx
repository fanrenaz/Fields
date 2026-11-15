import type { UIChatMessage } from "@lobechat/types";
import {
  ActionIcon,
  Avatar,
  Block,
  DropdownMenu,
  Flexbox,
  Markdown,
  Text,
} from "@lobehub/ui";
import { Button } from "@lobehub/ui/base-ui";
import { Clock3, Plus, RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Composer } from "../../../features/conversation/Composer";
import { Conversation } from "../../../features/conversation/Conversation";

export type AgentBuilderViewProps = {
  agentName: string;
  avatar: string;
  mode?: "agent" | "asset";
  topics: Array<{
    topic_id: string;
    title: string;
    updated_at_ms: number;
  }>;
  activeTopicId: string | null;
  messages: UIChatMessage[];
  draft: string;
  loading: boolean;
  submitting: boolean;
  error: string | null;
  onCreateTopic: () => void;
  onSelectTopic: (topicId: string) => void;
  onDraft: (value: string) => void;
  onSend: (value: string) => void;
};

/**
 * Vendored from LobeHub AgentBuilderConversation, AgentBuilderWelcome and
 * TopicSelector. Fields only supplies persistence/runtime callbacks.
 */
export function AgentBuilderView(props: AgentBuilderViewProps) {
  const { t } = useTranslation();
  const active = props.topics.find((topic) => topic.topic_id === props.activeTopicId);
  const items = useMemo(() => props.topics.map((topic) => ({
    checked: topic.topic_id === props.activeTopicId,
    closeOnClick: true,
    key: topic.topic_id,
    label: (
      <Flexbox horizontal align="center" gap={12} justify="space-between" width="100%">
        <span style={titleStyle}>{topic.title}</span>
        <span style={{ color: "var(--ant-color-text-tertiary)", fontSize: 11 }}>
          {new Date(topic.updated_at_ms).toLocaleDateString()}
        </span>
      </Flexbox>
    ),
    onCheckedChange: (checked: boolean) => {
      if (checked) props.onSelectTopic(topic.topic_id);
    },
    type: "checkbox" as const,
  })), [props.activeTopicId, props.onSelectTopic, props.topics]);

  return (
    <Flexbox flex={1} height="100%" style={{ background: "var(--ant-color-bg-container)", minHeight: 0 }}>
      <Flexbox
        horizontal
        align="center"
        justify="space-between"
        style={{ borderBottom: "1px solid var(--ant-color-border-secondary)", minHeight: 48, paddingInline: 12 }}
      >
        <span style={titleStyle}>{active?.title ?? t("agentBuilder.newConversation")}</span>
        <Flexbox horizontal gap={4}>
          <ActionIcon icon={Plus} title={t("agentBuilder.newConversation")} onClick={props.onCreateTopic} />
          <DropdownMenu
            items={items}
            placement="bottomRight"
            popupProps={{ style: { maxHeight: 400, minWidth: 280, overflowY: "auto" } }}
            triggerProps={{ disabled: props.topics.length === 0 }}
          >
            <ActionIcon disabled={props.topics.length === 0} icon={Clock3} title={t("agentBuilder.history")} />
          </DropdownMenu>
        </Flexbox>
      </Flexbox>
      <Flexbox flex={1} style={{ minHeight: 0, overflow: "hidden" }}>
        {props.messages.length > 0 || props.loading ? (
          <Conversation
            contentWidth="compact"
            context={{ id: props.activeTopicId ?? "new", surface: "home" }}
            error={props.error}
            loading={props.loading}
            messages={props.messages}
            messageActions={() => ["copy"]}
          />
        ) : (
          <AgentBuilderWelcome
            agentName={props.agentName}
            avatar={props.avatar}
            disabled={props.submitting}
            mode={props.mode ?? "agent"}
            onSuggestion={props.onDraft}
          />
        )}
      </Flexbox>
      <Composer
        contentWidth="compact"
        draft={props.draft}
        error={props.error}
        mentionOptions={[]}
        onClearReply={() => undefined}
        onDraft={props.onDraft}
        onSearch={() => undefined}
        onSend={props.onSend}
        referenceOptions={[]}
        replyAnchor={null}
        sendDisabled={props.submitting}
        showMentionButton={false}
        statusMessage={props.submitting
          ? props.mode === "asset" ? "assetBuilder.thinking" : "agentBuilder.thinking"
          : null}
      />
    </Flexbox>
  );
}

function AgentBuilderWelcome({ agentName, avatar, disabled, mode, onSuggestion }: {
  agentName: string;
  avatar: string;
  disabled: boolean;
  mode: "agent" | "asset";
  onSuggestion: (prompt: string) => void;
}) {
  const { t } = useTranslation();
  const prefix = mode === "asset" ? "assetBuilder" : "agentBuilder";
  const suggestionNames = mode === "asset"
    ? ["create", "improve", "validate"] as const
    : ["role", "instructions", "assets"] as const;
  const suggestions = suggestionNames.map((name) => (
    {
      prompt: t(`${prefix}.suggestions.${name}.prompt`),
      title: t(`${prefix}.suggestions.${name}.title`),
    }
  ));
  return (
    <Flexbox flex={1} justify="flex-end" gap={12} style={{ margin: "0 auto", maxWidth: 540, padding: "40px 20px 24px", width: "100%" }}>
      <Avatar avatar={avatar || "🤖"} shape="square" size={72} />
      <Text fontSize={24} weight="bold">{t(`${prefix}.title`)}</Text>
      <Markdown fontSize={14} variant="chat">
        {t(`${prefix}.welcome`, { name: agentName })}
      </Markdown>
      <Flexbox gap={8}>
        {suggestions.map((suggestion) => (
          <Block
            clickable={!disabled}
            key={suggestion.title}
            variant="outlined"
            style={{ cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1 }}
            onClick={() => {
              if (!disabled) onSuggestion(suggestion.prompt);
            }}
          >
            <Flexbox gap={4} paddingBlock={12} paddingInline={14}>
              <Text fontSize={14} weight={500}>{suggestion.title}</Text>
              <Text color="var(--ant-color-text-tertiary)" fontSize={12}>{suggestion.prompt}</Text>
            </Flexbox>
          </Block>
        ))}
      </Flexbox>
      <Button
        icon={<RefreshCw size={14} />}
        onClick={() => onSuggestion(suggestions[Math.floor(Math.random() * suggestions.length)]!.prompt)}
        size="small"
        type="text"
      >
        {t(`${prefix}.switchSuggestion`)}
      </Button>
    </Flexbox>
  );
}

const titleStyle = {
  overflow: "hidden",
  fontSize: 14,
  fontWeight: 500,
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;
