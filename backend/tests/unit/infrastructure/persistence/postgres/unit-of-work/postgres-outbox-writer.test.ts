import assert from "node:assert/strict";
import test from "node:test";

import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import { ApplicationError } from "../../../../../../src/application/platform/errors.js";
import type {
  EventCodec,
  EventCodecRegistry,
  VersionedOutboxEvent,
} from "../../../../../../src/application/platform/ports/index.js";
import type { BackendDatabase } from "../../../../../../src/infrastructure/persistence/postgres/database-service.js";

import {
  OUTBOX_EVENT_CODEC_UNAVAILABLE_CODE,
  OUTBOX_EVENT_INVALID_CODE,
  PostgresOutboxWriter,
} from "../../../../../../src/infrastructure/persistence/postgres/unit-of-work/postgres-outbox-writer.js";
import {
  PostgresCreateCompanyUnitOfWork,
  PostgresOwnerUnitOfWork,
  postgresTransactionForOutbox,
  postgresTransactionForOwner,
} from "../../../../../../src/infrastructure/persistence/postgres/unit-of-work/postgres-unit-of-work.js";

test("Outbox writer commits a Company fact and registered event through the one UoW transaction", async () => {
  const database = new TransactionalFakeDatabase();
  const unitOfWork = new PostgresCreateCompanyUnitOfWork(database.asBackendDatabase());
  const writer = new PostgresOutboxWriter(new CompanyProvisioningCodecRegistry(), postgresTransactionForOutbox);

  await unitOfWork.execute(async (transaction) => {
    await postgresTransactionForOwner(transaction.company, "company").execute(
      sql`insert into companies (id) values ('company_one')`,
    );
    await writer.append(transaction.outbox, provisioningEvent());
  });

  assert.equal(database.transactionCalls, 1);
  assert.equal(database.rootQueries.length, 0);
  assert.equal(database.transactionQueries.length, 2);
  assert.match(database.transactionQueries[0]?.sql ?? "", /insert into companies/u);
  const query = database.transactionQueries[1];
  assert.match(query?.sql ?? "", /insert into outbox_events/u);
  assert.match(query?.sql ?? "", /\$6::jsonb/u);
  assert.deepEqual(query?.params, [
    "event_one",
    "company.provisioning_requested.v1",
    1,
    "company",
    "company_one",
    JSON.stringify({ company_id: "company_one", reason: "initial" }),
    1_000,
  ]);
});

test("Outbox writer fails closed before a database write for unknown codecs and malformed fields", async () => {
  const database = new TransactionalFakeDatabase();
  const unitOfWork = new PostgresOwnerUnitOfWork(database.asBackendDatabase());
  const writer = new PostgresOutboxWriter(new EmptyCodecRegistry(), postgresTransactionForOutbox);

  await assert.rejects(
    () => unitOfWork.execute("company", (transaction) => writer.append(transaction.outbox, provisioningEvent())),
    applicationError(OUTBOX_EVENT_CODEC_UNAVAILABLE_CODE, false),
  );
  await assert.rejects(
    () => unitOfWork.execute("company", (transaction) => writer.append(transaction.outbox, {
      ...provisioningEvent(),
      eventId: " ",
    })),
    applicationError(OUTBOX_EVENT_INVALID_CODE, false),
  );

  assert.equal(database.rootQueries.length, 0);
  assert.equal(database.transactionQueries.length, 0);
});

function provisioningEvent(): VersionedOutboxEvent {
  return {
    eventId: "event_one",
    eventType: "company.provisioning_requested.v1",
    schemaVersion: 1,
    aggregateType: "company",
    aggregateId: "company_one",
    payload: { company_id: "company_one", reason: "initial" },
    occurredAtMs: 1_000,
  };
}

class CompanyProvisioningCodecRegistry implements EventCodecRegistry {
  find(eventType: string, schemaVersion: number): EventCodec<unknown> | null {
    if (eventType !== "company.provisioning_requested.v1" || schemaVersion !== 1) {
      return null;
    }
    return {
      eventType,
      schemaVersion,
      encode(payload: unknown) {
        if (
          !payload
          || typeof payload !== "object"
          || !("company_id" in payload)
          || !("reason" in payload)
        ) {
          throw new Error("Invalid event payload.");
        }
        return {
          company_id: payload.company_id,
          reason: payload.reason,
        };
      },
      decode(value: unknown): unknown {
        return value;
      },
    };
  }
}

class EmptyCodecRegistry implements EventCodecRegistry {
  find(): null {
    return null;
  }
}

function applicationError(code: string, retryable: boolean): (error: unknown) => boolean {
  return (error) => error instanceof ApplicationError
    && error.code === code
    && error.retryable === retryable;
}

type CapturedQuery = {
  sql: string;
  params: unknown[];
};

class TransactionalFakeDatabase {
  readonly rootQueries: CapturedQuery[] = [];
  readonly transactionQueries: CapturedQuery[] = [];
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
    return callback(new TransactionalFakeTransaction(this));
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
