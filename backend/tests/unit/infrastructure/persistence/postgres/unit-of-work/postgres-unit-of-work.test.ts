import assert from "node:assert/strict";
import test from "node:test";

import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import type { OwnerTransaction } from "../../../../../../src/application/platform/ports/index.js";
import type { BackendDatabase } from "../../../../../../src/infrastructure/persistence/postgres/database-service.js";

import {
  PostgresCreateCompanyUnitOfWork,
  PostgresOwnerUnitOfWork,
  PostgresTransactionUnavailableError,
  postgresTransactionForOutbox,
  postgresTransactionForOwner,
} from "../../../../../../src/infrastructure/persistence/postgres/unit-of-work/postgres-unit-of-work.js";

test("owner UoW exposes only an opaque owner capability and releases its PostgreSQL mapping", async () => {
  const database = new TransactionalFakeDatabase();
  const unitOfWork = new PostgresOwnerUnitOfWork(database.asBackendDatabase());
  let captured: OwnerTransaction | null = null;

  await unitOfWork.execute("actor", async (transaction) => {
    captured = transaction;
    assert.deepEqual(Object.keys(transaction).sort(), ["outbox", "owner"]);
    assert.equal(transaction.owner, "actor");
    assert.equal(postgresTransactionForOwner(transaction, "actor"), database.transactions[0]);
    assert.equal(postgresTransactionForOutbox(transaction.outbox), database.transactions[0]);
    assert.throws(
      () => postgresTransactionForOwner(transaction, "company"),
      PostgresTransactionUnavailableError,
    );

    await postgresTransactionForOwner(transaction, "actor").execute(sql`select 'actor'`);
  });

  assert.equal(database.transactionCalls, 1);
  assert.equal(database.rootQueries.length, 0);
  assert.equal(database.transactionQueries.length, 1);
  assert.match(database.transactionQueries[0]?.sql ?? "", /select 'actor'/u);
  const ownerTransaction = requiredOwnerTransaction(captured);
  assert.throws(
    () => postgresTransactionForOwner(ownerTransaction, "actor"),
    PostgresTransactionUnavailableError,
  );
  assert.throws(
    () => postgresTransactionForOutbox(ownerTransaction.outbox),
    PostgresTransactionUnavailableError,
  );
});

test("CreateCompany UoW binds Company, Actor, and Outbox capabilities to one transaction", async () => {
  const database = new TransactionalFakeDatabase();
  const unitOfWork = new PostgresCreateCompanyUnitOfWork(database.asBackendDatabase());
  let company: OwnerTransaction | null = null;
  let actor: OwnerTransaction | null = null;

  await unitOfWork.execute(async (transaction) => {
    company = transaction.company;
    actor = transaction.actor;
    const companyDatabase = postgresTransactionForOwner(transaction.company, "company");
    const actorDatabase = postgresTransactionForOwner(transaction.actor, "actor");

    assert.equal(companyDatabase, actorDatabase);
    assert.equal(companyDatabase, postgresTransactionForOutbox(transaction.outbox));
    await companyDatabase.execute(sql`select 'company'`);
    await actorDatabase.execute(sql`select 'actor'`);
  });

  assert.equal(database.transactionCalls, 1);
  assert.equal(database.rootQueries.length, 0);
  assert.equal(database.transactionQueries.length, 2);
  const companyTransaction = requiredOwnerTransaction(company);
  const actorTransaction = requiredOwnerTransaction(actor);
  assert.throws(
    () => postgresTransactionForOwner(companyTransaction, "company"),
    PostgresTransactionUnavailableError,
  );
  assert.throws(
    () => postgresTransactionForOwner(actorTransaction, "actor"),
    PostgresTransactionUnavailableError,
  );
});

type CapturedQuery = {
  sql: string;
  params: unknown[];
};

function requiredOwnerTransaction(value: OwnerTransaction | null): OwnerTransaction {
  if (!value) {
    throw new Error("Expected the UoW callback to receive an owner capability.");
  }
  return value;
}

class TransactionalFakeDatabase {
  readonly rootQueries: CapturedQuery[] = [];
  readonly transactionQueries: CapturedQuery[] = [];
  readonly transactions: TransactionalFakeTransaction[] = [];
  transactionCalls = 0;
  private readonly dialect = new PgDialect();

  async execute(query: SQL): Promise<unknown[]> {
    this.rootQueries.push(this.compile(query));
    return [];
  }

  async transaction<T>(
    callback: (transaction: TransactionalFakeTransaction) => Promise<T>,
  ): Promise<T> {
    this.transactionCalls += 1;
    const transaction = new TransactionalFakeTransaction(this);
    this.transactions.push(transaction);
    return callback(transaction);
  }

  asBackendDatabase(): BackendDatabase {
    return this as unknown as BackendDatabase;
  }

  recordTransactionQuery(query: SQL): void {
    this.transactionQueries.push(this.compile(query));
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
    this.database.recordTransactionQuery(query);
    return [];
  }
}
