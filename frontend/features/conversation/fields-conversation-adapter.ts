import type {
  AgentContent,
  AgentTurnEvent,
  AgentTurnItem,
  AgentTurnSnapshot,
} from "@fields/contracts/public/agent-activity";
import type {
  HomeThreadReadResult,
  HomeThreadTurn,
} from "@fields/contracts/public/home";
import type { AssistantContentBlock, UIChatMessage } from "@lobechat/types";

import type { TimelineMessage } from "../../shared/types/timeline";
import type { BrowserSafeTool } from "../../vendor/lobehub/store/tool-store";
import { markdownPlainText } from "./markdown-plain-text";

export type FieldsConversationProjection = {
  messages: UIChatMessage[];
  selectedThreadId: string;
  generatingMessageIds: string[];
  turnOrder: string[];
  turns: Record<string, HomeThreadTurn>;
};

export function projectHomeConversation(
  result: HomeThreadReadResult,
): FieldsConversationProjection {
  const turns = Object.fromEntries(result.turns.map((turn) => [
    homeTurnKey(turn.thread_id, turn.turn_id),
    turn,
  ]));
  return projectHomeTurnRecords({
    result,
    turns,
    turnOrder: result.turns.map((turn) => homeTurnKey(turn.thread_id, turn.turn_id)),
  });
}

export function reduceHomeConversationEvent(
  state: FieldsConversationProjection,
  result: HomeThreadReadResult,
  event: AgentTurnEvent,
): FieldsConversationProjection {
  if (event.scope.type !== "home" || event.scope.thread_id !== state.selectedThreadId) {
    return state;
  }
  const turnId = event.turn_id;
  if (!turnId) return state;
  const key = homeTurnKey(state.selectedThreadId, turnId);
  const current = state.turns[key]?.snapshot ?? emptySnapshot(turnId);
  const snapshot = reduceAgentTurnSnapshot(current, event);
  const turns = {
    ...state.turns,
    [key]: {
      thread_id: state.selectedThreadId,
      turn_id: turnId,
      snapshot,
    },
  };
  const turnOrder = state.turnOrder.includes(key)
    ? state.turnOrder
    : [...state.turnOrder, key];
  return projectHomeTurnRecords({ result, turns, turnOrder });
}

function projectHomeTurnRecords(input: {
  result: HomeThreadReadResult;
  turns: Record<string, HomeThreadTurn>;
  turnOrder: string[];
}): FieldsConversationProjection {
  const orderedTurns = input.turnOrder.flatMap((key) => input.turns[key] ? [input.turns[key]!] : []);
  const turnsByThread = new Map<string, HomeThreadTurn[]>();
  for (const turn of orderedTurns) {
    turnsByThread.set(turn.thread_id, [...(turnsByThread.get(turn.thread_id) ?? []), turn]);
  }
  const messagesById = new Map<string, UIChatMessage>();
  const pathByThread = new Map<string, string[]>();
  let ordinal = 0;
  for (const branch of input.result.branches) {
    let parentId: string | undefined;
    const path: string[] = [];
    for (const turn of turnsByThread.get(branch.thread_id) ?? []) {
      const projected = messagesForTurn(turn, parentId, ordinal);
      ordinal += 1;
      for (const message of projected) {
        const existing = messagesById.get(message.id);
        if (!existing) messagesById.set(message.id, message);
        path.push(message.id);
        parentId = message.id;
      }
    }
    pathByThread.set(branch.thread_id, path);
  }
  const selectedPath = new Set(pathByThread.get(input.result.selected_thread_id) ?? []);
  const messages = [...messagesById.values()];
  const childrenByParent = new Map<string, string[]>();
  for (const message of messages) {
    if (!message.parentId) continue;
    const children = childrenByParent.get(message.parentId) ?? [];
    if (!children.includes(message.id)) children.push(message.id);
    childrenByParent.set(message.parentId, children);
  }
  const branchedMessages = messages.map((message) => {
    const children = childrenByParent.get(message.id) ?? [];
    if (children.length < 2) return message;
    const selectedIndex = Math.max(0, children.findIndex((childId) => selectedPath.has(childId)));
    return {
      ...message,
      metadata: {
        ...message.metadata,
        activeBranchIndex: selectedIndex,
      },
    };
  });
  return {
    messages: branchedMessages,
    selectedThreadId: input.result.selected_thread_id,
    generatingMessageIds: branchedMessages
      .filter((message) => message.metadata?.fieldsStatus === "queued" || message.metadata?.fieldsStatus === "running")
      .map((message) => message.id),
    turnOrder: input.turnOrder,
    turns: input.turns,
  };
}

function messagesForTurn(
  turn: HomeThreadTurn,
  parentId: string | undefined,
  ordinal: number,
): UIChatMessage[] {
  const snapshot = turn.snapshot;
  const occurredAt = snapshot.started_at_ms ?? ordinal;
  const userItems = snapshot.narrative_items.filter((item) => item.type === "user_message");
  const userMessages = userItems.map((item, index): UIChatMessage => ({
    id: `home:item:${item.id}`,
    role: "user",
    content: contentMarkdown(item.content),
    createdAt: occurredAt + index,
    updatedAt: snapshot.completed_at_ms ?? occurredAt + index,
    parentId,
    threadId: turn.thread_id,
    metadata: {
      fieldsItemId: item.id,
      fieldsImported: turn.origin === "imported",
      fieldsTurnId: turn.turn_id,
      fieldsStatus: item.status,
    },
  }));
  const assistantParentId = userMessages.at(-1)?.id ?? parentId;
  const assistant = assistantMessageForTurn(turn, assistantParentId, occurredAt);
  return assistant ? [...userMessages, assistant] : userMessages;
}

function assistantMessageForTurn(
  turn: HomeThreadTurn,
  parentId: string | undefined,
  occurredAt: number,
): UIChatMessage | null {
  const snapshot = turn.snapshot;
  const assistantItems = snapshot.narrative_items.filter((item) => item.type === "assistant_message");
  const finalContent = assistantItems
    .filter((item) => item.phase === "final_answer")
    .map((item) => contentMarkdown(item.content))
    .filter(Boolean)
    .join("\n\n");
  const tools = snapshot.activity_items.map(browserSafeTool);
  const error = snapshot.error;
  const processBlocks: Array<AssistantContentBlock & { fieldsTool?: BrowserSafeTool }> = [
    ...snapshot.narrative_items.flatMap((item) => {
      if (item.type === "assistant_message" && item.phase !== "final_answer") {
        const content = contentMarkdown(item.content);
        return content ? [{
          id: item.id,
          content,
          metadata: { fieldsProcessKind: "commentary" },
        }] : [];
      }
      if (item.type === "plan") {
        const content = contentMarkdown(item.content);
        return content ? [{
          id: item.id,
          content,
          metadata: { fieldsProcessKind: "plan" },
        }] : [];
      }
      if (item.type === "reasoning") {
        const content = [
          contentMarkdown(item.summary),
          contentMarkdown(item.content),
        ].filter(Boolean).join("\n\n");
        return content ? [{
          id: item.id,
          content: "",
          metadata: { fieldsProcessKind: "reasoning" },
          reasoning: {
            content,
            duration: snapshot.duration_ms ?? undefined,
          },
        }] : [];
      }
      return [];
    }),
    ...tools.map((tool) => ({
      id: tool.id,
      content: "",
      metadata: { fieldsProcessKind: "activity" },
      fieldsTool: tool,
    })),
  ];
  if (error) {
    processBlocks.push({
      id: `${turn.turn_id}:error`,
      content: "",
      metadata: { fieldsProcessKind: "error" },
      error: { type: error.code, message: error.message },
    });
  }
  const running = snapshot.status === "queued" || snapshot.status === "running";
  if (!finalContent && processBlocks.length === 0 && (snapshot.interactions?.length ?? 0) === 0 && !running) return null;
  const messageId = `home:turn:${turn.turn_id}:assistant`;
  return {
    id: messageId,
    role: "assistant",
    content: finalContent,
    createdAt: occurredAt,
    updatedAt: snapshot.completed_at_ms ?? occurredAt,
    parentId,
    threadId: turn.thread_id,
    error: error ? { type: error.code, message: error.message } : undefined,
    tools: tools.map((tool) => ({
      apiName: tool.name,
      arguments: "{}",
      id: tool.id,
      identifier: tool.namespace ?? "fields",
      result_msg_id: `${messageId}:tool:${tool.id}`,
      type: "default",
    })),
    metadata: {
      fieldsProcessBlocks: processBlocks,
      fieldsProcessSummary: latestProcessSummary(snapshot, tools),
      fieldsStatus: snapshot.status,
      fieldsTools: tools,
      fieldsQuestionInteractions: snapshot.interactions ?? [],
      fieldsImported: turn.origin === "imported",
      fieldsTurnId: turn.turn_id,
    },
    performance: snapshot.duration_ms === null ? undefined : { duration: snapshot.duration_ms },
  };
}

function latestProcessSummary(
  snapshot: AgentTurnSnapshot,
  tools: readonly BrowserSafeTool[],
): string | null {
  const activeTool = [...tools].reverse().find((tool) => (
    tool.status === "queued"
    || tool.status === "running"
    || tool.intervention?.status === "pending"
  ));
  if (activeTool) {
    return activeTool.progress.at(-1)
      ?? activeTool.displayName
      ?? activeTool.name;
  }
  const commentary = [...snapshot.narrative_items].reverse().find((item) => (
    (item.type === "assistant_message" && item.phase !== "final_answer")
    || item.type === "plan"
  ));
  if (commentary && (commentary.type === "assistant_message" || commentary.type === "plan")) {
    const content = contentMarkdown(commentary.content).trim();
    if (content) return content;
  }
  const reasoning = [...snapshot.narrative_items].reverse().find((item) => item.type === "reasoning");
  if (reasoning?.type === "reasoning") {
    const content = [
      contentMarkdown(reasoning.summary),
      contentMarkdown(reasoning.content),
    ].filter(Boolean).join("\n\n").trim();
    if (content) return content;
  }
  const completedTool = [...tools].reverse().find((tool) => tool.status === "completed");
  return completedTool?.displayName ?? completedTool?.name ?? null;
}

export function projectRoomConversation(
  messages: TimelineMessage[],
  currentUserId?: string,
  snapshotsByExecutionId: Readonly<Record<string, AgentTurnSnapshot>> = {},
): UIChatMessage[] {
  const result: UIChatMessage[] = [];
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  let parentId: string | undefined;
  for (const message of messages) {
    const role = message.kind === "system"
      ? "system"
      : message.sender.type === "agent"
        ? "assistant"
        : "user";
    let projected: UIChatMessage = {
      id: `room:message:${message.id}`,
      role,
      content: message.body.markdown,
      createdAt: message.occurred_at,
      updatedAt: message.kind === "message"
        ? message.edited_at_ms ?? message.occurred_at
        : message.occurred_at,
      parentId,
      threadId: message.kind === "message" ? message.thread_id : null,
      sender: message.kind === "message" ? {
        id: message.sender.id,
        fullName: message.sender.display_name,
        username: message.sender.mark,
      } : null,
      metadata: message.kind === "message" ? {
        fieldsDeletedAt: message.deleted_at_ms,
        fieldsInteractions: message.interactions,
        fieldsReplyPreview: roomReplyPreview(message.reply_to, messagesById),
        fieldsReplyTo: message.reply_to,
        fieldsRevision: message.revision,
        fieldsRoomMessageId: message.id,
        fieldsStatus: message.agent_turn?.status,
        fieldsIsSelf: message.sender.id === currentUserId,
        fieldsSenderType: message.sender.type,
        fieldsVersion: message.agent_reply_version,
      } : {
        fieldsRoomMessageId: message.id,
      },
    };
    const executionId = message.kind === "message"
      ? message.agent_turn?.execution_id
      : undefined;
    const snapshot = executionId ? snapshotsByExecutionId[executionId] : undefined;
    if (snapshot && message.kind === "message" && message.sender.type === "agent") {
      const activity = assistantMessageForTurn({
        thread_id: message.thread_id ?? message.id,
        turn_id: snapshot.turn_id ?? executionId ?? message.id,
        snapshot,
      }, projected.parentId, message.occurred_at);
      if (activity) {
        projected = {
          ...projected,
          content: projected.content || activity.content,
          error: activity.error,
          metadata: {
            ...projected.metadata,
            ...activity.metadata,
          },
          performance: activity.performance,
          reasoning: activity.reasoning,
          tools: activity.tools,
        };
      }
    }
    if (message.kind === "message" && message.agent_reply_version) {
      projected.metadata = {
        ...projected.metadata,
        fieldsVersionGroupId: message.agent_reply_version.group_id,
      };
    }
    result.push(projected);
    parentId = projected.id;
  }
  const versions = new Map<string, UIChatMessage[]>();
  for (const message of result) {
    const groupId = typeof message.metadata?.fieldsVersionGroupId === "string"
      ? message.metadata.fieldsVersionGroupId
      : null;
    if (groupId) versions.set(groupId, [...(versions.get(groupId) ?? []), message]);
  }
  for (const group of versions.values()) {
    if (group.length < 2) continue;
    const firstIndex = result.findIndex((message) => message.id === group[0]!.id);
    const preceding = firstIndex > 0 ? result[firstIndex - 1] : undefined;
    for (const version of group) version.parentId = preceding?.id;
    if (preceding) {
      preceding.metadata = {
        ...preceding.metadata,
        activeBranchIndex: Math.max(0, group.findIndex((message) => message.metadata?.fieldsVersion?.selected === true)),
      };
    }
  }
  const branchTailByThread = new Map<string, UIChatMessage>();
  for (const message of result) {
    const threadId = message.threadId;
    if (!threadId) continue;
    const versionGroupId = typeof message.metadata?.fieldsVersionGroupId === "string"
      ? message.metadata.fieldsVersionGroupId
      : null;
    if (versionGroupId) {
      branchTailByThread.set(threadId, message);
      continue;
    }
    const branchTail = branchTailByThread.get(threadId);
    if (!branchTail) continue;
    message.parentId = branchTail.id;
    branchTailByThread.set(threadId, message);
  }
  return result;
}

function roomReplyPreview(
  replyTo: Extract<TimelineMessage, { kind: "message" }>["reply_to"],
  messagesById: ReadonlyMap<string, TimelineMessage>,
) {
  if (!replyTo || replyTo.message_ids.length === 0) return null;
  const target = replyTo.message_ids.length === 1
    ? messagesById.get(replyTo.message_ids[0]!)
    : undefined;
  return {
    count: replyTo.message_ids.length,
    target: target?.kind === "message"
      ? {
        content: markdownPlainText(target.body.markdown),
        id: target.id,
        senderName: target.sender.display_name,
      }
      : null,
  };
}

export function reduceAgentTurnSnapshot(
  snapshot: AgentTurnSnapshot,
  event: AgentTurnEvent,
): AgentTurnSnapshot {
  if (event.type === "agent_turn.snapshot") return event.snapshot;
  if (event.type === "agent_turn.status") {
    return {
      ...snapshot,
      status: event.status,
      started_at_ms: event.started_at_ms,
      completed_at_ms: event.completed_at_ms,
      duration_ms: event.duration_ms,
      error: event.error,
    };
  }
  if (event.type === "agent_turn.question_interaction") {
    const interactions = snapshot.interactions ?? [];
    const exists = interactions.some((interaction) => interaction.id === event.interaction.id);
    return {
      ...snapshot,
      interactions: exists
        ? interactions.map((interaction) => interaction.id === event.interaction.id ? event.interaction : interaction)
        : [...interactions, event.interaction],
    };
  }
  const items: AgentTurnItem[] = [...snapshot.narrative_items, ...snapshot.activity_items];
  if (event.type === "agent_turn.item_remove") {
    return snapshotWithItems(snapshot, items.filter((item) => item.id !== event.item_id));
  }
  if (event.type === "agent_turn.item_upsert") {
    const index = items.findIndex((item) => item.id === event.item.id);
    const next = index < 0
      ? [...items, event.item]
      : items.map((item, itemIndex) => itemIndex === index ? event.item : item);
    return snapshotWithItems(snapshot, next);
  }
  const item = items.find((candidate) => candidate.id === event.item_id);
  if (!item) return snapshot;
  const nextItem = reduceItemDelta(item, event);
  return snapshotWithItems(
    snapshot,
    items.map((candidate) => candidate.id === nextItem.id ? nextItem : candidate),
  );
}

function reduceItemDelta(item: AgentTurnItem, event: AgentTurnEvent): AgentTurnItem {
  if (event.type === "agent_turn.message_delta") {
    if (item.type !== "assistant_message" && item.type !== "plan") return item;
    return {
      ...item,
      content: appendContent(item.content, event.delta),
    };
  }
  if (event.type === "agent_turn.reasoning_delta") {
    if (item.type !== "reasoning") return item;
    const target = event.target === "summary" ? item.summary : item.content;
    const next = [...target];
    next[event.index] = appendAgentContent(next[event.index], event.delta);
    return event.target === "summary"
      ? { ...item, summary: next }
      : { ...item, content: next };
  }
  if (event.type === "agent_turn.command_output_delta") {
    return item.type === "command"
      ? { ...item, output: `${item.output ?? ""}${event.delta}` }
      : item;
  }
  if (event.type === "agent_turn.tool_progress") {
    return item.type === "tool_call"
      ? { ...item, progress: [...item.progress, event.message] }
      : item;
  }
  return item;
}

function snapshotWithItems(
  snapshot: AgentTurnSnapshot,
  items: AgentTurnItem[],
): AgentTurnSnapshot {
  return {
    ...snapshot,
    narrative_items: items.filter(isNarrativeItem),
    activity_items: items.filter(isActivityItem),
  };
}

function isNarrativeItem(
  item: AgentTurnItem,
): item is AgentTurnSnapshot["narrative_items"][number] {
  return item.type === "user_message"
    || item.type === "assistant_message"
    || item.type === "plan"
    || item.type === "reasoning";
}

function isActivityItem(
  item: AgentTurnItem,
): item is AgentTurnSnapshot["activity_items"][number] {
  return !isNarrativeItem(item);
}

function appendContent(content: AgentContent[], delta: string): AgentContent[] {
  const next = [...content];
  next[next.length - 1] = appendAgentContent(next.at(-1), delta);
  return next;
}

function appendAgentContent(content: AgentContent | undefined, delta: string): AgentContent {
  if (content?.type === "markdown") return { ...content, markdown: content.markdown + delta };
  if (content?.type === "text") return { ...content, text: content.text + delta };
  return { type: "markdown", markdown: delta };
}

function browserSafeTool(item: AgentTurnSnapshot["activity_items"][number]): BrowserSafeTool {
  switch (item.type) {
    case "tool_call":
      return {
        id: item.id,
        namespace: item.namespace,
        name: item.name,
        displayName: item.display_name,
        status: item.status,
        content: item.content.map(publicContentValue),
        progress: item.progress,
        error: item.error,
        durationMs: item.duration_ms,
      };
    case "command":
      return tool(item, "runtime", "command", "Command", [
        { text: item.command },
        ...(item.cwd ? [{ text: item.cwd }] : []),
        ...(item.output ? [{ text: item.output }] : []),
        ...(item.exit_code === null ? [] : [{ text: `Exit ${item.exit_code}` }]),
      ], item.duration_ms);
    case "file_change":
      return tool(item, "workspace", "file_change", "File changes", item.changes.map((change) => ({
        markdown: `${change.kind.toUpperCase()} \`${change.path}\`\n\n${change.diff}`,
      })));
    case "web_search":
      return tool(item, "web", "search", "Web search", [
        { text: item.query },
        { text: item.detail },
        ...(item.uri ? [{ uri: item.uri }] : []),
      ]);
    case "collaboration":
      return tool(item, "agents", item.action, "Collaboration", [
        { text: `${item.action} · ${item.target_count}` },
        ...(item.prompt ? [{ text: item.prompt }] : []),
      ]);
    case "subagent_activity":
      return tool(item, "agents", "subagent_activity", item.agent_label ?? "Subagent", [
        { text: item.activity },
      ]);
    case "image_view":
      return tool(item, "media", "image_view", "Viewed images", item.images.map(publicContentValue));
    case "image_generation":
      return tool(item, "media", "image_generation", "Image generation", [
        ...item.content.map(publicContentValue),
        ...(item.revised_prompt ? [{ text: item.revised_prompt }] : []),
      ]);
    case "context_compaction":
      return tool(item, "runtime", "context_compaction", "Context compacted", []);
  }
}

function tool(
  item: AgentTurnSnapshot["activity_items"][number],
  namespace: string,
  name: string,
  displayName: string,
  content: readonly unknown[],
  durationMs: number | null = null,
): BrowserSafeTool {
  return {
    id: item.id,
    namespace,
    name,
    displayName,
    status: item.status,
    content,
    progress: [],
    error: null,
    durationMs,
  };
}

function publicContentValue(content: AgentContent): unknown {
  switch (content.type) {
    case "text":
      return { text: content.text };
    case "markdown":
      return { markdown: content.markdown };
    case "resource_link":
      return { uri: content.uri, title: content.title, mimeType: content.mime_type };
    case "image":
      return { uri: content.uri, altText: content.alt_text, mimeType: content.mime_type };
    case "audio":
      return { uri: content.uri, transcript: content.transcript, mimeType: content.mime_type };
    case "json":
      return content.value;
  }
}

function contentMarkdown(content: AgentContent[]): string {
  return content.map((part) => {
    switch (part.type) {
      case "text":
        return part.text;
      case "markdown":
        return part.markdown;
      case "resource_link":
        return `[${part.title ?? part.uri}](${part.uri})`;
      case "image":
        return `![${part.alt_text ?? ""}](${part.uri})`;
      case "audio":
        return part.transcript ?? `[Audio](${part.uri})`;
      case "json":
        return `\`\`\`json\n${JSON.stringify(part.value, null, 2)}\n\`\`\``;
    }
  }).filter(Boolean).join("\n\n");
}

function emptySnapshot(turnId: string): AgentTurnSnapshot {
  return {
    turn_id: turnId,
    status: "running",
    started_at_ms: null,
    completed_at_ms: null,
    duration_ms: null,
    error: null,
    narrative_items: [],
    activity_items: [],
    interactions: [],
  };
}

function homeTurnKey(threadId: string, turnId: string): string {
  return `${threadId}\0${turnId}`;
}
