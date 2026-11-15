import assert from "node:assert/strict";
import test from "node:test";

import {
  roomAgentTurnEventStreamSchema,
} from "@fields/contracts/public/agent-activity";
import {
  homeFilesystemEventStreamSchema,
  homeTurnEventStreamSchema,
} from "@fields/contracts/public/home";
import { roomMessageEventStreamSchema } from "@fields/contracts/public/room";
import { desktopNotificationEventStreamSchema } from "@fields/contracts/public/desktop-notification";
import {
  roomSideChatTurnEventStreamSchema,
} from "@fields/contracts/public/room-side-chat";

import {
  createPublicTrpcRouterRecord,
  createRoomPublicTrpcRouterRecord,
} from "../../src/interface/trpc/public/index.js";

type ProcedureRecord = Record<string, { _def: { output: unknown; type: string } }>;

test("Backend subscriptions expose their exact public stream schemas", () => {
  const root = createPublicTrpcRouterRecord();
  const room = createRoomPublicTrpcRouterRecord();
  const procedures: ReadonlyArray<readonly [string, ProcedureRecord, unknown]> = [
    ["desktop.notifications.events", routerProcedures(root.desktop), desktopNotificationEventStreamSchema],
    ["home.filesystem.events", routerProcedures(root.home), homeFilesystemEventStreamSchema],
    ["home.turn.events", routerProcedures(root.home), homeTurnEventStreamSchema],
    ["room.agentActivity.watch", routerProcedures(room.agentActivity), roomAgentTurnEventStreamSchema],
    ["room.messages.events", routerProcedures(room.messages), roomMessageEventStreamSchema],
    [
      "roomSideChat.turn.events",
      routerProcedures(root.roomSideChat),
      roomSideChatTurnEventStreamSchema,
    ],
  ];

  for (const [route, record, output] of procedures) {
    const localRoute = route.split(".").slice(
      route.startsWith("room.") ? 2 : 1,
    ).join(".");
    assert.equal(record[localRoute]?._def.type, "subscription", route);
    assert.equal(record[localRoute]?._def.output, output, route);
  }
});

function routerProcedures(router: unknown): ProcedureRecord {
  return (router as { _def: { procedures: ProcedureRecord } })._def.procedures;
}
