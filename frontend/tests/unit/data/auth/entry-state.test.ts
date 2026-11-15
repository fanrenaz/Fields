import assert from "node:assert/strict";
import test from "node:test";
import type {
  SessionMe,
} from "@fields/contracts/public/company";

import {
  activeProductSessionFrom,
  authenticatedEntryFor,
  ONBOARDING_POLL_INTERVAL_MS,
  onboardingUsesGlobalLoading,
  shouldMountProductWorkspace,
} from "../../../../data/auth/entry-state";

const noCompany: SessionMe = {
  has_company: false,
  registration_pending: false,
  user_id: "user-one",
  actor_id: null,
  company_id: null,
  display_name: "Ada",
  actor_type: "human",
  company_role: null,
  company_status: null,
};

const provisioning: SessionMe = {
  has_company: true,
  registration_pending: false,
  user_id: "user-one",
  actor_id: "actor-one",
  company_id: "company-one",
  display_name: "Ada",
  actor_type: "human",
  company_role: "owner",
  company_status: "provisioning",
};

const active: SessionMe = { ...provisioning, company_status: "active" };

test("authenticated entry gates the product workspace on an active Company", () => {
  assert.equal(authenticatedEntryFor(noCompany), "noAccess");
  assert.equal(authenticatedEntryFor({ ...noCompany, registration_pending: true }), "registrationPending");
  assert.equal(authenticatedEntryFor(provisioning), "onboarding");
  assert.equal(authenticatedEntryFor({ ...provisioning, company_status: "setup_failed" }), "onboarding");
  assert.equal(authenticatedEntryFor(active), "workspace");
  assert.equal(shouldMountProductWorkspace(provisioning), false);
  assert.equal(shouldMountProductWorkspace(active), true);
});

test("only an active Company becomes a ProductSession", () => {
  assert.equal(activeProductSessionFrom(noCompany), null);
  assert.equal(activeProductSessionFrom(provisioning), null);
  assert.deepEqual(activeProductSessionFrom(active), {
    actor_id: "actor-one",
    company_id: "company-one",
    display_name: "Ada",
    actor_type: "human",
    company_role: "owner",
    company_status: "active",
  });
});

test("onboarding uses the frozen one-second poll and global-loading stages", () => {
  assert.equal(ONBOARDING_POLL_INTERVAL_MS, 1_000);
  assert.equal(onboardingUsesGlobalLoading("creatingRuntime"), true);
  assert.equal(onboardingUsesGlobalLoading("initializingRuntime"), true);
  assert.equal(onboardingUsesGlobalLoading("failed"), false);
  assert.equal(onboardingUsesGlobalLoading("ready"), false);
});
