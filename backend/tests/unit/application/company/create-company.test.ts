import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPANY_CREATION_CONFLICT_CODE,
  CreateCompanyProcess,
  type CreateCompanyProcessDependencies,
} from "../../../../src/application/processes/company-onboarding/create-company.js";
import { ApplicationError } from "../../../../src/application/platform/errors.js";

test("Company creation stops before external organization work once the singleton exists", async () => {
  let organizationCreateCalls = 0;
  const dependencies = {
    eligibility: {
      findCompanyIdForAuthUser: async () => null,
      isCompanyCreationAvailable: async () => false,
    },
    actorQueries: {
      findByAuthUserId: async () => null,
    },
    organizations: {
      createOrganization: async () => {
        organizationCreateCalls += 1;
        throw new Error("must not create a second organization");
      },
    },
  } as unknown as CreateCompanyProcessDependencies;
  const process = new CreateCompanyProcess(dependencies);

  await assert.rejects(
    process.execute({
      name: "Second Company",
      ownerUserId: "user_without_company",
      ownerDisplayName: "Member",
    }),
    (error: unknown) => error instanceof ApplicationError
      && error.code === COMPANY_CREATION_CONFLICT_CODE
      && error.retryable === false,
  );
  assert.equal(organizationCreateCalls, 0);
});

test("Company creation persists one hidden Scheduler Human in the product transaction", async () => {
  const actors: Array<Record<string, unknown>> = [];
  let id = 0;
  const transaction = { actor: {}, company: {}, outbox: {} };
  const dependencies = {
    eligibility: { findCompanyIdForAuthUser: async () => null, isCompanyCreationAvailable: async () => true },
    actorQueries: { findByAuthUserId: async () => null },
    organizations: {
      createOrganization: async () => ({ organizationId: "organization_one" }),
      resolveMembership: async () => ({ role: "owner" }),
      deleteOrganization: async () => undefined,
    },
    companyCommands: {
      create: async () => undefined,
      createOnboardingProcess: async () => undefined,
      createRuntimeProvisioning: async () => undefined,
    },
    actorCommands: { create: async (_transaction: unknown, actor: Record<string, unknown>) => { actors.push(actor); } },
    createCompanyUnitOfWork: { execute: async (work: (value: unknown) => Promise<void>) => work(transaction) },
    outbox: { append: async () => undefined },
    ids: { next: (scope: string) => `${scope}_${++id}` },
    clock: { now: () => 123 },
  } as unknown as CreateCompanyProcessDependencies;

  await new CreateCompanyProcess(dependencies).execute({ name: "Fields", ownerUserId: "user_one", ownerDisplayName: "Owner" });

  assert.equal(actors.length, 2);
  assert.deepEqual(actors[1], {
    id: "actor_3",
    companyId: "company_1",
    type: "human",
    displayName: "定时任务",
    mark: "定时",
    companyRole: "member",
    status: "active",
    authUserId: null,
    systemRole: "scheduler",
  });
});
