import assert from "node:assert/strict";
import test from "node:test";

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import { ApplicationError } from "../../../../../../src/application/platform/errors.js";
import {
  ROOM_ACTOR_ACCESS_DENIED_CODE,
  ROOM_ACTOR_ACCESS_UNAVAILABLE_CODE,
} from "../../../../../../src/application/room/ports/index.js";
import type { BackendDatabase } from "../../../../../../src/infrastructure/persistence/postgres/database-service.js";
import { PostgresRoomActorAccessQuery } from "../../../../../../src/infrastructure/persistence/postgres/repositories/actor-room-access-query.js";

const input = { actorId: "actor_ordinary", companyId: "company_one" };

test("Actor-side Room access allows only an active same-Company Human or Agent", async () => {
  const humanDatabase = new RecordingDatabase();
  humanDatabase.queueRows(actorRow());
  const humanAccess = new PostgresRoomActorAccessQuery(humanDatabase.asBackendDatabase());

  assert.deepEqual(await humanAccess.requireActiveOrdinaryActor(input), { ...input, actorType: "human" });
  assertQueryReadsOnlyActors(humanDatabase.queries[0]?.sql ?? "");

  const agentDatabase = new RecordingDatabase();
  agentDatabase.queueRows(actorRow({ id: "actor_agent", type: "agent" }));
  const agentAccess = new PostgresRoomActorAccessQuery(agentDatabase.asBackendDatabase());

  assert.deepEqual(
    await agentAccess.requireActiveOrdinaryActor({ actorId: "actor_agent", companyId: "company_one" }),
    { actorId: "actor_agent", companyId: "company_one", actorType: "agent" },
  );
  assertQueryReadsOnlyActors(agentDatabase.queries[0]?.sql ?? "");
});

test("Actor-side Room access fails closed for foreign, inactive, unknown, and malformed facts", async () => {
  const cases: Array<{ label: string; rows: readonly unknown[] }> = [
    { label: "wrong Company", rows: [actorRow({ company_id: "company_other" })] },
    { label: "inactive Actor", rows: [actorRow({ status: "inactive" })] },
    { label: "unknown Actor", rows: [] },
    { label: "malformed Actor type", rows: [actorRow({ type: "system" })] },
  ];

  for (const candidate of cases) {
    const database = new RecordingDatabase();
    database.queueRows(...candidate.rows);
    const access = new PostgresRoomActorAccessQuery(database.asBackendDatabase());

    await assert.rejects(
      () => access.requireActiveOrdinaryActor(input),
      (error: unknown) => (
        error instanceof ApplicationError
        && error.code === ROOM_ACTOR_ACCESS_DENIED_CODE
        && error.retryable === false
      ),
      candidate.label,
    );
  }
});

test("unknown PostgreSQL failures are safe and retryable", async () => {
  const database = new RecordingDatabase();
  database.queueError({ message: "postgres://secret-host/actors" });
  const access = new PostgresRoomActorAccessQuery(database.asBackendDatabase());

  await assert.rejects(
    () => access.requireActiveOrdinaryActor(input),
    (error: unknown) => (
      error instanceof ApplicationError
      && error.code === ROOM_ACTOR_ACCESS_UNAVAILABLE_CODE
      && error.retryable === true
      && !error.message.includes("secret-host")
    ),
  );
});

function assertQueryReadsOnlyActors(query: string): void {
  assert.match(query, /from actors/u);
  assert.equal(/\bjoin\b/u.test(query), false);
  assert.doesNotMatch(query, /home_human_actor_id/u);
  assert.match(query, /type in \('human', 'agent'\)/u);
  assert.match(query, /status = 'active'/u);
}

function actorRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: input.actorId,
    company_id: input.companyId,
    type: "human",
    status: "active",
    ...overrides,
  };
}

type CapturedQuery = {
  sql: string;
  params: unknown[];
};

class RecordingDatabase {
  readonly queries: CapturedQuery[] = [];
  private readonly dialect = new PgDialect();
  private readonly results: unknown[][] = [];
  private readonly errors: unknown[] = [];

  queueRows(...rows: unknown[]): void {
    this.results.push(rows);
  }

  queueError(error: unknown): void {
    this.errors.push(error);
  }

  async execute(query: SQL): Promise<unknown[]> {
    this.queries.push(this.compile(query));
    const error = this.errors.shift();
    if (error !== undefined) {
      throw error;
    }
    return this.results.shift() ?? [];
  }

  asBackendDatabase(): BackendDatabase {
    return this as unknown as BackendDatabase;
  }

  private compile(query: SQL): CapturedQuery {
    const compiled = this.dialect.sqlToQuery(query);
    return {
      sql: compiled.sql.replaceAll(/\s+/gu, " ").trim(),
      params: compiled.params,
    };
  }
}
