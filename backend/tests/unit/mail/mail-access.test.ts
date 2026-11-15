import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveMailboxAccess,
  stableMailConnectionErrorCode,
} from "../../../src/infrastructure/persistence/postgres/repositories/company/mail-repository.js";

test("Human personal mailboxes remain self-only, including from a Company Owner", () => {
  assert.equal(resolveMailboxAccess({
    requesterActorId: "human-one",
    isCompanyOwner: false,
    kind: "personal",
    targetActorId: "human-one",
    targetActorType: "human",
    granted: false,
    requireManage: false,
  }), "personal");
  assert.equal(resolveMailboxAccess({
    requesterActorId: "owner",
    isCompanyOwner: true,
    kind: "personal",
    targetActorId: "human-one",
    targetActorType: "human",
    granted: false,
    requireManage: false,
  }), null);
});

test("Company Owner can maintain Agent personal mail without granting ordinary Members", () => {
  assert.equal(resolveMailboxAccess({
    requesterActorId: "owner",
    isCompanyOwner: true,
    kind: "personal",
    targetActorId: "agent-one",
    targetActorType: "agent",
    granted: false,
    requireManage: true,
  }), "company_owner");
  assert.equal(resolveMailboxAccess({
    requesterActorId: "human-one",
    isCompanyOwner: false,
    kind: "personal",
    targetActorId: "agent-one",
    targetActorType: "agent",
    granted: true,
    requireManage: false,
  }), null);
});

test("shared grants provide data access until revoked but never management", () => {
  const base = {
    requesterActorId: "member",
    isCompanyOwner: false,
    kind: "shared" as const,
    targetActorId: null,
    targetActorType: undefined,
  };
  assert.equal(resolveMailboxAccess({
    ...base,
    granted: true,
    requireManage: false,
  }), "shared_grant");
  assert.equal(resolveMailboxAccess({
    ...base,
    granted: true,
    requireManage: true,
  }), null);
  assert.equal(resolveMailboxAccess({
    ...base,
    granted: false,
    requireManage: false,
  }), null);
});

test("connection projection exposes only stable allowlisted error codes", () => {
  assert.equal(stableMailConnectionErrorCode(
    Object.assign(new Error("provider failed"), { code: "MAIL_CONNECTION_SSRF_BLOCKED" }),
  ), "MAIL_CONNECTION_SSRF_BLOCKED");
  const secret = "imap-password=super-secret";
  const projected = stableMailConnectionErrorCode(
    Object.assign(new Error(secret), { code: secret }),
  );
  assert.equal(projected, "MAIL_CONNECTION_FAILED");
  assert.equal(projected.includes("secret"), false);
});
