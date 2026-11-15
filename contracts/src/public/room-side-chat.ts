import { z } from "zod";

import { homeAgentTurnEventStreamSchema } from "./agent-activity.js";
import {
  homeThreadReadResultSchema,
  homeTurnSubmitResultSchema,
} from "./home.js";

export const roomSideChatReadInputSchema = z.strictObject({
  room_id: z.string().min(1),
});
export type RoomSideChatReadInput = z.infer<typeof roomSideChatReadInputSchema>;

export const roomSideChatReadResultSchema = z.strictObject({
  room_id: z.string().min(1),
  thread_id: z.string().min(1).nullable(),
  thread: homeThreadReadResultSchema.nullable(),
});
export type RoomSideChatReadResult = z.infer<typeof roomSideChatReadResultSchema>;

export const roomSideChatTurnSubmitInputSchema = roomSideChatReadInputSchema.extend({
  prompt: z.string().trim().min(1).max(40_000),
  client_message_id: z.string().min(1).optional(),
  timeout_ms: z.number().int().min(1_000).max(900_000).optional(),
});
export type RoomSideChatTurnSubmitInput = z.infer<
  typeof roomSideChatTurnSubmitInputSchema
>;

export const roomSideChatTurnSubmitResultSchema = z.strictObject({
  room_id: z.string().min(1),
  turn: homeTurnSubmitResultSchema,
});
export type RoomSideChatTurnSubmitResult = z.infer<
  typeof roomSideChatTurnSubmitResultSchema
>;

export const roomSideChatTurnEventsInputSchema = roomSideChatReadInputSchema;
export const roomSideChatTurnEventStreamSchema = homeAgentTurnEventStreamSchema;
