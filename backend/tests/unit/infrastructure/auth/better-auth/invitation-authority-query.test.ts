import assert from "node:assert/strict";
import test from "node:test";

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  HUMAN_INVITATION_ADMISSION_UNAVAILABLE_CODE,
  HumanInvitationAdmissionError,
  HumanInvitationAdmissionPolicy,
} from "../../../../../src/application/actor/queries/human-invitation-admission.js";
import type { BackendDatabase } from "../../../../../src/infrastructure/persistence/postgres/database-service.js";

import { BetterAuthInvitationAuthorityQuery } from "../../../../../src/infrastructure/auth/better-auth/invitation-authority-query.js";

test("Better Auth invitation authority reads only invitation, membership, and email authority facts", async () => {
  const database = new RecordingDatabase();
  database.queueRows(invitationRow());
  database.queueRows({ membership_id: "membership_one" });
  database.queueRows({ auth_user_id: "user_one", membership_id: "membership_one" });
  const query = new BetterAuthInvitationAuthorityQuery(database.asBackendDatabase());

  assert.deepEqual(await query.findInvitationById("invitation_one"), {
    organizationId: "organization_one",
    email: "Ada@Example.test",
    role: "member",
    status: "pending",
    expiresAtMs: 500,
  });
  assert.equal(await query.hasAnyMembershipForAuthUser("user_one"), true);
  assert.deepEqual(await query.findEmailAuthorities({
    normalizedEmail: "ada@example.test",
    organizationId: "organization_one",
  }), [{ authUserId: "user_one", hasOrganizationMembership: true }]);

  assert.match(database.queries[0]?.sql ?? "", /from invitation/u);
  assert.match(database.queries[0]?.sql ?? "", /where id = \$\d+/u);
  assert.match(database.queries[1]?.sql ?? "", /from member/u);
  assert.match(database.queries[1]?.sql ?? "", /where user_id = \$\d+/u);
  assert.match(database.queries[1]?.sql ?? "", /limit 1/u);
  assert.match(database.queries[2]?.sql ?? "", /from "user" auth_user/u);
  assert.match(database.queries[2]?.sql ?? "", /left join member target_membership/u);
  assert.match(database.queries[2]?.sql ?? "", /target_membership\.organization_id = \$\d+/u);
  assert.match(database.queries[2]?.sql ?? "", /lower\(auth_user\.email\) = \$\d+/u);
  for (const captured of database.queries) {
    assert.equal(/\bcompanies\b|\bactors\b/u.test(captured.sql), false);
  }
  assert.equal(/session|account|token|credential/iu.test(database.queries[2]?.sql ?? ""), false);
});

test("Better Auth invitation authority accepts the timestamp string returned by real raw PostgreSQL queries", async () => {
  const database = new RecordingDatabase();
  database.queueRows(invitationRow({ expires_at: "1970-01-01 00:00:00.5" }));
  const query = new BetterAuthInvitationAuthorityQuery(database.asBackendDatabase());

  assert.deepEqual(await query.findInvitationById("invitation_one"), {
    organizationId: "organization_one",
    email: "Ada@Example.test",
    role: "member",
    status: "pending",
    expiresAtMs: 500,
  });
});

test("Better Auth invitation directory is scoped to pending member invitations for one Organization", async () => {
  const database = new RecordingDatabase();
  database.queueRows({
    invitation_id: "invitation_one",
    organization_id: "organization_one",
    email: "invitee@example.test",
    role: "member",
    status: "pending",
    created_at: new Date(100),
    expires_at: new Date(200),
  });
  const query = new BetterAuthInvitationAuthorityQuery(database.asBackendDatabase());

  assert.deepEqual(await query.listPendingMemberInvitations("organization_one"), [{
    invitationCredential: "invitation_one",
    organizationId: "organization_one",
    email: "invitee@example.test",
    role: "member",
    providerStatus: "pending",
    createdAtMs: 100,
    expiresAtMs: 200,
  }]);
  const captured = database.queries[0]?.sql ?? "";
  assert.match(captured, /from invitation/u);
  assert.match(captured, /organization_id = \$\d+/u);
  assert.match(captured, /role = 'member'/u);
  assert.match(captured, /status = 'pending'/u);
  assert.equal(/\bcompanies\b|\bactors\b|\bmember\b/u.test(captured.replace("role = 'member'", "")), false);
});

test("Better Auth invitation directory keeps the oldest canonical bearer across expiry changes", async () => {
  const database = new RecordingDatabase();
  database.queueRows(
    {
      invitation_id: "invitation_expired",
      organization_id: "organization_one",
      email: "Invitee@Example.test",
      role: "member",
      status: "pending",
      created_at: new Date(300),
      expires_at: new Date(400),
    },
    {
      invitation_id: "invitation_canonical",
      organization_id: "organization_one",
      email: "invitee@example.test",
      role: "member",
      status: "pending",
      created_at: new Date(100),
      expires_at: new Date(600),
    },
    {
      invitation_id: "invitation_other",
      organization_id: "organization_one",
      email: "other@example.test",
      role: "member",
      status: "pending",
      created_at: new Date(200),
      expires_at: new Date(700),
    },
  );
  const query = new BetterAuthInvitationAuthorityQuery(database.asBackendDatabase());

  assert.deepEqual(
    (await query.listPendingMemberInvitations("organization_one"))
      .map((invitation) => invitation.invitationCredential),
    ["invitation_canonical", "invitation_other"],
  );
});

test("Better Auth invitation authority preserves legacy absent and ambiguous invitation semantics", async () => {
  const database = new RecordingDatabase();
  database.queueRows();
  database.queueRows();
  database.queueRows();
  const query = new BetterAuthInvitationAuthorityQuery(database.asBackendDatabase());

  assert.equal(await query.findInvitationById("invitation_missing"), null);
  assert.equal(await query.hasAnyMembershipForAuthUser("user_missing"), false);
  assert.deepEqual(await query.findEmailAuthorities({
    normalizedEmail: "missing@example.test",
    organizationId: "organization_one",
  }), []);

  const ambiguousDatabase = new RecordingDatabase();
  ambiguousDatabase.queueRows(invitationRow(), invitationRow({ invitation_id: "invitation_other" }));
  const ambiguous = new BetterAuthInvitationAuthorityQuery(ambiguousDatabase.asBackendDatabase());
  assert.equal(await ambiguous.findInvitationById("invitation_one"), null);

  const membershipDatabase = new RecordingDatabase();
  membershipDatabase.queueRows(
    { membership_id: "membership_one" },
    { membership_id: "membership_two" },
  );
  const membership = new BetterAuthInvitationAuthorityQuery(membershipDatabase.asBackendDatabase());
  assert.equal(await membership.hasAnyMembershipForAuthUser("user_one"), true);
  assert.match(membershipDatabase.queries[0]?.sql ?? "", /limit 1/u);
});

test("Better Auth invitation authority turns malformed rows and driver failures into the policy safe unavailable outcome", async () => {
  const malformedDatabase = new RecordingDatabase();
  malformedDatabase.queueRows(invitationRow({ expires_at: "not-a-timestamp" }));
  const malformedPolicy = policyWithInvitationQuery(
    new BetterAuthInvitationAuthorityQuery(malformedDatabase.asBackendDatabase()),
  );

  await assert.rejects(
    malformedPolicy.previewInvitation("invitation_one"),
    unavailablePolicyError,
  );

  const secret = "postgres://invitation-authority-secret.example/fields";
  const failedDatabase = new RecordingDatabase();
  failedDatabase.queueError(new Error(secret));
  const failedQuery = new BetterAuthInvitationAuthorityQuery(failedDatabase.asBackendDatabase());
  await assert.rejects(
    failedQuery.hasAnyMembershipForAuthUser("user_one"),
    causeLessFailureWithout(secret),
  );
});

function policyWithInvitationQuery(invitations: BetterAuthInvitationAuthorityQuery): HumanInvitationAdmissionPolicy {
  return new HumanInvitationAdmissionPolicy({
    invitations,
    companies: {
      findActiveCompanyByAuthOrganizationId: async () => ({
        companyId: "company_one",
        companyName: "Fields",
      }),
    },
    humans: {
      hasRetainedHumanForAuthUser: async () => false,
      listInvitationHumans: async () => [],
    },
    clock: { now: () => 100 },
  });
}

function invitationRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    invitation_id: "invitation_one",
    organization_id: "organization_one",
    email: "Ada@Example.test",
    role: "member",
    status: "pending",
    expires_at: new Date(500),
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
