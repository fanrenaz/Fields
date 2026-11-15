import assert from "node:assert/strict";
import test from "node:test";

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import type { BackendDatabase } from "../../../../src/infrastructure/persistence/postgres/database-service.js";
import { PostgresScheduledTaskRunner } from "../../../../src/infrastructure/eventing/scheduled-task-runner.js";
import { insertRunAndEvent } from "../../../../src/infrastructure/persistence/postgres/repositories/company/scheduled-task-repository.js";

test("due scanning claims with SKIP LOCKED and queues one occurrence event", async () => {
  const now = Date.parse("2026-08-01T12:00:00.000Z");
  const database = new FakeDatabase([
    [{ task_id: "task_1", company_id: "company_1", schedule_json: { type: "cron", expression: "0 * * * *", timezone: "UTC" }, next_run_at_ms: now - 1_000 }],
    [{ run_id: "run_1" }],
    [],
    [],
    [],
  ]);
  const result = await new PostgresScheduledTaskRunner(database.asBackendDatabase(), () => now).runTick();

  assert.equal(result.claimed, 1);
  assert.equal(result.queued, 1);
  assert.equal(result.missed, 0);
  assert.match(database.queries[0]?.sql ?? "", /for update skip locked/u);
  assert.match(database.queries[1]?.sql ?? "", /on conflict \(task_id, occurrence_key\) do nothing returning run_id/u);
  assert.match(database.queries[2]?.sql ?? "", /scheduled_task\.occurrence_requested\.v1/u);
  assert.match(database.queries[3]?.sql ?? "", /update scheduled_tasks set next_run_at_ms/u);
  assert.match(database.queries[4]?.sql ?? "", /delete from scheduled_task_runs/u);
});

test("an occurrence beyond the grace window is recorded once and heartbeat restarts from now", async () => {
  const now = Date.parse("2026-08-01T12:00:00.000Z");
  const database = new FakeDatabase([
    [{ task_id: "task_1", company_id: "company_1", schedule_json: { type: "heartbeat", interval_minutes: 10 }, next_run_at_ms: now - 60_001 }],
    [],
    [],
    [],
  ]);
  const result = await new PostgresScheduledTaskRunner(database.asBackendDatabase(), () => now).runTick();

  assert.equal(result.queued, 0);
  assert.equal(result.missed, 1);
  assert.match(database.queries[1]?.sql ?? "", /'missed'/u);
  assert.equal(database.queries[2]?.params.includes(now + 600_000), true);
  assert.equal(database.queries.some((query) => /insert into outbox_events/u.test(query.sql)), false);
});

test("an existing occurrence suppresses its outbox event", async () => {
  const database = new FakeDatabase([[]]);
  const inserted = await insertRunAndEvent(database.asBackendDatabase(), {
    companyId: "company_1", taskId: "task_1", runId: "run_1", eventId: "event_1",
    occurrenceKey: "scheduled:100", scheduledForMs: 100, nowMs: 100, trigger: "scheduled",
  });
  assert.equal(inserted, false);
  assert.equal(database.queries.length, 1);
});

class FakeDatabase {
  readonly queries: Array<{ sql: string; params: unknown[] }> = [];
  readonly #dialect = new PgDialect();
  constructor(private readonly results: unknown[][]) {}
  async execute(query: SQL): Promise<unknown[]> {
    const compiled = this.#dialect.sqlToQuery(query);
    this.queries.push({ sql: compiled.sql, params: compiled.params });
    return this.results.shift() ?? [];
  }
  async transaction<T>(work: (transaction: BackendDatabase) => Promise<T>): Promise<T> {
    return work(this.asBackendDatabase());
  }
  asBackendDatabase(): BackendDatabase { return this as unknown as BackendDatabase; }
}
