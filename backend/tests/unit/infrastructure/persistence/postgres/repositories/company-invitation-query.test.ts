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

import { PostgresCompanyInvitationQuery } from "../../../../../../src/infrastructure/persistence/postgres/repositories/company-invitation-query.js";

test("Company invitation query reads one active Company mapping without Better Auth or Actor joins", async () => {
  const database = new RecordingDatabase();
  database.queueRows(companyRow());
  const query = new PostgresCompanyInvitationQuery(database.asBackendDatabase());

  assert.deepEqual(await query.findActiveCompanyByAuthOrganizationId("organization_one"), {
    companyId: "company_one",
    companyName: "Fields",
  });

  const captured = database.queries[0];
  assert.match(captured?.sql ?? "", /from companies/u);
  assert.match(captured?.sql ?? "", /status = 'active'/u);
  assert.match(captured?.sql ?? "", /auth_organization_id is not null/u);
  assert.match(captured?.sql ?? "", /auth_organization_id = \$\d+/u);
  assert.equal(/\bjoin\b/u.test(captured?.sql ?? ""), false);
  assert.equal(/\b(?:invitation|member|actors)\b/u.test(captured?.sql ?? ""), false);
  assert.equal(/"user"/u.test(captured?.sql ?? ""), false);
});

test("Company invitation query preserves legacy absent or ambiguous mapping semantics", async () => {
  const database = new RecordingDatabase();
  database.queueRows();
  const query = new PostgresCompanyInvitationQuery(database.asBackendDatabase());

  assert.equal(await query.findActiveCompanyByAuthOrganizationId("organization_missing"), null);

  const ambiguousDatabase = new RecordingDatabase();
  ambiguousDatabase.queueRows(companyRow(), companyRow({ company_id: "company_two" }));
  const ambiguous = new PostgresCompanyInvitationQuery(ambiguousDatabase.asBackendDatabase());
  assert.equal(await ambiguous.findActiveCompanyByAuthOrganizationId("organization_one"), null);

  const mismatchedDatabase = new RecordingDatabase();
  mismatchedDatabase.queueRows(companyRow({ auth_organization_id: "organization_other" }));
  const mismatched = new PostgresCompanyInvitationQuery(mismatchedDatabase.asBackendDatabase());
  assert.equal(await mismatched.findActiveCompanyByAuthOrganizationId("organization_one"), null);
});

test("Company invitation query resolves only the active current Company Organization mapping", async () => {
  const database = new RecordingDatabase();
  database.queueRows(companyRow());
  const query = new PostgresCompanyInvitationQuery(database.asBackendDatabase());

  assert.deepEqual(await query.findActiveOrganizationByCompanyId("company_one"), {
    companyId: "company_one",
    companyName: "Fields",
    organizationId: "organization_one",
  });
  const captured = database.queries[0];
  assert.match(captured?.sql ?? "", /from companies/u);
  assert.match(captured?.sql ?? "", /status = 'active'/u);
  assert.match(captured?.sql ?? "", /id = \$\d+/u);
  assert.match(captured?.sql ?? "", /auth_organization_id is not null/u);
  assert.equal(/\bjoin\b|\binvitation\b|\bactors\b/u.test(captured?.sql ?? ""), false);
});

test("Company invitation query turns malformed rows and driver failures into the policy safe unavailable outcome", async () => {
  const malformedDatabase = new RecordingDatabase();
  malformedDatabase.queueRows(companyRow({ company_name: " " }));
  const malformedPolicy = policyWithCompanyQuery(
    new PostgresCompanyInvitationQuery(malformedDatabase.asBackendDatabase()),
  );

  await assert.rejects(
    malformedPolicy.previewInvitation("invitation_one"),
    unavailablePolicyError,
  );

  const secret = "postgres://company-invitation-secret.example/fields";
  const failedDatabase = new RecordingDatabase();
  failedDatabase.queueError(new Error(secret));
  const failedQuery = new PostgresCompanyInvitationQuery(failedDatabase.asBackendDatabase());
  await assert.rejects(
    failedQuery.findActiveCompanyByAuthOrganizationId("organization_one"),
    causeLessFailureWithout(secret),
  );
});

function policyWithCompanyQuery(companies: PostgresCompanyInvitationQuery): HumanInvitationAdmissionPolicy {
  return new HumanInvitationAdmissionPolicy({
    invitations: {
      findInvitationById: async () => invitation(),
      hasAnyMembershipForAuthUser: async () => false,
      findEmailAuthorities: async () => [],
    },
    companies,
    humans: {
      hasRetainedHumanForAuthUser: async () => false,
      listInvitationHumans: async () => [],
    },
    clock: { now: () => 100 },
  });
}

function invitation() {
  return {
    organizationId: "organization_one",
    email: "ada@example.test",
    role: "member",
    status: "pending",
    expiresAtMs: 500,
  };
}

function companyRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    company_id: "company_one",
    company_name: "Fields",
    auth_organization_id: "organization_one",
    ...overrides,
  };
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
