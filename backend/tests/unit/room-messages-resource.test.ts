import assert from "node:assert/strict";
import test from "node:test";

import {
  readRoomMessagesResource,
  ROOM_MESSAGES_RESOURCE_ACCESS_DENIED_CODE,
  type ReadRoomMessagesResourceDependencies,
} from "../../src/application/room/queries/read-room-messages-resource.js";
import { ApplicationError } from "../../src/application/platform/errors.js";
import type { PersistedRoomMessage } from "../../src/application/room/ports/index.js";

test("Room Messages resources preserve chronological pages and expose no Room id in URIs", async () => {
  const listCalls: unknown[] = [];
  const contextCalls: unknown[] = [];
  let actorChecks = 0;
  const latestPage = Array.from({ length: 50 }, (_, index) => message(index + 2));
  latestPage[1] = message(3, [latestPage[0]!.messageId]);
  const dependencies = {
    companyActors: {
      getCompanyDirectoryActor: {
        execute: async () => {
          actorChecks += 1;
          return { actorType: "agent" };
        },
      },
    },
    roomMessages: {
      list: async (
        input: Parameters<ReadRoomMessagesResourceDependencies["roomMessages"]["list"]>[0],
      ) => {
        listCalls.push(input);
        return latestPage;
      },
      context: async (
        input: Parameters<ReadRoomMessagesResourceDependencies["roomMessages"]["context"]>[0],
      ) => {
        contextCalls.push(input);
        return Array.from({ length: 21 }, (_, index) => message(index + 40));
      },
    },
  } as unknown as ReadRoomMessagesResourceDependencies;

  const latest = await readRoomMessagesResource(dependencies, input({ kind: "latest" }));
  assert.equal(latest.uri, "fields://room/messages/latest");
  assert.equal(latest.mime_type, "text/markdown");
  assert.equal(latest.uri.includes("room-1"), false);
  assert.match(latest.text, /Human 2:\nmessage 2/u);
  assert.match(latest.text, /Human 3 \(replying to Human 2\):\nmessage 3/u);
  assert.match(latest.text, /Next page: fields:\/\/room\/messages\/before\/2$/u);
  assert.deepEqual(listCalls[0], {
    roomId: "room-1",
    companyId: "company-1",
    requestedByMemberId: "agent-1",
    beforeSequence: null,
    limit: 50,
  });

  const before = await readRoomMessagesResource(dependencies, input({
    kind: "before",
    sequence: 52,
  }));
  assert.equal(before.uri, "fields://room/messages/before/52");
  assert.deepEqual(listCalls[1], {
    roomId: "room-1",
    companyId: "company-1",
    requestedByMemberId: "agent-1",
    beforeSequence: 52,
    limit: 50,
  });

  const around = await readRoomMessagesResource(dependencies, input({
    kind: "around",
    message_id: "message-50",
  }));
  assert.equal(around.uri, "fields://room/messages/around/message-50");
  assert.equal(around.text.includes("Next page:"), false);
  assert.deepEqual(contextCalls, [{
    roomId: "room-1",
    companyId: "company-1",
    requestedByMemberId: "agent-1",
    messageId: "message-50",
    limit: 21,
  }]);
  assert.equal(actorChecks, 3);
});

test("Room Messages revalidates active Agent identity and Room membership on every read", async () => {
  let actorActive = true;
  let membershipActive = true;
  let actorChecks = 0;
  let membershipChecks = 0;
  const dependencies = {
    companyActors: {
      getCompanyDirectoryActor: {
        execute: async () => {
          actorChecks += 1;
          if (!actorActive) throw new ApplicationError("ACTOR_NOT_FOUND", false);
          return { actorType: "agent" };
        },
      },
    },
    roomMessages: {
      list: async () => {
        membershipChecks += 1;
        if (!membershipActive) {
          throw new ApplicationError("ROOM_MEMBERSHIP_ACCESS_DENIED", false);
        }
        return [message(1)];
      },
    },
  } as unknown as ReadRoomMessagesResourceDependencies;

  await readRoomMessagesResource(dependencies, input({ kind: "latest" }));
  membershipActive = false;
  await assert.rejects(
    readRoomMessagesResource(dependencies, input({ kind: "latest" })),
    (error: unknown) => error instanceof ApplicationError
      && error.code === "ROOM_MEMBERSHIP_ACCESS_DENIED",
  );
  actorActive = false;
  await assert.rejects(
    readRoomMessagesResource(dependencies, input({ kind: "latest" })),
    (error: unknown) => error instanceof ApplicationError
      && error.code === "ACTOR_NOT_FOUND",
  );
  assert.equal(actorChecks, 3);
  assert.equal(membershipChecks, 2);
});

test("Room Messages rejects non-Agent callers before reading Room data", async () => {
  let roomRead = false;
  const dependencies = {
    companyActors: {
      getCompanyDirectoryActor: {
        execute: async () => ({ actorType: "human" }),
      },
    },
    roomMessages: {
      list: async () => {
        roomRead = true;
        return [];
      },
    },
  } as unknown as ReadRoomMessagesResourceDependencies;

  await assert.rejects(
    readRoomMessagesResource(dependencies, input({ kind: "latest" })),
    (error: unknown) => error instanceof ApplicationError
      && error.code === ROOM_MESSAGES_RESOURCE_ACCESS_DENIED_CODE,
  );
  assert.equal(roomRead, false);
});

test("Room Messages allows a Human only through the trusted private side-chat mode", async () => {
  let roomReads = 0;
  const dependencies = {
    companyActors: {
      getCompanyDirectoryActor: {
        execute: async () => ({ actorType: "human" }),
      },
    },
    roomMessages: {
      list: async () => {
        roomReads += 1;
        return [message(1)];
      },
    },
  } as unknown as ReadRoomMessagesResourceDependencies;

  const result = await readRoomMessagesResource(dependencies, {
    ...input({ kind: "latest" }),
    access_mode: "human_side_chat",
    member_id: "human-1",
  });
  assert.match(result.text, /Human 1/u);
  assert.equal(roomReads, 1);
});

function input(resource: Parameters<typeof readRoomMessagesResource>[1]["resource"]) {
  return {
    company_id: "company-1",
    member_id: "agent-1",
    room_id: "room-1",
    access_mode: "agent_execution" as const,
    resource,
  };
}

function message(
  sequence: number,
  replyToMessageIds: readonly string[] = [],
): PersistedRoomMessage {
  return {
    messageId: `message-${sequence}`,
    roomId: "room-1",
    companyId: "company-1",
    sequence,
    eventSequence: sequence,
    revision: 1,
    senderMemberId: "human-1",
    senderType: "human",
    clientMessageId: `client-${sequence}`,
    markdown: `message ${sequence}`,
    plainText: `message ${sequence}`,
    replyToMessageIds,
    references: [],
    threadId: null,
    triggerMessageId: null,
    sourceExecutionId: null,
    sourceCascadeId: null,
    versionGroupId: null,
    versionNumber: null,
    versionCount: 0,
    selectedVersionMessageId: null,
    selectionRevision: 0,
    latestSuccessfulVersionMessageId: null,
    editedAtMs: null,
    deletedAtMs: null,
    sourceExecutionStatus: null,
    sourceExecutionStartedAtMs: null,
    sourceExecutionCompletedAtMs: null,
    senderDisplayName: `Human ${sequence}`,
    senderMark: "HU",
    senderAvatarResourceId: null,
    roomTitle: "Room",
    interactions: [],
    createdAtMs: sequence,
    updatedAtMs: sequence,
  };
}
