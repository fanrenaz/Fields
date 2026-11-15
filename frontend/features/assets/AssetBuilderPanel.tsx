import type {
  AssetBuilderTarget,
  AssetBuilderTopic,
} from "@fields/contracts/public/asset-builder";
import type { UIChatMessage } from "@lobechat/types";
import { useCallback, useEffect, useState } from "react";
import { ulid } from "ulid";

import { backendTrpc } from "../../data/boundary/backend-trpc";
import { projectHomeConversation } from "../conversation/fields-conversation-adapter";
import { AgentBuilderView } from "../../vendor/lobehub/agent-builder/AgentBuilder";

export function AssetBuilderPanel({
  target,
  onTargetChange,
}: {
  target: AssetBuilderTarget;
  onTargetChange: (target: AssetBuilderTarget) => void;
}) {
  const [topics, setTopics] = useState<AssetBuilderTopic[]>([]);
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
      const result = await backendTrpc.assetBuilder.topic.read.query({
        topic_id: topicId,
      });
      setMessages(result.thread ? projectHomeConversation(result.thread).messages : []);
      setActiveTopicId(topicId);
    } catch {
      setError("assetBuilder.loadFailed");
    } finally {
      setLoading(false);
    }
  }, []);

  const createTopic = useCallback(async () => {
    setError(null);
    try {
      const topic = await backendTrpc.assetBuilder.topic.create.mutate(target);
      setTopics((current) => [topic, ...current]);
      setActiveTopicId(topic.topic_id);
      setMessages([]);
    } catch {
      setError("assetBuilder.createTopicFailed");
    }
  }, [target]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void backendTrpc.assetBuilder.topic.list.query(target).then(async (result) => {
      if (!active) return;
      setTopics(result.items);
      const topic = result.items[0]
        ?? await backendTrpc.assetBuilder.topic.create.mutate(target);
      if (!active) return;
      if (result.items.length === 0) setTopics([topic]);
      await readTopic(topic.topic_id);
    }).catch(() => {
      if (active) setError("assetBuilder.loadFailed");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [readTopic, target]);

  async function send(prompt: string) {
    if (!activeTopicId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await backendTrpc.assetBuilder.turn.submit.mutate({
        topic_id: activeTopicId,
        prompt,
        client_message_id: `asset-builder-${ulid()}`,
        timeout_ms: 900_000,
      });
      setDraft("");
      setTopics((current) => [
        result.topic,
        ...current.filter((topic) => topic.topic_id !== result.topic.topic_id),
      ]);
      if (
        result.topic.target.asset_id !== target.asset_id
        || result.topic.target.draft_id !== target.draft_id
      ) {
        onTargetChange(result.topic.target);
      }
      await readTopic(result.topic.topic_id);
    } catch {
      setError("assetBuilder.sendFailed");
    } finally {
      setSubmitting(false);
    }
  }

  const label = target.asset_id
    ? `${target.kind} · ${target.asset_id}`
    : target.kind;
  return (
    <AgentBuilderView
      activeTopicId={activeTopicId}
      agentName={label}
      avatar={target.kind === "plugin" ? "🧩" : target.kind === "skill" ? "✨" : "🔌"}
      draft={draft}
      error={error}
      loading={loading}
      messages={messages}
      mode="asset"
      submitting={submitting}
      topics={topics}
      onCreateTopic={() => void createTopic()}
      onDraft={setDraft}
      onSelectTopic={(topicId) => void readTopic(topicId)}
      onSend={(prompt) => void send(prompt)}
    />
  );
}
