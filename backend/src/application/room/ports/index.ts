import type {
  AgentRoomInteractionResponseAccepted,
  AgentRoomInteractionResponseDispatch,
  AgentRoomExecutionCompletion,
  AgentRoomExecutionProgress,
} from "@fields/contracts/internal/agent-room";
import type {
  AgentTurnEvent,
  AgentTurnSnapshot,
} from "@fields/contracts/public/agent-activity";
import type {
  RoomMessageImageAttachment,
  RoomMessageInteraction,
} from "@fields/contracts/public/room";
import type { DesktopNotificationEvent } from "@fields/contracts/public/desktop-notification";

import type { Room, RoomMembership, RoomMembershipChange } from "../../../domain/room/index.js";
import type { OwnerTransaction } from "../../platform/ports/index.js";

/** The persistence adapter allocates the opaque membership row identifier. */
export type NewRoomMembership = Omit<RoomMembership, "id">;

/**
 * A lock-consistent Room snapshot used only inside the Room Owner Unit of
 * Work. Reading it through the command port prevents an idempotency decision
 * from racing a concurrent membership mutation.
 */
export type RoomMembershipMutationState = {
  room: Room;
  membership: RoomMembership | null;
};

export interface RoomCommandRepository {
  create(transaction: OwnerTransaction, room: Room, ownerMembership: NewRoomMembership): Promise<void>;
  readMembershipForMutation(
    transaction: OwnerTransaction,
    input: { roomId: string; actorId: string },
  ): Promise<RoomMembershipMutationState | null>;
  applyMembershipChange(transaction: OwnerTransaction, input: {
    roomId: string;
    actorId: string;
    change: RoomMembershipChange;
    membershipVersion: number;
    joinedAtMs: number;
    updatedAtMs: number;
    actorType: "human" | "agent";
  }): Promise<RoomMembership | null>;
}

export interface RoomQueryRepository {
  findById(roomId: string): Promise<Room | null>;
  listByCompanyId(companyId: string): Promise<readonly Room[]>;
  listActiveMembers(roomId: string): Promise<readonly RoomMembership[]>;
  currentMembershipVersion(roomId: string): Promise<number | null>;
}

/** Opaque public cursor facts for the Room-owned summary projection. */
export type RoomListCursor = {
  updatedAtMs: number;
  roomId: string;
};

/** Provider-neutral list item; transport owns snake_case DTO mapping. */
export type RoomListSummary = {
  roomId: string;
  name: string;
  subtitle: string | null;
  status: Room["status"];
  updatedAtMs: number;
  unreadCount: number;
  readThrough?: string | null;
};

/**
 * A Room-owned access-filtered page query. The adapter returns at most
 * `limit + 1` rows in the specified order so Application can form the stable
 * opaque next cursor without exposing persistence details.
 */
export interface RoomListProjectionQuery {
  listVisibleRoomSummaries(input: {
    companyId: string;
    actorId: string;
    cursor: RoomListCursor | null;
    limit: number;
    includeArchived: boolean;
    searchTerm?: string;
  }): Promise<readonly RoomListSummary[]>;
}

export type RoomAccess = {
  roomId: string;
  companyId: string;
  actorId: string;
  role: "owner" | "member";
};

export interface RoomAccessQuery {
  requireMember(input: { roomId: string; actorId: string }): Promise<RoomAccess>;
  requireOwner(input: { roomId: string; actorId: string }): Promise<RoomAccess & { role: "owner" }>;
}

/**
 * Actor-owned public profile facts needed to render an already-authorized
 * Room membership. The Room owner never joins or queries Actor persistence
 * directly; Composition injects the Actor public-query adapter.
 */
export type RoomMemberActorProfile = {
  actorId: string;
  companyId: string;
  displayName: string;
  mark: string;
  actorType: "human" | "agent";
};

export interface RoomMemberActorProfileQuery {
  listActiveOrdinaryProfiles(input: {
    companyId: string;
    actorIds: readonly string[];
  }): Promise<readonly RoomMemberActorProfile[]>;
}

/**
 * Narrow cross-owner Actor query consumed by Room commands. It admits an
 * active same-Company Human or Agent before a Room transaction begins.
 */
export type ActiveOrdinaryRoomActor = {
  actorId: string;
  companyId: string;
  actorType: "human" | "agent";
};

/**
 * Stable cross-owner result for an Actor fact that cannot participate in a
 * Room. Commands translate it to their own public-safe rejection code while
 * preserving retryable infrastructure failures.
 */
export const ROOM_ACTOR_ACCESS_DENIED_CODE = "ROOM_ACTOR_ACCESS_DENIED";
export const ROOM_ACTOR_ACCESS_UNAVAILABLE_CODE = "ROOM_ACTOR_ACCESS_UNAVAILABLE";

export interface RoomActorAccessQuery {
  requireActiveOrdinaryActor(input: { actorId: string; companyId: string }): Promise<ActiveOrdinaryRoomActor>;
}

export type RoomMembershipProjection = {
  roomId: string;
  companyId: string;
  membershipVersion: number;
  members: readonly RoomMembership[];
};

/** Execution reconciliation consumes only this canonical projection. */
export interface RoomMembershipQuery {
  readCurrentMembership(roomId: string): Promise<RoomMembershipProjection | null>;
}

export const agentRoomTriggerPolicies = [
  "human_explicit",
  "member_explicit",
  "human_auto",
  "member_auto",
  "human_explicit_agent_auto",
  "agent_explicit_human_auto",
] as const;
export type AgentRoomTriggerPolicy = typeof agentRoomTriggerPolicies[number];

export type PersistedRoomMessage = {
  messageId: string;
  roomId: string;
  companyId: string;
  sequence: number;
  eventSequence: number;
  revision: number;
  senderMemberId: string | null;
  senderType: "human" | "agent" | "system";
  clientMessageId: string | null;
  markdown: string;
  plainText: string;
  replyToMessageIds: readonly string[];
  references: readonly Record<string, unknown>[];
  imageAttachments?: readonly RoomMessageImageAttachment[];
  threadId: string | null;
  triggerMessageId: string | null;
  sourceExecutionId: string | null;
  sourceCascadeId: string | null;
  versionGroupId: string | null;
  versionNumber: number | null;
  versionCount: number;
  selectedVersionMessageId: string | null;
  selectionRevision: number;
  latestSuccessfulVersionMessageId: string | null;
  editedAtMs: number | null;
  deletedAtMs: number | null;
  sourceExecutionStatus: AgentRoomExecution["status"] | null;
  sourceExecutionStartedAtMs: number | null;
  sourceExecutionCompletedAtMs: number | null;
  senderDisplayName: string;
  senderMark: string;
  senderAvatarResourceId: string | null;
  roomTitle: string;
  interactions: readonly RoomMessageInteraction[];
  createdAtMs: number;
  updatedAtMs: number;
};

export type AgentRoomExecution = {
  executionId: string;
  roomId: string;
  companyId: string;
  agentMemberId: string;
  cascadeId: string;
  sourceMessageId: string;
  sourceExecutionId: string | null;
  codexTurnId: string | null;
  turnMessageId: string | null;
  idempotencyKey: string;
  trigger: "mention" | "direct_reply" | "automatic";
  triggerPolicy: AgentRoomTriggerPolicy;
  status: "pending" | "dispatched" | "running" | "succeeded" | "failed" | "cancelled";
  fromSequence: number;
  throughSequence: number;
  threadId: string | null;
  attempt: number;
  publishedMessageCount: number;
  startedAtMs: number | null;
  completedAtMs: number | null;
  error: { code: string; retryable: boolean } | null;
};

export type AgentRoomState = {
  roomId: string;
  companyId: string;
  agentMemberId: string;
  triggerPolicy: AgentRoomTriggerPolicy;
  triggerPolicyVersion: number;
  threadId: string | null;
  cursorSequence: number;
  eligibleFromSequence: number;
  membershipActive: boolean;
  membershipVersion: number;
  updatedAtMs: number;
};

export type SendRoomMessageInput = {
  roomId: string;
  companyId: string;
  senderMemberId: string;
  senderType: "human" | "agent";
  clientMessageId: string;
  markdown: string;
  plainText: string;
  replyToMessageIds: readonly string[];
  branchMessageId?: string | null;
  references: readonly Record<string, unknown>[];
  imageAttachments?: readonly RoomMessageImageAttachment[];
  nowMs: number;
  sourceExecutionId?: string | null;
  sourceCascadeId?: string | null;
  versionGroupId?: string | null;
  versionNumber?: number | null;
  threadId?: string | null;
  triggerMessageId?: string | null;
};

export type SendRoomMessageResult = {
  message: PersistedRoomMessage;
  created: boolean;
  cascadeId: string | null;
  executionIds: readonly string[];
};

export type RoomMessageRealtimeEvent =
  | {
    type: "message";
    eventSequence: number;
    message: PersistedRoomMessage;
  }
  | {
    type: "selection";
    eventSequence: number;
    versionGroupId: string;
    selectedMessageId: string;
    revision: number;
    occurredAtMs: number;
  };

export interface RoomMessageApplication {
  send(input: SendRoomMessageInput): Promise<SendRoomMessageResult>;
  edit(input: {
    roomId: string;
    companyId: string;
    requestedByMemberId: string;
    messageId: string;
    expectedRevision: number;
    markdown: string;
    idempotencyKey: string;
    nowMs: number;
  }): Promise<PersistedRoomMessage>;
  softDelete(input: {
    roomId: string;
    companyId: string;
    requestedByMemberId: string;
    messageId: string;
    expectedRevision: number;
    idempotencyKey: string;
    nowMs: number;
  }): Promise<PersistedRoomMessage>;
  selectAgentReplyVersion(input: {
    roomId: string;
    companyId: string;
    requestedByMemberId: string;
    versionGroupId: string;
    messageId: string;
    expectedRevision: number;
    idempotencyKey: string;
    nowMs: number;
  }): Promise<{
    versionGroupId: string;
    selectedMessageId: string;
    revision: number;
  }>;
  regenerateAgentReply(input: {
    roomId: string;
    companyId: string;
    requestedByMemberId: string;
    messageId: string;
    expectedRevision: number;
    idempotencyKey: string;
    nowMs: number;
  }): Promise<{
    executionId: string;
    versionGroupId: string;
    versionNumber: number;
    message: PersistedRoomMessage;
  }>;
  list(input: {
    roomId: string;
    companyId: string;
    requestedByMemberId: string;
    beforeSequence: number | null;
    limit: number;
  }): Promise<readonly PersistedRoomMessage[]>;
  search(input: {
    companyId: string;
    requestedByMemberId: string;
    query: string;
    limit: number;
  }): Promise<readonly PersistedRoomMessage[]>;
  context(input: {
    roomId: string;
    companyId: string;
    requestedByMemberId: string;
    messageId: string;
    limit: number;
  }): Promise<readonly PersistedRoomMessage[]>;
  readExecution(executionId: string): Promise<AgentRoomExecution | null>;
  readLatestActivitySnapshot(executionId: string): Promise<AgentTurnSnapshot | null>;
  recordActivityProjection(input: {
    eventId: string;
    executionId: string;
    roomId: string;
    agentMemberId: string;
    occurredAtMs: number;
    snapshot: AgentTurnSnapshot;
    interaction: RoomMessageInteraction | null;
    resolvedInteractionId: string | null;
  }): Promise<{ accepted: true; eventId: string; duplicate: boolean; interactionId: string | null }>;
  watchActivity(input: {
    roomId: string;
    companyId: string;
    executionId: string;
    requestedByMemberId: string;
    signal?: AbortSignal;
  }): AsyncIterable<AgentTurnEvent>;
  persistInteractionResponse(input: {
    roomId: string;
    companyId: string;
    messageId: string;
    interactionId: string;
    responderMemberId: string;
    response: import("@fields/contracts/public/room").RoomInteractionRespondInput["response"];
    clientResponseId?: string;
    nowMs: number;
  }): Promise<{
    dispatch: AgentRoomInteractionResponseDispatch;
    message: PersistedRoomMessage;
  }>;
  claimSecretInteractionResponse(input: {
    roomId: string;
    companyId: string;
    messageId: string;
    interactionId: string;
    responderMemberId: string;
    response: import("@fields/contracts/public/room").RoomInteractionRespondInput["response"];
    nowMs: number;
  }): Promise<{ claimToken: string; dispatch: AgentRoomInteractionResponseDispatch } | null>;
  completeSecretInteractionResponse(input: {
    claimToken: string;
    dispatch: AgentRoomInteractionResponseDispatch;
    delivered: boolean;
    nowMs: number;
  }): Promise<PersistedRoomMessage | null>;
  snoozeQuestionInteraction(input: {
    roomId: string;
    companyId: string;
    messageId: string;
    interactionId: string;
    memberId: string;
    nowMs: number;
  }): Promise<number>;
  markInteractionResponseDelivered(
    dispatch: AgentRoomInteractionResponseDispatch,
    accepted: AgentRoomInteractionResponseAccepted,
    nowMs: number,
  ): Promise<void>;
  readPendingInteractionResponse(persistedResponseId: string): Promise<{
    companyId: string;
    dispatch: AgentRoomInteractionResponseDispatch;
  } | null>;
  recordExecutionProgress(input: AgentRoomExecutionProgress): Promise<AgentRoomExecution>;
  completeExecution(input: AgentRoomExecutionCompletion): Promise<AgentRoomExecution>;
  getTriggerPolicy(input: {
    roomId: string;
    companyId: string;
    agentMemberId: string;
    requestedByMemberId: string;
  }): Promise<AgentRoomState>;
  setTriggerPolicy(input: {
    roomId: string;
    companyId: string;
    agentMemberId: string;
    requestedByMemberId: string;
    policy: AgentRoomTriggerPolicy;
    expectedVersion?: number;
    nowMs: number;
  }): Promise<AgentRoomState>;
  watch(input: {
    roomId: string;
    companyId: string;
    requestedByMemberId: string;
    signal?: AbortSignal;
  }): AsyncIterable<RoomMessageRealtimeEvent>;
  watchDesktopNotifications(input: { companyId: string; requestedByMemberId: string; signal?: AbortSignal }): AsyncIterable<DesktopNotificationEvent>;
}
