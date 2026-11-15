import assert from "node:assert/strict";
import test from "node:test";

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import { ApplicationError } from "../../../../../../src/application/platform/errors.js";
import type { BackendDatabase } from "../../../../../../src/infrastructure/persistence/postgres/database-service.js";
import {
  PostgresOwnerUnitOfWork,
  postgresTransactionForOwner,
} from "../../../../../../src/infrastructure/persistence/postgres/unit-of-work/postgres-unit-of-work.js";
import {
  COMPANY_PERSISTENCE_CONFLICT_CODE,
  COMPANY_PERSISTENCE_UNAVAILABLE_CODE,
  PostgresCompanyRepository,
} from "../../../../../../src/infrastructure/persistence/postgres/repositories/company-repository.js";

const companyId = "company_one";

test("beginRetry compare-and-sets setup failure and relies on fixed Runtime status", async () => {
  const database = new TransactionalFakeDatabase();
  database.queueRows({ id: companyId });
  database.queueRows(onboardingRow({
    stage: "creatingRuntime",
    version: "4",
    last_error_code: null,
    last_error_retryable: null,
    updated_at_ms: 2_000,
  }));
  const repository = new PostgresCompanyRepository(
    database.asBackendDatabase(),
    postgresTransactionForOwner,
  );
  const unitOfWork = new PostgresOwnerUnitOfWork(database.asBackendDatabase());

  const process = await unitOfWork.execute("company", (transaction) => (
    repository.beginRetry(transaction, companyId, 2_000)
  ));

  assert.deepEqual(process, {
    companyId,
    ownerActorId: "actor_owner",
    runtimeId: "runtime_one",
    executorId: "executor_one",
    initialOperationId: "operation_initial",
    stage: "creatingRuntime",
    version: 4,
    lastErrorCode: null,
    lastErrorRetryable: null,
    createdAtMs: 1_000,
    updatedAtMs: 2_000,
  });
  assert.equal(database.transactionCalls, 1);
  assert.equal(database.queries.length, 2);
  assert.match(database.queries[0]?.sql ?? "", /update companies/u);
  assert.match(database.queries[0]?.sql ?? "", /status = 'setup_failed'/u);
  assert.match(database.queries[1]?.sql ?? "", /update company_onboarding_processes/u);
  assert.match(database.queries[1]?.sql ?? "", /then 'ready' else 'creatingRuntime'/u);
  assert.match(database.queries[1]?.sql ?? "", /last_error_code = null/u);
  assert.match(database.queries[1]?.sql ?? "", /last_error_retryable = null/u);
  assert.match(database.queries[1]?.sql ?? "", /stage = 'failed'/u);
  assert.equal(database.queries[0]?.params.includes(companyId), true);
  assert.equal(database.queries[1]?.params.includes(2_000), true);
});

test("beginRetry treats an active or non-failed Company as a strict idempotent no-op", async () => {
  const database = new TransactionalFakeDatabase();
  database.queueRows();
  const repository = new PostgresCompanyRepository(
    database.asBackendDatabase(),
    postgresTransactionForOwner,
  );
  const unitOfWork = new PostgresOwnerUnitOfWork(database.asBackendDatabase());

  const process = await unitOfWork.execute("company", (transaction) => (
    repository.beginRetry(transaction, companyId, 2_000)
  ));

  assert.equal(process, null);
  assert.equal(database.queries.length, 1);
  assert.equal(/company_onboarding_processes/u.test(database.queries[0]?.sql ?? ""), false);
});

test("beginRetry fails closed when a setup_failed Company has no current failed process", async () => {
  const database = new TransactionalFakeDatabase();
  database.queueRows({ id: companyId });
  database.queueRows();
  const repository = new PostgresCompanyRepository(
    database.asBackendDatabase(),
    postgresTransactionForOwner,
  );
  const unitOfWork = new PostgresOwnerUnitOfWork(database.asBackendDatabase());

  await assert.rejects(
    () => unitOfWork.execute("company", (transaction) => repository.beginRetry(transaction, companyId, 2_000)),
    (error: unknown) => error instanceof ApplicationError
      && error.code === COMPANY_PERSISTENCE_CONFLICT_CODE
      && error.retryable === false,
  );
  assert.equal(database.queries.length, 2);
  assert.match(database.queries[1]?.sql ?? "", /stage = 'failed'/u);
});

test("beginRetry maps database details to a safe persistence error", async () => {
  const secret = "postgres://company-retry-secret";
  const database = new TransactionalFakeDatabase();
  database.queueError(new Error(secret));
  const repository = new PostgresCompanyRepository(
    database.asBackendDatabase(),
    postgresTransactionForOwner,
  );
  const unitOfWork = new PostgresOwnerUnitOfWork(database.asBackendDatabase());

  await assert.rejects(
    () => unitOfWork.execute("company", (transaction) => repository.beginRetry(transaction, companyId, 2_000)),
    (error: unknown) => error instanceof ApplicationError
      && error.code === COMPANY_PERSISTENCE_UNAVAILABLE_CODE
      && error.retryable === true
      && !error.message.includes(secret)
      && !("cause" in error),
  );
});

function onboardingRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    company_id: companyId,
    owner_actor_id: "actor_owner",
    runtime_id: "runtime_one",
    executor_id: "executor_one",
    initial_operation_id: "operation_initial",
    stage: "creatingRuntime",
    version: 2,
    last_error_code: null,
    last_error_retryable: null,
    created_at_ms: 1_000,
    updated_at_ms: 2_000,
    ...overrides,
  };
}

type CapturedQuery = {
  sql: string;
  params: unknown[];
};

class TransactionalFakeDatabase {
  readonly queries: CapturedQuery[] = [];
  transactionCalls = 0;
  private readonly dialect = new PgDialect();
  private readonly responses: Array<{ rows?: unknown[]; error?: unknown }> = [];

  queueRows(...rows: unknown[]): void {
    this.responses.push({ rows });
  }

  queueError(error: unknown): void {
    this.responses.push({ error });
  }

  async transaction<T>(callback: (transaction: TransactionalFakeTransaction) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    return callback(new TransactionalFakeTransaction(this));
  }

  asBackendDatabase(): BackendDatabase {
    return this as unknown as BackendDatabase;
  }

  execute(query: SQL): unknown[] {
    this.queries.push(this.compile(query));
    const response = this.responses.shift();
    if (response?.error !== undefined) {
      throw response.error;
    }
    return response?.rows ?? [];
  }

  private compile(query: SQL): CapturedQuery {
    const compiled = this.dialect.sqlToQuery(query);
    return {
      sql: compiled.sql.replaceAll(/\s+/gu, " ").trim(),
      params: compiled.params,
    };
  }
}

class TransactionalFakeTransaction {
  constructor(private readonly database: TransactionalFakeDatabase) {}

  async execute(query: SQL): Promise<unknown[]> {
    return this.database.execute(query);
  }
}
