import { z } from "zod";

export const desktopNotificationEventsInputSchema = z.object({}).strict();
export type DesktopNotificationEventsInput = z.infer<typeof desktopNotificationEventsInputSchema>;

const base = {
  schema_version: z.literal(1),
  event_id: z.string().min(1).max(256),
  occurred_at_ms: z.number().int().nonnegative(),
};

export const desktopRoomMessageNotificationSchema = z.strictObject({
  ...base,
  type: z.literal("room.message"),
  room_id: z.string().min(1),
  room_name: z.string().min(1),
  message_id: z.string().min(1),
  sender_name: z.string().min(1),
  preview: z.string().max(240),
});

export const desktopAgentTerminalNotificationSchema = z.strictObject({
  ...base,
  type: z.literal("agent.terminal"),
  status: z.enum(["completed", "failed", "interrupted"]),
  target: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("home"), thread_id: z.string().min(1), title: z.string().min(1) }),
    z.strictObject({ kind: z.literal("room"), room_id: z.string().min(1), room_name: z.string().min(1), message_id: z.string().min(1) }),
  ]),
  preview: z.string().max(240).nullable(),
});

export const desktopNotificationEventSchema = z.discriminatedUnion("type", [desktopRoomMessageNotificationSchema, desktopAgentTerminalNotificationSchema]);
export type DesktopNotificationEvent = z.infer<typeof desktopNotificationEventSchema>;

export const desktopNotificationEventStreamSchema = z.custom<AsyncIterable<unknown>>(isAsyncIterable).transform(async function* (iter) {
  for await (const value of iter) yield desktopNotificationEventSchema.parse(value);
});

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}
