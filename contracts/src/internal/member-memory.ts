import { z } from "zod";

import { companyRuntimeIdentitySchema } from "./company-runtime.js";

export const runtimeMemberMemoryApplyInputSchema = companyRuntimeIdentitySchema.extend({
  member_id: z.string().min(1),
  operation_id: z.string().min(1),
  enabled: z.boolean(),
  previous_enabled: z.boolean(),
  memory_model: z.string().trim().min(1).max(512),
});
export type RuntimeMemberMemoryApplyInput = z.infer<typeof runtimeMemberMemoryApplyInputSchema>;

export const runtimeMemberMemoryApplyResultSchema = z.strictObject({
  accepted: z.literal(true),
});

export const runtimeMemberMemoryCompletedInputSchema = z.strictObject({
  identity: companyRuntimeIdentitySchema,
  member_id: z.string().min(1),
  operation_id: z.string().min(1),
  applied_enabled: z.boolean(),
  status: z.enum(["ready", "failed"]),
  error_code: z.string().min(1).nullable(),
  completed_at_ms: z.number().int().nonnegative(),
});
