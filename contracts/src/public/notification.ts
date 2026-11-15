import { z } from "zod";

export const notificationTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("home"), thread_id: z.string().min(1), title: z.string().min(1) }),
  z.object({ kind: z.literal("room"), room_id: z.string().min(1), room_name: z.string().min(1), message_id: z.string().min(1).nullable() }),
]);

export const notificationActivitySchema = z.object({
  schema_version: z.literal(1),
  activity_id: z.string().min(1),
  read_through: z.string().min(1),
  kind: z.enum(["room.message", "agent.terminal"]),
  occurred_at_ms: z.number().int().nonnegative(),
  title: z.string().min(1),
  body: z.string().nullable(),
  status: z.enum(["completed", "failed", "interrupted"]).nullable(),
  target: notificationTargetSchema,
  read: z.boolean(),
});

export const notificationInboxListInputSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export const notificationInboxListResultSchema = z.object({
  items: z.array(notificationActivitySchema),
  next_cursor: z.string().nullable(),
  unread_count: z.number().int().nonnegative(),
});
export const notificationTargetRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("home"), thread_id: z.string().min(1) }),
  z.object({ kind: z.literal("room"), room_id: z.string().min(1) }),
]);
export const notificationMarkReadInputSchema = z.object({ target: notificationTargetRefSchema, through: z.string().min(1) });
export const notificationMarkReadResultSchema = z.object({ marked_read: z.literal(true) });

export const pushSubscriptionKeysSchema = z.object({
  p256dh: z.string().min(1).max(1024),
  auth: z.string().min(1).max(1024),
});
export const pushSubscriptionUpsertInputSchema = z.object({
  endpoint: z.string().url().max(4096),
  expiration_time_ms: z.number().int().nonnegative().nullable(),
  keys: pushSubscriptionKeysSchema,
  locale: z.enum(["en", "zh-CN", "zh-TW"]),
});
export const pushSubscriptionSchema = z.object({
  subscription_id: z.string().min(1),
  expiration_time_ms: z.number().int().nonnegative().nullable(),
  created_at_ms: z.number().int().nonnegative(),
  updated_at_ms: z.number().int().nonnegative(),
});
export const pushSubscriptionListResultSchema = z.object({ items: z.array(pushSubscriptionSchema) });
export const pushSubscriptionDeleteInputSchema = z.object({ subscription_id: z.string().min(1) });
export const pushSubscriptionDeleteResultSchema = z.object({ deleted: z.literal(true) });
export const webPushPublicKeyResultSchema = z.object({ public_key: z.string().min(1) });

export type NotificationTarget = z.infer<typeof notificationTargetSchema>;
export type NotificationActivity = z.infer<typeof notificationActivitySchema>;
export type NotificationInboxListInput = z.infer<typeof notificationInboxListInputSchema>;
export type NotificationInboxListResult = z.infer<typeof notificationInboxListResultSchema>;
export type NotificationTargetRef = z.infer<typeof notificationTargetRefSchema>;
export type PushSubscriptionUpsertInput = z.infer<typeof pushSubscriptionUpsertInputSchema>;
export type PushSubscription = z.infer<typeof pushSubscriptionSchema>;
