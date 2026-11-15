import assert from "node:assert/strict";
import test from "node:test";

import type { RoomMachineMessageEvent } from "../../../../data/room/room-machine-services";
import {
  listAllRoomMessages,
  reduceRoomMessageEvent,
} from "../../../../features/conversation/use-room-conversation";
import type { TimelineMessage } from "../../../../shared/types/timeline";

test("Room history follows authoritative cursors even when every page is short", async () => {
  const cursors: Array<string | null | undefined> = [];
  const pages = new Map<string | null, {
    items: TimelineMessage[];
    next: string | null;
  }>([
    [null, { items: [message("human-1")], next: "cursor-1" }],
    ["cursor-1", { items: [message("human-2")], next: "cursor-2" }],
    ["cursor-2", { items: [message("human-3")], next: null }],
  ]);
  const result = await listAllRoomMessages(async (input) => {
    cursors.push(input.cursor);
    const page = pages.get(input.cursor ?? null);
    assert.ok(page);
    return {
      items: page.items,
      page: {
        next_cursor: page.next,
        backwards_cursor: null,
      },
    };
  }, "room-1");

  assert.deepEqual(cursors, [null, "cursor-1", "cursor-2"]);
  assert.deepEqual(result.map((candidate) => candidate.id), [
    "human-1",
    "human-2",
    "human-3",
  ]);
});

test("Room history stops a repeated cursor without duplicating requests forever", async () => {
  let calls = 0;
  const result = await listAllRoomMessages(async () => {
    calls += 1;
    return {
      items: [message(`human-${calls}`)],
      page: {
        next_cursor: "cursor-repeat",
        backwards_cursor: null,
      },
    };
  }, "room-1");

  assert.equal(calls, 2);
  assert.deepEqual(result.map((candidate) => candidate.id), ["human-1", "human-2"]);
});

test("Room realtime updates retain tombstones and revisions", () => {
  const original = message("human-1", {
    revision: 1,
    body: {
      format: "inline_markdown",
      markdown: "Original",
      plain_text: "Original",
    },
  });
  const tombstone = message("human-1", {
    revision: 3,
    deleted_at_ms: 300,
    body: {
      format: "inline_markdown",
      markdown: "",
      plain_text: "",
    },
  });
  const event = {
    schema_version: 1,
    event_id: "event-update",
    type: "room.message.updated",
    source: "backend",
    room_id: "room-1",
    message: tombstone,
    occurred_at_ms: 300,
  } satisfies RoomMachineMessageEvent;

  assert.deepEqual(reduceRoomMessageEvent([original], event), [tombstone]);
});

test("Room realtime version selection remains member-local and revisioned", () => {
  const first = message("agent-1", {
    sender: agentSender(),
    agent_reply_version: {
      group_id: "group-1",
      version_number: 1,
      version_count: 2,
      selected: true,
      selection_revision: 1,
      latest_successful: false,
      source_execution_id: null,
    },
  });
  const second = message("agent-2", {
    sender: agentSender(),
    agent_reply_version: {
      group_id: "group-1",
      version_number: 2,
      version_count: 2,
      selected: false,
      selection_revision: 1,
      latest_successful: true,
      source_execution_id: "execution-1",
    },
  });
  const event = {
    schema_version: 1,
    event_id: "event-selection",
    type: "room.agent_reply.selection_changed",
    source: "backend",
    room_id: "room-1",
    version_group_id: "group-1",
    selected_message_id: "agent-2",
    revision: 2,
    occurred_at_ms: 400,
  } satisfies RoomMachineMessageEvent;

  const result = reduceRoomMessageEvent([first, second], event);
  assert.deepEqual(result.map((candidate) => (
    candidate.kind === "message"
      ? {
        id: candidate.id,
        selected: candidate.agent_reply_version?.selected,
        revision: candidate.agent_reply_version?.selection_revision,
      }
      : null
  )), [
    { id: "agent-1", selected: false, revision: 2 },
    { id: "agent-2", selected: true, revision: 2 },
  ]);
});

test("Room realtime deletion removes only the addressed projection", () => {
  const event = {
    schema_version: 1,
    event_id: "event-delete",
    type: "room.message.deleted",
    source: "backend",
    room_id: "room-1",
    message_id: "human-1",
    occurred_at_ms: 500,
  } satisfies RoomMachineMessageEvent;
  assert.deepEqual(
    reduceRoomMessageEvent([message("human-1"), message("human-2")], event)
      .map((candidate) => candidate.id),
    ["human-2"],
  );
});

function message(
  id: string,
  overrides: Partial<Extract<TimelineMessage, { kind: "message" }>> = {},
): Extract<TimelineMessage, { kind: "message" }> {
  return {
    id,
    kind: "message",
    sequence: id.endsWith("2") ? 2 : 1,
    occurred_at: id.endsWith("2") ? 2 : 1,
    sender: {
      type: "human",
      id: "member-1",
      display_name: "Member",
      mark: "ME",
      avatar_resource_id: null,
    },
    body: {
      format: "inline_markdown",
      markdown: id,
      plain_text: id,
    },
    revision: 1,
    edited_at_ms: null,
    deleted_at_ms: null,
    reply_to: null,
    interactions: [],
    thread_id: null,
    ...overrides,
  };
}

function agentSender() {
  return {
    type: "agent" as const,
    id: "agent-1",
    display_name: "Agent",
    mark: "AG",
    avatar_resource_id: null,
  };
}
