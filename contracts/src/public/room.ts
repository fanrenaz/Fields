import { z } from "zod";

import {
  agentQuestionInteractionSchema,
  roomAgentTurnEventSchema,
  roomAgentTurnEventStreamSchema,
  type RoomAgentTurnEvent,
} from "./agent-activity.js";
import {
  messageImageAttachmentsSchemaFor,
  messageImageMetadataSchema,
} from "./message-attachment.js";

export const roomMessageImageAttachmentSchema = messageImageMetadataSchema.extend({
  storage: z.literal("company_file_version"),
  file_id: z.string().min(1),
  version_id: z.string().min(1),
});
export type RoomMessageImageAttachment = z.infer<typeof roomMessageImageAttachmentSchema>;
export const roomMessageImageAttachmentsSchema = messageImageAttachmentsSchemaFor(roomMessageImageAttachmentSchema);

export const roomIdInputSchema = z.object({
  room_id: z.string().min(1),
});

export const roomMemberSchema = z.object({
  member_id: z.string().min(1),
  name: z.string().min(1),
  mark: z.string().min(1),
  role: z.string().min(1),
  meta: z.string().min(1),
  joined_at_ms: z.number().int().nonnegative(),
  status: z.string().min(1).optional(),
  contact: z.string().min(1).optional(),
  boundary: z.string().min(1).optional(),
  actor_type: z.enum(["human", "agent"]),
  membership_version: z.number().int().positive(),
  agent: z.boolean().optional(),
  skills: z.array(z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    scope: z.string().min(1).optional(),
  }).passthrough()).optional(),
}).strict();
export type RoomMember = z.infer<typeof roomMemberSchema>;

export const roomSummarySchema = z.object({
  room_id: z.string().min(1),
  name: z.string().min(1),
  subtitle: z.string().min(1).nullable().optional(),
  status: z.string().min(1),
  updated_at_ms: z.number().int().nonnegative(),
  unread_count: z.number().int().nonnegative().default(0),
  read_through: z.string().min(1).nullable().default(null),
}).passthrough();
export type RoomSummary = z.infer<typeof roomSummarySchema>;

export const roomCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(255),
  subtitle: z.string().trim().min(1).max(255).optional(),
});
export type RoomCreateInput = z.infer<typeof roomCreateInputSchema>;

export const roomCreateResultSchema = roomSummarySchema;
export type RoomCreateResult = z.infer<typeof roomCreateResultSchema>;

export const roomListInputSchema = z.object({
  cursor: z.string().min(1).nullable().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  include_archived: z.boolean().optional(),
  search_term: z.string().trim().min(1).max(255).optional(),
});
export type RoomListInput = z.infer<typeof roomListInputSchema>;

export const roomListResultSchema = z.object({
  items: z.array(roomSummarySchema),
  page: z.object({
    next_cursor: z.string().min(1).nullable(),
  }).passthrough(),
}).passthrough();
export type RoomListResult = z.infer<typeof roomListResultSchema>;

export const roomMessageSenderSchema = z.object({
  type: z.enum(["human", "agent", "system"]),
  id: z.string().min(1),
  display_name: z.string().min(1),
  mark: z.string().min(1),
  avatar_resource_id: z.string().min(1).nullable(),
}).passthrough();
export type RoomMessageSender = z.infer<typeof roomMessageSenderSchema>;

export const roomMessageBodySchema = z.object({
  format: z.literal("inline_markdown"),
  markdown: z.string(),
  plain_text: z.string(),
}).passthrough();
export type RoomMessageBody = z.infer<typeof roomMessageBodySchema>;

export const roomMessageReplyToSchema = z.object({
  message_ids: z.array(z.string().min(1)).min(1),
  preview: z.string(),
}).passthrough();
export type RoomMessageReplyTo = z.infer<typeof roomMessageReplyToSchema>;

export const roomDelegationInteractionSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("delegation_check"),
  label: z.string().min(1),
  status: z.union([z.enum(["pending", "approved", "rejected"]), z.string().min(1)]),
  responses: z.array(z.object({
    value: z.enum(["approve", "reject"]),
    label: z.string().min(1),
  }).passthrough()).min(1),
}).passthrough();
export const roomQuestionInteractionSchema = agentQuestionInteractionSchema.extend({
  kind: z.literal("request_user_input"),
}).passthrough();
export const roomMessageInteractionSchema = z.union([
  roomDelegationInteractionSchema,
  roomQuestionInteractionSchema,
]);
export type RoomMessageInteraction = z.infer<typeof roomMessageInteractionSchema>;

export const roomAgentTurnProvenanceSchema = z.object({
  trigger_message_id: z.string().min(1),
  execution_id: z.string().min(1),
  cascade_id: z.string().min(1),
  status: z.enum([
    "queued",
    "running",
    "completed",
    "failed",
    "interrupted",
  ]),
  started_at_ms: z.number().int().nonnegative().nullable(),
  completed_at_ms: z.number().int().nonnegative().nullable(),
  duration_ms: z.number().int().nonnegative().nullable(),
}).passthrough();
export type RoomAgentTurnProvenance = z.infer<typeof roomAgentTurnProvenanceSchema>;

export const roomAgentReplyVersionSchema = z.strictObject({
  group_id: z.string().min(1),
  version_number: z.number().int().positive(),
  version_count: z.number().int().positive(),
  selected: z.boolean(),
  selection_revision: z.number().int().nonnegative(),
  latest_successful: z.boolean(),
  source_execution_id: z.string().min(1).nullable(),
});
export type RoomAgentReplyVersion = z.infer<typeof roomAgentReplyVersionSchema>;

export const roomReferenceTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("room"), id: z.string().min(1) }).passthrough(),
  z.object({ type: z.literal("member"), id: z.string().min(1), room_id: z.string().min(1) }).passthrough(),
  z.object({ type: z.literal("resource"), id: z.string().min(1), room_id: z.string().min(1) }).passthrough(),
  z.object({ type: z.literal("memory"), id: z.string().min(1), room_id: z.string().min(1) }).passthrough(),
  z.object({
    type: z.literal("file"),
    id: z.string().min(1),
    version_id: z.string().min(1),
    room_id: z.string().min(1),
  }).passthrough(),
  z.object({ type: z.literal("message"), room_id: z.string().min(1), message_id: z.string().min(1) }).passthrough(),
  z.object({
    type: z.literal("thread"),
    room_id: z.string().min(1),
    thread_id: z.string().min(1),
    message_id: z.string().min(1).optional(),
  }).passthrough(),
  z.object({ type: z.literal("context"), room_id: z.string().min(1), tab: z.enum(["basis", "changes", "risks"]) }).passthrough(),
]);
export type RoomReferenceTarget = z.infer<typeof roomReferenceTargetSchema>;

export const roomSystemTimelineMessageSchema = z.object({
  id: z.string().min(1),
  sequence: z.number().int().positive(),
  kind: z.literal("system"),
  room_id: z.string().min(1),
  occurred_at_ms: z.number().int().nonnegative(),
  body: roomMessageBodySchema,
  delivery: z.never().optional(),
}).passthrough();
export type RoomSystemTimelineMessage = z.infer<typeof roomSystemTimelineMessageSchema>;

export const roomUserTimelineMessageSchema = z.object({
  id: z.string().min(1),
  sequence: z.number().int().positive(),
  kind: z.literal("message"),
  room_id: z.string().min(1),
  occurred_at_ms: z.number().int().nonnegative(),
  sender: roomMessageSenderSchema,
  body: roomMessageBodySchema,
  revision: z.number().int().positive(),
  edited_at_ms: z.number().int().nonnegative().nullable(),
  deleted_at_ms: z.number().int().nonnegative().nullable(),
  reply_to: roomMessageReplyToSchema.nullable(),
  interactions: z.array(roomMessageInteractionSchema).default([]),
  agent_turn: roomAgentTurnProvenanceSchema.optional(),
  agent_reply_version: roomAgentReplyVersionSchema.optional(),
  thread_id: z.string().min(1).nullable(),
  generation: z.object({
    state: z.enum(["waiting", "streaming"]),
  }).passthrough().optional(),
  references: z.array(roomReferenceTargetSchema).optional(),
  image_attachments: roomMessageImageAttachmentsSchema.optional(),
  delivery: z.never().optional(),
}).passthrough().superRefine((message, context) => {
  if (message.agent_turn !== undefined && message.sender.type !== "agent") {
    context.addIssue({
      code: "custom",
      path: ["agent_turn"],
      message: "agent_turn provenance is only valid for Agent messages",
    });
  }
  if (message.agent_reply_version !== undefined && message.sender.type !== "agent") {
    context.addIssue({
      code: "custom",
      path: ["agent_reply_version"],
      message: "agent_reply_version is only valid for Agent messages",
    });
  }
});
export type RoomUserTimelineMessage = z.infer<typeof roomUserTimelineMessageSchema>;

export const roomTimelineMessageSchema = z.discriminatedUnion("kind", [
  roomSystemTimelineMessageSchema,
  roomUserTimelineMessageSchema,
]);
export type RoomTimelineMessage = z.infer<typeof roomTimelineMessageSchema>;

export const roomMessagesListInputSchema = roomIdInputSchema.extend({
  cursor: z.string().min(1).nullable().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
export type RoomMessagesListInput = z.infer<typeof roomMessagesListInputSchema>;

export const roomMessagesListResultSchema = z.object({
  room_id: z.string().min(1),
  items: z.array(roomTimelineMessageSchema),
  page: z.object({
    next_cursor: z.string().min(1).nullable(),
    backwards_cursor: z.string().min(1).nullable(),
  }).passthrough(),
}).passthrough();
export type RoomMessagesListResult = z.infer<typeof roomMessagesListResultSchema>;

export const roomThreadReadInputSchema = roomIdInputSchema.extend({
  thread_id: z.string().min(1),
});
export type RoomThreadReadInput = z.infer<typeof roomThreadReadInputSchema>;

export const roomThreadReadResultSchema = z.object({
  room_id: z.string().min(1),
  thread_id: z.string().min(1),
  root_message_id: z.string().min(1),
  items: z.array(roomTimelineMessageSchema),
}).passthrough();
export type RoomThreadReadResult = z.infer<typeof roomThreadReadResultSchema>;

export const roomMessageSendInputSchema = z.object({
  room_id: z.string().min(1),
  client_message_id: z.string().min(1),
  markdown: z.string(),
  image_attachments: roomMessageImageAttachmentsSchema.optional(),
  reply_to_message_ids: z.array(z.string().min(1)).optional(),
  branch_message_id: z.string().min(1).optional(),
  references: z.array(roomReferenceTargetSchema).optional(),
}).superRefine((input, context) => {
  if (input.markdown.trim().length === 0 && (input.image_attachments?.length ?? 0) === 0) {
    context.addIssue({ code: "custom", path: ["markdown"], message: "A Room message requires text or an image." });
  }
});
export type RoomMessageSendInput = z.infer<typeof roomMessageSendInputSchema>;

export const roomMessageSendResultSchema = z.object({
  submitted: z.literal(true),
  room_id: z.string().min(1),
  message: roomTimelineMessageSchema,
}).passthrough();
export type RoomMessageSendResult = z.infer<typeof roomMessageSendResultSchema>;

export const roomMessageEditInputSchema = z.strictObject({
  room_id: z.string().min(1),
  message_id: z.string().min(1),
  expected_revision: z.number().int().positive(),
  markdown: z.string().min(1),
  idempotency_key: z.string().min(1).max(255),
});
export type RoomMessageEditInput = z.infer<typeof roomMessageEditInputSchema>;

export const roomMessageSoftDeleteInputSchema = z.strictObject({
  room_id: z.string().min(1),
  message_id: z.string().min(1),
  expected_revision: z.number().int().positive(),
  idempotency_key: z.string().min(1).max(255),
});
export type RoomMessageSoftDeleteInput = z.infer<typeof roomMessageSoftDeleteInputSchema>;

export const roomMessageMutationResultSchema = z.strictObject({
  room_id: z.string().min(1),
  message: roomTimelineMessageSchema,
});
export type RoomMessageMutationResult = z.infer<typeof roomMessageMutationResultSchema>;

export const roomAgentReplyRegenerateInputSchema = z.strictObject({
  room_id: z.string().min(1),
  message_id: z.string().min(1),
  expected_revision: z.number().int().positive(),
  idempotency_key: z.string().min(1).max(255),
});
export type RoomAgentReplyRegenerateInput = z.infer<typeof roomAgentReplyRegenerateInputSchema>;

export const roomAgentReplyRegenerateResultSchema = z.strictObject({
  accepted: z.literal(true),
  room_id: z.string().min(1),
  execution_id: z.string().min(1),
  version_group_id: z.string().min(1),
  version_number: z.number().int().positive(),
  message: roomTimelineMessageSchema,
});
export type RoomAgentReplyRegenerateResult = z.infer<typeof roomAgentReplyRegenerateResultSchema>;

export const roomAgentReplySelectionSetInputSchema = z.strictObject({
  room_id: z.string().min(1),
  version_group_id: z.string().min(1),
  message_id: z.string().min(1),
  expected_revision: z.number().int().nonnegative(),
  idempotency_key: z.string().min(1).max(255),
});
export type RoomAgentReplySelectionSetInput = z.infer<typeof roomAgentReplySelectionSetInputSchema>;

export const roomAgentReplySelectionResultSchema = z.strictObject({
  room_id: z.string().min(1),
  version_group_id: z.string().min(1),
  selected_message_id: z.string().min(1),
  revision: z.number().int().positive(),
});
export type RoomAgentReplySelectionResult = z.infer<typeof roomAgentReplySelectionResultSchema>;

export const roomMessageErrorCodeSchema = z.enum([
  "ROOM_NOT_FOUND",
  "ROOM_MEMBER_NOT_FOUND",
  "MESSAGE_NOT_FOUND",
  "MESSAGE_REPLY_TARGET_INVALID",
  "MESSAGE_IDEMPOTENCY_CONFLICT",
  "MESSAGE_REVISION_CONFLICT",
  "MESSAGE_NOT_OWNED",
  "MESSAGE_NOT_EDITABLE",
  "MESSAGE_ALREADY_DELETED",
  "AGENT_REPLY_VERSION_INVALID",
  "FORBIDDEN",
]);
export type RoomMessageErrorCode = z.infer<typeof roomMessageErrorCodeSchema>;

export const roomMessagesEventsInputSchema = roomIdInputSchema;
export type RoomMessagesEventsInput = z.infer<typeof roomMessagesEventsInputSchema>;

export const roomMessageCreatedOrUpdatedEventSchema = z.object({
  schema_version: z.literal(1),
  event_id: z.string().min(1),
  type: z.enum(["room.message.created", "room.message.updated"]),
  source: z.literal("backend"),
  room_id: z.string().min(1),
  message: roomTimelineMessageSchema,
  occurred_at_ms: z.number().int().nonnegative(),
}).passthrough();

export const roomMessageDeletedEventSchema = z.object({
  schema_version: z.literal(1),
  event_id: z.string().min(1),
  type: z.literal("room.message.deleted"),
  source: z.literal("backend"),
  room_id: z.string().min(1),
  message_id: z.string().min(1),
  occurred_at_ms: z.number().int().nonnegative(),
}).passthrough();

export const roomAgentReplySelectionChangedEventSchema = z.strictObject({
  schema_version: z.literal(1),
  event_id: z.string().min(1),
  type: z.literal("room.agent_reply.selection_changed"),
  source: z.literal("backend"),
  room_id: z.string().min(1),
  version_group_id: z.string().min(1),
  selected_message_id: z.string().min(1),
  revision: z.number().int().positive(),
  occurred_at_ms: z.number().int().nonnegative(),
});

export const roomMessageEventSchema = z.discriminatedUnion("type", [
  roomMessageCreatedOrUpdatedEventSchema,
  roomMessageDeletedEventSchema,
  roomAgentReplySelectionChangedEventSchema,
]);
export type RoomMessageEvent = z.infer<typeof roomMessageEventSchema>;

export const roomMessageEventStreamSchema = z.custom<AsyncIterable<unknown>>(isAsyncIterable).transform(async function* (iter) {
  for await (const value of iter) {
    yield roomMessageEventSchema.parse(value);
  }
});
export type RoomMessageEventStream = z.infer<typeof roomMessageEventStreamSchema>;

export const roomAgentTurnWatchInputSchema = z.object({
  room_id: z.string().min(1),
  message_id: z.string().min(1),
});
export type RoomAgentTurnWatchInput = z.infer<typeof roomAgentTurnWatchInputSchema>;

export const roomAgentSessionWatchInputSchema = roomAgentTurnWatchInputSchema;
export type RoomAgentSessionWatchInput = RoomAgentTurnWatchInput;

export const roomAgentTurnWatchEventSchema = roomAgentTurnEventSchema;
export type RoomAgentTurnWatchEvent = RoomAgentTurnEvent;

export const roomAgentTurnWatchEventStreamSchema = roomAgentTurnEventStreamSchema;
export type RoomAgentTurnWatchEventStream = z.infer<typeof roomAgentTurnWatchEventStreamSchema>;

export const roomMembersListInputSchema = roomIdInputSchema;
export type RoomMembersListInput = z.infer<typeof roomMembersListInputSchema>;

export const roomMembersListResultSchema = z.object({
  room_id: z.string().min(1),
  items: z.array(roomMemberSchema),
}).passthrough();
export type RoomMembersListResult = z.infer<typeof roomMembersListResultSchema>;

export const roomMembersAddInputSchema = z.discriminatedUnion("actor_type", [
  z.strictObject({
    room_id: z.string().min(1),
    actor_id: z.string().min(1),
    actor_type: z.literal("agent"),
  }),
  z.strictObject({
    room_id: z.string().min(1),
    actor_id: z.string().min(1),
    actor_type: z.literal("human"),
    executor_id: z.never().optional(),
  }),
]);
export type RoomMembersAddInput = z.infer<typeof roomMembersAddInputSchema>;

export const roomMembersRemoveInputSchema = z.object({
  room_id: z.string().min(1),
  actor_id: z.string().min(1),
});
export type RoomMembersRemoveInput = z.infer<typeof roomMembersRemoveInputSchema>;

export const roomMembersAddResultSchema = roomMembersListResultSchema;
export type RoomMembersAddResult = z.infer<typeof roomMembersAddResultSchema>;

export const roomMembersRemoveResultSchema = roomMembersListResultSchema;
export type RoomMembersRemoveResult = z.infer<typeof roomMembersRemoveResultSchema>;

export const roomMembersSyncInputSchema = z.object({
  room_id: z.string().min(1),
  members: z.array(roomMemberSchema),
});
export type RoomMembersSyncInput = z.infer<typeof roomMembersSyncInputSchema>;

export const roomMembersSyncResultSchema = z.object({
  synced: z.literal(true),
  room_id: z.string().min(1),
  count: z.number().int().nonnegative(),
}).passthrough();
export type RoomMembersSyncResult = z.infer<typeof roomMembersSyncResultSchema>;

export const roomInteractionRespondInputSchema = z.object({
  room_id: z.string().min(1),
  message_id: z.string().min(1),
  interaction_id: z.string().min(1),
  response: z.union([
    z.enum(["approve", "reject"]),
    z.strictObject({
      answers: z.record(z.string(), z.array(z.string())),
      resolution: z.enum(["answered", "dismissed", "timed_out"]),
    }),
  ]),
  client_response_id: z.string().min(1).optional(),
});
export type RoomInteractionRespondInput = z.infer<typeof roomInteractionRespondInputSchema>;

export const roomInteractionRespondResultSchema = z.object({
  room_id: z.string().min(1),
  message: roomTimelineMessageSchema,
}).passthrough();
export type RoomInteractionRespondResult = z.infer<typeof roomInteractionRespondResultSchema>;

export const roomInteractionSnoozeInputSchema = z.strictObject({
  room_id: z.string().min(1),
  message_id: z.string().min(1),
  interaction_id: z.string().min(1),
});
export const roomInteractionSnoozeResultSchema = z.strictObject({
  accepted: z.literal(true),
  deadline_at_ms: z.number().int().nonnegative(),
});

export const roomInteractionErrorCodeSchema = z.enum([
  "ROOM_NOT_FOUND",
  "ROOM_MEMBER_NOT_FOUND",
  "INTERACTION_NOT_FOUND",
  "INTERACTION_NOT_PENDING",
  "INTERACTION_RESPONSE_INVALID",
  "INTERACTION_IDEMPOTENCY_CONFLICT",
  "EXECUTION_NOT_ACTIVE",
  "COMPANY_RUNTIME_UNAVAILABLE",
  "FORBIDDEN",
]);
export type RoomInteractionErrorCode = z.infer<typeof roomInteractionErrorCodeSchema>;

export const roomMessagesInputSchema = roomMessagesListInputSchema;
export const roomMessagesResultSchema = roomMessagesListResultSchema;
export const roomMembersResultSchema = roomMembersListResultSchema;

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}
