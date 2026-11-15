import assert from "node:assert/strict";
import test from "node:test";

import {
  canTransitionCompanyStatus,
  CompanyStatusTransitionError,
  transitionCompanyStatus,
  type Company,
} from "../../../../src/domain/company/index.js";

const company: Company = {
  id: "company_one",
  name: "Fields",
  status: "provisioning",
  authOrganizationId: "organization_one",
  createdAtMs: 10,
  updatedAtMs: 10,
};

test("Company only exposes the approved provisioning status transitions", () => {
  assert.equal(canTransitionCompanyStatus("provisioning", "active"), true);
  assert.equal(canTransitionCompanyStatus("provisioning", "setup_failed"), true);
  assert.equal(canTransitionCompanyStatus("setup_failed", "provisioning"), true);
  assert.equal(canTransitionCompanyStatus("active", "setup_failed"), false);
  assert.equal(canTransitionCompanyStatus("active", "provisioning"), false);
});

test("Company status transition updates only a real state change", () => {
  assert.deepEqual(transitionCompanyStatus(company, "active", 20), {
    ...company,
    status: "active",
    updatedAtMs: 20,
  });
  assert.equal(transitionCompanyStatus(company, "provisioning", 20), company);
});

test("Company rejects status changes that bypass execution readiness or retry", () => {
  assert.throws(
    () => transitionCompanyStatus({ ...company, status: "active" }, "setup_failed", 20),
    (error: unknown) => (
      error instanceof CompanyStatusTransitionError
      && error.transition.from === "active"
      && error.transition.to === "setup_failed"
    ),
  );
});
