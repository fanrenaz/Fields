import type {
  AgentBuilderProfile,
  AgentBuilderTopic,
} from "@fields/contracts/public/agent-builder";
import type { UIChatMessage } from "@lobechat/types";
import { Alert, Flexbox, Skeleton, Text } from "@lobehub/ui";
import { Button, Input, Switch, TextArea } from "@lobehub/ui/base-ui";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ulid } from "ulid";

import { backendTrpc } from "../../data/boundary/backend-trpc";
import { projectHomeConversation } from "../conversation/fields-conversation-adapter";
import { AgentBuilderView } from "../../vendor/lobehub/agent-builder/AgentBuilder";

export function AgentBuilderPanel({ agentMemberId, agentName }: {
  agentMemberId: string;
  agentName: string;
}) {
  const [profile, setProfile] = useState<AgentBuilderProfile | null>(null);
  const [topics, setTopics] = useState<AgentBuilderTopic[]>([]);
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readTopic = useCallback(async (topicId: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await backendTrpc.agentBuilder.topic.read.query({
        agent_member_id: agentMemberId,
        topic_id: topicId,
      });
      setMessages(result.thread ? projectHomeConversation(result.thread).messages : []);
      setActiveTopicId(topicId);
    } catch {
      setError("agentBuilder.loadFailed");
    } finally {
      setLoading(false);
    }
  }, [agentMemberId]);

  const createTopic = useCallback(async () => {
    setError(null);
    try {
      const topic = await backendTrpc.agentBuilder.topic.create.mutate({
        agent_member_id: agentMemberId,
      });
      setTopics((current) => [topic, ...current]);
      setActiveTopicId(topic.topic_id);
      setMessages([]);
    } catch {
      setError("agentBuilder.createTopicFailed");
    }
  }, [agentMemberId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void Promise.all([
      backendTrpc.agentBuilder.profile.get.query({ agent_member_id: agentMemberId }),
      backendTrpc.agentBuilder.topic.list.query({ agent_member_id: agentMemberId }),
    ]).then(async ([nextProfile, nextTopics]) => {
      if (!active) return;
      setProfile(nextProfile);
      setTopics(nextTopics.items);
      const topic = nextTopics.items[0] ?? await backendTrpc.agentBuilder.topic.create.mutate({
        agent_member_id: agentMemberId,
      });
      if (!active) return;
      if (nextTopics.items.length === 0) setTopics([topic]);
      await readTopic(topic.topic_id);
    }).catch(() => {
      if (active) setError("agentBuilder.loadFailed");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [agentMemberId, readTopic]);

  async function send(prompt: string) {
    if (!activeTopicId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await backendTrpc.agentBuilder.turn.submit.mutate({
        agent_member_id: agentMemberId,
        topic_id: activeTopicId,
        prompt,
        client_message_id: `agent-builder-${ulid()}`,
        timeout_ms: 900_000,
      });
      setDraft("");
      setProfile(result.profile);
      setTopics((current) => [
        result.topic,
        ...current.filter((topic) => topic.topic_id !== result.topic.topic_id),
      ]);
      await readTopic(result.topic.topic_id);
    } catch {
      setError("agentBuilder.sendFailed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AgentBuilderView
      activeTopicId={activeTopicId}
      agentName={agentName}
      avatar={profile?.avatar ?? "🤖"}
      draft={draft}
      error={error}
      loading={loading}
      messages={messages}
      submitting={submitting}
      topics={topics}
      onCreateTopic={() => void createTopic()}
      onDraft={setDraft}
      onSelectTopic={(topicId) => void readTopic(topicId)}
      onSend={(prompt) => void send(prompt)}
    />
  );
}

export function AgentProfileEditor({ agentMemberId }: { agentMemberId: string }) {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<AgentBuilderProfile | null>(null);
  const [draft, setDraft] = useState<AgentBuilderProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void backendTrpc.agentBuilder.profile.get.query({ agent_member_id: agentMemberId })
      .then((value) => {
        if (!active) return;
        setProfile(value);
        setDraft(value);
      })
      .catch(() => { if (active) setError("agentBuilder.loadFailed"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [agentMemberId]);

  useEffect(() => {
    if (profile?.memory.status !== "applying") return;
    const timer = window.setInterval(() => {
      void backendTrpc.agentBuilder.profile.get.query({ agent_member_id: agentMemberId })
        .then((value) => {
          setProfile(value);
          setDraft((current) => current ? {
            ...current,
            agent_member_id: value.agent_member_id,
            memory: value.memory,
            revision: value.revision,
            updated_at_ms: value.updated_at_ms,
          } : value);
        })
        .catch(() => undefined);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [agentMemberId, profile?.memory.status]);

  if (loading || !draft || !profile) return <Skeleton active paragraph={{ rows: 4 }} />;

  async function save() {
    if (!draft || !profile || saving) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await backendTrpc.agentBuilder.profile.update.mutate({
        agent_member_id: agentMemberId,
        avatar: draft.avatar,
        description: draft.description,
        instructions: draft.instructions,
        readiness: draft.readiness,
        memory_enabled: draft.memory.enabled,
        expected_revision: profile.revision,
      });
      setProfile(updated);
      setDraft(updated);
    } catch {
      setError("agentBuilder.saveFailed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Flexbox gap={14} style={{ paddingBlock: 20 }}>
      <Text as="h3" fontSize={17} strong style={{ margin: 0 }}>{t("agentBuilder.profile")}</Text>
      <Flexbox horizontal gap={12}>
        <Input
          aria-label={t("agentBuilder.avatar")}
          maxLength={32}
          onChange={(event) => setDraft({ ...draft, avatar: event.target.value })}
          style={{ width: 80 }}
          value={draft.avatar}
        />
        <Input
          aria-label={t("agentBuilder.description")}
          onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          placeholder={t("agentBuilder.description")}
          value={draft.description}
        />
      </Flexbox>
      <TextArea
        aria-label={t("agentBuilder.instructions")}
        autoSize={{ minRows: 8, maxRows: 20 }}
        onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
        placeholder={t("agentBuilder.instructionsPlaceholder")}
        value={draft.instructions}
      />
      <Flexbox horizontal align="center" justify="space-between">
        <Text>{t("agentBuilder.memory")}</Text>
        <Flexbox horizontal align="center" gap={8}>
          <Text role="status" type="secondary">
            {t(`agentBuilder.memoryStatus.${memoryStatusKey(profile.memory)}`)}
          </Text>
          <Switch
            aria-label={t("agentBuilder.memory")}
            checked={draft.memory.enabled}
            disabled={saving || profile.memory.status === "applying"}
            onChange={(enabled) => setDraft({
              ...draft,
              memory: { ...draft.memory, enabled },
            })}
          />
        </Flexbox>
      </Flexbox>
      {profile.memory.status === "failed" ? (
        <Alert message={t("agentBuilder.memoryApplyFailed")} showIcon type="warning" />
      ) : null}
      {error ? <Alert message={t(error)} showIcon type="error" /> : null}
      <Flexbox horizontal align="center" justify="space-between">
        <Text type="secondary">{t(`agentBuilder.readiness.${draft.readiness}`)}</Text>
        <Flexbox horizontal gap={8}>
          <Button
            onClick={() => setDraft({ ...draft, readiness: draft.readiness === "ready" ? "draft" : "ready" })}
          >
            {t(draft.readiness === "ready" ? "agentBuilder.markDraft" : "agentBuilder.markReady")}
          </Button>
          <Button loading={saving} onClick={() => void save()} type="primary">{t("common.save")}</Button>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
}

function memoryStatusKey(memory: AgentBuilderProfile["memory"]): string {
  if (memory.status === "applying") return memory.enabled ? "enabling" : "disabling";
  if (memory.status === "failed") return "failed";
  return memory.applied_enabled ? "enabled" : "disabled";
}
