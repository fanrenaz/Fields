import assert from "node:assert/strict";
import test from "node:test";

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  HUMAN_INVITATION_ADMISSION_UNAVAILABLE_CODE,
  HumanInvitationAdmissionError,
  HumanInvitationAdmissionPolicy,
} from "../../../../../../src/application/actor/queries/human-invitation-admission.js";
import type { BackendDatabase } from "../../../../../../src/infrastructure/persistence/postgres/database-service.js";

import { PostgresActorInvitationHumanQuery } from "../../../../../../src/infrastructure/persistence/postgres/repositories/actor-invitation-human-query.js";

test("Actor invitation Human query reads retained and target-Company Human facts without Better Auth or Company joins", async () => {
  const database = new RecordingDatabase();
  database.queueRows({ actor_id: "actor_retained" });
  database.queueRows(
    { auth_user_id: "user_one", status: "active" },
    { auth_user_id: "user_two", status: "inactive" },
  );
  const query = new PostgresActorInvitationHumanQuery(database.asBackendDatabase());

  assert.equal(await query.hasRetainedHumanForAuthUser("user_retained"), true);
  assert.deepEqual(await query.listInvitationHumans({
    companyId: "company_one",
    authUserIds: ["user_one", "user_two"],
  }), [
    { authUserId: "user_one", status: "active" },
    { authUserId: "user_two", status: "inactive" },
  ]);

  assert.match(database.queries[0]?.sql ?? "", /from actors/u);
  assert.match(database.queries[0]?.sql ?? "", /auth_user_id = \$\d+/u);
  assert.match(database.queries[0]?.sql ?? "", /type = 'human'/u);
  assert.match(database.queries[0]?.sql ?? "", /limit 1/u);
  assert.match(database.queries[1]?.sql ?? "", /from actors/u);
  assert.match(database.queries[1]?.sql ?? "", /company_id = \$\d+/u);
  assert.match(database.queries[1]?.sql ?? "", /auth_user_id in \(/u);
  assert.match(database.queries[1]?.sql ?? "", /select auth_user_id, status/u);
  assert.equal(/status = 'active'/u.test(database.queries[1]?.sql ?? ""), false);
  for (const captured of database.queries) {
    assert.equal(/\bjoin\b/u.test(captured.sql), false);
    assert.equal(/\b(?:companies|invitation|member)\b/u.test(captured.sql), false);
    assert.equal(/"user"/u.test(captured.sql), false);
  }
});

test("Actor invitation Human query preserves no retained Human and an empty target batch", async () => {
  const retainedDatabase = new RecordingDatabase();
  retainedDatabase.queueRows();
  const retained = new PostgresActorInvitationHumanQuery(retainedDatabase.asBackendDatabase());
  assert.equal(await retained.hasRetainedHumanForAuthUser("user_missing"), false);

  const emptyBatchDatabase = new RecordingDatabase();
  const emptyBatch = new PostgresActorInvitationHumanQuery(emptyBatchDatabase.asBackendDatabase());
  assert.deepEqual(await emptyBatch.listInvitationHumans({
    companyId: "company_one",
    authUserIds: [],
  }), []);
  assert.deepEqual(emptyBatchDatabase.queries, []);

  const retainedRowsDatabase = new RecordingDatabase();
  retainedRowsDatabase.queueRows(
    { actor_id: "actor_retained" },
    { actor_id: "actor_other" },
  );
  const retainedRows = new PostgresActorInvitationHumanQuery(retainedRowsDatabase.asBackendDatabase());
  assert.equal(await retainedRows.hasRetainedHumanForAuthUser("user_retained"), true);
  assert.match(retainedRowsDatabase.queries[0]?.sql ?? "", /limit 1/u);
});

test("Actor invitation Human query turns malformed rows and driver failures into the policy safe unavailable outcome", async () => {
  const malformedDatabase = new RecordingDatabase();
  malformedDatabase.queueRows({ auth_user_id: "user_one", status: "retired" });
  const malformedPolicy = policyWithHumanQuery(
    new PostgresActorInvitationHumanQuery(malformedDatabase.asBackendDatabase()),
  );

  await assert.rejects(
    malformedPolicy.assertInvitationCreationAllowed({
      organizationId: "organization_one",
      email: "ada@example.test",
      role: "member",
    }),
    unavailablePolicyError,
  );

  const secret = "postgres://actor-invitation-secret.example/fields";
  const failedDatabase = new RecordingDatabase();
  failedDatabase.queueError(new Error(secret));
  const failedQuery = new PostgresActorInvitationHumanQuery(failedDatabase.asBackendDatabase());
  await assert.rejects(
    failedQuery.hasRetainedHumanForAuthUser("user_one"),
    causeLessFailureWithout(secret),
  );
});

function policyWithHumanQuery(humans: PostgresActorInvitationHumanQuery): HumanInvitationAdmissionPolicy {
  return new HumanInvitationAdmissionPolicy({
    invitations: {
      findInvitationById: async () => null,
      hasAnyMembershipForAuthUser: async () => false,
      findEmailAuthorities: async () => [{
        authUserId: "user_one",
        hasOrganizationMembership: true,
      }],
    },
    companies: {
      findActiveCompanyByAuthOrganizationId: async () => ({
        companyId: "company_one",
        companyName: "Fields",
      }),
    },
    humans,
    clock: { now: () => 100 },
  });
}

function unavailablePolicyError(error: unknown): boolean {
  assert.ok(error instanceof HumanInvitationAdmissionError);
  assert.equal(error.failure, "unavailable");
  assert.equal(error.code, HUMAN_INVITATION_ADMISSION_UNAVAILABLE_CODE);
  return true;
}

function causeLessFailureWithout(secret: string): (error: unknown) => boolean {
  return (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message.includes(secret), false);
    assert.equal("cause" in error, false);
    return true;
  };
}

type CapturedQuery = {
  sql: string;
  params: unknown[];
};

class RecordingDatabase {
  readonly queries: CapturedQuery[] = [];
  private readonly dialect = new PgDialect();
  private readonly responses: Array<{ rows?: unknown[]; error?: unknown }> = [];

  queueRows(...rows: unknown[]): void {
    this.responses.push({ rows });
  }

  queueError(error: unknown): void {
    this.responses.push({ error });
  }

  async execute(query: SQL): Promise<unknown[]> {
    const compiled = this.dialect.sqlToQuery(query);
    this.queries.push({
      sql: compiled.sql.replaceAll(/\s+/gu, " ").trim(),
      params: compiled.params,
    });
    const response = this.responses.shift();
    if (response?.error !== undefined) {
      throw response.error;
    }
    return response?.rows ?? [];
  }

  asBackendDatabase(): BackendDatabase {
    return this as unknown as BackendDatabase;
  }
}
