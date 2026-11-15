import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { sql } from "drizzle-orm";

import { PostgresEventingRepository } from "../src/infrastructure/eventing/postgres/repository.js";
import { createBackendDatabaseService } from "../src/infrastructure/persistence/postgres/database-service.js";

const databaseUrl = process.env.FIELDS_INTEGRATION_DATABASE_URL?.trim();
const skip = process.env.FIELDS_RUN_EVENTING_INTEGRATION_TESTS === "1" && databaseUrl
  ? false
  : "Set FIELDS_RUN_EVENTING_INTEGRATION_TESTS=1 and FIELDS_INTEGRATION_DATABASE_URL.";

test("real PostgreSQL fans out, claims, and completes a durable event", { skip }, async () => {
  const database = createBackendDatabaseService({ databaseUrl });
  const suffix = randomUUID().replaceAll("-", "");
  const eventId = `it_event_${suffix}`;
  const consumerName = "runtime.agent-room-execution" as const;
  const now = Date.now();
  try {
    await database.db.execute(sql`
      insert into outbox_events (
        event_id, event_type, schema_version, aggregate_type, aggregate_id,
        payload_json, occurred_at_ms, dispatched_at_ms
      ) values (
        ${eventId}, 'integration.event.v1', 1, 'integration', ${suffix},
        ${JSON.stringify({ value: suffix })}::jsonb, ${now}, null
      )
    `);
    const repository = new PostgresEventingRepository(database.db);
    assert.equal(await repository.claimAndFanOut({
      workerId: `fanout_${suffix}`,
      nowMs: now + 1,
      limit: 1,
      consumersFor: (event) => event.eventId === eventId ? [consumerName] : null,
    }), 1);
    const delivery = await repository.claimNext({
      workerId: `delivery_${suffix}`,
      nowMs: now + 2,
      claimTtlMs: 10_000,
      activeConsumers: [consumerName],
    });
    assert.ok(delivery);
    assert.equal(delivery.event.eventId, eventId);
    await repository.markSucceeded({
      claimToken: delivery.claimToken,
      workerId: `delivery_${suffix}`,
      nowMs: now + 3,
    });
    const rows = rowList<{ status: string }>(await database.db.execute(sql`
      select status from outbox_deliveries
      where event_id = ${eventId} and consumer_name = ${consumerName}
    `));
    assert.deepEqual(rows, [{ status: "succeeded" }]);
  } finally {
    await database.db.execute(sql`delete from outbox_events where event_id = ${eventId}`);
    await database.close();
  }
});

function rowList<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && "rows" in value) {
    const rows = (value as { rows?: unknown }).rows;
    return Array.isArray(rows) ? rows as T[] : [];
  }
  return [];
}
