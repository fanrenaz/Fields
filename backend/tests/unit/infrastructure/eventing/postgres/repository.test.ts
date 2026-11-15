import assert from "node:assert/strict";
import test from "node:test";

import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import type { BackendDatabase } from "../../../../../src/infrastructure/persistence/postgres/database-service.js";
import {
  PostgresEventDeadLetterTransaction,
  PostgresEventInboxTransaction,
  PostgresEventingRepository,
} from "../../../../../src/infrastructure/eventing/postgres/repository.js";

const companyProvisioningConsumer = "runtime.agent-room-execution" as const;
const executorReconfigurationConsumer = "runtime.agent-room-execution" as const;

test("fan-out holds unknown codecs undispatched and atomically persists known consumer deliveries", async () => {
  const database = new TransactionalFakeDatabase();
  database.queueRows(
    outboxEventRow({ event_id: "event_unknown", event_type: "future.event.v1", sequence: 1 }),
    outboxEventRow({ event_id: "event_known", sequence: 2 }),
  );
  database.queueRows();
  database.queueRows({ event_id: "event_known" });
  const repository = new PostgresEventingRepository(database.asBackendDatabase());
  const seenEventIds: string[] = [];

  const fannedOut = await repository.claimAndFanOut({
    workerId: "event_worker_one",
    nowMs: 1_000,
    limit: 10,
    consumersFor(event) {
      seenEventIds.push(event.eventId);
      return event.eventId === "event_unknown"
        ? null
        : [companyProvisioningConsumer, companyProvisioningConsumer];
    },
  });

  assert.equal(fannedOut, 1);
  assert.equal(database.transactionCalls, 1);
  assert.deepEqual(seenEventIds, ["event_unknown", "event_known"]);
  assert.equal(database.queries.length, 3);
  assert.match(database.queries[0]?.sql ?? "", /for update skip locked/u);
  assert.match(database.queries[1]?.sql ?? "", /on conflict \(event_id, consumer_name\) do nothing/u);
  assert.match(database.queries[2]?.sql ?? "", /set dispatched_at_ms/u);
  assert.equal(queryParams(database).includes("event_unknown"), false);
});

test("claiming is ordered by consumer and aggregate and token-binds an active reclaim", async () => {
  const database = new TransactionalFakeDatabase();
  database.queueRows({
    ...outboxEventRow(),
    consumer_name: companyProvisioningConsumer,
    attempt: 2,
    claim_token: "claim_from_database",
    claimed_until_ms: 1_030,
  });
  const repository = new PostgresEventingRepository(database.asBackendDatabase());

  const claimed = await repository.claimNext({
    workerId: "event_worker_one",
    nowMs: 1_000,
    claimTtlMs: 30,
    activeConsumers: [companyProvisioningConsumer],
  });

  assert.deepEqual(claimed, {
    event: {
      eventId: "event_one",
      eventType: "company.provisioning_requested.v1",
      schemaVersion: 1,
      aggregateType: "company",
      aggregateId: "company_one",
      sequence: 1,
      payload: { company_id: "company_one" },
      occurredAtMs: 900,
    },
    consumerName: companyProvisioningConsumer,
    attempt: 2,
    claimToken: "claim_from_database",
    claimedUntilMs: 1_030,
  });
  assert.equal(database.transactionCalls, 0);
  const claimSql = database.queries[0]?.sql ?? "";
  assert.match(claimSql, /for update of delivery skip locked/u);
  assert.match(claimSql, /earlier_event\.sequence < event\.sequence/u);
  assert.match(claimSql, /earlier_delivery\.status in \('pending', 'claimed', 'dead_letter'\)/u);
  assert.match(claimSql, /delivery\.claimed_until_ms <=/u);
  assert.equal(queryParams(database).includes("event_worker_one"), true);
});

test("claiming accepts the Executor reconfiguration consumer registered by the Event process", async () => {
  const database = new TransactionalFakeDatabase();
  database.queueRows({
    ...outboxEventRow({
      event_type: "execution.executor_configuration_changed.v1",
      aggregate_type: "executor",
      aggregate_id: "executor_one",
      payload_json: {
        company_id: "company_one",
        executor_id: "executor_one",
        owner_human_actor_id: null,
        home_actor_id: null,
        cause: "connected",
        occurred_at_ms: 900,
      },
    }),
    consumer_name: executorReconfigurationConsumer,
    attempt: 1,
    claim_token: "executor_reconfiguration_claim",
    claimed_until_ms: 1_030,
  });
  const repository = new PostgresEventingRepository(database.asBackendDatabase());

  const claimed = await repository.claimNext({
    workerId: "event_worker_one",
    nowMs: 1_000,
    claimTtlMs: 30,
    activeConsumers: [executorReconfigurationConsumer],
  });

  assert.equal(claimed?.consumerName, executorReconfigurationConsumer);
  assert.equal(claimed?.event.eventType, "execution.executor_configuration_changed.v1");
  assert.equal(claimed?.event.aggregateId, "executor_one");
});

test("claim renewal and retry transitions retain only safe failure codes behind live claim fences", async () => {
  const database = new TransactionalFakeDatabase();
  database.queueRows({ event_id: "event_one" });
  database.queueRows({ event_id: "event_one" });
  const repository = new PostgresEventingRepository(database.asBackendDatabase());
  const secret = "postgres://event-user:secret@example.internal/event";

  assert.equal(await repository.renewClaim({
    claimToken: "claim_one",
    workerId: "event_worker_one",
    nowMs: 1_000,
    claimTtlMs: 30,
  }), true);
  await repository.markFailed({
    claimToken: "claim_one",
    workerId: "event_worker_one",
    failure: { code: secret, retryable: true },
    nextAttemptAtMs: 1_250,
    deadLetter: false,
    nowMs: 1_000,
  });

  assert.equal(database.transactionCalls, 0);
  for (const query of database.queries) {
    assert.equal(query.params.includes(secret), false);
    assert.match(query.sql, /claimed_until_ms is not null/u);
    assert.match(query.sql, /claimed_until_ms >=/u);
  }
  assert.equal(queryParams(database).includes("EVENT_DELIVERY_FAILED"), true);
  assert.match(database.queries[1]?.sql ?? "", /set status = 'pending'/u);
});

test("dead-letter projection and terminal transition share one locked database transaction", async () => {
  const database = new TransactionalFakeDatabase();
  database.queueRows({ event_id: "event_one", consumer_name: companyProvisioningConsumer });
  database.queueRows();
  database.queueRows({ event_id: "event_one" });
  const repository = new PostgresEventingRepository(database.asBackendDatabase());
  const secret = "access_token=must-never-reach-outbox-deliveries";
  let projected = false;

  await repository.markFailed({
    claimToken: "claim_one",
    workerId: "event_worker_one",
    failure: { code: secret, retryable: false },
    nextAttemptAtMs: null,
    deadLetter: true,
    nowMs: 1_000,
    async deadLetterFailureProjector(transaction) {
      assert.ok(transaction instanceof PostgresEventDeadLetterTransaction);
      assert.equal(transaction.kind, "event-dead-letter-transaction");
      await transaction.execute(sql`select 1`);
      projected = true;
    },
  });

  assert.equal(projected, true);
  assert.equal(database.transactionCalls, 1);
  assert.match(database.queries[0]?.sql ?? "", /for update/u);
  assert.match(database.queries[2]?.sql ?? "", /set status = 'dead_letter'/u);
  for (const query of database.queries) {
    assert.equal(query.params.includes(secret), false);
  }
  assert.equal(queryParams(database).includes("EVENT_DELIVERY_FAILED"), true);
});

test("inbox receipt and handler work share a transaction and a duplicate receipt suppresses work", async () => {
  const database = new TransactionalFakeDatabase();
  database.queueRows({ event_id: "event_one" });
  database.queueRows();
  database.queueRows();
  const repository = new PostgresEventingRepository(database.asBackendDatabase());
  let workCalls = 0;

  const first = await repository.executeOnce({
    eventId: "event_one",
    consumerName: companyProvisioningConsumer,
    processedAtMs: 1_000,
    async work(transaction) {
      assert.ok(transaction instanceof PostgresEventInboxTransaction);
      assert.equal(transaction.kind, "event-inbox-transaction");
      await transaction.execute(sql`select 1`);
      workCalls += 1;
    },
  });
  const duplicate = await repository.executeOnce({
    eventId: "event_one",
    consumerName: companyProvisioningConsumer,
    processedAtMs: 1_001,
    async work() {
      workCalls += 1;
    },
  });

  assert.equal(first, "processed");
  assert.equal(duplicate, "already_processed");
  assert.equal(workCalls, 1);
  assert.equal(database.transactionCalls, 2);
  assert.match(database.queries[0]?.sql ?? "", /insert into event_inbox/u);
  assert.match(database.queries[0]?.sql ?? "", /on conflict \(event_id, consumer_name\) do nothing/u);
  assert.equal(database.queries.length, 3);
});

test("retention deletes only completed delivery sets and health keeps pending separate from dead-letter", async () => {
  const database = new TransactionalFakeDatabase();
  database.queueRows({ event_id: "event_old" });
  database.queueRows({ pending_count: "4", dead_letter_count: "2" });
  const repository = new PostgresEventingRepository(database.asBackendDatabase());

  assert.equal(await repository.sweepRetention({ beforeMs: 400, nowMs: 500 }), 1);
  assert.deepEqual(await repository.readCounts(), { pendingCount: 4, deadLetterCount: 2 });

  const retentionSql = database.queries[0]?.sql ?? "";
  assert.match(retentionSql, /event\.dispatched_at_ms is not null/u);
  assert.match(retentionSql, /delivery\.status <> 'succeeded'/u);
  assert.match(retentionSql, /for update of event skip locked/u);
  const healthSql = database.queries[1]?.sql ?? "";
  assert.match(healthSql, /outbox_events where dispatched_at_ms is null/u);
  assert.match(healthSql, /status in \('pending', 'claimed'\)/u);
  assert.match(healthSql, /status = 'dead_letter'/u);
});

class TransactionalFakeDatabase {
  readonly queries: Array<{ sql: string; params: unknown[] }> = [];
  transactionCalls = 0;
  private readonly results: unknown[][] = [];
  private readonly dialect = new PgDialect();

  queueRows(...rows: unknown[]): void {
    this.results.push(rows);
  }

  async execute(query: SQL): Promise<unknown[]> {
    const compiled = this.dialect.sqlToQuery(query);
    this.queries.push({
      sql: compiled.sql.replaceAll(/\s+/gu, " ").trim(),
      params: compiled.params,
    });
    return this.results.shift() ?? [];
  }

  async transaction<T>(callback: (transaction: TransactionalFakeDatabase) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    return callback(this);
  }

  asBackendDatabase(): BackendDatabase {
    return this as unknown as BackendDatabase;
  }
}

function outboxEventRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: "event_one",
    event_type: "company.provisioning_requested.v1",
    schema_version: 1,
    aggregate_type: "company",
    aggregate_id: "company_one",
    sequence: 1,
    payload_json: { company_id: "company_one" },
    occurred_at_ms: 900,
    ...overrides,
  };
}

function queryParams(database: TransactionalFakeDatabase): unknown[] {
  return database.queries.flatMap((query) => query.params);
}
