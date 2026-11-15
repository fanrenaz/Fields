import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { sql } from "drizzle-orm";

import { ResolveProductSessionActorQuery } from "../src/application/actor/queries/resolve-product-session-actor.js";
import { createBackendDatabaseService } from "../src/infrastructure/persistence/postgres/database-service.js";
import {
  PostgresActorRepository,
  PostgresCompanyRepository,
} from "../src/infrastructure/persistence/postgres/repositories/index.js";
import { postgresTransactionForOwner } from "../src/infrastructure/persistence/postgres/unit-of-work/index.js";

const databaseUrl = process.env.FIELDS_INTEGRATION_DATABASE_URL?.trim();
const skip = process.env.FIELDS_RUN_AUTH_COMPANY_INTEGRATION_TESTS === "1" && databaseUrl
  ? false
  : "Set FIELDS_RUN_AUTH_COMPANY_INTEGRATION_TESTS=1 and FIELDS_INTEGRATION_DATABASE_URL.";

test("real PostgreSQL binds one Better Auth owner to one Company actor", { skip }, async () => {
  const database = createBackendDatabaseService({ databaseUrl });
  const suffix = randomUUID().replaceAll("-", "");
  const userId = `it_user_${suffix}`;
  const organizationId = `it_org_${suffix}`;
  const companyId = `it_company_${suffix}`;
  const actorId = `it_actor_${suffix}`;
  const now = Date.now();
  try {
    await database.db.transaction(async (transaction) => {
      await transaction.execute(sql`
        insert into "user" (id, name, email, email_verified, created_at, updated_at)
        values (${userId}, 'Integration Owner', ${`${suffix}@example.test`}, true, now(), now())
      `);
      await transaction.execute(sql`
        insert into organization (id, name, slug, created_at)
        values (${organizationId}, 'Integration Company', ${`integration-${suffix}`}, now())
      `);
      await transaction.execute(sql`
        insert into member (id, organization_id, user_id, role, created_at)
        values (${`it_member_${suffix}`}, ${organizationId}, ${userId}, 'owner', now())
      `);
      await transaction.execute(sql`
        insert into companies (id, name, status, auth_organization_id, created_at_ms, updated_at_ms)
        values (${companyId}, 'Integration Company', 'active', ${organizationId}, ${now}, ${now})
      `);
      await transaction.execute(sql`
        insert into actors (
          id, company_id, type, display_name, mark, company_role, status,
          auth_user_id, created_at_ms, updated_at_ms
        ) values (
          ${actorId}, ${companyId}, 'human', 'Integration Owner', 'IO',
          'owner', 'active', ${userId}, ${now}, ${now}
        )
      `);
    });
    const query = new ResolveProductSessionActorQuery({
      actors: new PostgresActorRepository(database.db, postgresTransactionForOwner),
      companies: new PostgresCompanyRepository(database.db, postgresTransactionForOwner),
      memberships: {
        resolveMembership: async () => ({ role: "owner" as const }),
      },
      repair: {
        repair: async () => {
          throw new Error("A complete committed projection must not repair.");
        },
      },
    });
    assert.deepEqual(await query.resolveVerifiedSession({
      authUserId: userId,
      activeOrganizationId: organizationId,
    }), {
      actorId,
      companyId,
      companyRole: "owner",
      displayName: "Integration Owner",
      actorType: "human",
      companyStatus: "active",
    });
  } finally {
    await database.db.execute(sql`delete from actors where company_id = ${companyId}`);
    await database.db.execute(sql`delete from companies where id = ${companyId}`);
    await database.db.execute(sql`delete from organization where id = ${organizationId}`);
    await database.db.execute(sql`delete from "user" where id = ${userId}`);
    await database.close();
  }
});
