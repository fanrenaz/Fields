import assert from "node:assert/strict";
import test from "node:test";

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  ACTOR_DIRECTORY_ACCESS_DENIED_CODE,
  ACTOR_DIRECTORY_DATA_INVALID_CODE,
  ACTOR_DIRECTORY_UNAVAILABLE_CODE,
} from "../../../../../../src/application/actor/ports/index.js";
import { ApplicationError } from "../../../../../../src/application/platform/errors.js";
import type { BackendDatabase } from "../../../../../../src/infrastructure/persistence/postgres/database-service.js";
import {
  PostgresEventDeadLetterTransaction,
} from "../../../../../../src/infrastructure/eventing/postgres/repository.js";
import {
  PostgresOwnerUnitOfWork,
  postgresTransactionForOwner,
} from "../../../../../../src/infrastructure/persistence/postgres/unit-of-work/postgres-unit-of-work.js";

import {
  PostgresActorDirectoryRepository,
  PostgresHumanActorEmailQuery,
} from "../../../../../../src/infrastructure/persistence/postgres/repositories/actor-directory-repository.js";

test("Actor Directory PostgreSQL adapter reads only Actor facts while its specialized email query reads only Auth User id/email", async () => {
  const database = new TransactionalFakeDatabase();
  database.queueRows(callerRow());
  database.queueRows(humanRow(), agentRow());
  database.queueRows(agentRow());
  database.queueRows(profileRow({ id: "actor_agent", type: "agent" }));
  const directory = new PostgresActorDirectoryRepository(
    database.asBackendDatabase(),
    postgresTransactionForOwner,
  );

  assert.deepEqual(await directory.requireActiveHumanCaller({
    actorId: "actor_owner",
    companyId: "company_one",
  }), {
    actorId: "actor_owner",
    companyId: "company_one",
    companyRole: "owner",
  });
  assert.deepEqual((await directory.listActiveActors("company_one")).map((actor) => actor.id), [
    "actor_owner",
    "actor_agent",
  ]);
  assert.equal((await directory.findActiveActor({
    actorId: "actor_agent",
    companyId: "company_one",
  }))?.type, "agent");
  assert.deepEqual(await directory.listActiveOrdinaryProfiles({
    companyId: "company_one",
    actorIds: ["actor_agent", "actor_missing"],
  }), [{
    actorId: "actor_agent",
    companyId: "company_one",
    displayName: "Research Agent",
    mark: "RA",
    actorType: "agent",
  }]);

  assert.equal(database.rootQueries.length, 4);
  for (const query of database.rootQueries) {
    assert.match(query.sql, /from actors/u);
    assert.equal(/\bjoin\b/u.test(query.sql), false);
    assert.equal(/"user"/u.test(query.sql), false);
  }
  assert.match(database.rootQueries[1]?.sql ?? "", /status = 'active'/u);
  assert.doesNotMatch(database.rootQueries[1]?.sql ?? "", /home_human_actor_id/u);
  assert.match(database.rootQueries[1]?.sql ?? "", /order by company_role asc, display_name asc, id asc/u);
  assert.doesNotMatch(database.rootQueries[3]?.sql ?? "", /home_human_actor_id/u);

  const emailsDatabase = new TransactionalFakeDatabase();
  emailsDatabase.queueRows({ id: "user_owner", email: "owner@example.test" });
  const emails = await new PostgresHumanActorEmailQuery(emailsDatabase.asBackendDatabase())
    .findEmailsByAuthUserIds(["user_owner", "user_missing"]);
  assert.deepEqual([...emails], [["user_owner", "owner@example.test"]]);
  assert.match(emailsDatabase.rootQueries[0]?.sql ?? "", /from "user"/u);
  assert.equal(/\bjoin\b/u.test(emailsDatabase.rootQueries[0]?.sql ?? ""), false);
  assert.equal(/session|account|token|credential/iu.test(emailsDatabase.rootQueries[0]?.sql ?? ""), false);
});

test("Actor Directory PostgreSQL commands lock the target and only deactivate the ordinary-Agent shape", async () => {
  const database = new TransactionalFakeDatabase();
  database.queueRows(agentRow({ id: "actor_new", display_name: "New Agent", mark: "NA" }));
  database.queueRows(agentRow());
  database.queueRows(agentRow({ status: "inactive" }));
  database.queueRows([]);
  database.queueRows([]);
  database.queueRows([]);
  database.queueRows([]);
  database.queueRows([{ operation_id: "cleanup_1" }]);
  database.queueRows([]);
  const directory = new PostgresActorDirectoryRepository(
    database.asBackendDatabase(),
    postgresTransactionForOwner,
  );
  const unitOfWork = new PostgresOwnerUnitOfWork(database.asBackendDatabase());
  const actor = {
    id: "actor_new",
    companyId: "company_one",
    type: "agent" as const,
    displayName: "New Agent",
    mark: "NA",
    companyRole: "member" as const,
    status: "active" as const,
    authUserId: null,
  };

  await unitOfWork.execute("actor", async (transaction) => {
    assert.deepEqual(await directory.createOrdinaryAgent(transaction, actor, 100), actor);
    assert.equal((await directory.findActorForRemoval(transaction, {
      actorId: "actor_agent",
      companyId: "company_one",
    }))?.id, "actor_agent");
    assert.equal((await directory.deactivateOrdinaryAgent(transaction, {
      actorId: "actor_agent",
      companyId: "company_one",
      updatedAtMs: 125,
    }))?.status, "inactive");
  });

  assert.equal(database.transactionCalls, 1);
  assert.equal(database.transactionQueries.length, 10);
  assert.match(database.transactionQueries[0]?.sql ?? "", /insert into actors/u);
  assert.match(database.transactionQueries[1]?.sql ?? "", /limit 2 for update/u);
  assert.match(database.transactionQueries[2]?.sql ?? "", /update actors/u);
  assert.match(database.transactionQueries[2]?.sql ?? "", /type = 'agent'/u);
  assert.match(database.transactionQueries[2]?.sql ?? "", /company_role = 'member'/u);
  assert.match(database.transactionQueries[2]?.sql ?? "", /auth_user_id is null/u);
  assert.doesNotMatch(database.transactionQueries[2]?.sql ?? "", /home_human_actor_id/u);
  assert.match(database.transactionQueries[3]?.sql ?? "", /update room_memberships/u);
  assert.match(database.transactionQueries[4]?.sql ?? "", /update agent_room_states/u);
  assert.match(database.transactionQueries[5]?.sql ?? "", /update agent_room_executions/u);
  assert.match(database.transactionQueries[6]?.sql ?? "", /update agent_room_cascades/u);
  assert.match(database.transactionQueries[7]?.sql ?? "", /status = 'pending'/u);
  assert.match(database.transactionQueries[8]?.sql ?? "", /status = 'succeeded'/u);
  assert.match(database.transactionQueries[9]?.sql ?? "", /insert into outbox_events/u);
});

test("repeated inactive Agent removal is terminal after success and failed repair creates one pending operation", async () => {
  const succeeded = new TransactionalFakeDatabase();
  succeeded.queueRows();
  succeeded.queueRows(agentRow({ status: "inactive" }));
  succeeded.queueRows();
  succeeded.queueRows();
  succeeded.queueRows();
  succeeded.queueRows();
  succeeded.queueRows();
  succeeded.queueRows({ operation_id: "cleanup-succeeded", status: "succeeded" });
  const succeededDirectory = new PostgresActorDirectoryRepository(
    succeeded.asBackendDatabase(),
    postgresTransactionForOwner,
  );
  const succeededUnit = new PostgresOwnerUnitOfWork(succeeded.asBackendDatabase());
  await succeededUnit.execute("actor", (transaction) =>
    succeededDirectory.deactivateOrdinaryAgent(transaction, {
      actorId: "actor_agent",
      companyId: "company_one",
      updatedAtMs: 200,
    }));
  assert.equal(
    succeeded.transactionQueries.filter((query) =>
      /insert into agent_member_cleanup_operations/u.test(query.sql)).length,
    0,
  );
  assert.equal(
    succeeded.transactionQueries.filter((query) => /insert into outbox_events/u.test(query.sql)).length,
    0,
  );

  const failedRepair = new TransactionalFakeDatabase();
  for (const rows of [
    [],
    [agentRow({ status: "inactive" })],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [agentRow({ status: "inactive" })],
    [],
    [],
    [],
    [],
    [{ operation_id: "cleanup-repair" }],
    [{ operation_id: "cleanup-repair", status: "pending" }],
    [],
  ]) failedRepair.queueRows(...rows);
  const failedDirectory = new PostgresActorDirectoryRepository(
    failedRepair.asBackendDatabase(),
    postgresTransactionForOwner,
  );
  const failedUnit = new PostgresOwnerUnitOfWork(failedRepair.asBackendDatabase());
  await failedUnit.execute("actor", async (transaction) => {
    await failedDirectory.deactivateOrdinaryAgent(transaction, {
      actorId: "actor_agent",
      companyId: "company_one",
      updatedAtMs: 300,
    });
    await failedDirectory.deactivateOrdinaryAgent(transaction, {
      actorId: "actor_agent",
      companyId: "company_one",
      updatedAtMs: 301,
    });
  });
  assert.equal(
    failedRepair.transactionQueries.filter((query) =>
      /insert into agent_member_cleanup_operations/u.test(query.sql)).length,
    1,
  );
  assert.equal(
    failedRepair.transactionQueries.filter((query) => /insert into outbox_events/u.test(query.sql)).length,
    2,
    "pending repair replay reuses the operation and relies on outbox event idempotency",
  );
});

test("cleanup dead-letter projection marks the pending operation failed in the supplied transaction", async () => {
  const database = new TransactionalFakeDatabase();
  database.queueRows({ operation_id: "cleanup-dead-letter" });
  const directory = new PostgresActorDirectoryRepository(
    database.asBackendDatabase(),
    postgresTransactionForOwner,
  );
  await directory.markAgentMemberCleanupDeadLetter(
    new PostgresEventDeadLetterTransaction(
      new TransactionalFakeTransaction(database) as never,
    ),
    {
      operationId: "cleanup-dead-letter",
      failure: { code: "AGENT_MEMBER_CLEANUP_RUNTIME_UNAVAILABLE", retryable: true },
      attemptedAtMs: 500,
    },
  );
  assert.equal(database.transactionQueries.length, 1);
  assert.match(database.transactionQueries[0]?.sql ?? "", /set status = 'failed'/u);
  assert.match(database.transactionQueries[0]?.sql ?? "", /and status = 'pending'/u);
  assert.equal(
    database.transactionQueries[0]?.params.includes("AGENT_MEMBER_CLEANUP_RUNTIME_UNAVAILABLE"),
    true,
  );
});

test("Actor Directory PostgreSQL adapter fails closed for denied, malformed, and unavailable facts", async () => {
  const deniedDatabase = new TransactionalFakeDatabase();
  deniedDatabase.queueRows();
  await assert.rejects(
    new PostgresActorDirectoryRepository(deniedDatabase.asBackendDatabase(), postgresTransactionForOwner)
      .requireActiveHumanCaller({ actorId: "actor_owner", companyId: "company_one" }),
    applicationError(ACTOR_DIRECTORY_ACCESS_DENIED_CODE, false),
  );

  const malformedDatabase = new TransactionalFakeDatabase();
  malformedDatabase.queueRows(agentRow({ mark: " " }));
  await assert.rejects(
    new PostgresActorDirectoryRepository(malformedDatabase.asBackendDatabase(), postgresTransactionForOwner)
      .listActiveActors("company_one"),
    applicationError(ACTOR_DIRECTORY_DATA_INVALID_CODE, false),
  );

  const unavailableDatabase = new TransactionalFakeDatabase();
  unavailableDatabase.queueFailure(new Error("postgres://actor-directory:secret@internal/fields"));
  await assert.rejects(
    new PostgresActorDirectoryRepository(unavailableDatabase.asBackendDatabase(), postgresTransactionForOwner)
      .findActiveActor({ actorId: "actor_agent", companyId: "company_one" }),
    (error: unknown) => {
      assert.ok(error instanceof ApplicationError);
      assert.equal(error.code, ACTOR_DIRECTORY_UNAVAILABLE_CODE);
      assert.equal(error.retryable, true);
      assert.equal(error.message.includes("secret"), false);
      return true;
    },
  );
});

function callerRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "actor_owner",
    company_id: "company_one",
    type: "human",
    display_name: "Ada Lovelace",
    mark: "AL",
    company_role: "owner",
    status: "active",
    auth_user_id: "user_owner",
    ...overrides,
  };
}

function humanRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return callerRow(overrides);
}

function agentRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "actor_agent",
    company_id: "company_one",
    type: "agent",
    display_name: "Research Agent",
    mark: "RA",
    company_role: "member",
    status: "active",
    auth_user_id: null,
    ...overrides,
  };
}

function profileRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return agentRow(overrides);
}

function applicationError(code: string, retryable: boolean): (error: unknown) => boolean {
  return (error: unknown) => {
    assert.ok(error instanceof ApplicationError);
    assert.equal(error.code, code);
    assert.equal(error.retryable, retryable);
    assert.equal("cause" in error, false);
    return true;
  };
}

type CapturedQuery = {
  sql: string;
  params: unknown[];
};

class TransactionalFakeDatabase {
  readonly rootQueries: CapturedQuery[] = [];
  readonly transactionQueries: CapturedQuery[] = [];
  transactionCalls = 0;
  private readonly results: unknown[][] = [];
  private readonly failures: unknown[] = [];
  private readonly dialect = new PgDialect();

  queueRows(...rows: unknown[]): void {
    this.results.push(rows);
  }

  queueFailure(failure: unknown): void {
    this.failures.push(failure);
  }

  async execute(query: SQL): Promise<unknown[]> {
    this.rootQueries.push(this.compile(query));
    this.throwNextFailure();
    return this.results.shift() ?? [];
  }

  async transaction<T>(callback: (transaction: TransactionalFakeTransaction) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    return callback(new TransactionalFakeTransaction(this));
  }

  asBackendDatabase(): BackendDatabase {
    return this as unknown as BackendDatabase;
  }

  recordTransactionQuery(query: SQL): unknown[] {
    this.transactionQueries.push(this.compile(query));
    this.throwNextFailure();
    return this.results.shift() ?? [];
  }

  private throwNextFailure(): void {
    const failure = this.failures.shift();
    if (failure !== undefined) {
      throw failure;
    }
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
    return this.database.recordTransactionQuery(query);
  }
}
