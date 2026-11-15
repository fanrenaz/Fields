import { z } from "zod";
import { companyRuntimeIdentitySchema } from "./company-runtime.js";

export const homeTerminalNotificationInputSchema = z.object({
  identity: companyRuntimeIdentitySchema,
  event_id: z.string().min(1).max(256),
  recipient_actor_id: z.string().min(1),
  thread_id: z.string().min(1),
  thread_title: z.string().min(1).max(255),
  status: z.enum(["completed", "failed", "interrupted"]),
  preview: z.string().max(240).nullable(),
  occurred_at_ms: z.number().int().nonnegative(),
});
export const homeTerminalNotificationResultSchema = z.object({
  accepted: z.literal(true),
  activity_id: z.string().min(1),
});
export type HomeTerminalNotificationInput = z.infer<typeof homeTerminalNotificationInputSchema>;
