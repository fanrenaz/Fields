import assert from "node:assert/strict";
import test from "node:test";

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import type { BackendDatabase } from "../../../../../../src/infrastructure/persistence/postgres/database-service.js";
import {
  PostgresMemberExecutorAssignmentRepository,
} from "../../../../../../src/infrastructure/persistence/postgres/repositories/execution/member-executor-assignment-repository.js";

const sharedExecutorRow = {
  executor_id: "executor_shared",
  owner_member_id: "actor_owner",
  owner_display_name: "Owner",
  executor_name: "Shared Executor",
  sharing_state: "company_shared",
  executor_status: "connected",
  executor_type: "codex",
  configuration_status: "ready",
  configuration_revision: 1,
  allowed_models_json: [{
    model: "gpt-5.3-codex",
    display_name: "GPT-5.3 Codex",
    source: "catalog",
    supported_reasoning_efforts: ["high"],
    validation_status: "available",
    last_validated_at_ms: 1_000,
  }],
  allowed_reasoning_efforts_json: ["high"],
  default_model: "gpt-5.3-codex",
  default_reasoning_effort: "high",
  catalog_checked_at_ms: 1_000,
  configuration_updated_at_ms: 1_000,
  authorization_method: "chatgpt",
  plan_type: "team",
};

test("Human Executor options include own eligible Executors and the company shared pool", async () => {
  const database = new QueryDatabase();
  database.queueRows(
    [{ target_type: "human" }],
    [sharedExecutorRow],
  );
  const repository = new PostgresMemberExecutorAssignmentRepository(database.asBackendDatabase());

  const options = await repository.listOptions({
    companyId: "company_one",
    memberId: "actor_member",
    authority: { kind: "self", requestedByMemberId: "actor_member" },
  });

  assert.equal(options[0]?.executorId, "executor_shared");
  const optionQuery = database.queries[1]?.sql ?? "";
  assert.match(optionQuery, /executor\.owner_member_id = \$\d+/u);
  assert.match(optionQuery, /executor\.sharing_state <> 'admin_blocked'/u);
  assert.match(optionQuery, /or executor\.sharing_state = 'company_shared'/u);
});

test("Human binding eligibility accepts an available company shared Executor", async () => {
  const database = new QueryDatabase();
  database.queueRows(
    [{ target_type: "human" }],
    [sharedExecutorRow],
    [],
    [{
      ...sharedExecutorRow,
      company_id: "company_one",
      member_id: "actor_member",
      executor_id: "executor_shared",
      pending_executor_id: "executor_shared",
      assignment_version: 1,
      state: "switching",
      switch_operation_id: "operation_one",
      last_error_code: null,
      last_error_retryable: null,
      updated_at_ms: 2_000,
    }],
  );
  const repository = new PostgresMemberExecutorAssignmentRepository(database.asBackendDatabase());

  const result = await repository.beginSwitch({
    companyId: "company_one",
    memberId: "actor_member",
    executorId: "executor_shared",
    operationId: "operation_one",
    authority: { kind: "self", requestedByMemberId: "actor_member" },
    nowMs: 2_000,
  });

  assert.equal(result.kind, "switching");
  const eligibilityQuery = database.queries[1]?.sql ?? "";
  assert.match(eligibilityQuery, /executor\.status = 'connected'/u);
  assert.match(eligibilityQuery, /executor\.configuration_status = 'ready'/u);
  assert.match(eligibilityQuery, /executor\.owner_member_id = \$\d+/u);
  assert.match(eligibilityQuery, /executor\.sharing_state <> 'admin_blocked'/u);
  assert.match(eligibilityQuery, /or executor\.sharing_state = 'company_shared'/u);
});

class QueryDatabase {
  readonly queries: Array<{ sql: string; params: unknown[] }> = [];
  private readonly dialect = new PgDialect();
  private readonly results: unknown[][] = [];

  queueRows(...results: unknown[][]): void {
    this.results.push(...results);
  }

  async execute(query: SQL): Promise<unknown[]> {
    const compiled = this.dialect.sqlToQuery(query);
    this.queries.push({
      sql: compiled.sql.replaceAll(/\s+/gu, " ").trim(),
      params: compiled.params,
    });
    return this.results.shift() ?? [];
  }

  async transaction<T>(callback: (transaction: QueryDatabase) => Promise<T>): Promise<T> {
    return callback(this);
  }

  asBackendDatabase(): BackendDatabase {
    return this as unknown as BackendDatabase;
  }
}
