import { z } from "zod";

import { publicOperationErrorSchema } from "./company.js";

export const agentRoomTriggerPolicySchema = z.enum([
  "human_explicit",
  "member_explicit",
  "human_auto",
  "member_auto",
  "human_explicit_agent_auto",
  "agent_explicit_human_auto",
]);
export type AgentRoomTriggerPolicy = z.infer<typeof agentRoomTriggerPolicySchema>;

export const roomAgentTriggerPolicyInputSchema = z.strictObject({
  room_id: z.string().min(1),
  agent_member_id: z.string().min(1),
});
export type RoomAgentTriggerPolicyInput = z.infer<typeof roomAgentTriggerPolicyInputSchema>;

export const roomAgentTriggerPolicySetInputSchema = roomAgentTriggerPolicyInputSchema.extend({
  policy: agentRoomTriggerPolicySchema,
  expected_version: z.number().int().nonnegative().optional(),
});
export type RoomAgentTriggerPolicySetInput = z.infer<typeof roomAgentTriggerPolicySetInputSchema>;

export const roomAgentTriggerPolicyResultSchema = z.strictObject({
  room_id: z.string().min(1),
  agent_member_id: z.string().min(1),
  policy: agentRoomTriggerPolicySchema,
  version: z.number().int().positive(),
  updated_at_ms: z.number().int().nonnegative(),
});
export type RoomAgentTriggerPolicyResult = z.infer<typeof roomAgentTriggerPolicyResultSchema>;

export const agentRoomExecutionStatusSchema = z.enum([
  "pending",
  "dispatched",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export type AgentRoomExecutionStatus = z.infer<typeof agentRoomExecutionStatusSchema>;

export const agentRoomTriggerKindSchema = z.enum([
  "mention",
  "direct_reply",
  "automatic",
]);
export type AgentRoomTriggerKind = z.infer<typeof agentRoomTriggerKindSchema>;

export const agentRoomExecutionSummarySchema = z.strictObject({
  execution_id: z.string().min(1),
  cascade_id: z.string().min(1),
  room_id: z.string().min(1),
  agent_member_id: z.string().min(1),
  source_message_id: z.string().min(1),
  trigger: agentRoomTriggerKindSchema,
  status: agentRoomExecutionStatusSchema,
  started_at_ms: z.number().int().nonnegative().nullable(),
  completed_at_ms: z.number().int().nonnegative().nullable(),
  error: publicOperationErrorSchema.nullable(),
});
export type AgentRoomExecutionSummary = z.infer<typeof agentRoomExecutionSummarySchema>;

export const roomAgentExecutionGetInputSchema = z.strictObject({
  room_id: z.string().min(1),
  execution_id: z.string().min(1),
});
export type RoomAgentExecutionGetInput = z.infer<typeof roomAgentExecutionGetInputSchema>;

export const roomAgentActivityWatchInputSchema = roomAgentExecutionGetInputSchema;
export type RoomAgentActivityWatchInput = z.infer<typeof roomAgentActivityWatchInputSchema>;

export const agentRoomErrorCodeSchema = z.enum([
  "ROOM_NOT_FOUND",
  "ROOM_MEMBER_NOT_FOUND",
  "AGENT_MEMBER_REQUIRED",
  "AGENT_NOT_IN_ROOM",
  "AGENT_NOT_READY_FOR_ROOM",
  "TRIGGER_POLICY_VERSION_CONFLICT",
  "MEMBER_EXECUTOR_NOT_CONFIGURED",
  "MEMBER_EXECUTOR_SWITCH_IN_PROGRESS",
  "COMPANY_RUNTIME_UNAVAILABLE",
  "EXECUTION_NOT_FOUND",
  "FORBIDDEN",
]);
export type AgentRoomErrorCode = z.infer<typeof agentRoomErrorCodeSchema>;
