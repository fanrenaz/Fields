import assert from "node:assert/strict";
import test from "node:test";
import { createActor } from "xstate";

import type { RoomMachineServices } from "../../../../data/room/room-machine-services";
import { roomMachine, type RoomReplySelectionMessage } from "../../../../features/room/room-machine";
import { composerReferenceForSearchResult } from "../../../../features/room/use-room-machine";

test("Room XState contains domain orchestration but no conversation state", async () => {
  const actor = createActor(roomMachine, {
    input: {
      currentUser: { id: "member-1", name: "Member", mark: "ME" },
      services: fakeServices(),
    },
  }).start();

  await waitFor(() => actor.getSnapshot().context.roomsLoading === false);
  const context = actor.getSnapshot().context;
  assert.equal("messagesByRoomId" in context, false);
  assert.equal("agentTurnProjections" in context, false);
  assert.equal("composerSending" in context, false);
  assert.deepEqual(context.rooms.map((room) => room.id), ["room-1"]);

  actor.send({ type: "ROOM_SELECTED", roomId: "room-1" });
  await waitFor(() => actor.getSnapshot().context.membersByRoomId["room-1"]?.length === 1);
  assert.equal(actor.getSnapshot().context.activeRoomId, "room-1");
  actor.stop();
});

test("Room restoration follows pagination until the stable target is found", async () => {
  const services = fakeServices();
  const cursors: Array<string | null | undefined> = [];
  services.listRooms = async ({ cursor }) => {
    cursors.push(cursor);
    if (cursor === "next") {
      return {
        items: [{ id: "room-restored", title: "Restored", subtitle: null, status: "active" }],
        page: { next_cursor: "later" },
      };
    }
    return {
      items: [{ id: "room-1", title: "Room", subtitle: null, status: "active" }],
      page: { next_cursor: "next" },
    };
  };
  const actor = createActor(roomMachine, {
    input: {
      initialRoomId: "room-restored",
      services,
    },
  }).start();

  await waitFor(() => actor.getSnapshot().context.roomsLoading === false);
  assert.deepEqual(cursors, [null, "next"]);
  assert.deepEqual(actor.getSnapshot().context.rooms.map((room) => room.id), ["room-1", "room-restored"]);
  assert.equal(actor.getSnapshot().context.activeRoomId, "room-restored");
  actor.stop();
});

test("Room XState retains reply selection and Composer domain slots", () => {
  const actor = createActor(roomMachine, { input: { services: fakeServices() } }).start();
  const first: RoomReplySelectionMessage = { id: "message-1", sender: "A", text: "First" };
  const second: RoomReplySelectionMessage = { id: "message-2", sender: "B", text: "Second" };

  actor.send({ type: "REPLY_SELECTION_ENTERED", message: first });
  actor.send({ type: "REPLY_SELECTION_TOGGLED", message: second });
  actor.send({ type: "REPLY_SELECTION_CONFIRMED" });
  assert.deepEqual(actor.getSnapshot().context.replyAnchor, {
    messageIds: ["message-1", "message-2"],
  });

  actor.send({ type: "DRAFT_CHANGED", draft: "hello" });
  actor.send({ type: "DRAFT_SENT" });
  assert.equal(actor.getSnapshot().context.draft, "");
  assert.equal(actor.getSnapshot().context.replyAnchor, null);
  assert.equal("selectedReferences" in actor.getSnapshot().context, false);
  actor.stop();
});

test("Room Composer reference action opens and closes the search overlay", () => {
  const actor = createActor(roomMachine, { input: { services: fakeServices() } }).start();

  assert.equal(actor.getSnapshot().context.overlay, null);
  actor.send({ type: "OVERLAY_OPENED", overlay: "search" });
  assert.equal(actor.getSnapshot().context.overlay, "search");
  actor.send({ type: "OVERLAY_OPENED", overlay: "reference-search" });
  assert.equal(actor.getSnapshot().context.overlay, "reference-search");
  actor.send({ type: "OVERLAY_CLOSED" });
  assert.equal(actor.getSnapshot().context.overlay, null);

  actor.stop();
});

test("Room Composer turns selectable search results into structured references", () => {
  const available = [
    { label: "Member", target: { type: "member" as const, id: "member-1", room_id: "room-1" } },
    { label: "Plan.pdf", target: { type: "file" as const, id: "file-1", version_id: "version-3", room_id: "room-1" } },
  ];

  assert.deepEqual(composerReferenceForSearchResult({
    kind: "file",
    source: { type: "company" },
    file_id: "file-1",
    path: "Plan.pdf",
    name: "Plan.pdf",
    is_folder: false,
    modified_at_ms: 1,
  }, available, "room-1"), available[1]);
  assert.deepEqual(composerReferenceForSearchResult({
    kind: "message",
    room_id: "room-2",
    room_title: "Design",
    message_id: "message-1",
    sequence: 1,
    sender_display_name: "Alice",
    body_plain_text: "Decision",
    occurred_at_ms: 1,
  }, available, "room-1"), {
    label: "Alice · Design",
    target: { type: "message", room_id: "room-2", message_id: "message-1" },
  });
  assert.equal(composerReferenceForSearchResult({
    kind: "file",
    source: { type: "home" },
    file_id: null,
    path: "notes.txt",
    name: "notes.txt",
    is_folder: false,
    modified_at_ms: 1,
  }, available, "room-1"), null);
});

test("Room XState owns approval pending and failure state", async () => {
  const services = fakeServices();
  services.respondToInteraction = async () => {
    throw new Error("approval unavailable");
  };
  const actor = createActor(roomMachine, {
    input: {
      currentUser: { id: "member-1", name: "Member", mark: "ME" },
      initialRoomId: "room-1",
      services,
    },
  }).start();
  await waitFor(() => actor.getSnapshot().context.activeRoomId === "room-1");

  actor.send({
    type: "INTERACTION_RESPONSE_REQUESTED",
    messageId: "message-1",
    interactionId: "interaction-1",
    response: "approve",
  });
  assert.ok(actor.getSnapshot().context.pendingInteractions["interaction-1"]);
  await waitFor(() => actor.getSnapshot().context.interactionError !== null);
  assert.equal(actor.getSnapshot().context.pendingInteractions["interaction-1"], undefined);
  actor.stop();
});

test("Room right panel opens only the private side chat", async () => {
  const actor = createActor(roomMachine, {
    input: {
      initialRoomId: "room-1",
      services: fakeServices(),
    },
  }).start();
  await waitFor(() => actor.getSnapshot().context.activeRoomId === "room-1");
  actor.send({ type: "RIGHT_PANEL_OPENED" });
  assert.equal(
    actor.getSnapshot().matches({
      workspace: { active: { rightPanel: "sideChat" } },
    }),
    true,
  );
  actor.stop();
});

function fakeServices(): RoomMachineServices {
  const message = timelineMessage();
  return {
    listRooms: async () => ({
      items: [{ id: "room-1", title: "Room", subtitle: null, status: "active" }],
      page: { next_cursor: null },
    }),
    subscribeMessageEvents: () => ({ unsubscribe: () => undefined }),
    getAgentExecution: async () => {
      throw new Error("not used");
    },
    watchAgentActivity: () => ({ unsubscribe: () => undefined }),
    readThread: async () => ({
      room_id: "room-1",
      thread_id: "thread-1",
      items: [message],
    }),
    listMembers: async () => ({
      room_id: "room-1",
      items: [{
        member_id: "member-1",
        name: "Member",
        mark: "ME",
        role: "Owner",
        meta: "",
        joined_at_ms: 1,
        actor_type: "human",
        membership_version: 1,
        agent: false,
      }],
    }),
    addMember: async () => ({ room_id: "room-1", items: [] }),
    removeMember: async () => ({ room_id: "room-1", items: [] }),
    listMessages: async () => ({
      room_id: "room-1",
      items: [],
      page: { next_cursor: null, backwards_cursor: null },
    }),
    sendMessage: async () => ({ accepted: true, message }),
    respondToInteraction: async () => ({ accepted: true, message }),
  };
}

function timelineMessage() {
  return {
    id: "message-1",
    kind: "message" as const,
    sequence: 1,
    occurred_at: 1,
    sender: {
      type: "human" as const,
      id: "member-1",
      display_name: "Member",
      mark: "ME",
      avatar_resource_id: null,
    },
    body: {
      format: "inline_markdown" as const,
      markdown: "hello",
      plain_text: "hello",
    },
    revision: 1,
    edited_at_ms: null,
    deleted_at_ms: null,
    reply_to: null,
    interactions: [],
    thread_id: "thread-1",
  };
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for Room machine.");
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
