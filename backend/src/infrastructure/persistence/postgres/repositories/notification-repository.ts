import type { HomeTerminalNotificationInput } from "@fields/contracts/internal/notification";
import type { NotificationApplication } from "../../../../application/notification/index.js";
import type { NotificationActivity, NotificationInboxListInput, NotificationTargetRef, PushSubscriptionUpsertInput } from "@fields/contracts/public/notification";
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { BackendDatabase } from "../database-service.js";

type ActivityRow = { activity_id: string; kind: "room.message" | "agent.terminal"; target_kind: "home" | "room"; target_id: string; target_title: string; target_message_id: string | null; body: string | null; status: "completed" | "failed" | "interrupted" | null; occurred_at_ms: string | number; sequence: string | number; read: boolean };
type SubscriptionRow = { subscription_id: string; expiration_time_ms: string | number | null; created_at_ms: string | number; updated_at_ms: string | number };

export class PostgresNotificationApplication implements NotificationApplication {
  constructor(private readonly db: BackendDatabase, private readonly vapidPublicKey: string, private readonly now: () => number = Date.now) {}

  publicKey() {
    if (!this.vapidPublicKey) throw new Error("Web Push is not configured.");
    return { public_key: this.vapidPublicKey };
  }

  async unreadCount(companyId: string, actorId: string, target: NotificationTargetRef) {
    return (await this.targetState(companyId, actorId, target)).unreadCount;
  }

  async targetState(companyId: string, actorId: string, target: NotificationTargetRef) {
    const targetId = target.kind === "home" ? target.thread_id : target.room_id;
    const rows = rowsFromResult<{ count: string | number; latest_sequence: string | number | null }>(await this.db.execute(sql`
      select count(*) filter (where activity.sequence > coalesce(cursor.through_sequence, 0)) as count,
        max(activity.sequence) as latest_sequence
      from notification_activities activity
      left join notification_read_cursors cursor on cursor.company_id = activity.company_id
        and cursor.recipient_actor_id = activity.recipient_actor_id and cursor.target_kind = activity.target_kind and cursor.target_id = activity.target_id
      where activity.company_id = ${companyId} and activity.recipient_actor_id = ${actorId}
        and activity.target_kind = ${target.kind} and activity.target_id = ${targetId}
    `));
    return {
      unreadCount: Number(rows[0]?.count ?? 0),
      readThrough: rows[0]?.latest_sequence === null || rows[0]?.latest_sequence === undefined
        ? null
        : encodeCursor(rows[0].latest_sequence),
    };
  }

  async list(companyId: string, actorId: string, input: NotificationInboxListInput) {
    const before = decodeCursor(input.cursor);
    const rows = rowsFromResult<ActivityRow>(await this.db.execute(sql`
      select activity.activity_id, activity.kind, activity.target_kind, activity.target_id,
        activity.target_title, activity.target_message_id, activity.body, activity.status,
        activity.occurred_at_ms, activity.sequence,
        activity.sequence <= coalesce(cursor.through_sequence, 0) as read
      from notification_activities activity
      left join notification_read_cursors cursor
        on cursor.company_id = activity.company_id
       and cursor.recipient_actor_id = activity.recipient_actor_id
       and cursor.target_kind = activity.target_kind
       and cursor.target_id = activity.target_id
      where activity.company_id = ${companyId}
        and activity.recipient_actor_id = ${actorId}
        and (${before}::bigint is null or activity.sequence < ${before}::bigint)
      order by activity.sequence desc
      limit ${input.limit + 1}
    `));
    const page = rows.slice(0, input.limit);
    const unreadRows = rowsFromResult<{ count: string | number }>(await this.db.execute(sql`
      select count(*) as count from notification_activities activity
      left join notification_read_cursors cursor
        on cursor.company_id = activity.company_id and cursor.recipient_actor_id = activity.recipient_actor_id
       and cursor.target_kind = activity.target_kind and cursor.target_id = activity.target_id
      where activity.company_id = ${companyId} and activity.recipient_actor_id = ${actorId}
        and activity.sequence > coalesce(cursor.through_sequence, 0)
    `));
    return { items: page.map(activityFromRow), next_cursor: rows.length > input.limit ? encodeCursor(page.at(-1)!.sequence) : null, unread_count: Number(unreadRows[0]?.count ?? 0) };
  }

  async markRead(companyId: string, actorId: string, target: NotificationTargetRef, through: string) {
    const targetId = target.kind === "home" ? target.thread_id : target.room_id;
    const throughSequence = decodeCursor(through);
    if (throughSequence === null) throw new Error("Invalid notification read cursor.");
    await this.db.execute(sql`
      insert into notification_read_cursors (company_id, recipient_actor_id, target_kind, target_id, through_sequence, updated_at_ms)
      select ${companyId}, ${actorId}, ${target.kind}, ${targetId}, activity.sequence, ${this.now()}
      from notification_activities activity
      where activity.company_id = ${companyId} and activity.recipient_actor_id = ${actorId}
        and activity.target_kind = ${target.kind} and activity.target_id = ${targetId}
        and activity.sequence = ${throughSequence}::bigint
      on conflict (company_id, recipient_actor_id, target_kind, target_id) do update
      set through_sequence = greatest(notification_read_cursors.through_sequence, excluded.through_sequence), updated_at_ms = excluded.updated_at_ms
    `);
    return { marked_read: true as const };
  }

  async listSubscriptions(companyId: string, actorId: string) {
    const rows = rowsFromResult<SubscriptionRow>(await this.db.execute(sql`select subscription_id, expiration_time_ms, created_at_ms, updated_at_ms from notification_push_subscriptions where company_id = ${companyId} and recipient_actor_id = ${actorId} order by created_at_ms desc`));
    return { items: rows.map(subscriptionFromRow) };
  }

  async upsertSubscription(companyId: string, actorId: string, input: PushSubscriptionUpsertInput) {
    const id = `push_${createHash("sha256").update(input.endpoint).digest("hex").slice(0, 32)}`;
    const now = this.now();
    const rows = rowsFromResult<SubscriptionRow>(await this.db.execute(sql`
      insert into notification_push_subscriptions (subscription_id, company_id, recipient_actor_id, endpoint, p256dh, auth, locale, expiration_time_ms, created_at_ms, updated_at_ms)
      values (${id}, ${companyId}, ${actorId}, ${input.endpoint}, ${input.keys.p256dh}, ${input.keys.auth}, ${input.locale}, ${input.expiration_time_ms}, ${now}, ${now})
      on conflict (endpoint) do update set company_id = excluded.company_id, recipient_actor_id = excluded.recipient_actor_id,
        p256dh = excluded.p256dh, auth = excluded.auth, locale = excluded.locale, expiration_time_ms = excluded.expiration_time_ms, updated_at_ms = excluded.updated_at_ms
      where notification_push_subscriptions.company_id = excluded.company_id
        and notification_push_subscriptions.recipient_actor_id = excluded.recipient_actor_id
      returning subscription_id, expiration_time_ms, created_at_ms, updated_at_ms
    `));
    if (!rows[0]) throw new Error("Push subscription belongs to a different member.");
    return subscriptionFromRow(rows[0]!);
  }

  async deleteSubscription(companyId: string, actorId: string, subscriptionId: string) {
    await this.db.execute(sql`delete from notification_push_subscriptions where subscription_id = ${subscriptionId} and company_id = ${companyId} and recipient_actor_id = ${actorId}`);
    return { deleted: true as const };
  }

  async acceptHomeTerminal(input: HomeTerminalNotificationInput) {
    const sourceEventId = `${input.identity.company_id}:${input.event_id}`;
    const activityId = `notification_${createHash("sha256").update(sourceEventId).digest("hex").slice(0, 32)}`;
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        insert into notification_activities (activity_id, source_event_id, company_id, recipient_actor_id, kind, target_kind, target_id, target_title, target_message_id, body, status, occurred_at_ms, created_at_ms)
        values (${activityId}, ${sourceEventId}, ${input.identity.company_id}, ${input.recipient_actor_id}, 'agent.terminal', 'home', ${input.thread_id}, ${input.thread_title}, null, ${input.preview}, ${input.status}, ${input.occurred_at_ms}, ${this.now()})
        on conflict (source_event_id) do nothing
      `);
      await tx.execute(sql`
        insert into notification_push_deliveries (activity_id, subscription_id, next_attempt_at_ms, updated_at_ms)
        select activity.activity_id, subscription.subscription_id, ${this.now()}, ${this.now()}
        from notification_activities activity join notification_push_subscriptions subscription
          on subscription.company_id = activity.company_id and subscription.recipient_actor_id = activity.recipient_actor_id
        where activity.source_event_id = ${sourceEventId}
        on conflict (activity_id, subscription_id) do nothing
      `);
    });
    return { accepted: true as const, activity_id: activityId };
  }
}

function activityFromRow(row: ActivityRow): NotificationActivity { return { schema_version: 1, activity_id: row.activity_id, read_through: encodeCursor(row.sequence), kind: row.kind, occurred_at_ms: Number(row.occurred_at_ms), title: row.target_title, body: row.body, status: row.status, target: row.target_kind === "home" ? { kind: "home", thread_id: row.target_id, title: row.target_title } : { kind: "room", room_id: row.target_id, room_name: row.target_title, message_id: row.target_message_id }, read: row.read }; }
function subscriptionFromRow(row: SubscriptionRow) { return { subscription_id: row.subscription_id, expiration_time_ms: row.expiration_time_ms === null ? null : Number(row.expiration_time_ms), created_at_ms: Number(row.created_at_ms), updated_at_ms: Number(row.updated_at_ms) }; }
function encodeCursor(value: string | number) { return Buffer.from(String(value)).toString("base64url"); }
function decodeCursor(value?: string) { if (!value) return null; const decoded = Buffer.from(value, "base64url").toString("utf8"); return /^\d+$/.test(decoded) ? decoded : null; }
function rowsFromResult<T>(result: unknown): T[] { if (Array.isArray(result)) return result as T[]; if (result && typeof result === "object" && "rows" in result && Array.isArray((result as { rows: unknown }).rows)) return (result as { rows: T[] }).rows; return []; }
