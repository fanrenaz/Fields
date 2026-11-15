import type { HomeTurnSubmitResult } from "@fields/contracts/public/home";
import type { RoomSideChatReadResult } from "@fields/contracts/public/room-side-chat";
import { and, eq, isNull, or, sql } from "drizzle-orm";

import type { RoomSideChatApplication } from "../../../../../application/room-side-chat/index.js";
import type { CompanyRuntimePublicGateway } from "../../../../../application/execution/ports/index.js";
import type { RoomMessageApplication } from "../../../../../application/room/ports/index.js";
import { ApplicationError } from "../../../../../application/platform/errors.js";
import type { BackendDatabase } from "../../database-service.js";
import { roomSideChats } from "../../schema/company/room-side-chat.js";

export const ROOM_SIDE_CHAT_ACCESS_DENIED_CODE = "ROOM_SIDE_CHAT_ACCESS_DENIED";
export const ROOM_SIDE_CHAT_THREAD_CONFLICT_CODE = "ROOM_SIDE_CHAT_THREAD_CONFLICT";

export class PostgresRoomSideChatApplication implements RoomSideChatApplication {
  constructor(
    private readonly db: BackendDatabase,
    private readonly runtime: CompanyRuntimePublicGateway,
    private readonly roomMessages: RoomMessageApplication,
    private readonly nowMs: () => number = Date.now,
  ) {}

  async read(
    companyId: string,
    humanMemberId: string,
    roomId: string,
  ): Promise<RoomSideChatReadResult> {
    await this.requireAccess(companyId, humanMemberId, roomId);
    const row = await this.find(companyId, humanMemberId, roomId);
    return {
      room_id: roomId,
      thread_id: row?.threadId ?? null,
      thread: row?.threadId
        ? await this.runtime.roomSideChatThreadRead(
          companyId,
          humanMemberId,
          roomId,
          row.threadId,
        )
        : null,
    };
  }

  async submitTurn(input: {
    companyId: string;
    humanMemberId: string;
    roomId: string;
    prompt: string;
    clientMessageId?: string;
    timeoutMs?: number;
  }): Promise<{ room_id: string; turn: HomeTurnSubmitResult }> {
    await this.requireAccess(input.companyId, input.humanMemberId, input.roomId);
    const now = this.nowMs();
    await this.db.insert(roomSideChats).values({
      companyId: input.companyId,
      humanMemberId: input.humanMemberId,
      roomId: input.roomId,
      threadId: null,
      createdAtMs: now,
      updatedAtMs: now,
    }).onConflictDoNothing();
    const existing = await this.find(input.companyId, input.humanMemberId, input.roomId);
    const turn = await this.runtime.roomSideChatTurnSubmit(
      input.companyId,
      input.humanMemberId,
      {
        room_id: input.roomId,
        thread_id: existing?.threadId ?? null,
        prompt: input.prompt,
        developer_instructions: roomSideChatDeveloperInstructions(),
        ...(input.clientMessageId ? { client_message_id: input.clientMessageId } : {}),
        ...(input.timeoutMs ? { timeout_ms: input.timeoutMs } : {}),
      },
    );
    const updated = await this.db.update(roomSideChats).set({
      threadId: turn.thread_id,
      updatedAtMs: this.nowMs(),
    }).where(and(
      eq(roomSideChats.companyId, input.companyId),
      eq(roomSideChats.humanMemberId, input.humanMemberId),
      eq(roomSideChats.roomId, input.roomId),
      or(isNull(roomSideChats.threadId), eq(roomSideChats.threadId, turn.thread_id)),
    )).returning({ threadId: roomSideChats.threadId });
    if (updated.length !== 1) {
      throw new ApplicationError(ROOM_SIDE_CHAT_THREAD_CONFLICT_CODE, false);
    }
    return { room_id: input.roomId, turn };
  }

  async threadIds(companyId: string, humanMemberId: string): Promise<Set<string>> {
    const rows = await this.db.select({ threadId: roomSideChats.threadId })
      .from(roomSideChats)
      .where(and(
        eq(roomSideChats.companyId, companyId),
        eq(roomSideChats.humanMemberId, humanMemberId),
      ));
    return new Set(rows.flatMap((row) => row.threadId ? [row.threadId] : []));
  }

  private async find(companyId: string, humanMemberId: string, roomId: string) {
    const [row] = await this.db.select().from(roomSideChats).where(and(
      eq(roomSideChats.companyId, companyId),
      eq(roomSideChats.humanMemberId, humanMemberId),
      eq(roomSideChats.roomId, roomId),
    )).limit(1);
    return row ?? null;
  }

  private async requireAccess(
    companyId: string,
    humanMemberId: string,
    roomId: string,
  ): Promise<void> {
    const result = await this.db.execute(sql<{ type: string; status: string }>`
      select type, status from actors
      where company_id = ${companyId} and id = ${humanMemberId}
      limit 1
    `);
    const actor = result.rows[0];
    if (!actor || actor.type !== "human" || actor.status !== "active") {
      throw new ApplicationError(ROOM_SIDE_CHAT_ACCESS_DENIED_CODE, false);
    }
    await this.roomMessages.list({
      roomId,
      companyId,
      requestedByMemberId: humanMemberId,
      beforeSequence: null,
      limit: 1,
    });
  }
}

function roomSideChatDeveloperInstructions(): string {
  return [
    "You are in a private side chat belonging to the current human inside one Fields Room.",
    "Use the read-only fields_room_messages resource when Room conversation context is relevant.",
    "This private chat is not the Room timeline. Never claim that a response or action was posted to the Room.",
    "Do not modify shared Room files or messages from this chat.",
  ].join("\n");
}
