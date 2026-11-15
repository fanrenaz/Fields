import assert from "node:assert/strict";
import test from "node:test";

import type {
  CompanyActor,
  CompanyInvitation,
} from "@fields/contracts/public/company";
import type {
  CompanySharedPoolExecutorSummary,
} from "@fields/contracts/public/executor";

import {
  availableCompanySharedExecutors,
  createOrConfigureAgent,
  decideHumanInvitation,
  generateMemberMark,
  resolveAuthoritativeHumanInvitation,
} from "../../../../features/members/member-creation";

test("Human invitation validation distinguishes members, existing invitations, and creation", () => {
  const members = [actor({ email: "member@example.test" })];
  const invitations = [invitation({ email: "pending@example.test" })];

  assert.deepEqual(decideHumanInvitation("not-an-email", members, invitations), {
    kind: "invalid_email",
  });
  assert.deepEqual(decideHumanInvitation(" MEMBER@EXAMPLE.TEST ", members, invitations), {
    kind: "existing_member",
  });
  assert.deepEqual(
    decideHumanInvitation("pending@example.test", members, invitations),
    { kind: "existing_invitation", invitation: invitations[0] },
  );
  assert.deepEqual(decideHumanInvitation("new@example.test", members, invitations), {
    kind: "create",
    normalizedEmail: "new@example.test",
  });
});

test("Human submission revalidates every locally valid email against server authority", async () => {
  const staleInvitation = invitation({ email: "stale@example.test" });
  const resolvedEmails: string[] = [];
  const decision = await resolveAuthoritativeHumanInvitation(
    " STALE@EXAMPLE.TEST ",
    [],
    [staleInvitation],
    async (normalizedEmail) => {
      resolvedEmails.push(normalizedEmail);
      return { kind: "create", normalizedEmail };
    },
  );

  assert.deepEqual(resolvedEmails, ["stale@example.test"]);
  assert.deepEqual(decision, {
    kind: "create",
    normalizedEmail: "stale@example.test",
  });

  let invalidResolved = false;
  assert.deepEqual(
    await resolveAuthoritativeHumanInvitation(
      "not-an-email",
      [],
      [],
      async () => {
        invalidResolved = true;
        return { kind: "create", normalizedEmail: "unexpected@example.test" };
      },
    ),
    { kind: "invalid_email" },
  );
  assert.equal(invalidResolved, false);
});

test("mark generation handles words, Unicode code points, and Latin uppercasing", () => {
  assert.equal(generateMemberMark("research agent"), "RA");
  assert.equal(generateMemberMark("agent"), "AG");
  assert.equal(generateMemberMark("李雷"), "李雷");
  assert.equal(generateMemberMark("😀 robot"), "😀R");
  assert.equal(generateMemberMark("éclair"), "ÉC");
  assert.equal(generateMemberMark("ångström beta"), "ÅB");
  assert.equal(generateMemberMark("αθήνα"), "αθ");
});

test("only available company-shared Executors can be used for Agent creation", () => {
  const available = executor({ executor_id: "available" });
  assert.deepEqual(
    availableCompanySharedExecutors([
      available,
      executor({ executor_id: "blocked", sharing_status: "admin_blocked" }),
      executor({ executor_id: "offline", availability: "unavailable" }),
    ]),
    [available],
  );
});

test("Agent retry retains the created profile and never creates a duplicate", async () => {
  let createCalls = 0;
  let setCalls = 0;
  const created = actor({
    actor_id: "agent-one",
    actor_type: "agent",
    email: null,
    display_name: "Research Agent",
  });
  const createActor = async () => {
    createCalls += 1;
    return { actor: created };
  };
  const setExecutor = async (input: { member_id: string; executor_id: string }) => {
    setCalls += 1;
    if (setCalls === 1) throw new Error("runtime unavailable");
    return {
      member_id: input.member_id,
      executor: executor({ executor_id: input.executor_id }),
      version: 1,
      session_state: "ready" as const,
      updated_at_ms: 1,
    };
  };

  const first = await createOrConfigureAgent({
    createdActor: null,
    displayName: "Research Agent",
    mark: "RA",
    executorId: "executor-one",
    createActor,
    setExecutor,
  });
  assert.equal(first.status, "executor_failed");
  assert.equal(createCalls, 1);
  assert.equal(setCalls, 1);

  const retry = await createOrConfigureAgent({
    createdActor: first.actor,
    displayName: "Research Agent",
    mark: "RA",
    executorId: "executor-one",
    createActor,
    setExecutor,
  });
  assert.equal(retry.status, "configured");
  assert.equal(createCalls, 1);
  assert.equal(setCalls, 2);
});

function actor(overrides: Partial<CompanyActor> = {}): CompanyActor {
  return {
    actor_id: "actor-one",
    display_name: "Member",
    mark: "ME",
    email: "member@example.test",
    actor_type: "human",
    company_role: "member",
    status: "active",
    ...overrides,
  };
}

function invitation(overrides: Partial<CompanyInvitation> = {}): CompanyInvitation {
  return {
    status: "pending",
    invitation_credential: "invitation-one",
    email: "pending@example.test",
    created_at_ms: 1,
    expires_at_ms: 2,
    ...overrides,
  };
}

function executor(
  overrides: Partial<CompanySharedPoolExecutorSummary> = {},
): CompanySharedPoolExecutorSummary {
  return {
    executor_id: "executor-one",
    scope: "personal",
    executor_type: "codex",
    binding_method: "device_code",
    owner_actor_id: "owner-one",
    owner_display_name: "Owner",
    name: "Executor",
    authorization: { method: "custom_api_key" },
    availability: "available",
    model_policy: {
      revision: 1,
      status: "ready",
      models: [{ model: "gpt-5", display_name: "GPT-5", source: "catalog", supported_reasoning_efforts: ["medium"], validation_status: "available", last_validated_at_ms: 1 }],
      allowed_reasoning_efforts: ["medium"],
      default_model: "gpt-5",
      default_reasoning_effort: "medium",
      catalog_checked_at_ms: 1,
      updated_at_ms: 1,
    },
    sharing_status: "company_shared",
    ...overrides,
  };
}
