import assert from "node:assert/strict";
import test from "node:test";

import type { Clock } from "../../../../../src/application/platform/ports/index.js";
import type {
  ActiveInvitationCompany,
  ActorInvitationHumanQuery,
  CompanyInvitationQuery,
  HumanInvitationAdmissionInvitation,
  InvitationAuthorityQuery,
  InvitationEmailAuthority,
  InvitationHumanActor,
} from "../../../../../src/application/actor/ports/index.js";

import {
  HUMAN_INVITATION_ADMISSION_EXISTING_HUMAN_CODE,
  HUMAN_INVITATION_ADMISSION_INVALID_CODE,
  HUMAN_INVITATION_ADMISSION_REMOVED_HUMAN_CODE,
  HUMAN_INVITATION_ADMISSION_ROLE_INVALID_CODE,
  HUMAN_INVITATION_ADMISSION_SECOND_COMPANY_CODE,
  HUMAN_INVITATION_ADMISSION_UNAVAILABLE_CODE,
  HumanInvitationAdmissionError,
  HumanInvitationAdmissionPolicy,
  type HumanInvitationAdmissionFailure,
} from "../../../../../src/application/actor/queries/human-invitation-admission.js";

const NOW_MS = 1_000;
const invitationId = "invitation_one";
const organizationId = "organization_one";
const companyId = "company_one";
const invitationEmail = "invited@example.test";

test("preview returns only the active Company name and preserves invitation validation order", async () => {
  const fixture = policyFixture();

  const preview = await fixture.policy.previewInvitation(` ${invitationId} `);

  assert.deepEqual(preview, { company_name: "Fields" });
  assert.deepEqual(fixture.trace, [
    `invitation:${invitationId}`,
    "clock",
    `company:${organizationId}`,
  ]);
});

test("preview preserves the invalid outcome for missing, expired, wrong-role, and unmapped facts", async (t) => {
  const cases: Array<{
    name: string;
    mutate: (fixture: PolicyFixture) => void;
    expectedTrace: readonly string[];
  }> = [
    {
      name: "missing invitation",
      mutate: (fixture) => {
        fixture.state.invitation = null;
      },
      expectedTrace: [`invitation:${invitationId}`],
    },
    {
      name: "expired invitation at the injected clock boundary",
      mutate: (fixture) => {
        fixture.state.invitation = invitation({ expiresAtMs: NOW_MS });
      },
      expectedTrace: [`invitation:${invitationId}`, "clock"],
    },
    {
      name: "non-member invitation",
      mutate: (fixture) => {
        fixture.state.invitation = invitation({ role: "owner" });
      },
      expectedTrace: [`invitation:${invitationId}`],
    },
    {
      name: "unmapped organization",
      mutate: (fixture) => {
        fixture.state.company = null;
      },
      expectedTrace: [`invitation:${invitationId}`, "clock", `company:${organizationId}`],
    },
  ];

  for (const invalidCase of cases) {
    await t.test(invalidCase.name, async () => {
      const fixture = policyFixture();
      invalidCase.mutate(fixture);

      await assert.rejects(
        fixture.policy.previewInvitation(invitationId),
        admissionFailure("invalid"),
      );
      assert.deepEqual(fixture.trace, invalidCase.expectedTrace);
    });
  }
});

test("email signup normalizes the bearer and email, validates name first, and only then checks prior Humans", async () => {
  const fixture = policyFixture({
    authorities: [{ authUserId: "user_one", hasOrganizationMembership: true }],
    humans: [],
  });

  await fixture.policy.assertEmailSignUpAllowed({
    invitationId: ` ${invitationId} `,
    email: ` ${invitationEmail.toUpperCase()} `,
    name: " Ada Lovelace ",
  });

  assert.deepEqual(fixture.trace, [
    `invitation:${invitationId}`,
    "clock",
    `company:${organizationId}`,
    `email:${invitationEmail}:${organizationId}`,
    `humans:${companyId}:user_one`,
  ]);
});

test("email signup rejects invalid local input before querying invitation authority", async (t) => {
  const cases: Array<{
    name: string;
    input: { invitationId: string | null; email: unknown; name: unknown };
  }> = [
    {
      name: "missing bearer",
      input: { invitationId: null, email: invitationEmail, name: "Ada" },
    },
    {
      name: "header injection bearer",
      input: { invitationId: `bad\n${invitationId}`, email: invitationEmail, name: "Ada" },
    },
    {
      name: "empty email",
      input: { invitationId, email: " ", name: "Ada" },
    },
    {
      name: "empty display name",
      input: { invitationId, email: invitationEmail, name: "  " },
    },
  ];

  for (const invalidCase of cases) {
    await t.test(invalidCase.name, async () => {
      const fixture = policyFixture();

      await assert.rejects(
        fixture.policy.assertEmailSignUpAllowed(invalidCase.input),
        admissionFailure("invalid"),
      );
      assert.deepEqual(fixture.trace, []);
    });
  }
});

test("invitation creation rejects a non-member role before any Company or Actor read", async () => {
  const fixture = policyFixture();

  await assert.rejects(
    fixture.policy.assertInvitationCreationAllowed({
      organizationId,
      email: invitationEmail,
      role: "owner",
    }),
    admissionFailure("role-invalid"),
  );

  assert.deepEqual(fixture.trace, []);
});

test("invitation creation keeps active and removed Human re-invitation outcomes distinct", async (t) => {
  const cases: Array<{
    name: string;
    authorities: readonly InvitationEmailAuthority[];
    humans: readonly InvitationHumanActor[];
    failure: HumanInvitationAdmissionFailure;
  }> = [
    {
      name: "active Human with current target membership",
      authorities: [{ authUserId: "user_one", hasOrganizationMembership: true }],
      humans: [{ authUserId: "user_one", status: "active" }],
      failure: "existing-human",
    },
    {
      name: "inactive retained Human",
      authorities: [{ authUserId: "user_one", hasOrganizationMembership: true }],
      humans: [{ authUserId: "user_one", status: "inactive" }],
      failure: "removed-human",
    },
    {
      name: "active Human without current target membership",
      authorities: [{ authUserId: "user_one", hasOrganizationMembership: false }],
      humans: [{ authUserId: "user_one", status: "active" }],
      failure: "removed-human",
    },
  ];

  for (const policyCase of cases) {
    await t.test(policyCase.name, async () => {
      const fixture = policyFixture({
        authorities: policyCase.authorities,
        humans: policyCase.humans,
      });

      await assert.rejects(
        fixture.policy.assertInvitationCreationAllowed({
          organizationId,
          email: invitationEmail,
          role: "member",
        }),
        admissionFailure(policyCase.failure),
      );
      assert.deepEqual(fixture.trace, [
        `company:${organizationId}`,
        `email:${invitationEmail}:${organizationId}`,
        `humans:${companyId}:user_one`,
      ]);
    });
  }
});

test("acceptance rejects a second Company before retained-Human and email-projection checks", async () => {
  const fixture = policyFixture({ hasAnyMembership: true, hasRetainedHuman: true });

  await assert.rejects(
    fixture.policy.assertInvitationAcceptanceAllowed(acceptanceInput()),
    admissionFailure("second-company"),
  );

  assert.deepEqual(fixture.trace, [
    "clock",
    `company:${organizationId}`,
    "membership:user_one",
  ]);
});

test("acceptance rejects a retained Human before the target-company email check", async () => {
  const fixture = policyFixture({ hasRetainedHuman: true });

  await assert.rejects(
    fixture.policy.assertInvitationAcceptanceAllowed(acceptanceInput()),
    admissionFailure("removed-human"),
  );

  assert.deepEqual(fixture.trace, [
    "clock",
    `company:${organizationId}`,
    "membership:user_one",
    "retained:user_one",
  ]);
});

test("acceptance preserves invalid invitation/email outcomes before Company and membership reads", async (t) => {
  const cases: Array<{
    name: string;
    input: ReturnType<typeof acceptanceInput>;
    expectedTrace: readonly string[];
  }> = [
    {
      name: "wrong recipient email",
      input: acceptanceInput({ userEmail: "other@example.test" }),
      expectedTrace: ["clock"],
    },
    {
      name: "expired invitation",
      input: acceptanceInput({ invitation: invitation({ expiresAtMs: NOW_MS }) }),
      expectedTrace: ["clock"],
    },
  ];

  for (const invalidCase of cases) {
    await t.test(invalidCase.name, async () => {
      const fixture = policyFixture();

      await assert.rejects(
        fixture.policy.assertInvitationAcceptanceAllowed(invalidCase.input),
        admissionFailure("invalid"),
      );
      assert.deepEqual(fixture.trace, invalidCase.expectedTrace);
    });
  }
});

test("acceptance uses current target-Company Human evidence after authoritative membership and retained-Human checks", async () => {
  const fixture = policyFixture({
    authorities: [{ authUserId: "user_one", hasOrganizationMembership: true }],
    humans: [{ authUserId: "user_one", status: "active" }],
  });

  await assert.rejects(
    fixture.policy.assertInvitationAcceptanceAllowed(acceptanceInput()),
    admissionFailure("existing-human"),
  );

  assert.deepEqual(fixture.trace, [
    "clock",
    `company:${organizationId}`,
    "membership:user_one",
    "retained:user_one",
    `email:${invitationEmail}:${organizationId}`,
    `humans:${companyId}:user_one`,
  ]);
});

test("mapped Organization checks retain the invalid outcome without an invitation read", async () => {
  const fixture = policyFixture({ company: null });

  await assert.rejects(
    fixture.policy.assertMappedOrganization(organizationId),
    admissionFailure("invalid"),
  );

  assert.deepEqual(fixture.trace, [`company:${organizationId}`]);
});

test("authority, Actor, Company, clock, and malformed-port failures normalize to the safe unavailable outcome", async (t) => {
  const cases: Array<{
    name: string;
    invoke: (fixture: PolicyFixture) => Promise<unknown>;
    mutate: (fixture: PolicyFixture) => void;
  }> = [
    {
      name: "invitation authority failure",
      invoke: (fixture) => fixture.policy.previewInvitation(invitationId),
      mutate: (fixture) => {
        fixture.state.invitationError = new Error("invitation bearer must not escape");
      },
    },
    {
      name: "Company query failure",
      invoke: (fixture) => fixture.policy.previewInvitation(invitationId),
      mutate: (fixture) => {
        fixture.state.companyError = new Error("database details must not escape");
      },
    },
    {
      name: "Actor query failure",
      invoke: (fixture) => fixture.policy.assertInvitationCreationAllowed({
        organizationId,
        email: invitationEmail,
        role: "member",
      }),
      mutate: (fixture) => {
        fixture.state.authorities = [{ authUserId: "user_one", hasOrganizationMembership: true }];
        fixture.state.humansError = new Error("actor details must not escape");
      },
    },
    {
      name: "clock failure",
      invoke: (fixture) => fixture.policy.previewInvitation(invitationId),
      mutate: (fixture) => {
        fixture.state.clockError = new Error("clock details must not escape");
      },
    },
    {
      name: "malformed email authority",
      invoke: (fixture) => fixture.policy.assertInvitationCreationAllowed({
        organizationId,
        email: invitationEmail,
        role: "member",
      }),
      mutate: (fixture) => {
        fixture.state.authorities = [{ authUserId: "", hasOrganizationMembership: true }];
      },
    },
  ];

  for (const unavailableCase of cases) {
    await t.test(unavailableCase.name, async () => {
      const fixture = policyFixture();
      unavailableCase.mutate(fixture);

      await assert.rejects(
        unavailableCase.invoke(fixture),
        admissionFailure("unavailable"),
      );
    });
  }
});

function acceptanceInput(overrides: Partial<{
  invitation: HumanInvitationAdmissionInvitation;
  userId: string;
  userEmail: string;
}> = {}) {
  return {
    invitation: invitation(),
    userId: "user_one",
    userEmail: invitationEmail,
    ...overrides,
  };
}

function invitation(overrides: Partial<HumanInvitationAdmissionInvitation> = {}): HumanInvitationAdmissionInvitation {
  return {
    organizationId,
    email: invitationEmail,
    role: "member",
    status: "pending",
    expiresAtMs: NOW_MS + 1,
    ...overrides,
  };
}

type PolicyFixture = {
  policy: HumanInvitationAdmissionPolicy;
  state: FakeState;
  trace: string[];
};

type FakeState = {
  invitation: HumanInvitationAdmissionInvitation | null;
  company: ActiveInvitationCompany | null;
  authorities: readonly InvitationEmailAuthority[];
  humans: readonly InvitationHumanActor[];
  hasAnyMembership: boolean;
  hasRetainedHuman: boolean;
  nowMs: number;
  invitationError: Error | null;
  companyError: Error | null;
  authoritiesError: Error | null;
  membershipError: Error | null;
  retainedHumanError: Error | null;
  humansError: Error | null;
  clockError: Error | null;
};

function policyFixture(overrides: Partial<FakeState> = {}): PolicyFixture {
  const trace: string[] = [];
  const state: FakeState = {
    invitation: invitation(),
    company: { companyId, companyName: "Fields" },
    authorities: [],
    humans: [],
    hasAnyMembership: false,
    hasRetainedHuman: false,
    nowMs: NOW_MS,
    invitationError: null,
    companyError: null,
    authoritiesError: null,
    membershipError: null,
    retainedHumanError: null,
    humansError: null,
    clockError: null,
    ...overrides,
  };
  const invitations: InvitationAuthorityQuery = {
    async findInvitationById(value) {
      trace.push(`invitation:${value}`);
      if (state.invitationError) throw state.invitationError;
      return state.invitation;
    },
    async hasAnyMembershipForAuthUser(authUserId) {
      trace.push(`membership:${authUserId}`);
      if (state.membershipError) throw state.membershipError;
      return state.hasAnyMembership;
    },
    async findEmailAuthorities(input) {
      trace.push(`email:${input.normalizedEmail}:${input.organizationId}`);
      if (state.authoritiesError) throw state.authoritiesError;
      return state.authorities;
    },
  };
  const companies: CompanyInvitationQuery = {
    async findActiveCompanyByAuthOrganizationId(value) {
      trace.push(`company:${value}`);
      if (state.companyError) throw state.companyError;
      return state.company;
    },
  };
  const humans: ActorInvitationHumanQuery = {
    async hasRetainedHumanForAuthUser(authUserId) {
      trace.push(`retained:${authUserId}`);
      if (state.retainedHumanError) throw state.retainedHumanError;
      return state.hasRetainedHuman;
    },
    async listInvitationHumans(input) {
      trace.push(`humans:${input.companyId}:${input.authUserIds.join(",")}`);
      if (state.humansError) throw state.humansError;
      return state.humans;
    },
  };
  const clock: Clock = {
    now() {
      trace.push("clock");
      if (state.clockError) throw state.clockError;
      return state.nowMs;
    },
  };
  return {
    policy: new HumanInvitationAdmissionPolicy({ invitations, companies, humans, clock }),
    state,
    trace,
  };
}

function admissionFailure(expected: HumanInvitationAdmissionFailure): (error: unknown) => boolean {
  return (error: unknown) => {
    if (!(error instanceof HumanInvitationAdmissionError) || error.failure !== expected) {
      return false;
    }
    const expectedCode = {
      invalid: HUMAN_INVITATION_ADMISSION_INVALID_CODE,
      "role-invalid": HUMAN_INVITATION_ADMISSION_ROLE_INVALID_CODE,
      "second-company": HUMAN_INVITATION_ADMISSION_SECOND_COMPANY_CODE,
      "removed-human": HUMAN_INVITATION_ADMISSION_REMOVED_HUMAN_CODE,
      "existing-human": HUMAN_INVITATION_ADMISSION_EXISTING_HUMAN_CODE,
      unavailable: HUMAN_INVITATION_ADMISSION_UNAVAILABLE_CODE,
    } satisfies Record<HumanInvitationAdmissionFailure, string>;
    return error.code === expectedCode[expected]
      && error.message === expectedMessage(expected);
  };
}

function expectedMessage(failure: HumanInvitationAdmissionFailure): string {
  switch (failure) {
    case "invalid":
      return "A valid pending Fields invitation is required.";
    case "role-invalid":
      return "Fields Human invitations must use the member role.";
    case "second-company":
      return "This account already belongs to a Company.";
    case "removed-human":
      return "A removed Human cannot be invited again in this version.";
    case "existing-human":
      return "This Human already belongs to the Fields Company.";
    case "unavailable":
      return "Invitation validation is temporarily unavailable.";
  }
}
