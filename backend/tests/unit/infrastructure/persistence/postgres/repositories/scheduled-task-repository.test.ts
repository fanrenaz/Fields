import assert from "node:assert/strict";
import test from "node:test";

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import type { CompanyFileApplication } from "../../../../../../src/application/company/ports/company-files.js";
import type { CompanyRuntimePublicGateway } from "../../../../../../src/application/execution/ports/index.js";
import type { BackendDatabase } from "../../../../../../src/infrastructure/persistence/postgres/database-service.js";
import { PostgresScheduledTaskApplication } from "../../../../../../src/infrastructure/persistence/postgres/repositories/company/scheduled-task-repository.js";

test("list returns every accessible target kind without accepting a destination filter", async () => {
  const database = new FakeDatabase([homeRow(), roomRow()]);
  const application = new PostgresScheduledTaskApplication(database.asBackendDatabase(), {
    companyFiles: {} as CompanyFileApplication,
    runtime: {} as CompanyRuntimePublicGateway,
  });

  const result = await application.list("company-1", "member-1");

  assert.deepEqual(result.items.map((task) => task.target.kind), ["home", "room"]);
  assert.match(database.query?.sql ?? "", /target_kind = 'home'[\s\S]*target_kind = 'room'/u);
  assert.doesNotMatch(database.query?.sql ?? "", /target_kind = \$\d+[^\s\S]*order by/u);
});

function homeRow() {
  return taskRow({
    targetKind: "home",
    home_owner_member_id: "member-1",
    home_thread_mode: "new_each_run",
    content_json: { kind: "home", prompt: "Daily brief" },
  });
}

function roomRow() {
  return taskRow({
    task_id: "task-room",
    targetKind: "room",
    home_owner_member_id: null,
    home_thread_mode: null,
    room_id: "room-1",
    content_json: { kind: "room", markdown: "Daily brief", references: [], reply_to_message_ids: [] },
  });
}

function taskRow(overrides: Record<string, unknown>) {
  return {
    task_id: "task-home", company_id: "company-1", created_by_member_id: "member-1", name: "Daily brief",
    targetKind: "home", home_owner_member_id: "member-1", home_thread_mode: "new_each_run", home_thread_id: null,
    room_id: null, content_json: { kind: "home", prompt: "Daily brief" },
    schedule_json: { type: "heartbeat", interval_minutes: 10 }, schedule_type: "heartbeat", status: "active",
    next_run_at_ms: 100, max_executions: null, successful_executions: 0, remaining_executions: null,
    version: 1, blocked_reason: null, created_at_ms: 1, updated_at_ms: 1, deleted_at_ms: null,
    ...overrides,
  };
}

class FakeDatabase {
  query: { sql: string; params: unknown[] } | null = null;
  readonly #dialect = new PgDialect();
  constructor(private readonly rows: unknown[]) {}
  async execute(query: SQL): Promise<unknown[]> {
    const compiled = this.#dialect.sqlToQuery(query);
    this.query = { sql: compiled.sql, params: compiled.params };
    return this.rows;
  }
  asBackendDatabase(): BackendDatabase { return this as unknown as BackendDatabase; }
}
