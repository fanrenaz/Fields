import type {
  RoomInteractionRespondInput,
  RoomInteractionRespondResult,
  RoomListInput,
  RoomListResult,
  RoomMember,
  RoomMembersListResult,
  RoomAgentReplyRegenerateResult,
  RoomAgentReplySelectionResult,
  RoomMessageMutationResult,
  RoomMessageEvent,
  RoomMessagesListInput,
  RoomMessagesListResult,
  RoomMessageSendInput,
  RoomMessageSendResult,
  RoomMessageImageAttachment,
  RoomThreadReadResult,
  RoomSummary as BackendRoomSummary,
  RoomTimelineMessage,
} from "@fields/contracts/public/room";
import type {
  AgentRoomExecutionSummary,
} from "@fields/contracts/public/agent-room";
import type {
  RoomAgentTurnEvent,
} from "@fields/contracts/public/agent-activity";

import { backendTrpc } from "../boundary/backend-trpc";
import type { ProfileMember } from "../../shared/types/member";
import type { TimelineMessage } from "../../shared/types/timeline";

export type RoomMessageEventsSubscription = {
  unsubscribe: () => void;
};

export type RoomAgentActivitySubscription = {
  unsubscribe: () => void;
};

export type RoomMachineMessageEvent =
  | (Omit<Extract<RoomMessageEvent, { type: "room.message.created" | "room.message.updated" }>, "message"> & {
    message: TimelineMessage;
  })
  | Extract<RoomMessageEvent, { type: "room.message.deleted" | "room.agent_reply.selection_changed" }>;

export type SubscribeRoomMessageEventsHandlers = {
  onEvent: (event: RoomMachineMessageEvent) => void;
  onError: (error: unknown) => void;
  onComplete: () => void;
};

export type WatchAgentActivityHandlers = {
  onEvent: (event: RoomAgentTurnEvent) => void;
  onError: (error: unknown) => void;
  onComplete: () => void;
};

export type RoomMachineMembersListResult = Omit<RoomMembersListResult, "items"> & {
  items: ProfileMember[];
};

export type RoomMachineMessagesListResult = Omit<RoomMessagesListResult, "items" | "page"> & {
  items: TimelineMessage[];
  page: {
    next_cursor: string | null;
    backwards_cursor: string | null;
  };
};

export type RoomMachineThreadReadResult = Omit<RoomThreadReadResult, "items"> & {
  items: TimelineMessage[];
};

export type RoomSummary = {
  id: string;
  title: string;
  subtitle: string | null;
  status: string;
  updatedAtMs?: number;
  unreadCount?: number;
  readThrough?: string | null;
};

export type RoomMachineListRoomsInput = {
  cursor?: string | null;
  limit?: number;
  includeArchived?: boolean;
  searchTerm?: string;
};

export type RoomMachineListRoomsResult = Omit<RoomListResult, "items" | "page"> & {
  items: RoomSummary[];
  page: {
    next_cursor: string | null;
  };
};

export type RoomMachineSendMessageInput = {
  roomId: string;
  clientMessageId: string;
  markdown: string;
  replyToMessageIds?: RoomMessageSendInput["reply_to_message_ids"];
  branchMessageId?: RoomMessageSendInput["branch_message_id"];
  references?: RoomMessageSendInput["references"];
  imageAttachments?: RoomMessageImageAttachment[];
};

export type RoomMachineMessageSendResult = Omit<RoomMessageSendResult, "message"> & {
  message: TimelineMessage;
};

export type RoomMachineRespondToInteractionInput = {
  roomId: string;
  messageId: string;
  interactionId: string;
  response: RoomInteractionRespondInput["response"];
  clientResponseId?: string;
};

export type RoomMachineInteractionRespondResult = Omit<RoomInteractionRespondResult, "message"> & {
  message: TimelineMessage;
};

export type RoomMachineServices = {
  createDefaultRoom?: () => Promise<RoomSummary>;
  listRooms: (input: RoomMachineListRoomsInput) => Promise<RoomMachineListRoomsResult>;
  subscribeMessageEvents: (
    input: { roomId: string },
    handlers: SubscribeRoomMessageEventsHandlers,
  ) => RoomMessageEventsSubscription;
  getAgentExecution: (input: { roomId: string; executionId: string }) => Promise<AgentRoomExecutionSummary>;
  watchAgentActivity: (
    input: { roomId: string; executionId: string },
    handlers: WatchAgentActivityHandlers,
  ) => RoomAgentActivitySubscription;
  readThread: (input: { roomId: string; threadId: string }) => Promise<RoomMachineThreadReadResult>;
  readMessageContext?: (input: {
    roomId: string;
    messageId: string;
    limit?: number;
  }) => Promise<RoomMachineMessagesListResult>;
  listMembers: (input: { roomId: string }) => Promise<RoomMachineMembersListResult>;
  addMember: (input: { roomId: string; actorId: string; actorType: "human" | "agent" }) => Promise<RoomMachineMembersListResult>;
  removeMember: (input: { roomId: string; actorId: string }) => Promise<RoomMachineMembersListResult>;
  listMessages: (input: {
    roomId: string;
    cursor?: string | null;
    limit?: number;
  }) => Promise<RoomMachineMessagesListResult>;
  sendMessage: (input: RoomMachineSendMessageInput) => Promise<RoomMachineMessageSendResult>;
  editMessage?: (input: {
    roomId: string;
    messageId: string;
    markdown: string;
    expectedRevision: number;
    idempotencyKey: string;
  }) => Promise<RoomMessageMutationResult>;
  deleteMessage?: (input: {
    roomId: string;
    messageId: string;
    expectedRevision: number;
    idempotencyKey: string;
  }) => Promise<RoomMessageMutationResult>;
  regenerateAgentReply?: (input: {
    roomId: string;
    messageId: string;
    expectedRevision: number;
    idempotencyKey: string;
  }) => Promise<RoomAgentReplyRegenerateResult>;
  selectAgentReplyVersion?: (input: {
    roomId: string;
    versionGroupId: string;
    messageId: string;
    expectedRevision: number;
    idempotencyKey: string;
  }) => Promise<RoomAgentReplySelectionResult>;
  respondToInteraction: (
    input: RoomMachineRespondToInteractionInput,
  ) => Promise<RoomMachineInteractionRespondResult>;
  snoozeInteraction?: (input: { roomId: string; messageId: string; interactionId: string }) => Promise<number>;
};

export async function createDefaultRoom(): Promise<RoomSummary> {
  const result = await backendTrpc.room.create.mutate({
    name: "Untitled Room",
    subtitle: "Room workspace",
  });
  return roomSummaryFromBackendRoomSummary(result);
}

export const defaultRoomMachineServices: RoomMachineServices = {
  createDefaultRoom,
  async listRooms(input) {
    const queryInput: RoomListInput = {
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
      ...(typeof input.includeArchived === "boolean" ? { include_archived: input.includeArchived } : {}),
      ...(input.searchTerm ? { search_term: input.searchTerm } : {}),
    };
    const result = await backendTrpc.room.list.query(queryInput);
    return {
      ...result,
      items: result.items.map(roomSummaryFromBackendRoomSummary),
    };
  },
  subscribeMessageEvents(input, handlers) {
    const subscription = backendTrpc.room.messages.events.subscribe(
      {
        room_id: input.roomId,
      },
      {
        onData: (event) => handlers.onEvent(roomMessageEventToMachineEvent(event)),
        onError: handlers.onError,
        onComplete: handlers.onComplete,
      },
    );
    return {
      unsubscribe: () => subscription.unsubscribe(),
    };
  },
  getAgentExecution(input) {
    return backendTrpc.room.agents.execution.get.query({
      room_id: input.roomId,
      execution_id: input.executionId,
    });
  },
  watchAgentActivity(input, handlers) {
    const subscription = backendTrpc.room.agentActivity.watch.subscribe(
      {
        room_id: input.roomId,
        execution_id: input.executionId,
      },
      {
        onData: (event) => handlers.onEvent(event),
        onError: handlers.onError,
        onComplete: handlers.onComplete,
      },
    );
    return {
      unsubscribe: () => subscription.unsubscribe(),
    };
  },
  async readThread(input) {
    const result = await backendTrpc.room.threads.read.query({
      room_id: input.roomId,
      thread_id: input.threadId,
    });
    return {
      ...result,
      items: result.items.map(timelineMessageFromRoomTimelineMessage),
    };
  },
  async readMessageContext(input) {
    const result = await backendTrpc.room.messages.context.query({
      room_id: input.roomId,
      message_id: input.messageId,
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    });
    return {
      ...result,
      items: result.items.map(timelineMessageFromRoomTimelineMessage),
    };
  },
  async listMembers(input) {
    const result = await backendTrpc.room.members.list.query({
      room_id: input.roomId,
    });
    return {
      ...result,
      items: result.items.map(profileMemberFromRoomMember),
    };
  },
  async addMember(input) {
    const result = await backendTrpc.room.members.add.mutate(input.actorType === "agent" ? {
      room_id: input.roomId,
      actor_id: input.actorId,
      actor_type: "agent",
    } : {
      room_id: input.roomId,
      actor_id: input.actorId,
      actor_type: "human",
    });
    return {
      ...result,
      items: result.items.map(profileMemberFromRoomMember),
    };
  },
  async removeMember(input) {
    const result = await backendTrpc.room.members.remove.mutate({
      room_id: input.roomId,
      actor_id: input.actorId,
    });
    return {
      ...result,
      items: result.items.map(profileMemberFromRoomMember),
    };
  },
  async listMessages(input) {
    const queryInput: RoomMessagesListInput = {
      room_id: input.roomId,
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(input.limit ? { limit: input.limit } : {}),
    };
    const result = await backendTrpc.room.messages.list.query(queryInput);
    return {
      ...result,
      items: result.items.map(timelineMessageFromRoomTimelineMessage),
    };
  },
  async sendMessage(input) {
    const result = await backendTrpc.room.messages.send.mutate({
      room_id: input.roomId,
      client_message_id: input.clientMessageId,
      markdown: input.markdown,
      ...(input.replyToMessageIds ? { reply_to_message_ids: input.replyToMessageIds } : {}),
      ...(input.branchMessageId ? { branch_message_id: input.branchMessageId } : {}),
      ...(input.references ? { references: input.references } : {}),
      ...(input.imageAttachments ? { image_attachments: input.imageAttachments } : {}),
    });
    return {
      ...result,
      message: timelineMessageFromRoomTimelineMessage(result.message),
    };
  },
  editMessage(input) {
    return backendTrpc.room.messages.edit.mutate({
      room_id: input.roomId,
      message_id: input.messageId,
      markdown: input.markdown,
      expected_revision: input.expectedRevision,
      idempotency_key: input.idempotencyKey,
    });
  },
  deleteMessage(input) {
    return backendTrpc.room.messages.softDelete.mutate({
      room_id: input.roomId,
      message_id: input.messageId,
      expected_revision: input.expectedRevision,
      idempotency_key: input.idempotencyKey,
    });
  },
  regenerateAgentReply(input) {
    return backendTrpc.room.messages.regenerate.mutate({
      room_id: input.roomId,
      message_id: input.messageId,
      expected_revision: input.expectedRevision,
      idempotency_key: input.idempotencyKey,
    });
  },
  selectAgentReplyVersion(input) {
    return backendTrpc.room.messages.selectVersion.mutate({
      room_id: input.roomId,
      version_group_id: input.versionGroupId,
      message_id: input.messageId,
      expected_revision: input.expectedRevision,
      idempotency_key: input.idempotencyKey,
    });
  },
  async respondToInteraction(input) {
    const result = await backendTrpc.room.interactions.respond.mutate({
      room_id: input.roomId,
      message_id: input.messageId,
      interaction_id: input.interactionId,
      response: input.response,
      ...(input.clientResponseId ? { client_response_id: input.clientResponseId } : {}),
    });
    return {
      ...result,
      message: timelineMessageFromRoomTimelineMessage(result.message),
    };
  },
  async snoozeInteraction(input) {
    const result = await backendTrpc.room.interactions.snooze.mutate({
      room_id: input.roomId,
      message_id: input.messageId,
      interaction_id: input.interactionId,
    });
    return result.deadline_at_ms;
  },
};

export function roomSummaryFromBackendRoomSummary(room: BackendRoomSummary): RoomSummary {
  return {
    id: room.room_id,
    title: room.name,
    subtitle: room.subtitle ?? null,
    status: room.status,
    updatedAtMs: room.updated_at_ms,
    unreadCount: room.unread_count,
    readThrough: room.read_through,
  };
}

export function profileMemberFromRoomMember(member: RoomMember): ProfileMember {
  return member;
}

export function timelineMessageFromRoomTimelineMessage(message: RoomTimelineMessage): TimelineMessage {
  if (message.kind === "system") {
    return {
      id: message.id,
      kind: "system",
      sequence: message.sequence,
      occurred_at: message.occurred_at_ms,
      body: message.body,
    };
  }

  return {
    id: message.id,
    kind: "message",
    sequence: message.sequence,
    occurred_at: message.occurred_at_ms,
    sender: {
      type: message.sender.type === "human" ? "human" : "agent",
      id: message.sender.id,
      display_name: message.sender.display_name,
      mark: message.sender.mark,
      avatar_resource_id: message.sender.avatar_resource_id,
    },
    body: message.body,
    revision: message.revision,
    edited_at_ms: message.edited_at_ms,
    deleted_at_ms: message.deleted_at_ms,
    reply_to: message.reply_to,
    interactions: [...message.interactions],
    thread_id: message.thread_id,
    ...(message.agent_turn ? { agent_turn: message.agent_turn } : {}),
    ...(message.agent_reply_version ? { agent_reply_version: message.agent_reply_version } : {}),
    ...(message.references ? { references: message.references } : {}),
    ...(message.generation ? { generation: message.generation } : {}),
  };
}

export function roomMessageEventToMachineEvent(event: RoomMessageEvent): RoomMachineMessageEvent {
  if (
    event.type === "room.message.deleted"
    || event.type === "room.agent_reply.selection_changed"
  ) {
    return event;
  }
  return {
    ...event,
    message: timelineMessageFromRoomTimelineMessage(event.message),
  };
}
