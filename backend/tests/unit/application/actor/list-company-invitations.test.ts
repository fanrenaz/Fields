import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ApplicationError } from "../../../../src/application/platform/errors.js";
import type {
  CompanyInvitationOrganizationQuery,
  PendingCompanyMemberInvitation,
  PendingCompanyMemberInvitationQuery,
} from "../../../../src/application/actor/ports/company-invitation-directory.js";
import {
  COMPANY_INVITATIONS_UNAVAILABLE_CODE,
  ListCompanyInvitations,
} from "../../../../src/application/actor/queries/list-company-invitations.js";
import type {
  RequireActiveHumanCompanyOwnerUseCase,
} from "../../../../src/application/actor/queries/require-active-company-owner.js";

const request = {
  companyId: "company_one",
  requestedByActorId: "actor_owner",
};

test("Company invitation directory is Owner-only and derives the exact expiry boundary", async () => {
  const owner = new RecordingOwnerAuthorization();
  const companies = new FakeCompanies();
  const invitations = new FakeInvitations([
    invitation({ invitationCredential: "future", expiresAtMs: 101 }),
    invitation({ invitationCredential: "exact", expiresAtMs: 100 }),
    invitation({ invitationCredential: "past", expiresAtMs: 99 }),
  ]);
  const query = new ListCompanyInvitations({
    ownerAuthorization: owner,
    companies,
    invitations,
    now: () => 100,
  });

  assert.deepEqual(await query.execute(request), [
    projection("future", "pending", 101),
    projection("exact", "expired", 100),
    projection("past", "expired", 99),
  ]);
  assert.deepEqual(owner.calls, [request]);
  assert.deepEqual(companies.calls, ["company_one"]);
  assert.deepEqual(invitations.calls, ["organization_one"]);

  owner.failure = new ApplicationError("COMPANY_OWNER_REQUIRED", false);
  await assert.rejects(
    query.execute({ ...request, requestedByActorId: "actor_member" }),
    (error: unknown) => {
      assert.ok(error instanceof ApplicationError);
      assert.equal(error.code, "COMPANY_OWNER_REQUIRED");
      assert.equal(error.retryable, false);
      return true;
    },
  );
  assert.equal(companies.calls.length, 1);
});

test("Company invitation directory rejects cross-Company, role, and provider-status leakage", async () => {
  for (const malformed of [
    invitation({ organizationId: "organization_other" }),
    invitation({ role: "owner" }),
    invitation({ providerStatus: "accepted" }),
  ]) {
    const query = new ListCompanyInvitations({
      ownerAuthorization: new RecordingOwnerAuthorization(),
      companies: new FakeCompanies(),
      invitations: new FakeInvitations([malformed]),
      now: () => 100,
    });
    await assert.rejects(query.execute(request), unavailable);
  }
});

test("Company invitation failures expose no credential, email, link, or persistence detail", async () => {
  const sensitive = [
    "invitation_super_secret",
    "invitee@example.test",
    "https://fields.example.com/auth?invitation=secret",
    "postgresql://secret",
  ].join(" ");
  const query = new ListCompanyInvitations({
    ownerAuthorization: new RecordingOwnerAuthorization(),
    companies: new FakeCompanies(),
    invitations: {
      async listPendingMemberInvitations() {
        throw new Error(sensitive);
      },
    },
    now: () => 100,
  });

  await assert.rejects(query.execute(request), (error: unknown) => {
    assert.ok(error instanceof ApplicationError);
    assert.equal(error.code, COMPANY_INVITATIONS_UNAVAILABLE_CODE);
    assert.equal(error.retryable, true);
    assert.equal(error.message.includes("secret"), false);
    assert.equal("cause" in error, false);
    return true;
  });
});

test("Company invitation request failure logs contain only controlled classifications", () => {
  const core = readFileSync(
    new URL("../../../../src/interface/trpc/core.ts", import.meta.url),
    "utf8",
  );
  const start = core.indexOf('emitObservabilityLog("trpc.request.failed"');
  const end = core.indexOf("});", start);
  const failureLog = core.slice(start, end);

  assert.ok(start >= 0);
  assert.match(failureLog, /code: result\.error\.code/u);
  assert.match(failureLog, /retryable:/u);
  assert.match(failureLog, /"fields\.procedure": path/u);
  assert.doesNotMatch(
    failureLog,
    /credential|email|invitationLink|input|output|message|cause/iu,
  );
});

function invitation(
  overrides: Partial<PendingCompanyMemberInvitation> = {},
): PendingCompanyMemberInvitation {
  return {
    invitationCredential: "invitation_one",
    organizationId: "organization_one",
    email: "invitee@example.test",
    role: "member",
    providerStatus: "pending",
    createdAtMs: 1,
    expiresAtMs: 200,
    ...overrides,
  };
}

function projection(
  credential: string,
  status: "pending" | "expired",
  expiresAtMs: number,
) {
  return {
    status,
    invitation_credential: credential,
    email: "invitee@example.test",
    created_at_ms: 1,
    expires_at_ms: expiresAtMs,
  };
}

function unavailable(error: unknown): boolean {
  assert.ok(error instanceof ApplicationError);
  assert.equal(error.code, COMPANY_INVITATIONS_UNAVAILABLE_CODE);
  assert.equal(error.retryable, true);
  return true;
}

class RecordingOwnerAuthorization implements RequireActiveHumanCompanyOwnerUseCase {
  readonly calls: typeof request[] = [];
  failure: ApplicationError | null = null;

  async execute(input: typeof request) {
    this.calls.push(input);
    if (this.failure) throw this.failure;
    return {
      actorId: input.requestedByActorId,
      companyId: input.companyId,
      companyRole: "owner" as const,
    };
  }
}

class FakeCompanies implements CompanyInvitationOrganizationQuery {
  readonly calls: string[] = [];

  async findActiveOrganizationByCompanyId(companyId: string) {
    this.calls.push(companyId);
    return {
      companyId,
      companyName: "Fields",
      organizationId: "organization_one",
    };
  }
}

class FakeInvitations implements PendingCompanyMemberInvitationQuery {
  readonly calls: string[] = [];

  constructor(private readonly items: readonly PendingCompanyMemberInvitation[]) {}

  async listPendingMemberInvitations(organizationId: string) {
    this.calls.push(organizationId);
    return this.items;
  }
}
