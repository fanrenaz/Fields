import { z } from "zod";

import {
  agentRoomExecutionStatusSchema,
  agentRoomTriggerKindSchema,
  agentRoomTriggerPolicySchema,
} from "../public/agent-room.js";
import {
  roomMessageBodySchema,
  roomReferenceTargetSchema,
  roomMessageReplyToSchema,
  roomMessageSenderSchema,
  roomMessageImageAttachmentsSchema,
} from "../public/room.js";
import { publicOperationErrorSchema } from "../public/company.js";

export const agentRoomPromptMessageSchema = z.strictObject({
  message_id: z.string().min(1),
  sequence: z.number().int().positive(),
  occurred_at_ms: z.number().int().nonnegative(),
  sender: roomMessageSenderSchema,
  body: roomMessageBodySchema,
  reply_to: roomMessageReplyToSchema.nullable(),
  references: z.array(roomReferenceTargetSchema),
  image_attachments: roomMessageImageAttachmentsSchema.optional(),
});
export type AgentRoomPromptMessage = z.infer<typeof agentRoomPromptMessageSchema>;

export const agentRoomThreadStateSchema = z.enum(["active", "retained"]);
export type AgentRoomThreadState = z.infer<typeof agentRoomThreadStateSchema>;

export const agentRoomThreadSchema = z.strictObject({
  room_id: z.string().min(1),
  agent_member_id: z.string().min(1),
  codex_thread_id: z.string().min(1).nullable(),
  state: agentRoomThreadStateSchema,
  last_consumed_sequence: z.number().int().nonnegative(),
  membership_version: z.number().int().positive(),
  updated_at_ms: z.number().int().nonnegative(),
});
export type AgentRoomThread = z.infer<typeof agentRoomThreadSchema>;

export const agentRoomCompanyFileSnapshotSchema = z.strictObject({
  file_id: z.string().min(1),
  version_id: z.string().min(1),
  message_ids: z.array(z.string().min(1)).min(1).max(11),
  name: z.string().trim().min(1).max(255),
  mime_type: z.string().trim().min(1).max(255),
  size_bytes: z.number().int().positive().max(25 * 1024 * 1024),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  as_image: z.boolean().optional(),
});
export type AgentRoomCompanyFileSnapshot = z.infer<typeof agentRoomCompanyFileSnapshotSchema>;

export const agentRoomCompanyFileInputSchema = agentRoomCompanyFileSnapshotSchema.extend({
  download_url: z.string().url(),
  download_expires_at_ms: z.number().int().nonnegative(),
});
export type AgentRoomCompanyFileInput = z.infer<typeof agentRoomCompanyFileInputSchema>;

export const agentRoomExecutionDispatchSchema = z.strictObject({
  execution_id: z.string().min(1),
  idempotency_key: z.string().min(1),
  cascade_id: z.string().min(1),
  company_id: z.string().min(1),
  room_id: z.string().min(1),
  agent_member_id: z.string().min(1),
  membership_version: z.number().int().positive(),
  source_message_id: z.string().min(1),
  source_message_sequence: z.number().int().positive(),
  room_title: z.string().min(1),
  agent_display_name: z.string().min(1),
  agent_instructions: z.string().optional(),
  model: z.string().min(1).optional(),
  reasoning_effort: z.string().min(1).nullable().optional(),
  trigger: agentRoomTriggerKindSchema,
  trigger_policy: agentRoomTriggerPolicySchema,
  thread: agentRoomThreadSchema,
  regeneration: z.strictObject({
    source_execution_id: z.string().min(1),
    fork_parent_thread_id: z.string().min(1),
    fork_before_turn_id: z.string().min(1),
  }).nullable().optional(),
  prompt_messages: z.array(agentRoomPromptMessageSchema).min(1).max(11),
  company_file_inputs: z.array(agentRoomCompanyFileInputSchema).max(200).default([]),
}).superRefine((dispatch, context) => {
  const sequences = dispatch.prompt_messages.map((message) => message.sequence);
  if (sequences.some((sequence, index) => index > 0 && sequence <= sequences[index - 1]!)) {
    context.addIssue({
      code: "custom",
      path: ["prompt_messages"],
      message: "Prompt Room messages must be strictly ordered by Backend sequence.",
    });
  }
  if (!sequences.includes(dispatch.source_message_sequence)) {
    context.addIssue({
      code: "custom",
      path: ["source_message_sequence"],
      message: "The source message must be present in the unread message batch.",
    });
  }
});
export type AgentRoomExecutionDispatch = z.infer<typeof agentRoomExecutionDispatchSchema>;

export const agentRoomExecutionAcceptedSchema = z.strictObject({
  accepted: z.literal(true),
  execution_id: z.string().min(1),
  idempotency_key: z.string().min(1),
  duplicate: z.boolean(),
});
export type AgentRoomExecutionAccepted = z.infer<typeof agentRoomExecutionAcceptedSchema>;

export const agentRoomInteractionResponseDispatchSchema = z.strictObject({
  persisted_response_id: z.string().min(1),
  idempotency_key: z.string().min(1),
  execution_id: z.string().min(1),
  room_id: z.string().min(1),
  agent_member_id: z.string().min(1),
  message_id: z.string().min(1),
  interaction_id: z.string().min(1),
  responder_member_id: z.string().min(1),
  response: z.union([
    z.enum(["approve", "reject"]),
    z.strictObject({
      answers: z.record(z.string(), z.array(z.string())),
      resolution: z.enum(["answered", "dismissed", "timed_out"]),
    }),
  ]),
  responded_at_ms: z.number().int().nonnegative(),
});
export type AgentRoomInteractionResponseDispatch = z.infer<typeof agentRoomInteractionResponseDispatchSchema>;

export const agentRoomInteractionResponseAcceptedSchema = z.strictObject({
  accepted: z.literal(true),
  persisted_response_id: z.string().min(1),
  idempotency_key: z.string().min(1),
  duplicate: z.boolean(),
});
export type AgentRoomInteractionResponseAccepted = z.infer<typeof agentRoomInteractionResponseAcceptedSchema>;

export const agentRoomExecutionCompletionSchema = z.strictObject({
  execution_id: z.string().min(1),
  idempotency_key: z.string().min(1),
  cascade_id: z.string().min(1),
  room_id: z.string().min(1),
  agent_member_id: z.string().min(1),
  status: z.enum(["succeeded", "failed", "cancelled"]),
  codex_thread_id: z.string().min(1).nullable(),
  codex_turn_id: z.string().min(1).nullable(),
  consumed_through_sequence: z.number().int().positive(),
  final_answer_markdown: z.string().min(1).optional(),
  error: publicOperationErrorSchema.nullable(),
  completed_at_ms: z.number().int().nonnegative(),
}).superRefine((completion, context) => {
  if (completion.status === "succeeded" && completion.error !== null) {
    context.addIssue({ code: "custom", path: ["error"], message: "Successful executions cannot carry an error." });
  }
  if (completion.status !== "succeeded" && completion.error === null) {
    context.addIssue({ code: "custom", path: ["error"], message: "Failed or cancelled executions require an error." });
  }
  if (completion.status === "succeeded" && completion.codex_thread_id === null) {
    context.addIssue({
      code: "custom",
      path: ["codex_thread_id"],
      message: "A successful execution must retain its Codex Thread identifier.",
    });
  }
  if (completion.status !== "succeeded" && completion.final_answer_markdown !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["final_answer_markdown"],
      message: "Failed or cancelled executions cannot publish a final answer.",
    });
  }
});
export type AgentRoomExecutionCompletion = z.infer<typeof agentRoomExecutionCompletionSchema>;

export const agentRoomExecutionProgressSchema = z.strictObject({
  execution_id: z.string().min(1),
  status: agentRoomExecutionStatusSchema,
  codex_turn_id: z.string().min(1).nullable(),
  occurred_at_ms: z.number().int().nonnegative(),
});
export type AgentRoomExecutionProgress = z.infer<typeof agentRoomExecutionProgressSchema>;

export const agentRoomCursorCommitSchema = z.strictObject({
  execution_id: z.string().min(1),
  room_id: z.string().min(1),
  agent_member_id: z.string().min(1),
  consumed_through_sequence: z.number().int().positive(),
  codex_thread_id: z.string().min(1),
});
export type AgentRoomCursorCommit = z.infer<typeof agentRoomCursorCommitSchema>;

export const agentRoomCascadeSchema = z.strictObject({
  cascade_id: z.string().min(1),
  root_message_id: z.string().min(1),
  status: z.enum(["active", "silent", "failed"]),
  active_execution_count: z.number().int().nonnegative(),
  published_message_count: z.number().int().nonnegative(),
  updated_at_ms: z.number().int().nonnegative(),
});
export type AgentRoomCascade = z.infer<typeof agentRoomCascadeSchema>;
