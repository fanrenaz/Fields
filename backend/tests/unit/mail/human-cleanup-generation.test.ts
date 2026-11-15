import assert from "node:assert/strict";
import test from "node:test";

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import type { OwnerTransaction } from "../../../src/application/platform/ports/index.js";
import type { BackendDatabase } from "../../../src/infrastructure/persistence/postgres/database-service.js";
import {
  PostgresActorRepository,
} from "../../../src/infrastructure/persistence/postgres/repositories/actor-repository.js";

const transaction: OwnerTransaction = {
  owner: "actor",
  outbox: { kind: "outbox-transaction" },
};

test("active Human removal creates exactly one pending cleanup operation", async () => {
  const database = new SqlQueue();
  database.queue(humanRow("active"));
  database.queue(humanRow("inactive"));
  database.queue();
  database.queue();
  database.queue();
  database.queue();
  const repository = actorRepository(database);

  const actor = await repository.inactivate(transaction, "human-one", 100);
  assert.equal(actor?.status, "inactive");
  assert.equal(database.matching(/insert into agent_member_cleanup_operations/u), 1);
  assert.equal(database.matching(/insert into outbox_events/u), 1);
});

test("inactive succeeded Human reconciliation creates no cleanup operation or outbox", async () => {
  const database = new SqlQueue();
  database.queue(humanRow("inactive"));
  database.queue();
  database.queue({ operation_id: "cleanup-succeeded", status: "succeeded" });
  const repository = actorRepository(database);

  const actor = await repository.inactivate(transaction, "human-one", 200);
  assert.equal(actor?.status, "inactive");
  assert.equal(database.matching(/insert into agent_member_cleanup_operations/u), 0);
  assert.equal(database.matching(/insert into outbox_events/u), 0);
});

test("failed Human cleanup repair creates one pending generation and then reuses it", async () => {
  const database = new SqlQueue();
  for (const rows of [
    [humanRow("inactive")],
    [],
    [],
    [],
    [],
    [humanRow("inactive")],
    [{ operation_id: "cleanup-repair" }],
    [{ operation_id: "cleanup-repair", status: "pending" }],
    [],
  ]) database.queue(...rows);
  const repository = actorRepository(database);

  await repository.inactivate(transaction, "human-one", 300);
  await repository.inactivate(transaction, "human-one", 301);

  assert.equal(database.matching(/insert into agent_member_cleanup_operations/u), 1);
  assert.equal(database.matching(/insert into outbox_events/u), 2);
});

function actorRepository(database: SqlQueue): PostgresActorRepository {
  return new PostgresActorRepository(
    database as unknown as BackendDatabase,
    () => database as never,
  );
}

function humanRow(status: "active" | "inactive") {
  return {
    id: "human-one",
    company_id: "company-one",
    type: "human",
    display_name: "Human",
    mark: "HU",
    company_role: "member",
    status,
    auth_user_id: "auth-one",
  };
}

class SqlQueue {
  readonly queries: string[] = [];
  private readonly results: unknown[][] = [];
  private readonly dialect = new PgDialect();

  queue(...rows: unknown[]): void {
    this.results.push(rows);
  }

  async execute(query: SQL): Promise<unknown[]> {
    const compiled = this.dialect.sqlToQuery(query);
    this.queries.push(compiled.sql.replaceAll(/\s+/gu, " ").trim());
    return this.results.shift() ?? [];
  }

  matching(pattern: RegExp): number {
    return this.queries.filter((query) => pattern.test(query)).length;
  }
}
