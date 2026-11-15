import { z } from "zod";

import {
  homeThreadReadResultSchema,
  homeTurnSubmitResultSchema,
} from "./home.js";

export const agentProfileReadinessSchema = z.enum(["draft", "ready"]);
export type AgentProfileReadiness = z.infer<typeof agentProfileReadinessSchema>;

export const agentMemoryStatusSchema = z.enum(["ready", "applying", "failed"]);
export type AgentMemoryStatus = z.infer<typeof agentMemoryStatusSchema>;

export const agentMemoryProfileSchema = z.strictObject({
  enabled: z.boolean(),
  applied_enabled: z.boolean(),
  status: agentMemoryStatusSchema,
  error_code: z.string().min(1).nullable(),
});
export type AgentMemoryProfile = z.infer<typeof agentMemoryProfileSchema>;

export const agentBuilderProfileSchema = z.strictObject({
  agent_member_id: z.string().min(1),
  description: z.string(),
  avatar: z.string(),
  instructions: z.string(),
  readiness: agentProfileReadinessSchema,
  memory: agentMemoryProfileSchema,
  revision: z.number().int().nonnegative(),
  updated_at_ms: z.number().int().nonnegative(),
});
export type AgentBuilderProfile = z.infer<typeof agentBuilderProfileSchema>;

export const agentBuilderProfileInputSchema = z.strictObject({
  agent_member_id: z.string().min(1),
});

export const agentBuilderProfileUpdateInputSchema = agentBuilderProfileInputSchema.extend({
  description: z.string().max(2_000),
  avatar: z.string().max(32),
  instructions: z.string().max(40_000),
  readiness: agentProfileReadinessSchema,
  memory_enabled: z.boolean(),
  expected_revision: z.number().int().nonnegative(),
});

export const agentBuilderTopicSchema = z.strictObject({
  topic_id: z.string().min(1),
  agent_member_id: z.string().min(1),
  title: z.string().min(1),
  thread_id: z.string().min(1).nullable(),
  created_at_ms: z.number().int().nonnegative(),
  updated_at_ms: z.number().int().nonnegative(),
});
export type AgentBuilderTopic = z.infer<typeof agentBuilderTopicSchema>;

export const agentBuilderTopicListInputSchema = agentBuilderProfileInputSchema;
export const agentBuilderTopicListResultSchema = z.strictObject({
  items: z.array(agentBuilderTopicSchema),
});

export const agentBuilderTopicCreateInputSchema = agentBuilderProfileInputSchema.extend({
  title: z.string().trim().min(1).max(120).optional(),
});
export const agentBuilderTopicReadInputSchema = z.strictObject({
  agent_member_id: z.string().min(1),
  topic_id: z.string().min(1),
});
export const agentBuilderTopicReadResultSchema = z.strictObject({
  topic: agentBuilderTopicSchema,
  thread: homeThreadReadResultSchema.nullable(),
});

export const agentBuilderTurnSubmitInputSchema = agentBuilderTopicReadInputSchema.extend({
  prompt: z.string().trim().min(1).max(40_000),
  client_message_id: z.string().min(1).optional(),
  timeout_ms: z.number().int().min(1_000).max(900_000).optional(),
});
export const agentBuilderTurnSubmitResultSchema = z.strictObject({
  topic: agentBuilderTopicSchema,
  turn: homeTurnSubmitResultSchema,
  profile: agentBuilderProfileSchema,
});
