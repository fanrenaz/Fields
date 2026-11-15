import assert from "node:assert/strict";
import test from "node:test";

import {
  isProductAccessError,
  productSessionFrom,
  signedOutAuthSurface,
} from "../../../../data/auth/auth-state";

test("signed-out auth state selects bootstrap before login", () => {
  assert.equal(signedOutAuthSurface(true), "bootstrap");
  assert.equal(signedOutAuthSurface(false), "login");
});

test("product session accepts only the fixed human session shape", () => {
  assert.deepEqual(productSessionFrom({
    actor_id: "actor-owner",
    company_id: "company-one",
    display_name: "Owner",
    actor_type: "human",
    company_role: "owner",
    company_status: "active",
  }), {
    actor_id: "actor-owner",
    company_id: "company-one",
    display_name: "Owner",
    actor_type: "human",
    company_role: "owner",
    company_status: "active",
  });
  assert.equal(productSessionFrom({
    actor_id: "actor-agent",
    company_id: "company-one",
    display_name: "Agent",
    actor_type: "agent",
    company_role: "member",
    company_status: "active",
  }), null);
  assert.equal(productSessionFrom({
    actor_id: "actor-member",
    company_id: "company-one",
    display_name: "Member",
    actor_type: "human",
    company_role: "admin",
    company_status: "active",
  }), null);
  assert.equal(productSessionFrom({
    actor_id: "actor-member",
    company_id: "company-one",
    display_name: "Member",
    actor_type: "human",
    company_role: "member",
  }), null);
});

test("product access errors are separated from transport failures", () => {
  assert.equal(isProductAccessError({ data: { code: "UNAUTHORIZED" } }), true);
  assert.equal(isProductAccessError({ data: { code: "FORBIDDEN" } }), true);
  assert.equal(isProductAccessError({ data: { code: "NOT_FOUND" } }), true);
  assert.equal(isProductAccessError({ data: { code: "INTERNAL_SERVER_ERROR" } }), false);
  assert.equal(isProductAccessError(new Error("offline")), false);
});
