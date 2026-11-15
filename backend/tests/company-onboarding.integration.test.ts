import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { sql } from "drizzle-orm";

import { CreateCompanyProcess } from "../src/application/processes/company-onboarding/create-company.js";
import { UuidIdGenerator } from "../src/infrastructure/configuration/uuid-id-generator.js";
import { createBackendDatabaseService } from "../src/infrastructure/persistence/postgres/database-service.js";
import {
  PostgresActorRepository,
  PostgresCompanyRepository,
} from "../src/infrastructure/persistence/postgres/repositories/index.js";
import {
  PostgresCreateCompanyUnitOfWork,
  postgresTransactionForOwner,
} from "../src/infrastructure/persistence/postgres/unit-of-work/index.js";

const databaseUrl = process.env.FIELDS_INTEGRATION_DATABASE_URL?.trim();
const skip = process.env.FIELDS_RUN_COMPANY_ONBOARDING_INTEGRATION_TESTS === "1" && databaseUrl
  ? false
  : "Set FIELDS_RUN_COMPANY_ONBOARDING_INTEGRATION_TESTS=1 and FIELDS_INTEGRATION_DATABASE_URL.";

test("real PostgreSQL commits Company onboarding without Runtime orchestration rows", {
  skip,
}, async () => {
  const database = createBackendDatabaseService({ databaseUrl });
  const suffix = randomUUID().replaceAll("-", "");
  const companyId = `company_${suffix}`;
  const ownerUserId = `it_user_${suffix}`;
  const organizationId = `it_org_${suffix}`;
  const now = Date.now();
  try {
    await database.db.transaction(async (transaction) => {
      await transaction.execute(sql`
        insert into "user" (id, name, email, email_verified, created_at, updated_at)
        values (${ownerUserId}, 'Owner', ${`${suffix}@example.test`}, true, now(), now())
      `);
      await transaction.execute(sql`
        insert into organization (id, name, slug, created_at)
        values (${organizationId}, 'Onboarding integration', ${`onboarding-${suffix}`}, now())
      `);
    });
    const companies = new PostgresCompanyRepository(database.db, postgresTransactionForOwner);
    const actors = new PostgresActorRepository(database.db, postgresTransactionForOwner);
    const process = new CreateCompanyProcess({
      eligibility: companies,
      actorQueries: actors,
      organizations: {
        createOrganization: async () => ({ organizationId }),
        resolveMembership: async () => ({ role: "owner" as const }),
        deleteOrganization: async () => undefined,
      },
      companyCommands: companies,
      actorCommands: actors,
      createCompanyUnitOfWork: new PostgresCreateCompanyUnitOfWork(database.db),
      ids: new UuidIdGenerator(() => suffix),
      clock: { now: () => now },
    });
    const created = await process.execute({
      name: "Onboarding integration",
      ownerUserId,
      ownerDisplayName: "Owner",
    });
    assert.equal(created.company.id, companyId);
    const rows = rowList<{ stage: string; runtime_status_count: number | string }>(
      await database.db.execute(sql`
        select process.stage,
          (select count(*) from company_runtime_status runtime
            where runtime.company_id = process.company_id) as runtime_status_count
        from company_onboarding_processes process
        where process.company_id = ${companyId}
      `),
    );
    assert.deepEqual(rows, [{ stage: "creatingRuntime", runtime_status_count: "0" }]);
  } finally {
    await database.db.execute(sql`delete from actors where company_id = ${companyId}`);
    await database.db.execute(sql`delete from companies where id = ${companyId}`);
    await database.db.execute(sql`delete from organization where id = ${organizationId}`);
    await database.db.execute(sql`delete from "user" where id = ${ownerUserId}`);
    await database.close();
  }
});

function rowList<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && "rows" in value) {
    const rows = (value as { rows?: unknown }).rows;
    return Array.isArray(rows) ? rows as T[] : [];
  }
  return [];
}
