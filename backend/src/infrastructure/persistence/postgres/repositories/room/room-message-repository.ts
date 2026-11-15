import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type {
  AgentRoomCompanyFileSnapshot,
  AgentRoomInteractionResponseAccepted,
  AgentRoomInteractionResponseDispatch,
  AgentRoomExecutionCompletion,
  AgentRoomExecutionDispatch,
  AgentRoomExecutionProgress,
} from "@fields/contracts/internal/agent-room";
import { agentRoomCompanyFileSnapshotSchema } from "@fields/contracts/internal/agent-room";
import {
  agentTurnSnapshotSchema,
  type AgentTurnEvent,
  type AgentTurnSnapshot,
} from "@fields/contracts/public/agent-activity";
import {
  roomQuestionInteractionSchema,
  roomMessageImageAttachmentsSchema,
  roomReferenceTargetSchema,
  type RoomMessageImageAttachment,
  type RoomMessageInteraction,
} from "@fields/contracts/public/room";
import type { DesktopNotificationEvent } from "@fields/contracts/public/desktop-notification";
import { sql } from "drizzle-orm";

import { ApplicationError } from "../../../../../application/platform/errors.js";
import { agentRoomPolicyTriggers } from "../../../../../application/room/agent-room-trigger-policy.js";
import { markdownToPlainText } from "../../../../../application/room/markdown-to-plain-text.js";
import type { BackendDatabase } from "../../database-service.js";

export const ROOM_MESSAGE_ACCESS_DENIED_CODE = "ROOM_MESSAGE_ACCESS_DENIED";
export const ROOM_MESSAGE_INVALID_CODE = "ROOM_MESSAGE_INVALID";
export const ROOM_MESSAGE_NOT_FOUND_CODE = "ROOM_MESSAGE_NOT_FOUND";
export const ROOM_MESSAGE_NOT_OWNED_CODE = "ROOM_MESSAGE_NOT_OWNED";
export const ROOM_MESSAGE_NOT_EDITABLE_CODE = "ROOM_MESSAGE_NOT_EDITABLE";
export const ROOM_MESSAGE_REVISION_CONFLICT_CODE = "ROOM_MESSAGE_REVISION_CONFLICT";
export const ROOM_MESSAGE_PERSISTENCE_UNAVAILABLE_CODE = "ROOM_MESSAGE_PERSISTENCE_UNAVAILABLE";
export const AGENT_ROOM_STATE_INVALID_CODE = "AGENT_ROOM_STATE_INVALID";
export const AGENT_ROOM_EXECUTION_INVALID_CODE = "AGENT_ROOM_EXECUTION_INVALID";

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
  imageAttachments: readonly RoomMessageImageAttachment[];
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

type DatabaseExecutor = Pick<BackendDatabase, "execute">;
type DatabaseNumber = number | string | bigint;

type MessageRow = {
  message_id: string;
  room_id: string;
  company_id: string;
  sequence: DatabaseNumber;
  event_sequence: DatabaseNumber;
  revision: DatabaseNumber;
  sender_member_id: string | null;
  sender_type: string;
  client_message_id: string | null;
  markdown: string;
  plain_text: string;
  reply_to_message_ids_json: unknown;
  references_json: unknown;
  image_attachments_json: unknown;
  thread_id: string | null;
  trigger_message_id: string | null;
  source_execution_id: string | null;
  source_cascade_id: string | null;
  version_group_id: string | null;
  version_number: DatabaseNumber | null;
  edited_at_ms: DatabaseNumber | null;
  deleted_at_ms: DatabaseNumber | null;
  created_at_ms: DatabaseNumber;
  updated_at_ms: DatabaseNumber;
};

type InteractionRow = {
  interaction_id: string;
  room_id: string;
  company_id: string;
  execution_id: string;
  agent_member_id: string;
  message_id: string;
  kind: string;
  label: string;
  status: string;
  responses_json: unknown;
  interaction_json: unknown;
  deadline_at_ms: DatabaseNumber | null;
  created_at_ms: DatabaseNumber;
  updated_at_ms: DatabaseNumber;
  responded_at_ms: DatabaseNumber | null;
};

type AgentStateRow = {
  room_id: string;
  company_id: string;
  agent_member_id: string;
  trigger_policy: string;
  trigger_policy_version: DatabaseNumber;
  thread_id: string | null;
  cursor_sequence: DatabaseNumber;
  eligible_from_sequence: DatabaseNumber;
  membership_active: boolean;
  membership_version: DatabaseNumber;
  updated_at_ms: DatabaseNumber;
};

type ExecutionRow = {
  execution_id: string;
  room_id: string;
  company_id: string;
  agent_member_id: string;
  cascade_id: string;
  source_message_id: string;
  source_execution_id: string | null;
  codex_turn_id: string | null;
  turn_message_id: string | null;
  idempotency_key: string;
  trigger: string;
  trigger_policy: string;
  status: string;
  from_sequence: DatabaseNumber;
  through_sequence: DatabaseNumber;
  thread_id: string | null;
  attempt: DatabaseNumber;
  published_message_count: DatabaseNumber;
  started_at_ms: DatabaseNumber | null;
  completed_at_ms: DatabaseNumber | null;
  last_error_code: string | null;
  last_error_retryable: boolean | null;
};

type DispatchMessageRow = {
  message_id: string;
  sequence: DatabaseNumber;
  created_at_ms: DatabaseNumber;
  sender_member_id: string | null;
  sender_type: string;
  markdown: string;
  plain_text: string;
  reply_to_message_ids_json: unknown;
  references_json: unknown;
  image_attachments_json: unknown;
  sender_display_name: string | null;
  sender_mark: string | null;
  sender_avatar_resource_id: string | null;
};

type AgentExecutionPlan = {
  agentMemberId: string;
  trigger: "mention" | "direct_reply" | "automatic";
  triggerPolicy: AgentRoomTriggerPolicy;
  threadId: string | null;
  fromSequence: number;
  throughSequence: number;
};

/**
 * Backend is the only Room message owner. Message persistence, trigger
 * decisions, execution creation, exact unread input capture, and outbox write
 * happen in one PostgreSQL transaction.
 */
export class PostgresRoomMessageRepository {
  constructor(private readonly db: BackendDatabase) {}

  async send(input: SendRoomMessageInput): Promise<SendRoomMessageResult> {
    assertSendInput(input);
    try {
      const result = await this.db.transaction(async (transaction) => {
        const existing = await findIdempotentMessage(transaction, input);
        if (existing !== null) {
          return {
            message: existing,
            created: false,
            cascadeId: existing.sourceCascadeId,
            executionIds: Object.freeze([]),
          };
        }

        await requireActiveSenderMembership(transaction, input);
        await validateReplyTargets(transaction, input.roomId, input.replyToMessageIds);
        const selectedBranch = await selectedBranchThread(
          transaction,
          input.roomId,
          input.senderMemberId,
          input.branchMessageId ?? null,
        );
        const threadId = input.threadId
          ?? selectedBranch?.threadId
          ?? await replyThreadId(transaction, input.roomId, input.replyToMessageIds);
        const position = await allocateRoomMessagePosition(transaction, input);
        const messageId = randomUUID();
        const message = await insertMessage(transaction, {
          ...input,
          threadId,
          messageId,
          ...position,
        });
        if (message.senderType === "human" && message.senderMemberId !== null) {
          await projectRoomNotification(transaction, {
            eventId: `room.message:${message.messageId}`,
            message,
            kind: "room.message",
            status: null,
            excludeActorId: message.senderMemberId,
            nowMs: input.nowMs,
          });
        }

        const executionPlan = await planTriggeredExecutions(transaction, message, "created", {
          agentMemberId: selectedBranch?.agentMemberId ?? null,
        });
        if (executionPlan.length === 0) {
          return {
            message,
            created: true,
            cascadeId: input.sourceCascadeId ?? null,
            executionIds: Object.freeze([]),
          };
        }

        if (input.sourceCascadeId === undefined || input.sourceCascadeId === null) {
        }
        const cascadeId = input.sourceCascadeId ?? randomUUID();
        if (input.sourceCascadeId === undefined || input.sourceCascadeId === null) {
          await transaction.execute(sql`
            insert into agent_room_cascades (
              cascade_id, room_id, company_id, source_message_id, status,
              created_at_ms, completed_at_ms
            ) values (
              ${cascadeId}, ${message.roomId}, ${message.companyId}, ${message.messageId},
              'active', ${input.nowMs}, null
            )
          `);
        } else {
          const activeCascade = rowsFromResult<{ cascade_id: string }>(await transaction.execute(sql`
            select cascade_id from agent_room_cascades
            where cascade_id = ${cascadeId}
              and room_id = ${message.roomId}
              and company_id = ${message.companyId}
              and status = 'active'
            limit 2
            for update
          `));
          if (activeCascade.length !== 1) {
            throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
          }
        }

        await transaction.execute(sql`
          update room_messages
          set source_cascade_id = ${cascadeId}
          where message_id = ${message.messageId}
        `);

        const executionIds: string[] = [];
        for (const plan of executionPlan) {
          const executionId = await createAgentRoomExecution(transaction, {
            message,
            cascadeId,
            plan,
            nowMs: input.nowMs,
          });
          if (executionId) executionIds.push(executionId);
        }

        return {
          message: { ...message, sourceCascadeId: cascadeId },
          created: true,
          cascadeId,
          executionIds: Object.freeze(executionIds),
        };
      });
      const [message] = await hydrateMessageProjections(
        this.db,
        [result.message],
        input.senderMemberId,
      );
      if (!message) throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
      return { ...result, message };
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(ROOM_MESSAGE_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

  async edit(input: {
    roomId: string;
    companyId: string;
    requestedByMemberId: string;
    messageId: string;
    expectedRevision: number;
    markdown: string;
    idempotencyKey: string;
    nowMs: number;
  }): Promise<PersistedRoomMessage> {
    const markdown = input.markdown.trim();
    if (
      markdown.length === 0
      || !Number.isSafeInteger(input.expectedRevision)
      || input.expectedRevision < 1
      || input.idempotencyKey.length === 0
    ) {
      throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
    }
    const fingerprint = mutationFingerprint("edit", {
      message_id: input.messageId,
      expected_revision: input.expectedRevision,
      markdown,
    });
    try {
      const message = await this.db.transaction(async (transaction) => {
        const replay = await mutationReceiptMessage(
          transaction,
          input,
          "edit",
          fingerprint,
        );
        if (replay !== null) return replay;
        await requireActiveMembership(
          transaction,
          input.roomId,
          input.companyId,
          input.requestedByMemberId,
        );
        const current = await lockRoomMessage(
          transaction,
          input.roomId,
          input.companyId,
          input.messageId,
        );
        assertOwnedEditableHumanMessage(current, input.requestedByMemberId);
        if (current.deletedAtMs !== null) {
          throw new ApplicationError(ROOM_MESSAGE_NOT_EDITABLE_CODE, false);
        }
        if (current.revision !== input.expectedRevision) {
          throw new ApplicationError(ROOM_MESSAGE_REVISION_CONFLICT_CODE, false);
        }
        const eventSequence = await allocateRoomMessageEventSequence(transaction, input);
        const nextRevision = current.revision + 1;
        const rows = rowsFromResult<MessageRow>(await transaction.execute(sql`
          update room_messages
          set markdown = ${markdown},
            plain_text = ${markdownToPlainText(markdown)},
            revision = ${nextRevision},
            event_sequence = ${eventSequence},
            edited_at_ms = ${input.nowMs},
            updated_at_ms = ${input.nowMs}
          where message_id = ${input.messageId}
            and room_id = ${input.roomId}
            and company_id = ${input.companyId}
            and revision = ${input.expectedRevision}
          returning message_id, room_id, company_id, sequence, event_sequence, revision,
            sender_member_id, sender_type, client_message_id, markdown, plain_text,
            reply_to_message_ids_json, references_json, image_attachments_json, thread_id, trigger_message_id,
            source_execution_id, source_cascade_id, version_group_id, version_number,
            edited_at_ms, deleted_at_ms, created_at_ms, updated_at_ms
        `));
        if (rows.length !== 1) {
          throw new ApplicationError(ROOM_MESSAGE_REVISION_CONFLICT_CODE, false);
        }
        await insertMessageRevision(transaction, {
          messageId: input.messageId,
          revision: nextRevision,
          editorMemberId: input.requestedByMemberId,
          markdown,
          plainText: markdownToPlainText(markdown),
          deleted: false,
          nowMs: input.nowMs,
        });
        const updated = messageFromRow(rows[0]!);
        await insertMutationReceipt(transaction, input, "edit", fingerprint, updated);
        return updated;
      });
      const [projected] = await hydrateMessageProjections(
        this.db,
        [message],
        input.requestedByMemberId,
      );
      if (!projected) throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
      return projected;
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(ROOM_MESSAGE_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

  async softDelete(input: {
    roomId: string;
    companyId: string;
    requestedByMemberId: string;
    messageId: string;
    expectedRevision: number;
    idempotencyKey: string;
    nowMs: number;
  }): Promise<PersistedRoomMessage> {
    if (
      !Number.isSafeInteger(input.expectedRevision)
      || input.expectedRevision < 1
      || input.idempotencyKey.length === 0
    ) {
      throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
    }
    const fingerprint = mutationFingerprint("soft_delete", {
      message_id: input.messageId,
      expected_revision: input.expectedRevision,
    });
    try {
      const message = await this.db.transaction(async (transaction) => {
        const replay = await mutationReceiptMessage(
          transaction,
          input,
          "soft_delete",
          fingerprint,
        );
        if (replay !== null) return replay;
        await requireActiveMembership(
          transaction,
          input.roomId,
          input.companyId,
          input.requestedByMemberId,
        );
        const current = await lockRoomMessage(
          transaction,
          input.roomId,
          input.companyId,
          input.messageId,
        );
        assertOwnedEditableHumanMessage(current, input.requestedByMemberId);
        if (current.deletedAtMs !== null) {
          throw new ApplicationError(ROOM_MESSAGE_NOT_EDITABLE_CODE, false);
        }
        if (current.revision !== input.expectedRevision) {
          throw new ApplicationError(ROOM_MESSAGE_REVISION_CONFLICT_CODE, false);
        }
        const eventSequence = await allocateRoomMessageEventSequence(transaction, input);
        const nextRevision = current.revision + 1;
        const rows = rowsFromResult<MessageRow>(await transaction.execute(sql`
          update room_messages
          set markdown = '',
            plain_text = '',
            revision = ${nextRevision},
            event_sequence = ${eventSequence},
            deleted_at_ms = ${input.nowMs},
            updated_at_ms = ${input.nowMs}
          where message_id = ${input.messageId}
            and room_id = ${input.roomId}
            and company_id = ${input.companyId}
            and revision = ${input.expectedRevision}
          returning message_id, room_id, company_id, sequence, event_sequence, revision,
            sender_member_id, sender_type, client_message_id, markdown, plain_text,
            reply_to_message_ids_json, references_json, image_attachments_json, thread_id, trigger_message_id,
            source_execution_id, source_cascade_id, version_group_id, version_number,
            edited_at_ms, deleted_at_ms, created_at_ms, updated_at_ms
        `));
        if (rows.length !== 1) {
          throw new ApplicationError(ROOM_MESSAGE_REVISION_CONFLICT_CODE, false);
        }
        await insertMessageRevision(transaction, {
          messageId: input.messageId,
          revision: nextRevision,
          editorMemberId: input.requestedByMemberId,
          markdown: "",
          plainText: "",
          deleted: true,
          nowMs: input.nowMs,
        });
        const updated = messageFromRow(rows[0]!);
        await insertMutationReceipt(
          transaction,
          input,
          "soft_delete",
          fingerprint,
          updated,
        );
        return updated;
      });
      const [projected] = await hydrateMessageProjections(
        this.db,
        [message],
        input.requestedByMemberId,
      );
      if (!projected) throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
      return projected;
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(ROOM_MESSAGE_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

  async selectAgentReplyVersion(input: {
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
  }> {
    if (
      !Number.isSafeInteger(input.expectedRevision)
      || input.expectedRevision < 0
      || input.idempotencyKey.length === 0
    ) {
      throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
    }
    const fingerprint = mutationFingerprint("select_version", {
      version_group_id: input.versionGroupId,
      message_id: input.messageId,
      expected_revision: input.expectedRevision,
    });
    try {
      return await this.db.transaction(async (transaction) => {
        await transaction.execute(sql`
          select pg_advisory_xact_lock(hashtextextended(${input.idempotencyKey}, 0))
        `);
        const receipts = rowsFromResult<{
          room_id: string;
          member_id: string;
          operation: string;
          fingerprint: string;
          result_json: unknown;
        }>(await transaction.execute(sql`
          select room_id, member_id, operation, fingerprint, result_json
          from room_message_mutation_receipts
          where idempotency_key = ${input.idempotencyKey}
          limit 2
        `));
        if (receipts.length > 0) {
          const receipt = receipts[0]!;
          const result = objectValue(receipt.result_json);
          if (
            receipts.length !== 1
            || receipt.room_id !== input.roomId
            || receipt.member_id !== input.requestedByMemberId
            || receipt.operation !== "select_version"
            || receipt.fingerprint !== fingerprint
            || result?.version_group_id !== input.versionGroupId
            || result.selected_message_id !== input.messageId
            || typeof result.revision !== "number"
          ) {
            throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
          }
          return {
            versionGroupId: input.versionGroupId,
            selectedMessageId: input.messageId,
            revision: positiveNumber(result.revision),
          };
        }
        await requireActiveMembership(
          transaction,
          input.roomId,
          input.companyId,
          input.requestedByMemberId,
        );
        const groups = rowsFromResult<{ version_group_id: string }>(await transaction.execute(sql`
          select version_group_id
          from room_agent_reply_version_groups
          where version_group_id = ${input.versionGroupId}
            and room_id = ${input.roomId}
            and company_id = ${input.companyId}
          limit 2
          for update
        `));
        if (groups.length !== 1) {
          throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
        }
        const versions = rowsFromResult<{ message_id: string }>(await transaction.execute(sql`
          select message_id
          from room_messages
          where message_id = ${input.messageId}
            and version_group_id = ${input.versionGroupId}
            and room_id = ${input.roomId}
            and company_id = ${input.companyId}
          limit 2
        `));
        if (versions.length !== 1) {
          throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
        }
        const selections = rowsFromResult<{
          revision: DatabaseNumber;
          selected_message_id: string;
        }>(await transaction.execute(sql`
          select revision, selected_message_id
          from room_agent_reply_selections
          where version_group_id = ${input.versionGroupId}
            and member_id = ${input.requestedByMemberId}
          limit 2
          for update
        `));
        const currentRevision = selections[0]
          ? positiveNumber(selections[0].revision)
          : 0;
        if (currentRevision !== input.expectedRevision) {
          throw new ApplicationError(ROOM_MESSAGE_REVISION_CONFLICT_CODE, false);
        }
        if (
          selections[0]?.selected_message_id === input.messageId
          && currentRevision > 0
        ) {
          throw new ApplicationError(ROOM_MESSAGE_REVISION_CONFLICT_CODE, false);
        }
        const eventSequence = await allocateRoomMessageEventSequence(transaction, input);
        const revision = currentRevision + 1;
        await transaction.execute(sql`
          insert into room_agent_reply_selections (
            version_group_id, member_id, selected_message_id, revision,
            event_sequence, created_at_ms, updated_at_ms
          ) values (
            ${input.versionGroupId}, ${input.requestedByMemberId}, ${input.messageId},
            ${revision}, ${eventSequence}, ${input.nowMs}, ${input.nowMs}
          )
          on conflict (version_group_id, member_id)
          do update set
            selected_message_id = excluded.selected_message_id,
            revision = excluded.revision,
            event_sequence = excluded.event_sequence,
            updated_at_ms = excluded.updated_at_ms
        `);
        await transaction.execute(sql`
          insert into room_message_mutation_receipts (
            idempotency_key, room_id, member_id, operation, fingerprint,
            result_json, created_at_ms
          ) values (
            ${input.idempotencyKey}, ${input.roomId}, ${input.requestedByMemberId},
            'select_version', ${fingerprint},
            ${JSON.stringify({
              version_group_id: input.versionGroupId,
              selected_message_id: input.messageId,
              revision,
            })}::jsonb,
            ${input.nowMs}
          )
        `);
        return {
          versionGroupId: input.versionGroupId,
          selectedMessageId: input.messageId,
          revision,
        };
      });
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(ROOM_MESSAGE_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

  async regenerateAgentReply(input: {
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
  }> {
    if (
      !Number.isSafeInteger(input.expectedRevision)
      || input.expectedRevision < 1
      || input.idempotencyKey.length === 0
    ) {
      throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
    }
    const fingerprint = mutationFingerprint("regenerate", {
      message_id: input.messageId,
      expected_revision: input.expectedRevision,
    });
    try {
      const result = await this.db.transaction(async (transaction) => {
        await transaction.execute(sql`
          select pg_advisory_xact_lock(hashtextextended(${input.idempotencyKey}, 0))
        `);
        const receipts = rowsFromResult<{
          room_id: string;
          member_id: string;
          operation: string;
          fingerprint: string;
          result_json: unknown;
        }>(await transaction.execute(sql`
          select room_id, member_id, operation, fingerprint, result_json
          from room_message_mutation_receipts
          where idempotency_key = ${input.idempotencyKey}
          limit 2
        `));
        if (receipts.length > 0) {
          const receipt = receipts[0]!;
          const replay = objectValue(receipt.result_json);
          if (
            receipts.length !== 1
            || receipt.room_id !== input.roomId
            || receipt.member_id !== input.requestedByMemberId
            || receipt.operation !== "regenerate"
            || receipt.fingerprint !== fingerprint
            || typeof replay?.execution_id !== "string"
            || typeof replay.message_id !== "string"
            || typeof replay.version_group_id !== "string"
            || typeof replay.version_number !== "number"
          ) {
            throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
          }
          const replayMessage = await lockRoomMessage(
            transaction,
            input.roomId,
            input.companyId,
            replay.message_id,
          );
          return {
            executionId: replay.execution_id,
            versionGroupId: replay.version_group_id,
            versionNumber: positiveNumber(replay.version_number),
            message: replayMessage,
          };
        }
        await requireActiveMembership(
          transaction,
          input.roomId,
          input.companyId,
          input.requestedByMemberId,
        );
        const reply = await lockRoomMessage(
          transaction,
          input.roomId,
          input.companyId,
          input.messageId,
        );
        if (
          reply.senderType !== "agent"
          || reply.sourceExecutionId === null
          || reply.versionGroupId === null
          || reply.versionNumber === null
          || reply.revision !== input.expectedRevision
        ) {
          throw new ApplicationError(
            reply.revision === input.expectedRevision
              ? ROOM_MESSAGE_NOT_EDITABLE_CODE
              : ROOM_MESSAGE_REVISION_CONFLICT_CODE,
            false,
          );
        }
        const sourceExecution = await lockExecution(transaction, reply.sourceExecutionId);
        if (
          sourceExecution === null
          || sourceExecution.roomId !== input.roomId
          || sourceExecution.companyId !== input.companyId
          || sourceExecution.agentMemberId !== reply.senderMemberId
          || sourceExecution.status !== "succeeded"
          || sourceExecution.threadId === null
          || sourceExecution.codexTurnId === null
        ) {
          throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
        }
        const triggerMessage = await lockRoomMessage(
          transaction,
          input.roomId,
          input.companyId,
          sourceExecution.sourceMessageId,
        );
        const cascadeId = randomUUID();
        await transaction.execute(sql`
          insert into agent_room_cascades (
            cascade_id, room_id, company_id, source_message_id, status,
            created_at_ms, completed_at_ms
          ) values (
            ${cascadeId}, ${input.roomId}, ${input.companyId},
            ${triggerMessage.messageId}, 'active', ${input.nowMs}, null
          )
        `);
        const executionId = await createAgentRoomExecution(transaction, {
          message: triggerMessage,
          cascadeId,
          plan: {
            agentMemberId: sourceExecution.agentMemberId,
            trigger: sourceExecution.trigger,
            triggerPolicy: sourceExecution.triggerPolicy,
            threadId: sourceExecution.threadId,
            fromSequence: sourceExecution.fromSequence,
            throughSequence: sourceExecution.throughSequence,
          },
          nowMs: input.nowMs,
          idempotencyKey: `room-agent-regenerate:${input.idempotencyKey}`,
          sourceExecutionId: sourceExecution.executionId,
        });
        if (executionId === null) {
          throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
        }
        const execution = await lockExecution(transaction, executionId);
        if (execution?.turnMessageId === null || execution?.turnMessageId === undefined) {
          throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
        }
        const message = await lockRoomMessage(
          transaction,
          input.roomId,
          input.companyId,
          execution.turnMessageId,
        );
        if (message.versionGroupId === null || message.versionNumber === null) {
          throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
        }
        const eventSequence = await allocateRoomMessageEventSequence(transaction, input);
        const selections = rowsFromResult<{ revision: DatabaseNumber }>(await transaction.execute(sql`
          select revision
          from room_agent_reply_selections
          where version_group_id = ${message.versionGroupId}
            and member_id = ${input.requestedByMemberId}
          limit 2
          for update
        `));
        const selectionRevision = (selections[0]
          ? positiveNumber(selections[0].revision)
          : 0) + 1;
        await transaction.execute(sql`
          insert into room_agent_reply_selections (
            version_group_id, member_id, selected_message_id, revision,
            event_sequence, created_at_ms, updated_at_ms
          ) values (
            ${message.versionGroupId}, ${input.requestedByMemberId}, ${message.messageId},
            ${selectionRevision}, ${eventSequence}, ${input.nowMs}, ${input.nowMs}
          )
          on conflict (version_group_id, member_id)
          do update set
            selected_message_id = excluded.selected_message_id,
            revision = excluded.revision,
            event_sequence = excluded.event_sequence,
            updated_at_ms = excluded.updated_at_ms
        `);
        await transaction.execute(sql`
          insert into room_message_mutation_receipts (
            idempotency_key, room_id, member_id, operation, fingerprint,
            result_json, created_at_ms
          ) values (
            ${input.idempotencyKey}, ${input.roomId}, ${input.requestedByMemberId},
            'regenerate', ${fingerprint},
            ${JSON.stringify({
              execution_id: executionId,
              message_id: message.messageId,
              version_group_id: message.versionGroupId,
              version_number: message.versionNumber,
            })}::jsonb,
            ${input.nowMs}
          )
        `);
        return {
          executionId,
          versionGroupId: message.versionGroupId,
          versionNumber: message.versionNumber,
          message,
        };
      });
      const [message] = await hydrateMessageProjections(
        this.db,
        [result.message],
        input.requestedByMemberId,
      );
      if (!message) throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
      return { ...result, message };
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(ROOM_MESSAGE_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

  async list(input: {
    roomId: string;
    companyId: string;
    requestedByMemberId: string;
    beforeSequence: number | null;
    limit: number;
  }): Promise<readonly PersistedRoomMessage[]> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
    }
    try {
      await requireActiveMembership(this.db, input.roomId, input.companyId, input.requestedByMemberId);
      const before = input.beforeSequence;
      const beforeClause = before === null ? sql.empty() : sql`and sequence < ${before}`;
      const messages = rowsFromResult<MessageRow>(await this.db.execute(sql`
        select message_id, room_id, company_id, sequence, event_sequence, revision, sender_member_id,
          sender_type, client_message_id, markdown, plain_text,
          reply_to_message_ids_json, references_json, image_attachments_json, thread_id, trigger_message_id,
          source_execution_id, source_cascade_id, version_group_id, version_number,
          edited_at_ms, deleted_at_ms, created_at_ms, updated_at_ms
        from room_messages
        where room_id = ${input.roomId}
          and company_id = ${input.companyId}
          ${beforeClause}
        order by sequence desc
        limit ${input.limit}
      `)).map(messageFromRow).reverse();
      return Object.freeze(await hydrateMessageProjections(
        this.db,
        messages,
        input.requestedByMemberId,
      ));
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(ROOM_MESSAGE_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

  async search(input: {
    companyId: string;
    requestedByMemberId: string;
    query: string;
    limit: number;
  }): Promise<readonly PersistedRoomMessage[]> {
    const query = input.query.trim();
    if (query.length === 0 || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
    }
    try {
      const messages = rowsFromResult<MessageRow>(await this.db.execute(sql`
        select message.message_id, message.room_id, message.company_id,
          message.sequence, message.event_sequence, message.revision,
          message.sender_member_id, message.sender_type,
          message.client_message_id, message.markdown, message.plain_text,
          message.reply_to_message_ids_json, message.references_json, message.image_attachments_json,
          message.thread_id, message.trigger_message_id, message.source_execution_id,
          message.source_cascade_id, message.version_group_id, message.version_number,
          message.edited_at_ms, message.deleted_at_ms, message.created_at_ms,
          message.updated_at_ms
        from room_messages message
        inner join room_memberships membership
          on membership.room_id = message.room_id
          and membership.company_id = message.company_id
          and membership.actor_id = ${input.requestedByMemberId}
          and membership.status = 'active'
        where message.company_id = ${input.companyId}
          and message.plain_text ilike ${`%${escapeLike(query)}%`} escape '\\'
        order by message.created_at_ms desc, message.sequence desc
        limit ${input.limit}
      `)).map(messageFromRow);
      return Object.freeze(await hydrateMessageProjections(
        this.db,
        messages,
        input.requestedByMemberId,
      ));
    } catch {
      throw new ApplicationError(ROOM_MESSAGE_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

  async context(input: {
    roomId: string;
    companyId: string;
    requestedByMemberId: string;
    messageId: string;
    limit: number;
  }): Promise<readonly PersistedRoomMessage[]> {
    await requireActiveMembership(this.db, input.roomId, input.companyId, input.requestedByMemberId);
    const target = rowsFromResult<{ sequence: DatabaseNumber }>(await this.db.execute(sql`
      select sequence from room_messages
      where room_id = ${input.roomId}
        and company_id = ${input.companyId}
        and message_id = ${input.messageId}
      limit 2
    `));
    if (target.length !== 1) throw new ApplicationError(ROOM_MESSAGE_NOT_FOUND_CODE, false);
    const sequence = positiveNumber(target[0]!.sequence);
    const radius = Math.max(0, Math.floor((input.limit - 1) / 2));
    const messages = rowsFromResult<MessageRow>(await this.db.execute(sql`
      select message_id, room_id, company_id, sequence, event_sequence, revision, sender_member_id,
        sender_type, client_message_id, markdown, plain_text,
        reply_to_message_ids_json, references_json, image_attachments_json, thread_id, trigger_message_id,
        source_execution_id, source_cascade_id, version_group_id, version_number,
        edited_at_ms, deleted_at_ms, created_at_ms, updated_at_ms
      from room_messages
      where room_id = ${input.roomId}
        and company_id = ${input.companyId}
        and sequence between ${Math.max(1, sequence - radius)} and ${sequence + radius}
      order by sequence asc
      limit ${input.limit}
    `)).map(messageFromRow);
    return Object.freeze(await hydrateMessageProjections(
      this.db,
      messages,
      input.requestedByMemberId,
    ));
  }

  async *watch(input: {
    roomId: string;
    companyId: string;
    requestedByMemberId: string;
    signal?: AbortSignal;
  }): AsyncGenerator<RoomMessageRealtimeEvent> {
    const afterRows = await this.db.transaction(async (transaction) => {
      await requireActiveMembership(transaction, input.roomId, input.companyId, input.requestedByMemberId);
      return rowsFromResult<{ event_sequence: DatabaseNumber }>(await transaction.execute(sql`
        select greatest(
          coalesce((
            select max(message.event_sequence)
            from room_messages message
            where message.room_id = ${input.roomId}
              and message.company_id = ${input.companyId}
          ), 0),
          coalesce((
            select max(selection.event_sequence)
            from room_agent_reply_selections selection
            inner join room_agent_reply_version_groups version_group
              on version_group.version_group_id = selection.version_group_id
            where version_group.room_id = ${input.roomId}
              and version_group.company_id = ${input.companyId}
              and selection.member_id = ${input.requestedByMemberId}
          ), 0)
        ) as event_sequence
      `));
    });
    let after = nonNegativeNumber(afterRows[0]?.event_sequence ?? 0);
    while (!input.signal?.aborted) {
      const messageRows = rowsFromResult<MessageRow>(await this.db.execute(sql`
        select message_id, room_id, company_id, sequence, event_sequence, revision, sender_member_id,
          sender_type, client_message_id, markdown, plain_text,
          reply_to_message_ids_json, references_json, image_attachments_json, thread_id, trigger_message_id,
          source_execution_id, source_cascade_id, version_group_id, version_number,
          edited_at_ms, deleted_at_ms, created_at_ms, updated_at_ms
        from room_messages
        where room_id = ${input.roomId}
          and company_id = ${input.companyId}
          and event_sequence > ${after}
        order by event_sequence asc
        limit 100
      `));
      const selectionRows = rowsFromResult<{
        event_sequence: DatabaseNumber;
        version_group_id: string;
        selected_message_id: string;
        revision: DatabaseNumber;
        updated_at_ms: DatabaseNumber;
      }>(await this.db.execute(sql`
        select selection.event_sequence, selection.version_group_id,
          selection.selected_message_id, selection.revision, selection.updated_at_ms
        from room_agent_reply_selections selection
        inner join room_agent_reply_version_groups version_group
          on version_group.version_group_id = selection.version_group_id
        where version_group.room_id = ${input.roomId}
          and version_group.company_id = ${input.companyId}
          and selection.member_id = ${input.requestedByMemberId}
          and selection.event_sequence > ${after}
        order by selection.event_sequence asc
        limit 100
      `));
      const events = [
        ...messageRows.map((row) => ({
          type: "message" as const,
          eventSequence: positiveNumber(row.event_sequence),
          row,
        })),
        ...selectionRows.map((row) => ({
          type: "selection" as const,
          eventSequence: positiveNumber(row.event_sequence),
          row,
        })),
      ].sort((left, right) => left.eventSequence - right.eventSequence);
      for (const event of events.slice(0, 100)) {
        after = event.eventSequence;
        if (event.type === "selection") {
          yield {
            type: "selection",
            eventSequence: event.eventSequence,
            versionGroupId: event.row.version_group_id,
            selectedMessageId: event.row.selected_message_id,
            revision: positiveNumber(event.row.revision),
            occurredAtMs: nonNegativeNumber(event.row.updated_at_ms),
          };
          continue;
        }
        const message = messageFromRow(event.row);
        const [projected] = await hydrateMessageProjections(
          this.db,
          [message],
          input.requestedByMemberId,
        );
        if (projected) {
          yield {
            type: "message",
            eventSequence: event.eventSequence,
            message: projected,
          };
        }
      }
      await delay(500, input.signal);
    }
  }

  async readLatestActivitySnapshot(executionId: string): Promise<AgentTurnSnapshot | null> {
    try {
      const rows = rowsFromResult<{ snapshot_json: unknown }>(await this.db.execute(sql`
        select snapshot_json
        from agent_room_activity_snapshots
        where execution_id = ${executionId}
        order by sequence desc
        limit 1
      `));
      return rows[0] ? agentTurnSnapshotSchema.parse(rows[0].snapshot_json) : null;
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(ROOM_MESSAGE_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

  async recordActivityProjection(input: {
    eventId: string;
    executionId: string;
    roomId: string;
    agentMemberId: string;
    occurredAtMs: number;
    snapshot: AgentTurnSnapshot;
    interaction: RoomMessageInteraction | null;
    resolvedInteractionId: string | null;
  }): Promise<{ accepted: true; eventId: string; duplicate: boolean; interactionId: string | null }> {
    const snapshot = agentTurnSnapshotSchema.parse(input.snapshot);
    try {
      return await this.db.transaction(async (transaction) => {
        const receipt = rowsFromResult<{ interaction_id: string | null }>(await transaction.execute(sql`
          select interaction_id
          from agent_room_activity_receipts
          where event_id = ${input.eventId}
          limit 1
        `));
        if (receipt[0]) {
          return {
            accepted: true,
            eventId: input.eventId,
            duplicate: true,
            interactionId: receipt[0].interaction_id,
          };
        }

        const execution = await lockExecution(transaction, input.executionId);
        if (
          execution === null
          || execution.roomId !== input.roomId
          || execution.agentMemberId !== input.agentMemberId
          || !["pending", "dispatched", "running"].includes(execution.status)
        ) {
          throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
        }

        let interactionId: string | null = null;
        if (input.interaction !== null) {
          interactionId = randomUUID();
          const messageId = await turnMessageIdForExecution(
            transaction,
            execution.executionId,
          );
          await transaction.execute(sql`
            insert into room_interactions (
              interaction_id, room_id, company_id, execution_id, agent_member_id,
              message_id, kind, label, status, responses_json,
              interaction_json, deadline_at_ms, created_at_ms, updated_at_ms, responded_at_ms
            ) values (
              ${interactionId}, ${execution.roomId}, ${execution.companyId},
              ${execution.executionId}, ${execution.agentMemberId}, ${messageId},
              ${input.interaction.kind}, ${input.interaction.kind === "delegation_check" ? input.interaction.label : ""}, 'pending',
              ${JSON.stringify(input.interaction.kind === "delegation_check" ? input.interaction.responses : [])}::jsonb,
              ${JSON.stringify({ ...input.interaction, id: interactionId })}::jsonb,
              ${input.interaction.kind === "request_user_input" ? input.interaction.deadline_at_ms : null},
              ${input.occurredAtMs}, ${input.occurredAtMs}, null
            )
          `);
          await touchTurnMessage(transaction, execution, input.occurredAtMs);
        }
        if (input.resolvedInteractionId !== null) {
          await transaction.execute(sql`
            update room_interactions set resolved_at_ms = coalesce(resolved_at_ms, ${input.occurredAtMs}),
              updated_at_ms = greatest(updated_at_ms, ${input.occurredAtMs})
            where interaction_id = ${input.resolvedInteractionId}
              and execution_id = ${input.executionId} and kind = 'request_user_input'
          `);
        }

        const sequenceRows = rowsFromResult<{ sequence: DatabaseNumber }>(await transaction.execute(sql`
          select coalesce(max(sequence), 0) + 1 as sequence
          from agent_room_activity_snapshots
          where execution_id = ${input.executionId}
        `));
        const sequence = positiveNumber(sequenceRows[0]?.sequence ?? 1);
        const publicEvent = {
          schema_version: 2 as const,
          event_id: `activity:${input.eventId}`,
          type: "agent_turn.snapshot" as const,
          source: "backend" as const,
          scope: {
            type: "room" as const,
            room_id: execution.roomId,
            agent_member_id: execution.agentMemberId,
            execution_id: execution.executionId,
          },
          turn_id: snapshot.turn_id,
          occurred_at_ms: input.occurredAtMs,
          snapshot,
        };
        await transaction.execute(sql`
          insert into agent_room_activity_snapshots (
            execution_id, sequence, event_id, snapshot_json, occurred_at_ms
          ) values (
            ${input.executionId}, ${sequence}, ${publicEvent.event_id},
            ${JSON.stringify(snapshot)}::jsonb, ${input.occurredAtMs}
          )
        `);
        await transaction.execute(sql`
          insert into agent_room_activity_receipts (
            event_id, execution_id, interaction_id, occurred_at_ms, created_at_ms
          ) values (
            ${input.eventId}, ${input.executionId}, ${interactionId},
            ${input.occurredAtMs}, ${Date.now()}
          )
        `);
        return {
          accepted: true,
          eventId: input.eventId,
          duplicate: false,
          interactionId,
        };
      });
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(ROOM_MESSAGE_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

  async *watchActivity(input: {
    roomId: string;
    companyId: string;
    executionId: string;
    requestedByMemberId: string;
    signal?: AbortSignal;
  }): AsyncGenerator<AgentTurnEvent> {
    const baseline = await this.db.transaction(async (transaction) => {
      await requireActiveMembership(
        transaction,
        input.roomId,
        input.companyId,
        input.requestedByMemberId,
      );
      const execution = await lockExecution(transaction, input.executionId);
      if (
        execution === null
        || execution.roomId !== input.roomId
        || execution.companyId !== input.companyId
      ) {
        throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
      }
      const rows = rowsFromResult<{
        sequence: DatabaseNumber;
        event_id: string;
        snapshot_json: unknown;
        occurred_at_ms: DatabaseNumber;
      }>(await transaction.execute(sql`
        select sequence, event_id, snapshot_json, occurred_at_ms
        from agent_room_activity_snapshots
        where execution_id = ${input.executionId}
        order by sequence desc
        limit 1
      `));
      return { execution, row: rows[0] ?? null };
    });
    let after = baseline.row === null ? 0 : positiveNumber(baseline.row.sequence);
    yield activitySnapshotEvent(
      baseline.execution,
      baseline.row?.event_id ?? `execution:${input.executionId}:snapshot`,
      baseline.row === null
        ? executionActivitySnapshot(baseline.execution)
        : agentTurnSnapshotSchema.parse(baseline.row.snapshot_json),
      baseline.row === null
        ? baseline.execution.startedAtMs ?? baseline.execution.completedAtMs ?? 0
        : nonNegativeNumber(baseline.row.occurred_at_ms),
    );

    while (!input.signal?.aborted) {
      const rows = rowsFromResult<{
        sequence: DatabaseNumber;
        event_id: string;
        snapshot_json: unknown;
        occurred_at_ms: DatabaseNumber;
      }>(await this.db.execute(sql`
        select sequence, event_id, snapshot_json, occurred_at_ms
        from agent_room_activity_snapshots
        where execution_id = ${input.executionId}
          and sequence > ${after}
        order by sequence asc
        limit 100
      `));
      for (const row of rows) {
        after = positiveNumber(row.sequence);
        yield activitySnapshotEvent(
          baseline.execution,
          row.event_id,
          agentTurnSnapshotSchema.parse(row.snapshot_json),
          nonNegativeNumber(row.occurred_at_ms),
        );
      }
      await delay(250, input.signal);
    }
  }

  async persistInteractionResponse(input: {
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
  }> {
    try {
      const result = await this.db.transaction(async (transaction) => {
        await requireActiveMembership(
          transaction,
          input.roomId,
          input.companyId,
          input.responderMemberId,
        );
        const interactions = rowsFromResult<InteractionRow>(await transaction.execute(sql`
          select interaction_id, room_id, company_id, execution_id,
            agent_member_id, message_id, kind, label, status, responses_json,
            interaction_json, deadline_at_ms, created_at_ms, updated_at_ms, responded_at_ms
          from room_interactions
          where interaction_id = ${input.interactionId}
          limit 2
          for update
        `));
        const interaction = interactions[0];
        if (
          interactions.length !== 1
          || !interaction
          || interaction.room_id !== input.roomId
          || interaction.company_id !== input.companyId
          || interaction.message_id !== input.messageId
        ) {
          throw new ApplicationError(ROOM_MESSAGE_NOT_FOUND_CODE, false);
        }

        const idempotencyKey = input.clientResponseId
          ? `interaction:${input.interactionId}:client:${input.clientResponseId}`
          : `interaction:${input.interactionId}:responder:${input.responderMemberId}`;
        const existing = rowsFromResult<{
          persisted_response_id: string;
          responder_member_id: string;
          response: string;
          response_json: unknown;
          responded_at_ms: DatabaseNumber;
        }>(await transaction.execute(sql`
          select persisted_response_id, responder_member_id, response, response_json, responded_at_ms
          from room_interaction_responses
          where idempotency_key = ${idempotencyKey}
          limit 2
        `));
        if (existing[0]) {
          if (
            existing.length !== 1
            || existing[0].responder_member_id !== input.responderMemberId
            || existing[0].response !== (typeof input.response === "string" ? input.response : "answer")
            || (typeof input.response !== "string" && !isDeepStrictEqual(existing[0].response_json, input.response))
          ) {
            throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
          }
          return {
            interaction,
            dispatch: interactionResponseDispatch(
              interaction,
              existing[0].persisted_response_id,
              idempotencyKey,
              input.responderMemberId,
              input.response,
              nonNegativeNumber(existing[0].responded_at_ms),
            ),
          };
        }
        if (interaction.status !== "pending") {
          throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
        }
        const execution = await lockExecution(transaction, interaction.execution_id);
        if (
          execution === null
          || !["pending", "dispatched", "running"].includes(execution.status)
        ) {
          throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
        }
        const persistedResponseId = randomUUID();
        const responseKind = typeof input.response === "string" ? input.response : "answer";
        const completedInteraction = interaction.kind === "request_user_input"
          ? completedRoomQuestionInteraction(interaction, input.response, input.nowMs)
          : interaction.interaction_json;
        await transaction.execute(sql`
          insert into room_interaction_responses (
            persisted_response_id, interaction_id, idempotency_key,
            client_response_id, responder_member_id, response, response_json, delivery_status,
            runtime_duplicate, responded_at_ms, delivered_at_ms
          ) values (
            ${persistedResponseId}, ${input.interactionId}, ${idempotencyKey},
            ${input.clientResponseId ?? null}, ${input.responderMemberId},
            ${responseKind}, ${typeof input.response === "string" ? null : JSON.stringify(input.response)}::jsonb,
            'pending', null, ${input.nowMs}, null
          )
        `);
        await transaction.execute(sql`
          insert into outbox_events (
            event_id, event_type, schema_version, aggregate_type, aggregate_id,
            payload_json, occurred_at_ms, dispatched_at_ms
          ) values (
            ${`agent-room-interaction-response:${persistedResponseId}`},
            'execution.agent_room_interaction_response_requested.v1', 1,
            'agent_room_interaction_response', ${persistedResponseId},
            ${JSON.stringify({
              company_id: input.companyId,
              persisted_response_id: persistedResponseId,
              requested_at_ms: input.nowMs,
            })}::jsonb,
            ${input.nowMs}, null
          )
          on conflict (event_id) do nothing
        `);
        await transaction.execute(sql`
          update room_interactions
          set status = ${typeof input.response === "string" ? (input.response === "approve" ? "approved" : "rejected") : "completed"},
            interaction_json = ${completedInteraction === null ? null : JSON.stringify(completedInteraction)}::jsonb,
            deadline_at_ms = null,
            responded_at_ms = ${input.nowMs}, updated_at_ms = ${input.nowMs}
          where interaction_id = ${input.interactionId}
        `);
        await touchTurnMessage(transaction, execution, input.nowMs);
        return {
          interaction: {
            ...interaction,
            status: typeof input.response === "string" ? (input.response === "approve" ? "approved" : "rejected") : "completed",
            interaction_json: completedInteraction,
            deadline_at_ms: null,
            updated_at_ms: input.nowMs,
            responded_at_ms: input.nowMs,
          },
          dispatch: interactionResponseDispatch(
            interaction,
            persistedResponseId,
            idempotencyKey,
            input.responderMemberId,
            input.response,
            input.nowMs,
          ),
        };
      });
      const messages = await this.context({
        roomId: input.roomId,
        companyId: input.companyId,
        requestedByMemberId: input.responderMemberId,
        messageId: input.messageId,
        limit: 1,
      });
      const message = messages.find((candidate) => candidate.messageId === input.messageId);
      if (!message) throw new ApplicationError(ROOM_MESSAGE_NOT_FOUND_CODE, false);
      return { dispatch: result.dispatch, message };
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(ROOM_MESSAGE_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

  async snoozeQuestionInteraction(input: {
    roomId: string;
    companyId: string;
    messageId: string;
    interactionId: string;
    memberId: string;
    nowMs: number;
  }): Promise<number> {
    const deadlineAtMs = input.nowMs + 90_000;
    return this.db.transaction(async (transaction) => {
      await requireActiveMembership(transaction, input.roomId, input.companyId, input.memberId);
      const updated = rowsFromResult<{ interaction_id: string }>(await transaction.execute(sql`
        update room_interactions set deadline_at_ms = ${deadlineAtMs}, updated_at_ms = ${input.nowMs},
          interaction_json = jsonb_set(interaction_json, '{deadline_at_ms}', to_jsonb(${deadlineAtMs}::bigint), true)
        where interaction_id = ${input.interactionId} and room_id = ${input.roomId}
          and company_id = ${input.companyId} and message_id = ${input.messageId}
          and kind = 'request_user_input' and status = 'pending'
        returning interaction_id
      `));
      if (updated.length !== 1) throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
      return deadlineAtMs;
    });
  }

  async claimSecretInteractionResponse(input: {
    roomId: string;
    companyId: string;
    messageId: string;
    interactionId: string;
    responderMemberId: string;
    response: import("@fields/contracts/public/room").RoomInteractionRespondInput["response"];
    nowMs: number;
  }): Promise<{ claimToken: string; dispatch: AgentRoomInteractionResponseDispatch } | null> {
    if (typeof input.response === "string") return null;
    return this.db.transaction(async (transaction) => {
      await requireActiveMembership(transaction, input.roomId, input.companyId, input.responderMemberId);
      const rows = rowsFromResult<InteractionRow>(await transaction.execute(sql`
        select interaction_id, room_id, company_id, execution_id, agent_member_id,
          message_id, kind, label, status, responses_json, interaction_json,
          deadline_at_ms, created_at_ms, updated_at_ms, responded_at_ms
        from room_interactions
        where interaction_id = ${input.interactionId}
        limit 2 for update
      `));
      const interaction = rows[0];
      if (!interaction || rows.length !== 1 || interaction.room_id !== input.roomId
        || interaction.company_id !== input.companyId || interaction.message_id !== input.messageId) {
        throw new ApplicationError(ROOM_MESSAGE_NOT_FOUND_CODE, false);
      }
      if (interaction.kind !== "request_user_input") return null;
      const projected = roomQuestionInteractionSchema.parse(interaction.interaction_json);
      if (!projected.questions.some((question) => question.secret)) return null;
      completedRoomQuestionInteraction(interaction, input.response, input.nowMs, true);
      if (interaction.status !== "pending") throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
      const execution = await lockExecution(transaction, interaction.execution_id);
      if (!execution || !["pending", "dispatched", "running"].includes(execution.status)) {
        throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
      }
      const claimToken = randomUUID();
      await transaction.execute(sql`
        update room_interactions
        set status = 'responding', claim_token = ${claimToken}, claimed_at_ms = ${input.nowMs},
          resolved_at_ms = null, updated_at_ms = ${input.nowMs}
        where interaction_id = ${input.interactionId} and status = 'pending'
      `);
      return {
        claimToken,
        dispatch: interactionResponseDispatch(
          interaction,
          `secret:${claimToken}`,
          `secret:${claimToken}`,
          input.responderMemberId,
          input.response,
          input.nowMs,
        ),
      };
    });
  }

  async completeSecretInteractionResponse(input: {
    claimToken: string;
    dispatch: AgentRoomInteractionResponseDispatch;
    delivered: boolean;
    nowMs: number;
  }): Promise<PersistedRoomMessage | null> {
    const result = await this.db.transaction(async (transaction) => {
      const rows = rowsFromResult<InteractionRow>(await transaction.execute(sql`
        select interaction_id, room_id, company_id, execution_id, agent_member_id,
          message_id, kind, label, status, responses_json, interaction_json,
          deadline_at_ms, created_at_ms, updated_at_ms, responded_at_ms
        from room_interactions
        where interaction_id = ${input.dispatch.interaction_id} and claim_token = ${input.claimToken}
        limit 2 for update
      `));
      const interaction = rows[0];
      if (!interaction || rows.length !== 1 || interaction.status !== "responding") return null;
      if (!input.delivered) {
        await transaction.execute(sql`
          update room_interactions set status = 'pending', claim_token = null, claimed_at_ms = null,
            updated_at_ms = ${input.nowMs}
          where interaction_id = ${interaction.interaction_id} and claim_token = ${input.claimToken}
        `);
        return null;
      }
      const completed = completedRoomQuestionInteraction(interaction, input.dispatch.response, input.nowMs, true);
      await transaction.execute(sql`
        update room_interactions set status = 'completed', interaction_json = ${JSON.stringify(completed)}::jsonb,
          deadline_at_ms = null, claim_token = null, claimed_at_ms = null,
          responded_at_ms = ${input.nowMs}, updated_at_ms = ${input.nowMs}
        where interaction_id = ${interaction.interaction_id} and claim_token = ${input.claimToken}
      `);
      const execution = await lockExecution(transaction, interaction.execution_id);
      if (execution) await touchTurnMessage(transaction, execution, input.nowMs);
      return interaction;
    });
    if (!result || !input.delivered) return null;
    const messages = await this.context({
      roomId: result.room_id,
      companyId: result.company_id,
      requestedByMemberId: input.dispatch.responder_member_id,
      messageId: result.message_id,
      limit: 1,
    });
    return messages.find((message) => message.messageId === result.message_id) ?? null;
  }

  async markInteractionResponseDelivered(
    dispatch: AgentRoomInteractionResponseDispatch,
    accepted: AgentRoomInteractionResponseAccepted,
    nowMs: number,
  ): Promise<void> {
    if (
      accepted.persisted_response_id !== dispatch.persisted_response_id
      || accepted.idempotency_key !== dispatch.idempotency_key
    ) {
      throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
    }
    const rows = rowsFromResult<{ persisted_response_id: string }>(await this.db.execute(sql`
      update room_interaction_responses
      set delivery_status = 'delivered', runtime_duplicate = ${accepted.duplicate},
        delivered_at_ms = coalesce(delivered_at_ms, ${nowMs})
      where persisted_response_id = ${dispatch.persisted_response_id}
        and idempotency_key = ${dispatch.idempotency_key}
      returning persisted_response_id
    `));
    if (rows.length !== 1) throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
  }

  async readPendingInteractionResponse(persistedResponseId: string): Promise<{
    companyId: string;
    dispatch: AgentRoomInteractionResponseDispatch;
  } | null> {
    const rows = rowsFromResult<{
      company_id: string;
      interaction_id: string;
      execution_id: string;
      room_id: string;
      agent_member_id: string;
      message_id: string;
      persisted_response_id: string;
      idempotency_key: string;
      responder_member_id: string;
      response: string;
      response_json: unknown;
      responded_at_ms: DatabaseNumber;
      delivery_status: string;
    }>(await this.db.execute(sql`
      select interaction.company_id, interaction.interaction_id,
        interaction.execution_id, interaction.room_id,
        interaction.agent_member_id, interaction.message_id,
        response.persisted_response_id, response.idempotency_key,
        response.responder_member_id, response.response, response.response_json,
        response.responded_at_ms, response.delivery_status
      from room_interaction_responses response
      join room_interactions interaction
        on interaction.interaction_id = response.interaction_id
      where response.persisted_response_id = ${persistedResponseId}
      limit 2
    `));
    if (rows.length !== 1) return null;
    const row = rows[0]!;
    if (row.delivery_status === "delivered") return null;
    if (row.delivery_status !== "pending" || !["approve", "reject", "answer"].includes(row.response)) {
      throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
    }
    return {
      companyId: row.company_id,
      dispatch: {
        persisted_response_id: row.persisted_response_id,
        idempotency_key: row.idempotency_key,
        execution_id: row.execution_id,
        room_id: row.room_id,
        agent_member_id: row.agent_member_id,
        message_id: row.message_id,
        interaction_id: row.interaction_id,
        responder_member_id: row.responder_member_id,
        response: row.response === "answer"
          ? roomQuestionResponse(row.response_json)
          : row.response as "approve" | "reject",
        responded_at_ms: nonNegativeNumber(row.responded_at_ms),
      },
    };
  }

  async readExecution(executionId: string): Promise<AgentRoomExecution | null> {
    try {
      const rows = rowsFromResult<ExecutionRow>(await this.db.execute(sql`
        select execution_id, room_id, company_id, agent_member_id, cascade_id,
          source_message_id, source_execution_id, codex_turn_id, turn_message_id,
          idempotency_key, trigger, trigger_policy, status,
          from_sequence, through_sequence, thread_id, attempt,
          published_message_count, started_at_ms, completed_at_ms,
          last_error_code, last_error_retryable
        from agent_room_executions
        where execution_id = ${executionId}
        limit 2
      `));
      if (rows.length > 1) throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
      return rows[0] ? executionFromRow(rows[0]) : null;
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(ROOM_MESSAGE_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

  async readExecutionMessages(executionId: string): Promise<readonly PersistedRoomMessage[]> {
    try {
      return Object.freeze(rowsFromResult<MessageRow>(await this.db.execute(sql`
        select message.message_id, message.room_id, message.company_id,
          message.sequence, message.event_sequence, message.revision,
          message.sender_member_id, message.sender_type,
          message.client_message_id, message.markdown, message.plain_text,
          message.reply_to_message_ids_json, message.references_json, message.image_attachments_json,
          message.thread_id, message.trigger_message_id, message.source_execution_id,
          message.source_cascade_id, message.version_group_id, message.version_number,
          message.edited_at_ms, message.deleted_at_ms, message.created_at_ms,
          message.updated_at_ms
        from agent_room_execution_messages input
        inner join room_messages message on message.message_id = input.message_id
        where input.execution_id = ${executionId}
        order by input.sequence asc
      `)).map(messageFromRow));
    } catch {
      throw new ApplicationError(ROOM_MESSAGE_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

  async snapshotExecutionCompanyFileInputs(
    executionId: string,
    inputs: readonly AgentRoomCompanyFileSnapshot[],
  ): Promise<AgentRoomCompanyFileSnapshot[]> {
    const parsed = agentRoomCompanyFileSnapshotSchema.array().parse(inputs);
    try {
      await this.db.execute(sql`
        update agent_room_executions
        set company_file_inputs_json = ${JSON.stringify(parsed)}::jsonb
        where execution_id = ${executionId}
          and company_file_inputs_json is null
      `);
      const rows = rowsFromResult<{ company_file_inputs_json: unknown }>(await this.db.execute(sql`
        select company_file_inputs_json
        from agent_room_executions
        where execution_id = ${executionId}
        limit 2
      `));
      if (rows.length !== 1 || rows[0]!.company_file_inputs_json === null) {
        throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
      }
      return agentRoomCompanyFileSnapshotSchema.array().parse(
        rows[0]!.company_file_inputs_json,
      );
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(ROOM_MESSAGE_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

  async readExecutionDispatch(executionId: string): Promise<AgentRoomExecutionDispatch | null> {
    try {
      const execution = await this.readExecution(executionId);
      if (execution === null) return null;
      const state = await readAgentState(this.db, execution.roomId, execution.agentMemberId);
      if (state === null || state.companyId !== execution.companyId) {
        throw new ApplicationError(AGENT_ROOM_STATE_INVALID_CODE, false);
      }
      const messages = rowsFromResult<DispatchMessageRow>(await this.db.execute(sql`
        select message.message_id, message.sequence, message.created_at_ms,
          message.sender_member_id, message.sender_type, message.markdown,
          message.plain_text, message.reply_to_message_ids_json, message.references_json,
          message.image_attachments_json,
          actor.display_name as sender_display_name,
          actor.mark as sender_mark,
          null::varchar as sender_avatar_resource_id
        from agent_room_execution_messages input
        inner join room_messages message on message.message_id = input.message_id
        left join actors actor
          on actor.company_id = message.company_id
          and actor.id = message.sender_member_id
        where input.execution_id = ${executionId}
        order by input.sequence asc
      `));
      if (messages.length === 0) {
        throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
      }
      const source = messages.find((message) => message.message_id === execution.sourceMessageId);
      if (source === undefined) {
        throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
      }
      const metadata = rowsFromResult<{
        room_title: string;
        agent_display_name: string;
        agent_instructions: string;
      }>(await this.db.execute(sql`
        select room.name as room_title, actor.display_name as agent_display_name,
          coalesce(profile.instructions, '') as agent_instructions
        from rooms room
        inner join actors actor
          on actor.company_id = room.company_id
          and actor.id = ${execution.agentMemberId}
          and actor.type = 'agent'
          and actor.status = 'active'
        left join agent_builder_profiles profile
          on profile.company_id = actor.company_id
          and profile.agent_member_id = actor.id
        where room.id = ${execution.roomId}
          and room.company_id = ${execution.companyId}
          and room.status = 'active'
        limit 2
      `));
      if (metadata.length !== 1) {
        throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
      }
      const sourceExecution = execution.sourceExecutionId === null
        ? null
        : await this.readExecution(execution.sourceExecutionId);
      if (
        execution.sourceExecutionId !== null
        && (
          sourceExecution === null
          || sourceExecution.roomId !== execution.roomId
          || sourceExecution.agentMemberId !== execution.agentMemberId
          || sourceExecution.threadId === null
          || sourceExecution.codexTurnId === null
        )
      ) {
        throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
      }
      return {
        execution_id: execution.executionId,
        idempotency_key: execution.idempotencyKey,
        cascade_id: execution.cascadeId,
        company_id: execution.companyId,
        room_id: execution.roomId,
        agent_member_id: execution.agentMemberId,
        membership_version: state.membershipVersion,
        source_message_id: execution.sourceMessageId,
        source_message_sequence: positiveNumber(source.sequence),
        room_title: metadata[0]!.room_title,
        agent_display_name: metadata[0]!.agent_display_name,
        agent_instructions: metadata[0]!.agent_instructions,
        trigger: execution.trigger,
        trigger_policy: execution.triggerPolicy,
        thread: {
          room_id: execution.roomId,
          agent_member_id: execution.agentMemberId,
          codex_thread_id: state.threadId,
          state: state.membershipActive ? "active" : "retained",
          last_consumed_sequence: state.cursorSequence,
          membership_version: state.membershipVersion,
          updated_at_ms: state.updatedAtMs,
        },
        regeneration: sourceExecution
          ? {
            source_execution_id: sourceExecution.executionId,
            fork_parent_thread_id: sourceExecution.threadId!,
            fork_before_turn_id: sourceExecution.codexTurnId!,
          }
          : null,
        prompt_messages: messages.map(dispatchMessageFromRow),
        company_file_inputs: [],
      };
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(ROOM_MESSAGE_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

  async prepareExecutionDispatch(
    executionId: string,
    nowMs: number,
  ): Promise<"ready" | "blocked" | "terminal"> {
    try {
      return await this.db.transaction(async (transaction) => {
        const execution = await lockExecution(transaction, executionId);
        if (execution === null) {
          throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
        }
        if (["succeeded", "failed", "cancelled"].includes(execution.status)) {
          return "terminal";
        }
        if (execution.sourceExecutionId !== null) {
          const state = await lockAgentState(
            transaction,
            execution.roomId,
            execution.agentMemberId,
          );
          if (state === null || !state.membershipActive) {
            throw new ApplicationError(AGENT_ROOM_STATE_INVALID_CODE, false);
          }
          const rows = rowsFromResult<{ execution_id: string }>(await transaction.execute(sql`
            update agent_room_executions
            set status = 'running',
              started_at_ms = coalesce(started_at_ms, ${nowMs}),
              updated_at_ms = ${nowMs}
            where execution_id = ${execution.executionId}
              and status in ('pending', 'dispatched', 'running')
            returning execution_id
          `));
          if (rows.length !== 1) {
            throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, true);
          }
          return "ready";
        }
        const earlier = rowsFromResult<{ execution_id: string }>(await transaction.execute(sql`
          select execution_id
          from agent_room_executions
          where room_id = ${execution.roomId}
            and agent_member_id = ${execution.agentMemberId}
            and execution_id <> ${execution.executionId}
            and through_sequence < ${execution.throughSequence}
            and status in ('pending', 'dispatched', 'running')
          order by through_sequence asc
          limit 1
        `));
        if (earlier.length > 0) return "blocked";
        const state = await lockAgentState(
          transaction,
          execution.roomId,
          execution.agentMemberId,
        );
        if (state === null) {
          throw new ApplicationError(AGENT_ROOM_STATE_INVALID_CODE, false);
        }
        const fromSequence = Math.max(
          state.cursorSequence + 1,
          state.eligibleFromSequence,
        );
        if (fromSequence > execution.throughSequence) {
          await transaction.execute(sql`
            update agent_room_executions
            set status = 'cancelled', completed_at_ms = ${nowMs},
              last_error_code = null, last_error_retryable = null,
              updated_at_ms = ${nowMs}
            where execution_id = ${execution.executionId}
          `);
          return "terminal";
        }
        await transaction.execute(sql`
          delete from agent_room_execution_messages
          where execution_id = ${execution.executionId}
        `);
        await transaction.execute(sql`
          with recursive reply_chain as (
            select message_id, sequence, reply_to_message_ids_json,
              0 as depth, array[message_id]::varchar[] as path
            from room_messages
            where room_id = ${execution.roomId}
              and company_id = ${execution.companyId}
              and message_id = ${execution.sourceMessageId}

            union all

            select parent.message_id, parent.sequence,
              parent.reply_to_message_ids_json, child.depth + 1,
              child.path || parent.message_id
            from reply_chain child
            cross join lateral jsonb_array_elements_text(
              child.reply_to_message_ids_json
            ) reply(message_id)
            inner join room_messages parent
              on parent.room_id = ${execution.roomId}
              and parent.company_id = ${execution.companyId}
              and parent.message_id = reply.message_id
            where child.depth < 10
              and not parent.message_id = any(child.path)
          ),
          deduplicated as (
            select distinct on (message_id)
              message_id, sequence, depth
            from reply_chain
            order by message_id, depth asc
          ),
          selected as (
            select message_id, sequence
            from deduplicated
            order by depth asc, sequence desc
            limit 11
          )
          insert into agent_room_execution_messages (
            execution_id, message_id, sequence
          )
          select ${execution.executionId}, message_id, sequence
          from selected
          order by sequence asc
        `);
        const rows = rowsFromResult<{ execution_id: string }>(await transaction.execute(sql`
          update agent_room_executions
          set status = 'running', from_sequence = ${fromSequence},
            started_at_ms = coalesce(started_at_ms, ${nowMs}),
            updated_at_ms = ${nowMs}
          where execution_id = ${execution.executionId}
            and status in ('pending', 'dispatched', 'running')
          returning execution_id
        `));
        if (rows.length !== 1) {
          throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, true);
        }
        return "ready";
      });
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(ROOM_MESSAGE_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

  async recordExecutionDispatched(input: {
    executionId: string;
    nowMs: number;
  }): Promise<AgentRoomExecution> {
    return this.recordExecutionProgress({
      execution_id: input.executionId,
      status: "dispatched",
      codex_turn_id: null,
      occurred_at_ms: input.nowMs,
    });
  }

  async recordExecutionProgress(
    progress: AgentRoomExecutionProgress,
  ): Promise<AgentRoomExecution> {
    try {
      return await this.db.transaction(async (transaction) => {
        const current = await lockExecution(transaction, progress.execution_id);
        if (current === null) throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
        if (
          ["succeeded", "failed", "cancelled"].includes(current.status)
          || current.status === progress.status
        ) {
          return current;
        }
        const rows = rowsFromResult<ExecutionRow>(await transaction.execute(sql`
          update agent_room_executions
          set status = ${progress.status},
            codex_turn_id = coalesce(${progress.codex_turn_id}, codex_turn_id),
            started_at_ms = case
              when ${progress.status} in ('running', 'succeeded', 'failed', 'cancelled')
                then coalesce(started_at_ms, ${progress.occurred_at_ms})
              else started_at_ms
            end,
            updated_at_ms = ${progress.occurred_at_ms}
          where execution_id = ${progress.execution_id}
            and status not in ('succeeded', 'failed', 'cancelled')
          returning execution_id, room_id, company_id, agent_member_id,
            cascade_id, source_message_id, source_execution_id, codex_turn_id,
            turn_message_id, idempotency_key, trigger, trigger_policy,
            status, from_sequence, through_sequence, thread_id, attempt,
            published_message_count, started_at_ms, completed_at_ms,
            last_error_code, last_error_retryable
        `));
        if (rows.length !== 1) throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
        const execution = executionFromRow(rows[0]!);
        await touchTurnMessage(transaction, execution, progress.occurred_at_ms);
        return execution;
      });
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(ROOM_MESSAGE_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

  async completeExecution(
    completion: AgentRoomExecutionCompletion,
  ): Promise<AgentRoomExecution> {
    try {
      return await this.db.transaction(async (transaction) => {
        const execution = await lockExecution(transaction, completion.execution_id);
        if (
          execution === null
          || execution.idempotencyKey !== completion.idempotency_key
          || execution.cascadeId !== completion.cascade_id
          || execution.roomId !== completion.room_id
          || execution.agentMemberId !== completion.agent_member_id
          || execution.throughSequence !== completion.consumed_through_sequence
        ) {
          throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
        }
        const expectedPublishedCount = completion.final_answer_markdown === undefined ? 0 : 1;
        if (["succeeded", "failed", "cancelled"].includes(execution.status)) {
          if (
            execution.status !== completion.status
            || execution.publishedMessageCount !== expectedPublishedCount
            || (
              completion.codex_thread_id !== null
              && execution.sourceExecutionId === null
              && execution.threadId !== completion.codex_thread_id
            )
          ) {
            throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
          }
          return execution;
        }
        const state = await lockAgentState(
          transaction,
          execution.roomId,
          execution.agentMemberId,
        );
        if (state === null) {
          throw new ApplicationError(AGENT_ROOM_STATE_INVALID_CODE, false);
        }
        if (
          completion.status === "succeeded"
          && (
            completion.codex_thread_id === null
            || (
              execution.sourceExecutionId === null
              && (
                (state.threadId !== null && state.threadId !== completion.codex_thread_id)
                || (execution.threadId !== null && execution.threadId !== completion.codex_thread_id)
              )
            )
          )
        ) {
          throw new ApplicationError(AGENT_ROOM_STATE_INVALID_CODE, false);
        }
        if ((completion.status === "succeeded") !== (completion.error === null)) {
          throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
        }
        if (
          completion.codex_thread_id !== null
          && execution.sourceExecutionId === null
        ) {
          await transaction.execute(sql`
            update agent_room_states
            set thread_id = ${completion.codex_thread_id},
              updated_at_ms = ${completion.completed_at_ms}
            where room_id = ${execution.roomId}
              and agent_member_id = ${execution.agentMemberId}
          `);
        }
        const rows = rowsFromResult<ExecutionRow>(await transaction.execute(sql`
          update agent_room_executions
          set status = ${completion.status},
            thread_id = coalesce(${completion.codex_thread_id}, thread_id),
            codex_turn_id = coalesce(${completion.codex_turn_id}, codex_turn_id),
            published_message_count = ${expectedPublishedCount},
            last_error_code = ${completion.error?.code ?? null},
            last_error_retryable = ${completion.error?.retryable ?? null},
            updated_at_ms = ${completion.completed_at_ms},
            completed_at_ms = ${completion.completed_at_ms}
          where execution_id = ${completion.execution_id}
            and status in ('pending', 'dispatched', 'running')
          returning execution_id, room_id, company_id, agent_member_id,
            cascade_id, source_message_id, source_execution_id, codex_turn_id,
            turn_message_id, idempotency_key, trigger, trigger_policy,
            status, from_sequence, through_sequence, thread_id, attempt,
            published_message_count, started_at_ms, completed_at_ms,
            last_error_code, last_error_retryable
        `));
        if (rows.length !== 1) {
          throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
        }
        const completed = executionFromRow(rows[0]!);
        const turnMessage = await finalizeTurnMessage(transaction, completed, {
          markdown: completion.final_answer_markdown,
          threadId: completion.codex_thread_id,
          nowMs: completion.completed_at_ms,
        });
        if (
          completion.status === "succeeded"
          && execution.sourceExecutionId === null
        ) {
          await transaction.execute(sql`
            update agent_room_states
            set cursor_sequence = greatest(cursor_sequence, ${execution.throughSequence}),
              updated_at_ms = ${completion.completed_at_ms}
            where room_id = ${execution.roomId}
              and agent_member_id = ${execution.agentMemberId}
          `);
          if (completion.final_answer_markdown !== undefined) {
            const downstream = await planTriggeredExecutions(
              transaction,
              turnMessage,
              "updated",
            );
            for (const plan of downstream) {
              await createAgentRoomExecution(transaction, {
                message: turnMessage,
                cascadeId: execution.cascadeId,
                plan,
                nowMs: completion.completed_at_ms,
              });
            }
          }
        }
        const activeRows = rowsFromResult<{ count: DatabaseNumber }>(await transaction.execute(sql`
          select count(*) as count
          from agent_room_executions
          where cascade_id = ${execution.cascadeId}
            and status in ('pending', 'dispatched', 'running')
        `));
        if (nonNegativeNumber(activeRows[0]?.count ?? 0) === 0) {
          await transaction.execute(sql`
            update agent_room_cascades
            set status = ${completion.status === "failed" ? "failed" : "silent_completed"},
              completed_at_ms = ${completion.completed_at_ms}
            where cascade_id = ${execution.cascadeId}
              and status = 'active'
          `);
        }
        await projectRoomNotification(transaction, {
          eventId: `room.agent.terminal:${completed.executionId}:${completed.status}`,
          message: turnMessage,
          kind: "agent.terminal",
          status: completion.status === "succeeded" ? "completed" : completion.status === "cancelled" ? "interrupted" : "failed",
          excludeActorId: null,
          nowMs: completion.completed_at_ms,
        });
        return completed;
      });
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(ROOM_MESSAGE_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

  async recordExecutionStarted(input: {
    executionId: string;
    threadId: string;
    nowMs: number;
  }): Promise<AgentRoomExecution> {
    try {
      return await this.db.transaction(async (transaction) => {
        const execution = await lockExecution(transaction, input.executionId);
        if (execution === null) throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
        if (["succeeded", "failed", "cancelled"].includes(execution.status)) return execution;
        const state = await lockAgentState(transaction, execution.roomId, execution.agentMemberId);
        if (state === null) {
          throw new ApplicationError(AGENT_ROOM_STATE_INVALID_CODE, false);
        }
        if (state.threadId !== null && state.threadId !== input.threadId) {
          throw new ApplicationError(AGENT_ROOM_STATE_INVALID_CODE, false);
        }
        await transaction.execute(sql`
          update agent_room_states
          set thread_id = ${input.threadId}, updated_at_ms = ${input.nowMs}
          where room_id = ${execution.roomId}
            and agent_member_id = ${execution.agentMemberId}
        `);
        const rows = rowsFromResult<ExecutionRow>(await transaction.execute(sql`
          update agent_room_executions
          set status = 'running', thread_id = ${input.threadId},
            attempt = attempt + 1, updated_at_ms = ${input.nowMs},
            started_at_ms = coalesce(started_at_ms, ${input.nowMs})
          where execution_id = ${input.executionId}
            and status in ('pending', 'dispatched', 'running')
          returning execution_id, room_id, company_id, agent_member_id,
            cascade_id, source_message_id, source_execution_id, codex_turn_id,
            turn_message_id, idempotency_key, trigger, trigger_policy,
            status, from_sequence, through_sequence, thread_id, attempt,
            published_message_count, started_at_ms, completed_at_ms,
            last_error_code, last_error_retryable
        `));
        if (rows.length !== 1) throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
        const started = executionFromRow(rows[0]!);
        await touchTurnMessage(transaction, started, input.nowMs);
        return started;
      });
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(ROOM_MESSAGE_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

  async getTriggerPolicy(input: {
    roomId: string;
    companyId: string;
    agentMemberId: string;
    requestedByMemberId: string;
  }): Promise<AgentRoomState> {
    try {
      await requireActiveMembership(this.db, input.roomId, input.companyId, input.requestedByMemberId);
      const state = await readAgentState(this.db, input.roomId, input.agentMemberId);
      if (state === null || state.companyId !== input.companyId) {
        throw new ApplicationError(AGENT_ROOM_STATE_INVALID_CODE, false);
      }
      return state;
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(ROOM_MESSAGE_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

  async setTriggerPolicy(input: {
    roomId: string;
    companyId: string;
    agentMemberId: string;
    requestedByMemberId: string;
    policy: AgentRoomTriggerPolicy;
    expectedVersion?: number;
    nowMs: number;
  }): Promise<AgentRoomState> {
    if (!agentRoomTriggerPolicies.includes(input.policy)) {
      throw new ApplicationError(AGENT_ROOM_STATE_INVALID_CODE, false);
    }
    try {
      const rows = rowsFromResult<AgentStateRow>(await this.db.execute(sql`
        update agent_room_states state
        set trigger_policy = ${input.policy},
          trigger_policy_version = trigger_policy_version + 1,
          updated_at_ms = ${input.nowMs}
        from room_memberships requester
        where state.room_id = ${input.roomId}
          and state.company_id = ${input.companyId}
          and state.agent_member_id = ${input.agentMemberId}
          and requester.room_id = state.room_id
          and requester.company_id = state.company_id
          and requester.actor_id = ${input.requestedByMemberId}
          and requester.role = 'owner'
          and requester.status = 'active'
          and (
            ${input.expectedVersion ?? null}::bigint is null
            or state.trigger_policy_version = ${input.expectedVersion ?? null}
          )
        returning state.room_id, state.company_id, state.agent_member_id,
          state.trigger_policy, state.trigger_policy_version,
          state.thread_id, state.cursor_sequence,
          state.eligible_from_sequence, state.membership_active,
          state.membership_version, state.updated_at_ms
      `));
      if (rows.length !== 1) throw new ApplicationError(ROOM_MESSAGE_ACCESS_DENIED_CODE, false);
      return stateFromRow(rows[0]!);
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(ROOM_MESSAGE_PERSISTENCE_UNAVAILABLE_CODE, true);
    }
  }

  async *watchDesktopNotifications(input: { companyId: string; requestedByMemberId: string; signal?: AbortSignal }): AsyncGenerator<DesktopNotificationEvent> {
    let afterMessage = nonNegativeNumber(rowsFromResult<{ value: DatabaseNumber }>(await this.db.execute(sql`
      select coalesce(max(event_sequence), 0) as value from room_messages where company_id = ${input.companyId}
    `))[0]?.value ?? 0);
    let afterExecutionMs = Date.now();
    let afterExecutionId = "";
    while (!input.signal?.aborted) {
      const messages = rowsFromResult<{ event_sequence: DatabaseNumber; message_id: string; room_id: string; room_name: string; sender_name: string; plain_text: string; created_at_ms: DatabaseNumber }>(await this.db.execute(sql`
        select message.event_sequence, message.message_id, message.room_id, room.name as room_name,
          sender.display_name as sender_name, message.plain_text, message.created_at_ms
        from room_messages message
        inner join rooms room on room.id = message.room_id and room.company_id = message.company_id
        inner join room_memberships membership on membership.room_id = message.room_id
          and membership.company_id = message.company_id and membership.actor_id = ${input.requestedByMemberId} and membership.status = 'active'
        inner join actors sender on sender.id = message.sender_member_id and sender.company_id = message.company_id
        where message.company_id = ${input.companyId} and message.event_sequence > ${afterMessage}
          and message.revision = 1 and message.deleted_at_ms is null
          and message.sender_type = 'human' and message.sender_member_id <> ${input.requestedByMemberId}
        order by message.event_sequence asc limit 100
      `));
      for (const row of messages) {
        afterMessage = positiveNumber(row.event_sequence);
        yield { schema_version: 1, event_id: `desktop-room-message:${row.message_id}`, type: "room.message", occurred_at_ms: nonNegativeNumber(row.created_at_ms), room_id: row.room_id, room_name: row.room_name, message_id: row.message_id, sender_name: row.sender_name, preview: notificationPreview(row.plain_text) };
      }
      const executions = rowsFromResult<{ execution_id: string; room_id: string; room_name: string; status: string; updated_at_ms: DatabaseNumber; completed_at_ms: DatabaseNumber | null; message_id: string; plain_text: string | null }>(await this.db.execute(sql`
        select execution.execution_id, execution.room_id, room.name as room_name, execution.status,
          execution.updated_at_ms, execution.completed_at_ms,
          coalesce(turn_message.message_id, execution.source_message_id) as message_id, turn_message.plain_text
        from agent_room_executions execution
        inner join rooms room on room.id = execution.room_id and room.company_id = execution.company_id
        inner join room_memberships membership on membership.room_id = execution.room_id
          and membership.company_id = execution.company_id and membership.actor_id = ${input.requestedByMemberId} and membership.status = 'active'
        left join room_messages turn_message on turn_message.message_id = execution.turn_message_id
        where execution.company_id = ${input.companyId} and execution.status in ('succeeded', 'failed', 'cancelled')
          and (execution.updated_at_ms > ${afterExecutionMs} or (execution.updated_at_ms = ${afterExecutionMs} and execution.execution_id > ${afterExecutionId}))
        order by execution.updated_at_ms asc, execution.execution_id asc limit 100
      `));
      for (const row of executions) {
        afterExecutionMs = nonNegativeNumber(row.updated_at_ms); afterExecutionId = row.execution_id;
        yield { schema_version: 1, event_id: `desktop-room-agent:${row.execution_id}:${row.status}`, type: "agent.terminal", occurred_at_ms: nonNegativeNumber(row.completed_at_ms ?? row.updated_at_ms), status: row.status === "succeeded" ? "completed" : row.status === "cancelled" ? "interrupted" : "failed", target: { kind: "room", room_id: row.room_id, room_name: row.room_name, message_id: row.message_id }, preview: row.plain_text ? notificationPreview(row.plain_text) : null };
      }
      await delay(500, input.signal);
    }
  }
}

async function findIdempotentMessage(
  database: DatabaseExecutor,
  input: SendRoomMessageInput,
): Promise<PersistedRoomMessage | null> {
  const rows = rowsFromResult<MessageRow>(await database.execute(sql`
    select message_id, room_id, company_id, sequence, event_sequence, revision, sender_member_id,
      sender_type, client_message_id, markdown, plain_text,
      reply_to_message_ids_json, references_json, image_attachments_json, thread_id, trigger_message_id,
      source_execution_id, source_cascade_id, version_group_id, version_number,
      edited_at_ms, deleted_at_ms, created_at_ms, updated_at_ms
    from room_messages
    where room_id = ${input.roomId}
      and sender_member_id = ${input.senderMemberId}
      and client_message_id = ${input.clientMessageId}
    limit 2
  `));
  if (rows.length > 1) throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
  const existing = rows[0] ? messageFromRow(rows[0]) : null;
  if (
    existing !== null
    && (
      existing.companyId !== input.companyId
      || existing.senderType !== input.senderType
      || existing.markdown !== input.markdown
      || existing.plainText !== input.plainText
      || !isDeepStrictEqual(existing.replyToMessageIds, input.replyToMessageIds)
      || !isDeepStrictEqual(existing.references, input.references)
      || !isDeepStrictEqual(existing.imageAttachments, input.imageAttachments ?? [])
    )
  ) {
    throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
  }
  return existing;
}

async function requireActiveSenderMembership(
  database: DatabaseExecutor,
  input: SendRoomMessageInput,
): Promise<void> {
  const rows = rowsFromResult<{ actor_type: string }>(await database.execute(sql`
    select actor.type as actor_type
    from room_memberships membership
    inner join rooms room
      on room.id = membership.room_id
      and room.company_id = membership.company_id
    inner join actors actor
      on actor.id = membership.actor_id
      and actor.company_id = membership.company_id
    where membership.room_id = ${input.roomId}
      and membership.company_id = ${input.companyId}
      and membership.actor_id = ${input.senderMemberId}
      and membership.status = 'active'
      and room.status = 'active'
      and actor.status = 'active'
    limit 2
    for share
  `));
  if (rows.length === 1 && rows[0]!.actor_type === input.senderType) return;

  if (
    input.senderType === "agent"
    && input.sourceExecutionId
    && input.sourceCascadeId
  ) {
    const executionRows = rowsFromResult<{ execution_id: string }>(await database.execute(sql`
      select execution_id
      from agent_room_executions
      where execution_id = ${input.sourceExecutionId}
        and room_id = ${input.roomId}
        and company_id = ${input.companyId}
        and agent_member_id = ${input.senderMemberId}
        and cascade_id = ${input.sourceCascadeId}
        and status in ('pending', 'dispatched', 'running')
        and (
          thread_id is null
          or thread_id = ${input.threadId ?? null}
        )
      limit 2
      for share
    `));
    if (executionRows.length === 1) return;
  }
  throw new ApplicationError(ROOM_MESSAGE_ACCESS_DENIED_CODE, false);
}

async function requireActiveMembership(
  database: DatabaseExecutor,
  roomId: string,
  companyId: string,
  memberId: string,
): Promise<void> {
  const rows = rowsFromResult<{ actor_id: string }>(await database.execute(sql`
    select membership.actor_id
    from room_memberships membership
    inner join rooms room
      on room.id = membership.room_id
      and room.company_id = membership.company_id
    where membership.room_id = ${roomId}
      and membership.company_id = ${companyId}
      and membership.actor_id = ${memberId}
      and membership.status = 'active'
      and room.status = 'active'
    limit 2
  `));
  if (rows.length !== 1) throw new ApplicationError(ROOM_MESSAGE_ACCESS_DENIED_CODE, false);
}

type MessageMutationInput = {
  roomId: string;
  companyId: string;
  requestedByMemberId: string;
  messageId: string;
  idempotencyKey: string;
};

async function mutationReceiptMessage(
  database: DatabaseExecutor,
  input: MessageMutationInput,
  operation: "edit" | "soft_delete",
  fingerprint: string,
): Promise<PersistedRoomMessage | null> {
  await database.execute(sql`
    select pg_advisory_xact_lock(hashtextextended(${input.idempotencyKey}, 0))
  `);
  const receipts = rowsFromResult<{
    room_id: string;
    member_id: string;
    operation: string;
    fingerprint: string;
    result_json: unknown;
  }>(await database.execute(sql`
    select room_id, member_id, operation, fingerprint, result_json
    from room_message_mutation_receipts
    where idempotency_key = ${input.idempotencyKey}
    limit 2
  `));
  if (receipts.length === 0) return null;
  const receipt = receipts[0]!;
  const result = objectValue(receipt.result_json);
  if (
    receipts.length !== 1
    || receipt.room_id !== input.roomId
    || receipt.member_id !== input.requestedByMemberId
    || receipt.operation !== operation
    || receipt.fingerprint !== fingerprint
    || result?.message_id !== input.messageId
  ) {
    throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
  }
  return lockRoomMessage(database, input.roomId, input.companyId, input.messageId);
}

async function insertMutationReceipt(
  database: DatabaseExecutor,
  input: MessageMutationInput & { nowMs: number },
  operation: "edit" | "soft_delete",
  fingerprint: string,
  message: PersistedRoomMessage,
): Promise<void> {
  await database.execute(sql`
    insert into room_message_mutation_receipts (
      idempotency_key, room_id, member_id, operation, fingerprint,
      result_json, created_at_ms
    ) values (
      ${input.idempotencyKey}, ${input.roomId}, ${input.requestedByMemberId},
      ${operation}, ${fingerprint},
      ${JSON.stringify({
        message_id: message.messageId,
        revision: message.revision,
      })}::jsonb,
      ${input.nowMs}
    )
  `);
}

async function lockRoomMessage(
  database: DatabaseExecutor,
  roomId: string,
  companyId: string,
  messageId: string,
): Promise<PersistedRoomMessage> {
  const rows = rowsFromResult<MessageRow>(await database.execute(sql`
    select message_id, room_id, company_id, sequence, event_sequence, revision,
      sender_member_id, sender_type, client_message_id, markdown, plain_text,
      reply_to_message_ids_json, references_json, image_attachments_json, thread_id, trigger_message_id,
      source_execution_id, source_cascade_id, version_group_id, version_number,
      edited_at_ms, deleted_at_ms, created_at_ms, updated_at_ms
    from room_messages
    where message_id = ${messageId}
      and room_id = ${roomId}
      and company_id = ${companyId}
    limit 2
    for update
  `));
  if (rows.length !== 1) {
    throw new ApplicationError(ROOM_MESSAGE_NOT_FOUND_CODE, false);
  }
  return messageFromRow(rows[0]!);
}

function assertOwnedEditableHumanMessage(
  message: PersistedRoomMessage,
  requestedByMemberId: string,
): void {
  if (
    message.senderType !== "human"
    || message.senderMemberId !== requestedByMemberId
  ) {
    throw new ApplicationError(ROOM_MESSAGE_NOT_OWNED_CODE, false);
  }
  if (message.sourceExecutionId !== null) {
    throw new ApplicationError(ROOM_MESSAGE_NOT_EDITABLE_CODE, false);
  }
}

async function insertMessageRevision(
  database: DatabaseExecutor,
  input: {
    messageId: string;
    revision: number;
    editorMemberId: string;
    markdown: string;
    plainText: string;
    deleted: boolean;
    nowMs: number;
  },
): Promise<void> {
  await database.execute(sql`
    insert into room_message_revisions (
      message_id, revision, editor_member_id, markdown, plain_text,
      deleted, created_at_ms
    ) values (
      ${input.messageId}, ${input.revision}, ${input.editorMemberId},
      ${input.markdown}, ${input.plainText}, ${input.deleted}, ${input.nowMs}
    )
  `);
}

function mutationFingerprint(
  operation: string,
  payload: Record<string, unknown>,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ operation, ...payload }))
    .digest("hex");
}

async function validateReplyTargets(
  database: DatabaseExecutor,
  roomId: string,
  replyToMessageIds: readonly string[],
): Promise<void> {
  if (replyToMessageIds.length === 0) return;
  const rows = rowsFromResult<{ message_id: string }>(await database.execute(sql`
    select message_id from room_messages
    where room_id = ${roomId}
      and message_id in ${sql`(${sql.join(replyToMessageIds.map((id) => sql`${id}`), sql`, `)})`}
  `));
  if (rows.length !== new Set(replyToMessageIds).size) {
    throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
  }
}

async function replyThreadId(
  database: DatabaseExecutor,
  roomId: string,
  replyToMessageIds: readonly string[],
): Promise<string | null> {
  if (replyToMessageIds.length === 0) return null;
  const rows = rowsFromResult<{ thread_id: string | null }>(await database.execute(sql`
    select distinct thread_id
    from room_messages
    where room_id = ${roomId}
      and message_id in ${sql`(${sql.join(replyToMessageIds.map((id) => sql`${id}`), sql`, `)})`}
      and thread_id is not null
  `));
  return rows.length === 1 ? rows[0]!.thread_id : null;
}

async function selectedBranchThread(
  database: DatabaseExecutor,
  roomId: string,
  memberId: string,
  branchMessageId: string | null,
): Promise<{ threadId: string; agentMemberId: string } | null> {
  if (branchMessageId === null) return null;
  const rows = rowsFromResult<{
    thread_id: string | null;
    agent_member_id: string | null;
    active_message_id: string | null;
  }>(await database.execute(sql`
    select message.thread_id, version_group.agent_member_id,
      coalesce(
        selection.selected_message_id,
        (
          select candidate.message_id
          from room_messages candidate
          left join agent_room_executions candidate_execution
            on candidate_execution.execution_id = candidate.source_execution_id
          where candidate.version_group_id = message.version_group_id
          order by
            case when candidate_execution.status = 'succeeded' then 0 else 1 end,
            candidate.version_number desc
          limit 1
        )
      ) as active_message_id
    from room_messages message
    left join room_agent_reply_version_groups version_group
      on version_group.version_group_id = message.version_group_id
    left join room_agent_reply_selections selection
      on selection.version_group_id = message.version_group_id
      and selection.member_id = ${memberId}
    where message.room_id = ${roomId}
      and message.message_id = ${branchMessageId}
      and message.sender_type = 'agent'
      and message.deleted_at_ms is null
    limit 2
  `));
  if (
    rows.length !== 1
    || rows[0]!.thread_id === null
    || rows[0]!.agent_member_id === null
    || rows[0]!.active_message_id !== branchMessageId
  ) {
    throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
  }
  return {
    threadId: rows[0]!.thread_id,
    agentMemberId: rows[0]!.agent_member_id,
  };
}

async function allocateRoomMessageEventSequence(
  database: DatabaseExecutor,
  input: { roomId: string; companyId: string; nowMs: number },
): Promise<number> {
  const rows = rowsFromResult<{ event_sequence: DatabaseNumber }>(await database.execute(sql`
    update rooms
    set next_message_event_sequence = next_message_event_sequence + 1,
      updated_at_ms = greatest(updated_at_ms, ${input.nowMs})
    where id = ${input.roomId}
      and company_id = ${input.companyId}
      and status = 'active'
    returning next_message_event_sequence - 1 as event_sequence
  `));
  if (rows.length !== 1) throw new ApplicationError(ROOM_MESSAGE_NOT_FOUND_CODE, false);
  return positiveNumber(rows[0]!.event_sequence);
}

async function turnMessageIdForExecution(
  database: DatabaseExecutor,
  executionId: string,
): Promise<string> {
  const rows = rowsFromResult<{ message_id: string }>(await database.execute(sql`
    select turn_message_id as message_id
    from agent_room_executions
    where execution_id = ${executionId}
      and turn_message_id is not null
    limit 2
    for update
  `));
  if (rows.length !== 1) throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
  return rows[0]!.message_id;
}

async function touchTurnMessage(
  database: DatabaseExecutor,
  execution: AgentRoomExecution,
  nowMs: number,
): Promise<void> {
  const eventSequence = await allocateRoomMessageEventSequence(database, {
    roomId: execution.roomId,
    companyId: execution.companyId,
    nowMs,
  });
  const rows = rowsFromResult<{ message_id: string }>(await database.execute(sql`
    update room_messages
    set event_sequence = ${eventSequence},
      revision = revision + 1,
      updated_at_ms = greatest(updated_at_ms, ${nowMs})
    where message_id = ${execution.turnMessageId}
      and room_id = ${execution.roomId}
      and company_id = ${execution.companyId}
    returning message_id
  `));
  if (rows.length !== 1) throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
}

async function finalizeTurnMessage(
  database: DatabaseExecutor,
  execution: AgentRoomExecution,
  input: {
    markdown: string | undefined;
    threadId: string | null;
    nowMs: number;
  },
): Promise<PersistedRoomMessage> {
  const eventSequence = await allocateRoomMessageEventSequence(database, {
    roomId: execution.roomId,
    companyId: execution.companyId,
    nowMs: input.nowMs,
  });
  const markdown = input.markdown ?? "";
  const rows = rowsFromResult<MessageRow>(await database.execute(sql`
    update room_messages
    set markdown = ${markdown},
      plain_text = ${markdownToPlainText(markdown)},
      thread_id = coalesce(${input.threadId}, thread_id),
      event_sequence = ${eventSequence},
      revision = revision + 1,
      updated_at_ms = greatest(updated_at_ms, ${input.nowMs})
    where message_id = ${execution.turnMessageId}
      and room_id = ${execution.roomId}
      and company_id = ${execution.companyId}
    returning message_id, room_id, company_id, sequence, event_sequence, revision,
      sender_member_id, sender_type, client_message_id, markdown, plain_text,
      reply_to_message_ids_json, references_json, image_attachments_json, thread_id, trigger_message_id,
      source_execution_id, source_cascade_id, version_group_id, version_number,
      edited_at_ms, deleted_at_ms, created_at_ms, updated_at_ms
  `));
  if (rows.length !== 1) throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
  return messageFromRow(rows[0]!);
}

async function allocateRoomMessagePosition(
  database: DatabaseExecutor,
  input: { roomId: string; companyId: string; nowMs: number },
): Promise<{ sequence: number; eventSequence: number }> {
  const rows = rowsFromResult<{
    sequence: DatabaseNumber;
    event_sequence: DatabaseNumber;
  }>(await database.execute(sql`
    update rooms
    set next_message_sequence = next_message_sequence + 1,
      next_message_event_sequence = next_message_event_sequence + 1,
      updated_at_ms = greatest(updated_at_ms, ${input.nowMs})
    where id = ${input.roomId}
      and company_id = ${input.companyId}
      and status = 'active'
    returning next_message_sequence - 1 as sequence,
      next_message_event_sequence - 1 as event_sequence
  `));
  if (rows.length !== 1) throw new ApplicationError(ROOM_MESSAGE_NOT_FOUND_CODE, false);
  return {
    sequence: positiveNumber(rows[0]!.sequence),
    eventSequence: positiveNumber(rows[0]!.event_sequence),
  };
}

async function insertMessage(
  database: DatabaseExecutor,
  input: SendRoomMessageInput & {
    messageId: string;
    sequence: number;
    eventSequence: number;
  },
): Promise<PersistedRoomMessage> {
  const rows = rowsFromResult<MessageRow>(await database.execute(sql`
    insert into room_messages (
      message_id, room_id, company_id, sequence, event_sequence, revision, sender_member_id,
      sender_type, client_message_id, markdown, plain_text,
      reply_to_message_ids_json, references_json, image_attachments_json, thread_id, trigger_message_id,
      source_execution_id, source_cascade_id, version_group_id, version_number,
      edited_at_ms, deleted_at_ms, created_at_ms, updated_at_ms
    ) values (
      ${input.messageId}, ${input.roomId}, ${input.companyId}, ${input.sequence},
      ${input.eventSequence}, 1,
      ${input.senderMemberId}, ${input.senderType}, ${input.clientMessageId},
      ${input.markdown}, ${input.plainText},
      ${JSON.stringify(input.replyToMessageIds)}::jsonb,
      ${JSON.stringify(input.references)}::jsonb,
      ${JSON.stringify(input.imageAttachments ?? [])}::jsonb,
      ${input.threadId ?? null}, ${input.triggerMessageId ?? null},
      ${input.sourceExecutionId ?? null}, ${input.sourceCascadeId ?? null},
      ${input.versionGroupId ?? null}, ${input.versionNumber ?? null},
      null, null,
      ${input.nowMs}, ${input.nowMs}
    )
    returning message_id, room_id, company_id, sequence, event_sequence, revision, sender_member_id,
      sender_type, client_message_id, markdown, plain_text,
      reply_to_message_ids_json, references_json, image_attachments_json, thread_id, trigger_message_id,
      source_execution_id, source_cascade_id, version_group_id, version_number,
      edited_at_ms, deleted_at_ms, created_at_ms, updated_at_ms
  `));
  if (rows.length !== 1) throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
  const message = messageFromRow(rows[0]!);
  if (message.senderType === "human" && message.senderMemberId !== null) {
    await insertMessageRevision(database, {
      messageId: message.messageId,
      revision: 1,
      editorMemberId: message.senderMemberId,
      markdown: message.markdown,
      plainText: message.plainText,
      deleted: false,
      nowMs: input.nowMs,
    });
  }
  return message;
}

async function projectRoomNotification(
  database: DatabaseExecutor,
  input: { eventId: string; message: PersistedRoomMessage; kind: "room.message" | "agent.terminal"; status: "completed" | "failed" | "interrupted" | null; excludeActorId: string | null; nowMs: number },
): Promise<void> {
  await database.execute(sql`
    insert into notification_activities (
      activity_id, source_event_id, company_id, recipient_actor_id, kind,
      target_kind, target_id, target_title, target_message_id, body, status,
      occurred_at_ms, created_at_ms
    )
    select 'notification_' || md5(${input.eventId} || ':' || membership.actor_id),
      ${input.eventId} || ':' || membership.actor_id, ${input.message.companyId}, membership.actor_id,
      ${input.kind}, 'room', ${input.message.roomId}, room.name, ${input.message.messageId},
      nullif(left(${input.message.plainText}, 240), ''), ${input.status}, ${input.nowMs}, ${input.nowMs}
    from room_memberships membership
    join rooms room on room.id = membership.room_id and room.company_id = membership.company_id
    join actors actor on actor.id = membership.actor_id and actor.company_id = membership.company_id
    where membership.room_id = ${input.message.roomId} and membership.company_id = ${input.message.companyId}
      and membership.status = 'active' and actor.status = 'active' and actor.type = 'human'
      and (${input.excludeActorId}::varchar is null or membership.actor_id <> ${input.excludeActorId})
    on conflict (source_event_id) do nothing
  `);
  await database.execute(sql`
    insert into notification_push_deliveries (activity_id, subscription_id, next_attempt_at_ms, updated_at_ms)
    select activity.activity_id, subscription.subscription_id, ${input.nowMs}, ${input.nowMs}
    from notification_activities activity join notification_push_subscriptions subscription
      on subscription.company_id = activity.company_id and subscription.recipient_actor_id = activity.recipient_actor_id
    where activity.source_event_id like ${input.eventId + ":%"}
    on conflict (activity_id, subscription_id) do nothing
  `);
}

async function createAgentRoomExecution(
  database: DatabaseExecutor,
  input: {
    message: PersistedRoomMessage;
    cascadeId: string;
    plan: AgentExecutionPlan;
    nowMs: number;
    idempotencyKey?: string;
    sourceExecutionId?: string | null;
  },
): Promise<string | null> {
  const { message, cascadeId, plan, nowMs } = input;
  const executionId = randomUUID();
  const idempotencyKey = input.idempotencyKey ?? roomExecutionIdempotencyKey(
    message.roomId,
    message.messageId,
    plan.agentMemberId,
  );
  const inserted = rowsFromResult<{ execution_id: string }>(await database.execute(sql`
    insert into agent_room_executions (
      execution_id, room_id, company_id, agent_member_id, cascade_id,
      source_message_id, source_execution_id, codex_turn_id, turn_message_id,
      idempotency_key, trigger, trigger_policy, status,
      from_sequence, through_sequence, thread_id, attempt,
      published_message_count, last_error_code, last_error_retryable,
      created_at_ms, updated_at_ms, started_at_ms, completed_at_ms
    ) values (
      ${executionId}, ${message.roomId}, ${message.companyId}, ${plan.agentMemberId},
      ${cascadeId}, ${message.messageId}, ${input.sourceExecutionId ?? null}, null, null,
      ${idempotencyKey}, ${plan.trigger}, ${plan.triggerPolicy},
      'pending', ${plan.fromSequence}, ${plan.throughSequence}, ${plan.threadId},
      0, 0, null, null, ${nowMs}, ${nowMs}, null, null
    )
    on conflict (idempotency_key) do nothing
    returning execution_id
  `));
  if (inserted.length === 0) return null;

  const version = await allocateAgentReplyVersion(database, {
    message,
    agentMemberId: plan.agentMemberId,
    nowMs,
  });

  await database.execute(sql`
    with recursive reply_chain as (
      select message_id, sequence, reply_to_message_ids_json,
        0 as depth, array[message_id]::varchar[] as path
      from room_messages
      where room_id = ${message.roomId}
        and company_id = ${message.companyId}
        and message_id = ${message.messageId}

      union all

      select parent.message_id, parent.sequence,
        parent.reply_to_message_ids_json, child.depth + 1,
        child.path || parent.message_id
      from reply_chain child
      cross join lateral jsonb_array_elements_text(
        child.reply_to_message_ids_json
      ) reply(message_id)
      inner join room_messages parent
        on parent.room_id = ${message.roomId}
        and parent.company_id = ${message.companyId}
        and parent.message_id = reply.message_id
      where child.depth < 10
        and not parent.message_id = any(child.path)
    ),
    deduplicated as (
      select distinct on (message_id)
        message_id, sequence, depth
      from reply_chain
      order by message_id, depth asc
    ),
    selected as (
      select message_id, sequence
      from deduplicated
      order by depth asc, sequence desc
      limit 11
    )
    insert into agent_room_execution_messages (
      execution_id, message_id, sequence
    )
    select ${executionId}, message_id, sequence
    from selected
    order by sequence asc
  `);

  const position = await allocateRoomMessagePosition(database, {
    roomId: message.roomId,
    companyId: message.companyId,
    nowMs,
  });
  const turnMessage = await insertMessage(database, {
    roomId: message.roomId,
    companyId: message.companyId,
    senderMemberId: plan.agentMemberId,
    senderType: "agent",
    clientMessageId: `agent-room-turn:${executionId}`,
    markdown: "",
    plainText: "",
    replyToMessageIds: [message.messageId],
    references: [],
    threadId: plan.threadId,
    triggerMessageId: message.messageId,
    sourceExecutionId: executionId,
    sourceCascadeId: cascadeId,
    versionGroupId: version.versionGroupId,
    versionNumber: version.versionNumber,
    nowMs,
    messageId: randomUUID(),
    ...position,
  });
  await database.execute(sql`
    update agent_room_executions
    set turn_message_id = ${turnMessage.messageId}
    where execution_id = ${executionId}
  `);

  const eventId = `agent-room-execution:${executionId}`;
  await database.execute(sql`
    insert into outbox_events (
      event_id, event_type, schema_version, aggregate_type, aggregate_id,
      payload_json, occurred_at_ms, dispatched_at_ms
    ) values (
      ${eventId}, 'execution.agent_room_requested.v1', 1,
      'agent_room_execution', ${executionId},
      ${JSON.stringify({
        company_id: message.companyId,
        room_id: message.roomId,
        agent_member_id: plan.agentMemberId,
        execution_id: executionId,
        cascade_id: cascadeId,
        source_message_id: message.messageId,
        idempotency_key: idempotencyKey,
        from_sequence: plan.fromSequence,
        through_sequence: plan.throughSequence,
        thread_id: plan.threadId,
        requested_at_ms: nowMs,
      })}::jsonb,
      ${nowMs}, null
    )
    on conflict (event_id) do nothing
  `);
  await database.execute(sql`
    insert into outbox_deliveries (
      event_id, consumer_name, status, attempt, next_attempt_at_ms,
      created_at_ms, updated_at_ms
    ) values (
      ${eventId}, 'runtime.agent-room-execution', 'pending', 0,
      ${nowMs}, ${nowMs}, ${nowMs}
    )
    on conflict (event_id, consumer_name) do nothing
  `);
  return executionId;
}

async function allocateAgentReplyVersion(
  database: DatabaseExecutor,
  input: {
    message: PersistedRoomMessage;
    agentMemberId: string;
    nowMs: number;
  },
): Promise<{ versionGroupId: string; versionNumber: number }> {
  const candidateId = randomUUID();
  await database.execute(sql`
    insert into room_agent_reply_version_groups (
      version_group_id, room_id, company_id, trigger_message_id,
      agent_member_id, created_at_ms, updated_at_ms
    ) values (
      ${candidateId}, ${input.message.roomId}, ${input.message.companyId},
      ${input.message.messageId}, ${input.agentMemberId}, ${input.nowMs}, ${input.nowMs}
    )
    on conflict (trigger_message_id, agent_member_id)
    do update set updated_at_ms = greatest(
      room_agent_reply_version_groups.updated_at_ms,
      excluded.updated_at_ms
    )
  `);
  const groups = rowsFromResult<{ version_group_id: string }>(await database.execute(sql`
    select version_group_id
    from room_agent_reply_version_groups
    where trigger_message_id = ${input.message.messageId}
      and agent_member_id = ${input.agentMemberId}
    limit 2
    for update
  `));
  if (groups.length !== 1) {
    throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
  }
  const versionGroupId = groups[0]!.version_group_id;
  const versions = rowsFromResult<{ version_number: DatabaseNumber }>(await database.execute(sql`
    select coalesce(max(version_number), 0) + 1 as version_number
    from room_messages
    where version_group_id = ${versionGroupId}
  `));
  return {
    versionGroupId,
    versionNumber: positiveNumber(versions[0]?.version_number ?? 1),
  };
}

async function planTriggeredExecutions(
  database: DatabaseExecutor,
  message: PersistedRoomMessage,
  mode: "created" | "updated" = "created",
  branch: { agentMemberId: string | null } = { agentMemberId: null },
): Promise<readonly AgentExecutionPlan[]> {
  const states = rowsFromResult<AgentStateRow>(await database.execute(sql`
    select state.room_id, state.company_id, state.agent_member_id,
      state.trigger_policy, state.trigger_policy_version,
      state.thread_id, state.cursor_sequence,
      state.eligible_from_sequence, state.membership_active,
      state.membership_version, state.updated_at_ms
    from agent_room_states state
    inner join room_memberships membership
      on membership.room_id = state.room_id
      and membership.company_id = state.company_id
      and membership.actor_id = state.agent_member_id
      and membership.status = 'active'
    inner join actors actor
      on actor.id = state.agent_member_id
      and actor.company_id = state.company_id
      and actor.type = 'agent'
      and actor.status = 'active'
    where state.room_id = ${message.roomId}
      and state.company_id = ${message.companyId}
      and state.membership_active = true
    order by state.agent_member_id asc
    for update of state
  `)).map(stateFromRow);
  if (states.length === 0) return Object.freeze([]);

  const repliedAgentIds = await repliedAgentMemberIds(database, message);
  const referencedMemberIds = new Set(
    message.references.flatMap((reference) => (
      reference.type === "member" && typeof reference.id === "string"
        ? [reference.id]
        : []
    )),
  );

  return Object.freeze(states.flatMap((state) => {
    const explicit = repliedAgentIds.has(state.agentMemberId)
      || referencedMemberIds.has(state.agentMemberId);
    if (!agentRoomPolicyTriggers(state.triggerPolicy, message.senderType, explicit)) return [];
    if (message.senderMemberId === state.agentMemberId) return [];
    const fromSequence = Math.max(
      state.cursorSequence + 1,
      state.eligibleFromSequence,
      mode === "updated" ? message.sequence : 1,
    );
    if (mode === "created" && fromSequence > message.sequence) return [];
    const trigger: "mention" | "direct_reply" | "automatic" = explicit
      ? (repliedAgentIds.has(state.agentMemberId) ? "direct_reply" : "mention")
      : "automatic";
    return [{
      agentMemberId: state.agentMemberId,
      trigger,
      triggerPolicy: state.triggerPolicy,
      threadId: branch.agentMemberId === state.agentMemberId
        ? message.threadId ?? state.threadId
        : state.threadId,
      fromSequence,
      throughSequence: mode === "updated" ? fromSequence : message.sequence,
    }];
  }));
}

async function repliedAgentMemberIds(
  database: DatabaseExecutor,
  message: PersistedRoomMessage,
): Promise<ReadonlySet<string>> {
  if (message.replyToMessageIds.length === 0) return new Set();
  const rows = rowsFromResult<{ sender_member_id: string | null; sender_type: string }>(await database.execute(sql`
    select sender_member_id, sender_type
    from room_messages
    where room_id = ${message.roomId}
      and message_id in ${sql`(${sql.join(message.replyToMessageIds.map((id) => sql`${id}`), sql`, `)})`}
  `));
  return new Set(rows.flatMap((row) => (
    row.sender_type === "agent" && row.sender_member_id !== null
      ? [row.sender_member_id]
      : []
  )));
}

async function lockExecution(
  database: DatabaseExecutor,
  executionId: string,
): Promise<AgentRoomExecution | null> {
  const rows = rowsFromResult<ExecutionRow>(await database.execute(sql`
    select execution_id, room_id, company_id, agent_member_id, cascade_id,
      source_message_id, source_execution_id, codex_turn_id, turn_message_id,
      idempotency_key, trigger, trigger_policy, status,
      from_sequence, through_sequence, thread_id, attempt,
      published_message_count, started_at_ms, completed_at_ms,
      last_error_code, last_error_retryable
    from agent_room_executions
    where execution_id = ${executionId}
    limit 2
    for update
  `));
  if (rows.length > 1) throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
  return rows[0] ? executionFromRow(rows[0]) : null;
}

async function lockAgentState(
  database: DatabaseExecutor,
  roomId: string,
  agentMemberId: string,
): Promise<AgentRoomState | null> {
  const rows = rowsFromResult<AgentStateRow>(await database.execute(sql`
    select room_id, company_id, agent_member_id, trigger_policy,
      trigger_policy_version, thread_id,
      cursor_sequence, eligible_from_sequence, membership_active,
      membership_version, updated_at_ms
    from agent_room_states
    where room_id = ${roomId}
      and agent_member_id = ${agentMemberId}
    limit 2
    for update
  `));
  if (rows.length > 1) throw new ApplicationError(AGENT_ROOM_STATE_INVALID_CODE, false);
  return rows[0] ? stateFromRow(rows[0]) : null;
}

async function readAgentState(
  database: DatabaseExecutor,
  roomId: string,
  agentMemberId: string,
): Promise<AgentRoomState | null> {
  const rows = rowsFromResult<AgentStateRow>(await database.execute(sql`
    select room_id, company_id, agent_member_id, trigger_policy,
      trigger_policy_version, thread_id,
      cursor_sequence, eligible_from_sequence, membership_active,
      membership_version, updated_at_ms
    from agent_room_states
    where room_id = ${roomId}
      and agent_member_id = ${agentMemberId}
    limit 2
  `));
  if (rows.length > 1) throw new ApplicationError(AGENT_ROOM_STATE_INVALID_CODE, false);
  return rows[0] ? stateFromRow(rows[0]) : null;
}

function messageFromRow(row: MessageRow): PersistedRoomMessage {
  const senderId = row.sender_member_id ?? "system";
  return {
    messageId: row.message_id,
    roomId: row.room_id,
    companyId: row.company_id,
    sequence: positiveNumber(row.sequence),
    eventSequence: positiveNumber(row.event_sequence),
    revision: positiveNumber(row.revision),
    senderMemberId: row.sender_member_id,
    senderType: senderType(row.sender_type),
    clientMessageId: row.client_message_id,
    markdown: row.markdown,
    plainText: row.plain_text,
    replyToMessageIds: stringArray(row.reply_to_message_ids_json),
    references: objectArray(row.references_json),
    imageAttachments: roomMessageImageAttachmentsSchema.parse(row.image_attachments_json),
    threadId: row.thread_id,
    triggerMessageId: row.trigger_message_id,
    sourceExecutionId: row.source_execution_id,
    sourceCascadeId: row.source_cascade_id,
    versionGroupId: row.version_group_id,
    versionNumber: row.version_number === null ? null : positiveNumber(row.version_number),
    versionCount: row.version_number === null ? 0 : positiveNumber(row.version_number),
    selectedVersionMessageId: null,
    selectionRevision: 0,
    latestSuccessfulVersionMessageId: null,
    editedAtMs: row.edited_at_ms === null ? null : nonNegativeNumber(row.edited_at_ms),
    deletedAtMs: row.deleted_at_ms === null ? null : nonNegativeNumber(row.deleted_at_ms),
    sourceExecutionStatus: null,
    sourceExecutionStartedAtMs: null,
    sourceExecutionCompletedAtMs: null,
    senderDisplayName: row.sender_type === "system" ? "System" : senderId,
    senderMark: row.sender_type === "system" ? "SYS" : senderId.slice(0, 2),
    senderAvatarResourceId: null,
    roomTitle: row.room_id,
    interactions: [],
    createdAtMs: nonNegativeNumber(row.created_at_ms),
    updatedAtMs: nonNegativeNumber(row.updated_at_ms),
  };
}

async function hydrateMessageProjections(
  database: DatabaseExecutor,
  messages: readonly PersistedRoomMessage[],
  requestedByMemberId?: string,
): Promise<PersistedRoomMessage[]> {
  if (messages.length === 0) return [];
  const memberIds = [...new Set(messages.flatMap((message) => (
    message.senderMemberId === null ? [] : [message.senderMemberId]
  )))];
  const roomIds = [...new Set(messages.map((message) => message.roomId))];
  const actors = memberIds.length === 0
    ? []
    : rowsFromResult<{ id: string; display_name: string; mark: string }>(await database.execute(sql`
      select id, display_name, mark
      from actors
      where id in ${sql`(${sql.join(memberIds.map((id) => sql`${id}`), sql`, `)})`}
    `));
  const rooms = rowsFromResult<{ id: string; name: string }>(await database.execute(sql`
    select id, name
    from rooms
    where id in ${sql`(${sql.join(roomIds.map((id) => sql`${id}`), sql`, `)})`}
  `));
  const messageIds = messages.map((message) => message.messageId);
  const executionIds = [...new Set(messages.flatMap((message) => (
    message.sourceExecutionId === null ? [] : [message.sourceExecutionId]
  )))];
  const versionGroupIds = [...new Set(messages.flatMap((message) => (
    message.versionGroupId === null ? [] : [message.versionGroupId]
  )))];
  const interactions = rowsFromResult<InteractionRow>(await database.execute(sql`
    select interaction_id, room_id, company_id, execution_id, agent_member_id,
      message_id, kind, label, status, responses_json,
      interaction_json, deadline_at_ms, created_at_ms, updated_at_ms, responded_at_ms
    from room_interactions
    where message_id in ${sql`(${sql.join(messageIds.map((id) => sql`${id}`), sql`, `)})`}
    order by created_at_ms asc, interaction_id asc
  `));
  const executions = executionIds.length === 0
    ? []
    : rowsFromResult<ExecutionRow>(await database.execute(sql`
      select execution_id, room_id, company_id, agent_member_id, cascade_id,
        source_message_id, source_execution_id, codex_turn_id, turn_message_id,
        idempotency_key, trigger, trigger_policy, status,
        from_sequence, through_sequence, thread_id, attempt,
        published_message_count, started_at_ms, completed_at_ms,
        last_error_code, last_error_retryable
      from agent_room_executions
      where execution_id in ${sql`(${sql.join(executionIds.map((id) => sql`${id}`), sql`, `)})`}
    `));
  const versionRows = versionGroupIds.length === 0
    ? []
    : rowsFromResult<{
      version_group_id: string;
      message_id: string;
      version_number: DatabaseNumber;
      execution_status: string | null;
    }>(await database.execute(sql`
      select message.version_group_id, message.message_id, message.version_number,
        execution.status as execution_status
      from room_messages message
      left join agent_room_executions execution
        on execution.execution_id = message.source_execution_id
      where message.version_group_id in ${sql`(${sql.join(versionGroupIds.map((id) => sql`${id}`), sql`, `)})`}
      order by message.version_group_id asc, message.version_number asc
    `));
  const selectionRows = versionGroupIds.length === 0 || requestedByMemberId === undefined
    ? []
    : rowsFromResult<{
      version_group_id: string;
      selected_message_id: string;
      revision: DatabaseNumber;
    }>(await database.execute(sql`
      select version_group_id, selected_message_id, revision
      from room_agent_reply_selections
      where member_id = ${requestedByMemberId}
        and version_group_id in ${sql`(${sql.join(versionGroupIds.map((id) => sql`${id}`), sql`, `)})`}
    `));
  const actorById = new Map(actors.map((actor) => [actor.id, actor]));
  const roomById = new Map(rooms.map((room) => [room.id, room.name]));
  const interactionsByMessageId = new Map<string, RoomMessageInteraction[]>();
  for (const interaction of interactions) {
    const projected = interactionProjection(interaction);
    interactionsByMessageId.set(
      interaction.message_id,
      [...(interactionsByMessageId.get(interaction.message_id) ?? []), projected],
    );
  }
  const executionById = new Map(
    executions.map((execution) => [execution.execution_id, executionFromRow(execution)]),
  );
  const versionsByGroup = new Map<string, typeof versionRows>();
  for (const version of versionRows) {
    versionsByGroup.set(
      version.version_group_id,
      [...(versionsByGroup.get(version.version_group_id) ?? []), version],
    );
  }
  const selectionByGroup = new Map(
    selectionRows.map((selection) => [
      selection.version_group_id,
      selection.selected_message_id,
    ]),
  );
  const selectionRevisionByGroup = new Map(
    selectionRows.map((selection) => [
      selection.version_group_id,
      positiveNumber(selection.revision),
    ]),
  );
  return messages.map((message) => {
    const actor = message.senderMemberId === null
      ? null
      : actorById.get(message.senderMemberId) ?? null;
    const execution = message.sourceExecutionId === null
      ? null
      : executionById.get(message.sourceExecutionId) ?? null;
    const versions = message.versionGroupId === null
      ? []
      : versionsByGroup.get(message.versionGroupId) ?? [];
    const latestSuccessful = [...versions]
      .reverse()
      .find((version) => version.execution_status === "succeeded")
      ?? versions.at(-1)
      ?? null;
    const selectedVersionMessageId = message.versionGroupId === null
      ? null
      : selectionByGroup.get(message.versionGroupId)
        ?? latestSuccessful?.message_id
        ?? null;
    return {
      ...message,
      senderDisplayName: actor?.display_name ?? (message.senderType === "system" ? "System" : message.senderMemberId!),
      senderMark: actor?.mark ?? (message.senderType === "system" ? "SYS" : message.senderMemberId!.slice(0, 2)),
      senderAvatarResourceId: null,
      roomTitle: roomById.get(message.roomId) ?? message.roomId,
      sourceExecutionStatus: execution?.status ?? null,
      sourceExecutionStartedAtMs: execution?.startedAtMs ?? null,
      sourceExecutionCompletedAtMs: execution?.completedAtMs ?? null,
      versionCount: versions.length,
      selectedVersionMessageId,
      selectionRevision: message.versionGroupId === null
        ? 0
        : selectionRevisionByGroup.get(message.versionGroupId) ?? 0,
      latestSuccessfulVersionMessageId: latestSuccessful?.message_id ?? null,
      interactions: Object.freeze(interactionsByMessageId.get(message.messageId) ?? []),
    };
  });
}

function interactionProjection(row: InteractionRow): RoomMessageInteraction {
  if (row.kind === "request_user_input") {
    const parsed = roomQuestionInteractionSchema.safeParse(row.interaction_json);
    if (!parsed.success) throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
    return parsed.data;
  }
  const status = row.status;
  if (status !== "pending" && status !== "approved" && status !== "rejected") {
    throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
  }
  const responses = Array.isArray(row.responses_json)
    ? row.responses_json.flatMap((value) => {
      const response = objectValue(value);
      const choice = response?.value;
      const label = response?.label;
      return (choice === "approve" || choice === "reject") && typeof label === "string" && label
        ? [{ value: choice as "approve" | "reject", label }]
        : [];
    })
    : [];
  if (responses.length === 0) throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
  return {
    id: row.interaction_id,
    kind: "delegation_check",
    label: row.label,
    status,
    responses,
  };
}

function completedRoomQuestionInteraction(
  row: InteractionRow,
  response: AgentRoomInteractionResponseDispatch["response"],
  completedAtMs: number,
  allowSecrets = false,
): unknown {
  const interaction = roomQuestionInteractionSchema.parse(row.interaction_json);
  if (typeof response === "string") throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
  const questionIds = new Set(interaction.questions.map((question) => question.id));
  if (Object.keys(response.answers).some((id) => !questionIds.has(id))) {
    throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
  }
  const secretIds = new Set(interaction.questions.filter((question) => question.secret).map((question) => question.id));
  if (secretIds.size > 0 && !allowSecrets) {
    throw new ApplicationError("SECRET_INTERACTION_REQUIRES_DIRECT_DELIVERY", false);
  }
  return {
    ...interaction,
    status: "completed",
    answers: Object.fromEntries(Object.entries(response.answers).map(([id, values]) => [id, {
      values: secretIds.has(id) && values.length > 0 ? ["••••••"] : values,
      redacted: secretIds.has(id),
    }])),
    resolution: response.resolution,
    deadline_at_ms: null,
    completed_at_ms: completedAtMs,
  };
}

function roomQuestionResponse(value: unknown): Extract<AgentRoomInteractionResponseDispatch["response"], object> {
  const response = objectValue(value);
  const answersValue = objectValue(response?.answers);
  const resolution = response?.resolution;
  if (!answersValue || (resolution !== "answered" && resolution !== "dismissed" && resolution !== "timed_out")) {
    throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
  }
  const answers = Object.fromEntries(Object.entries(answersValue).map(([id, entries]) => {
    if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== "string")) {
      throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
    }
    return [id, entries as string[]];
  }));
  return { answers, resolution };
}

function interactionResponseDispatch(
  interaction: InteractionRow,
  persistedResponseId: string,
  idempotencyKey: string,
  responderMemberId: string,
  response: AgentRoomInteractionResponseDispatch["response"],
  respondedAtMs: number,
): AgentRoomInteractionResponseDispatch {
  return {
    persisted_response_id: persistedResponseId,
    idempotency_key: idempotencyKey,
    execution_id: interaction.execution_id,
    room_id: interaction.room_id,
    agent_member_id: interaction.agent_member_id,
    message_id: interaction.message_id,
    interaction_id: interaction.interaction_id,
    responder_member_id: responderMemberId,
    response,
    responded_at_ms: respondedAtMs,
  };
}

function activitySnapshotEvent(
  execution: AgentRoomExecution,
  eventId: string,
  snapshot: AgentTurnSnapshot,
  occurredAtMs: number,
): AgentTurnEvent {
  return {
    schema_version: 2,
    event_id: eventId,
    type: "agent_turn.snapshot",
    source: "backend",
    scope: {
      type: "room",
      room_id: execution.roomId,
      agent_member_id: execution.agentMemberId,
      execution_id: execution.executionId,
    },
    turn_id: snapshot.turn_id,
    occurred_at_ms: occurredAtMs,
    snapshot,
  };
}

function executionActivitySnapshot(execution: AgentRoomExecution): AgentTurnSnapshot {
  const status = execution.status === "pending" || execution.status === "dispatched"
    ? "queued"
    : execution.status === "running"
      ? "running"
      : execution.status === "succeeded"
        ? "completed"
        : execution.status === "cancelled"
          ? "interrupted"
          : "failed";
  return {
    turn_id: null,
    status,
    started_at_ms: execution.startedAtMs,
    completed_at_ms: execution.completedAtMs,
    duration_ms: execution.startedAtMs === null || execution.completedAtMs === null
      ? null
      : Math.max(0, execution.completedAtMs - execution.startedAtMs),
    error: execution.error === null
      ? null
      : { code: execution.error.code, message: "Agent turn failed." },
    narrative_items: [],
    activity_items: [],
  };
}

function dispatchMessageFromRow(
  row: DispatchMessageRow,
): AgentRoomExecutionDispatch["prompt_messages"][number] {
  const type = senderType(row.sender_type);
  const senderId = row.sender_member_id ?? "system";
  const displayName = row.sender_display_name ?? (type === "system" ? "System" : senderId);
  const mark = row.sender_mark ?? (type === "system" ? "SYS" : displayName.slice(0, 2));
  const replyIds = stringArray(row.reply_to_message_ids_json);
  return {
    message_id: row.message_id,
    sequence: positiveNumber(row.sequence),
    occurred_at_ms: nonNegativeNumber(row.created_at_ms),
    sender: {
      type,
      id: senderId,
      display_name: displayName,
      mark,
      avatar_resource_id: row.sender_avatar_resource_id,
    },
    body: {
      format: "inline_markdown",
      markdown: row.markdown,
      plain_text: row.plain_text,
    },
    reply_to: replyIds.length === 0
      ? null
      : { message_ids: [...replyIds], preview: "" },
    references: roomReferenceTargetSchema.array().parse(row.references_json),
    image_attachments: roomMessageImageAttachmentsSchema.parse(row.image_attachments_json),
  };
}

function stateFromRow(row: AgentStateRow): AgentRoomState {
  return {
    roomId: row.room_id,
    companyId: row.company_id,
    agentMemberId: row.agent_member_id,
    triggerPolicy: triggerPolicy(row.trigger_policy),
    triggerPolicyVersion: positiveNumber(row.trigger_policy_version),
    threadId: row.thread_id,
    cursorSequence: nonNegativeNumber(row.cursor_sequence),
    eligibleFromSequence: positiveNumber(row.eligible_from_sequence),
    membershipActive: row.membership_active,
    membershipVersion: positiveNumber(row.membership_version),
    updatedAtMs: nonNegativeNumber(row.updated_at_ms),
  };
}

function executionFromRow(row: ExecutionRow): AgentRoomExecution {
  return {
    executionId: row.execution_id,
    roomId: row.room_id,
    companyId: row.company_id,
    agentMemberId: row.agent_member_id,
    cascadeId: row.cascade_id,
    sourceMessageId: row.source_message_id,
    sourceExecutionId: row.source_execution_id,
    codexTurnId: row.codex_turn_id,
    turnMessageId: row.turn_message_id,
    idempotencyKey: row.idempotency_key,
    trigger: executionTrigger(row.trigger),
    triggerPolicy: triggerPolicy(row.trigger_policy),
    status: executionStatus(row.status),
    fromSequence: positiveNumber(row.from_sequence),
    throughSequence: positiveNumber(row.through_sequence),
    threadId: row.thread_id,
    attempt: nonNegativeNumber(row.attempt),
    publishedMessageCount: nonNegativeNumber(row.published_message_count),
    startedAtMs: row.started_at_ms === null ? null : nonNegativeNumber(row.started_at_ms),
    completedAtMs: row.completed_at_ms === null ? null : nonNegativeNumber(row.completed_at_ms),
    error: row.last_error_code === null
      ? null
      : { code: row.last_error_code, retryable: row.last_error_retryable ?? false },
  };
}

function assertSendInput(input: SendRoomMessageInput): void {
  if (
    !input.roomId
    || !input.companyId
    || !input.senderMemberId
    || !input.clientMessageId
    || (input.markdown.trim().length === 0 && (input.imageAttachments?.length ?? 0) === 0)
    || !Number.isSafeInteger(input.nowMs)
    || input.nowMs < 0
    || new Set(input.replyToMessageIds).size !== input.replyToMessageIds.length
  ) {
    throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
  }
}

function roomExecutionIdempotencyKey(
  roomId: string,
  messageId: string,
  agentMemberId: string,
): string {
  return `room:${roomId}:message:${messageId}:agent:${agentMemberId}`;
}

function senderType(value: string): PersistedRoomMessage["senderType"] {
  if (value === "human" || value === "agent" || value === "system") return value;
  throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
}

function triggerPolicy(value: string): AgentRoomTriggerPolicy {
  if (agentRoomTriggerPolicies.includes(value as AgentRoomTriggerPolicy)) {
    return value as AgentRoomTriggerPolicy;
  }
  throw new ApplicationError(AGENT_ROOM_STATE_INVALID_CODE, false);
}

function executionTrigger(value: string): AgentRoomExecution["trigger"] {
  if (value === "mention" || value === "direct_reply" || value === "automatic") return value;
  throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
}

function executionStatus(value: string): AgentRoomExecution["status"] {
  if (
    value === "pending"
    || value === "dispatched"
    || value === "running"
    || value === "succeeded"
    || value === "failed"
    || value === "cancelled"
  ) {
    return value;
  }
  throw new ApplicationError(AGENT_ROOM_EXECUTION_INVALID_CODE, false);
}

function positiveNumber(value: DatabaseNumber): number {
  const result = databaseNumber(value);
  if (result < 1) throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
  return result;
}

function nonNegativeNumber(value: DatabaseNumber): number {
  const result = databaseNumber(value);
  if (result < 0) throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
  return result;
}

function databaseNumber(value: DatabaseNumber): number {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(result)) throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
  return result;
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
  }
  return Object.freeze([...value]);
}

function objectArray(value: unknown): readonly Record<string, unknown>[] {
  if (
    !Array.isArray(value)
    || value.some((entry) => entry === null || typeof entry !== "object" || Array.isArray(entry))
  ) {
    throw new ApplicationError(ROOM_MESSAGE_INVALID_CODE, false);
  }
  return Object.freeze(value.map((entry) => ({ ...(entry as Record<string, unknown>) })));
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function rowsFromResult<Row>(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  if (result !== null && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as Row[];
  }
  return [];
}

async function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

function notificationPreview(value: string): string { return value.replace(/\s+/gu, " ").trim().slice(0, 240); }
