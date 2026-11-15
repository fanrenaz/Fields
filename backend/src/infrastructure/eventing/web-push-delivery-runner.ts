import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import webpush from "web-push";
import type { BackendDatabase } from "../persistence/postgres/database-service.js";
import { emitObservabilityLog } from "../../observability/events.js";

type Delivery = { activity_id: string; subscription_id: string; endpoint: string; p256dh: string; auth: string; locale: "en" | "zh-CN" | "zh-TW"; kind: "room.message" | "agent.terminal"; target_kind: "home" | "room"; target_id: string; target_message_id: string | null; status: string | null; attempt: number };

export class PostgresWebPushDeliveryRunner {
  readonly #enabled: boolean;
  constructor(private readonly db: BackendDatabase, configuration: { subject?: string; publicKey?: string; privateKey?: string }, private readonly now: () => number = Date.now) {
    this.#enabled = Boolean(configuration.subject && configuration.publicKey && configuration.privateKey);
    if (this.#enabled) webpush.setVapidDetails(configuration.subject!, configuration.publicKey!, configuration.privateKey!);
  }

  async runTick(): Promise<{ processed: number }> {
    if (!this.#enabled) return { processed: 0 };
    const now = this.now();
    const claimToken = `push_claim_${randomUUID()}`;
    const deliveries = await this.db.transaction(async (tx) => {
      const rows = rowsFromResult<Delivery>(await tx.execute(sql`
        with due as (
          select delivery.activity_id, delivery.subscription_id
          from notification_push_deliveries delivery
          where (delivery.status = 'pending' or (delivery.status = 'claimed' and delivery.claimed_until_ms < ${now}))
            and delivery.next_attempt_at_ms <= ${now}
          order by delivery.next_attempt_at_ms
          limit 25 for update skip locked
        )
        update notification_push_deliveries delivery set status = 'claimed', claim_token = ${claimToken},
          claimed_until_ms = ${now + 30_000}, attempt = delivery.attempt + 1, updated_at_ms = ${now}
        from due, notification_activities activity, notification_push_subscriptions subscription
        where delivery.activity_id = due.activity_id and delivery.subscription_id = due.subscription_id
          and activity.activity_id = delivery.activity_id and subscription.subscription_id = delivery.subscription_id
        returning delivery.activity_id, delivery.subscription_id, subscription.endpoint, subscription.p256dh,
          subscription.auth, subscription.locale, activity.kind, activity.target_kind, activity.target_id,
          activity.target_message_id, activity.status, delivery.attempt
      `));
      return rows;
    });
    for (const delivery of deliveries) await this.deliver(delivery, claimToken);
    return { processed: deliveries.length };
  }

  private async deliver(delivery: Delivery, claimToken: string) {
    try {
      await webpush.sendNotification({ endpoint: delivery.endpoint, keys: { p256dh: delivery.p256dh, auth: delivery.auth } }, JSON.stringify(webPushPayload(delivery)), { TTL: 300 });
      await this.db.execute(sql`update notification_push_deliveries set status = 'succeeded', claim_token = null, claimed_until_ms = null, last_error_code = null, updated_at_ms = ${this.now()} where activity_id = ${delivery.activity_id} and subscription_id = ${delivery.subscription_id} and claim_token = ${claimToken}`);
      emitObservabilityLog("notification.push.delivered", { code: "push_delivered", retryable: false, "fields.operation": "notification_push_delivery" });
    } catch (error) {
      const statusCode = pushStatusCode(error);
      const terminal = statusCode === 404 || statusCode === 410 || delivery.attempt >= 8;
      const now = this.now();
      await this.db.transaction(async (tx) => {
        await tx.execute(sql`update notification_push_deliveries set status = ${terminal ? "dead_letter" : "pending"}, claim_token = null, claimed_until_ms = null, next_attempt_at_ms = ${now + retryDelay(delivery.attempt)}, last_error_code = ${statusCode ? `http_${statusCode}` : "push_send_failed"}, updated_at_ms = ${now} where activity_id = ${delivery.activity_id} and subscription_id = ${delivery.subscription_id} and claim_token = ${claimToken}`);
        if (statusCode === 404 || statusCode === 410) await tx.execute(sql`delete from notification_push_subscriptions where subscription_id = ${delivery.subscription_id}`);
      });
      emitObservabilityLog("notification.push.failed", { code: statusCode ? `http_${statusCode}` : "push_send_failed", retryable: !terminal, "fields.operation": "notification_push_delivery" });
    }
  }
}

export function webPushPayload(delivery: Pick<Delivery, "activity_id" | "kind" | "locale" | "status" | "target_kind" | "target_id" | "target_message_id">) {
  const titles = delivery.locale === "zh-CN" ? { room: "房间有新动态", agent: "Agent 任务已结束" } : delivery.locale === "zh-TW" ? { room: "房間有新動態", agent: "Agent 工作已結束" } : { room: "New room activity", agent: "Agent task finished" };
  const target = delivery.target_kind === "home" ? { kind: "home" as const, thread_id: delivery.target_id } : { kind: "room" as const, room_id: delivery.target_id, message_id: delivery.target_message_id };
  const url = delivery.target_kind === "home"
    ? `/app/home/${encodeURIComponent(delivery.target_id)}`
    : `/app/rooms/${encodeURIComponent(delivery.target_id)}`;
  return { schema_version: 1, activity_id: delivery.activity_id, kind: delivery.kind, title: delivery.kind === "room.message" ? titles.room : titles.agent, status: delivery.status, url, target };
}
function retryDelay(attempt: number) { return Math.min(3_600_000, 5_000 * (2 ** Math.min(attempt, 9))); }
function pushStatusCode(error: unknown) { return error && typeof error === "object" && "statusCode" in error && typeof (error as { statusCode: unknown }).statusCode === "number" ? (error as { statusCode: number }).statusCode : null; }
function rowsFromResult<T>(result: unknown): T[] { if (Array.isArray(result)) return result as T[]; if (result && typeof result === "object" && "rows" in result && Array.isArray((result as { rows: unknown }).rows)) return (result as { rows: T[] }).rows; return []; }
