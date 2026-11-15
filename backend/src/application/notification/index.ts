import type {
  NotificationInboxListInput,
  NotificationInboxListResult,
  NotificationTargetRef,
  PushSubscription,
  PushSubscriptionUpsertInput,
} from "@fields/contracts/public/notification";
import type { HomeTerminalNotificationInput } from "@fields/contracts/internal/notification";

export interface NotificationApplication {
  list(companyId: string, actorId: string, input: NotificationInboxListInput): Promise<NotificationInboxListResult>;
  markRead(companyId: string, actorId: string, target: NotificationTargetRef, through: string): Promise<{ marked_read: true }>;
  listSubscriptions(companyId: string, actorId: string): Promise<{ items: PushSubscription[] }>;
  upsertSubscription(companyId: string, actorId: string, input: PushSubscriptionUpsertInput): Promise<PushSubscription>;
  deleteSubscription(companyId: string, actorId: string, subscriptionId: string): Promise<{ deleted: true }>;
  publicKey(): { public_key: string };
  acceptHomeTerminal(input: HomeTerminalNotificationInput): Promise<{ accepted: true; activity_id: string }>;
  unreadCount(companyId: string, actorId: string, target: NotificationTargetRef): Promise<number>;
  targetState(companyId: string, actorId: string, target: NotificationTargetRef): Promise<{ unreadCount: number; readThrough: string | null }>;
}
