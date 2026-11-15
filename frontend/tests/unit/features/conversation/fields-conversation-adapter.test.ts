import assert from "node:assert/strict";
import test from "node:test";
import type { AgentTurnSnapshot } from "@fields/contracts/public/agent-activity";
import type { HomeThreadReadResult } from "@fields/contracts/public/home";
import { parse } from "@lobechat/conversation-flow";
import type { UIChatMessage } from "@lobechat/types";

import {
  projectHomeConversation,
  projectRoomConversation,
  reduceHomeConversationEvent,
} from "../../../../features/conversation/fields-conversation-adapter";
import { createConversationStore } from "../../../../vendor/lobehub/store";

test("Home projection preserves every provider-neutral activity kind in browser-safe tools", () => {
  const result = homeRead([{
    thread_id: "thread-root",
    turn_id: "turn-1",
    snapshot: snapshot(),
  }]);
  const projection = projectHomeConversation(result);
  const assistant = projection.messages.find((message) => message.role === "assistant");
  assert.ok(assistant);
  assert.equal(assistant.id, "home:turn:turn-1:assistant");
  assert.equal(assistant.content, "Done");
  assert.equal(assistant.reasoning, undefined);
  assert.equal(
    assistant.metadata?.fieldsProcessBlocks.some((
      block: { reasoning?: { content?: string } },
    ) => block.reasoning?.content === "Considered"),
    true,
  );
  assert.deepEqual(
    assistant.metadata?.fieldsTools.map((tool: { name: string }) => tool.name),
    [
      "command",
      "file_change",
      "lookup",
      "search",
      "spawn",
      "subagent_activity",
      "image_view",
      "image_generation",
      "context_compaction",
    ],
  );
  const serialized = JSON.stringify(assistant.metadata?.fieldsTools);
  assert.equal(serialized.includes("arguments"), false);
  assert.equal(serialized.includes("rawResult"), false);
  assert.equal(serialized.includes("provider"), false);
  const group = parse(projection.messages).flatList.find((message) => (
    message.role === "assistantGroup"
  ));
  assert.ok(group);
  assert.ok(group.children?.some((block) => (
    (block.metadata?.fieldsTools?.length ?? 0) > 0
  )));
});

test("running commentary is projected as folded process instead of final answer content", () => {
  const result = homeRead([{
    thread_id: "thread-root",
    turn_id: "turn-process",
    snapshot: {
      ...snapshot(),
      turn_id: "turn-process",
      status: "running",
      completed_at_ms: null,
      duration_ms: null,
      narrative_items: [{
        id: "commentary-1",
        type: "assistant_message",
        status: "running",
        phase: "commentary",
        content: [{ type: "markdown", markdown: "I am checking the files." }],
      }],
      activity_items: [],
    },
  }]);

  const projection = projectHomeConversation(result);
  const assistant = projection.messages.at(-1);
  assert.equal(assistant?.role, "assistant");
  assert.equal(assistant?.content, "");
  assert.deepEqual(projection.generatingMessageIds, ["home:turn:turn-process:assistant"]);
  assert.deepEqual(assistant?.metadata?.fieldsProcessBlocks, [{
    id: "commentary-1",
    content: "I am checking the files.",
    metadata: { fieldsProcessKind: "commentary" },
  }]);
  assert.equal(assistant?.metadata?.fieldsProcessSummary, "I am checking the files.");
});

test("an empty running turn still projects an assistant for Quick Reply", () => {
  const result = homeRead([{
    thread_id: "thread-root",
    turn_id: "turn-queued",
    snapshot: {
      ...snapshot(),
      turn_id: "turn-queued",
      status: "queued",
      started_at_ms: null,
      completed_at_ms: null,
      duration_ms: null,
      narrative_items: [],
      activity_items: [],
    },
  }]);

  const projection = projectHomeConversation(result);
  const assistant = projection.messages.at(-1);
  assert.equal(assistant?.content, "");
  assert.deepEqual(assistant?.metadata?.fieldsProcessBlocks, []);
  assert.deepEqual(projection.generatingMessageIds, ["home:turn:turn-queued:assistant"]);
});

test("Home question interactions stay attached to the assistant message", () => {
  const result = homeRead([{
    thread_id: "thread-root",
    turn_id: "turn-question",
    snapshot: {
      ...snapshot(),
      turn_id: "turn-question",
      status: "running",
      interactions: [],
    },
  }]);
  const initial = projectHomeConversation(result);
  const next = reduceHomeConversationEvent(initial, result, {
    schema_version: 2,
    event_id: "question-event",
    source: "backend",
    scope: { type: "home", member_id: "member-1", thread_id: "thread-root" },
    turn_id: "turn-question",
    occurred_at_ms: 10,
    type: "agent_turn.question_interaction",
    interaction: {
      id: "question-1",
      item_id: "item-1",
      status: "pending",
      questions: [{ id: "env", header: "Environment", question: "Where?", allow_other: false, secret: false, options: null }],
      answers: {},
      resolution: null,
      deadline_at_ms: null,
      created_at_ms: 10,
      completed_at_ms: null,
    },
  });
  assert.equal(next.messages.at(-1)?.metadata?.fieldsQuestionInteractions?.[0]?.id, "question-1");
});

test("Home live deltas keep stable message identity and update semantic content", () => {
  const result = homeRead([{
    thread_id: "thread-root",
    turn_id: "turn-live",
    snapshot: {
      ...snapshot(),
      turn_id: "turn-live",
      status: "running",
      narrative_items: [{
        id: "assistant-live",
        type: "assistant_message",
        status: "running",
        phase: "final_answer",
        content: [{ type: "markdown", markdown: "Hel" }],
      }],
      activity_items: [],
    },
  }]);
  const initial = projectHomeConversation(result);
  const next = reduceHomeConversationEvent(initial, result, {
    schema_version: 2,
    event_id: "event-delta",
    source: "backend",
    scope: {
      type: "home",
      member_id: "member-1",
      thread_id: "thread-root",
    },
    occurred_at_ms: 2,
    type: "agent_turn.message_delta",
    turn_id: "turn-live",
    item_id: "assistant-live",
    target: "assistant_message",
    delta: "lo",
  });
  assert.equal(next.messages.at(-1)?.id, initial.messages.at(-1)?.id);
  assert.equal(next.messages.at(-1)?.content, "Hello");
  assert.deepEqual(next.generatingMessageIds, ["home:turn:turn-live:assistant"]);
});

test("Home fork histories merge shared Turn IDs and select the active child path", () => {
  const shared = {
    thread_id: "thread-root",
    turn_id: "turn-shared",
    snapshot: {
      ...snapshot(),
      turn_id: "turn-shared",
      narrative_items: [{
        id: "user-shared",
        type: "user_message" as const,
        status: "completed" as const,
        content: [{ type: "markdown" as const, markdown: "Question" }],
      }],
      activity_items: [],
    },
  };
  const result: HomeThreadReadResult = {
    ...homeRead([shared]),
    selected_thread_id: "thread-fork",
    branches: [
      {
        thread_id: "thread-root",
        root_thread_id: "thread-root",
        source_thread_id: null,
        anchor_turn_id: null,
        kind: "root",
        selected: false,
        created_at_ms: 1,
      },
      {
        thread_id: "thread-fork",
        root_thread_id: "thread-root",
        source_thread_id: "thread-root",
        anchor_turn_id: "turn-shared",
        kind: "regenerated_assistant",
        selected: true,
        created_at_ms: 2,
      },
    ],
    turns: [
      shared,
      { ...shared, thread_id: "thread-fork" },
      {
        thread_id: "thread-root",
        turn_id: "turn-root-answer",
        snapshot: assistantSnapshot("turn-root-answer", "answer-root", "First"),
      },
      {
        thread_id: "thread-fork",
        turn_id: "turn-fork-answer",
        snapshot: assistantSnapshot("turn-fork-answer", "answer-fork", "Second"),
      },
    ],
  };
  const projection = projectHomeConversation(result);
  assert.equal(projection.messages.filter((message) => message.id === "home:item:user-shared").length, 1);
  const sharedMessage = projection.messages.find((message) => message.id === "home:item:user-shared");
  assert.equal(sharedMessage?.metadata?.activeBranchIndex, 1);
  assert.deepEqual(
    parse(projection.messages).flatList.map((message) => message.id),
    ["home:item:user-shared", "home:turn:turn-fork-answer:assistant"],
  );
});

test("Room reply versions become siblings and later messages follow the selected thread", () => {
  const messages = projectRoomConversation([
    roomMessage("trigger", 1, "human", undefined),
    roomMessage("v1", 2, "agent", {
      group_id: "versions",
      version_number: 1,
      version_count: 2,
      selected: false,
      selection_revision: 1,
      latest_successful: false,
      source_execution_id: "execution-1",
    }),
    roomMessage("v2", 3, "agent", {
      group_id: "versions",
      version_number: 2,
      version_count: 2,
      selected: true,
      selection_revision: 1,
      latest_successful: true,
      source_execution_id: "execution-2",
    }),
    roomMessage("continued-user", 4, "human", undefined, "thread-v2"),
    roomMessage("continued-agent", 5, "agent", undefined, "thread-v2"),
  ], "human");
  const versions = messages.filter((message) => message.metadata?.fieldsVersionGroupId === "versions");
  assert.equal(versions[0]?.parentId, "room:message:trigger");
  assert.equal(versions[1]?.parentId, "room:message:trigger");
  assert.equal(messages[0]?.metadata?.activeBranchIndex, 1);
  assert.deepEqual(
    parse(messages).flatList.map((message) => message.id),
    [
      "room:message:trigger",
      "room:message:v2",
      "room:message:continued-user",
      "room:message:continued-agent",
    ],
  );
});

test("Room replies retain a renderable preview after server projection", () => {
  const target = {
    ...roomMessage("target", 1, "agent", undefined),
    body: {
      format: "inline_markdown" as const,
      markdown: "Ask [@Test](fields://member/actor_test)",
      plain_text: "Ask [@Test](fields://member/actor_test)",
    },
  };
  const reply = {
    ...roomMessage("reply", 2, "human", undefined),
    reply_to: {
      message_ids: ["target"],
      preview: "",
    },
  };

  const projected = projectRoomConversation([target, reply], "human");
  assert.deepEqual(projected[1]?.metadata?.fieldsReplyPreview, {
    count: 1,
    target: {
      content: "Ask @Test",
      id: "target",
      senderName: "agent",
    },
  });
});

test("Conversation Store reserves and then resolves an optimistic Lobe branch", () => {
  const parent: UIChatMessage = {
    id: "parent",
    role: "user",
    content: "prompt",
    createdAt: 1,
    updatedAt: 1,
    metadata: { activeBranchIndex: 1 },
  };
  const original: UIChatMessage = {
    id: "original",
    role: "assistant",
    content: "old",
    createdAt: 2,
    updatedAt: 2,
    parentId: parent.id,
  };
  const store = createConversationStore({
    context: { surface: "home", id: "thread-root" },
    initialMessages: [parent, original],
  });
  assert.deepEqual(
    store.getState().displayMessages.map((message) => message.id),
    ["parent", "original"],
  );
  store.getState().upsertMessage({
    id: "optimistic",
    role: "assistant",
    content: "",
    createdAt: 3,
    updatedAt: 3,
    parentId: parent.id,
  });
  assert.deepEqual(
    store.getState().displayMessages.map((message) => message.id),
    ["parent", "optimistic"],
  );
  store.getState().setEditingMessage("optimistic");
  store.getState().updateInputMessage("replacement");
  assert.equal(store.getState().editingMessageId, "optimistic");
  assert.equal(store.getState().inputMessage, "replacement");
  store.getState().replaceMessages([parent, original]);
  assert.equal(store.getState().editingMessageId, null);
});

function homeRead(turns: HomeThreadReadResult["turns"]): HomeThreadReadResult {
  return {
    thread_id: "thread-root",
    root_thread_id: "thread-root",
    selected_thread_id: "thread-root",
    revision: 1,
    branches: [{
      thread_id: "thread-root",
      root_thread_id: "thread-root",
      source_thread_id: null,
      anchor_turn_id: null,
      kind: "root",
      selected: true,
      created_at_ms: 1,
    }],
    turns,
  };
}

function snapshot(): AgentTurnSnapshot {
  return {
    turn_id: "turn-1",
    status: "completed",
    started_at_ms: 1,
    completed_at_ms: 2,
    duration_ms: 1,
    error: null,
    narrative_items: [
      {
        id: "user-1",
        type: "user_message",
        status: "completed",
        content: [{ type: "markdown", markdown: "Do it" }],
      },
      {
        id: "reasoning-1",
        type: "reasoning",
        status: "completed",
        summary: [{ type: "text", text: "Considered" }],
        content: [],
      },
      {
        id: "assistant-1",
        type: "assistant_message",
        status: "completed",
        phase: "final_answer",
        content: [{ type: "markdown", markdown: "Done" }],
      },
    ],
    activity_items: [
      {
        id: "command-1",
        type: "command",
        status: "completed",
        command: "pnpm typecheck",
        cwd: "/workspace",
        actions: [],
        output: "ok",
        exit_code: 0,
        duration_ms: 1,
      },
      {
        id: "file-1",
        type: "file_change",
        status: "completed",
        changes: [{ path: "a.ts", kind: "update", diff: "+safe" }],
      },
      {
        id: "tool-1",
        type: "tool_call",
        status: "completed",
        namespace: "docs",
        name: "lookup",
        display_name: "Lookup",
        content: [{ type: "json", value: { title: "Safe" } }],
        progress: ["complete"],
        error: null,
        duration_ms: 1,
      },
      {
        id: "web-1",
        type: "web_search",
        status: "completed",
        query: "query",
        detail: "detail",
        uri: "https://example.com",
      },
      {
        id: "collaboration-1",
        type: "collaboration",
        status: "completed",
        action: "spawn",
        target_count: 1,
        target_ids: ["agent-1"],
        prompt: "Inspect",
      },
      {
        id: "subagent-1",
        type: "subagent_activity",
        status: "completed",
        activity: "started",
        agent_turn_id: "agent-turn-1",
        agent_label: "Inspector",
      },
      {
        id: "image-view-1",
        type: "image_view",
        status: "completed",
        images: [{ type: "image", uri: "fields://image/1", alt_text: "Preview", mime_type: "image/png" }],
      },
      {
        id: "image-gen-1",
        type: "image_generation",
        status: "completed",
        content: [{ type: "resource_link", uri: "fields://image/2", title: "Result", mime_type: "image/png" }],
        revised_prompt: "Safe prompt",
      },
      {
        id: "compact-1",
        type: "context_compaction",
        status: "completed",
      },
    ],
  };
}

function assistantSnapshot(turnId: string, itemId: string, markdown: string): AgentTurnSnapshot {
  return {
    turn_id: turnId,
    status: "completed",
    started_at_ms: 1,
    completed_at_ms: 2,
    duration_ms: 1,
    error: null,
    narrative_items: [{
      id: itemId,
      type: "assistant_message",
      status: "completed",
      phase: "final_answer",
      content: [{ type: "markdown", markdown }],
    }],
    activity_items: [],
  };
}

function roomMessage(
  id: string,
  occurredAt: number,
  sender: "human" | "agent",
  version: {
    group_id: string;
    version_number: number;
    version_count: number;
    selected: boolean;
    selection_revision: number;
    latest_successful: boolean;
    source_execution_id: string;
  } | undefined,
  threadId: string | null = version ? `thread-${id}` : null,
) {
  return {
    id,
    kind: "message" as const,
    occurred_at: occurredAt,
    sender: {
      type: sender,
      id: sender,
      display_name: sender,
      mark: sender.slice(0, 2),
      avatar_resource_id: null,
    },
    body: {
      format: "inline_markdown" as const,
      markdown: id,
      plain_text: id,
    },
    revision: 1,
    edited_at_ms: null,
    deleted_at_ms: null,
    reply_to: null,
    interactions: [],
    thread_id: threadId,
    ...(version ? { agent_reply_version: version } : {}),
  };
}
