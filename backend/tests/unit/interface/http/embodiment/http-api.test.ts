import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";

import { EmbodimentApplication } from "../../../../../src/application/embodiment/index.js";
import { registerEmbodimentHttpApi } from "../../../../../src/interface/http/embodiment/http-api.js";

test("runtime terminal discovery is company-scoped and leaves the Owner endpoint unchanged", async () => {
  const authorizationHeaders: Array<{ kind?: string; memberId?: string }> = [];
  const application = new EmbodimentApplication({
    terminals: {
      async list(companyId) {
        return companyId === "company_a"
          ? [{
            terminal_id: "terminal_a",
            company_id: "company_a",
            label: "Office",
            status: "active",
            current_token_version: 1,
            created_at_ms: 1,
            paired_at_ms: 2,
            revoked_at_ms: null,
            updated_at_ms: 2,
          }]
          : [{
            terminal_id: "terminal_b",
            company_id: "company_b",
            label: "Private",
            status: "active",
            current_token_version: 1,
            created_at_ms: 1,
            paired_at_ms: 2,
            revoked_at_ms: null,
            updated_at_ms: 2,
          }];
      },
      async create() { throw new Error("not used"); },
      async authenticate() { return null; },
      async prepareRotation() { throw new Error("not used"); },
      async promotePending() {},
      async revoke() { throw new Error("not used"); },
    },
    runtime: {
      async start() { throw new Error("not used"); },
      async exchange() { throw new Error("not used"); },
      async end() { throw new Error("not used"); },
      async deliverPairingCredentials() { return { delivered: false, confirmed: false }; },
      async connectedTerminalIds() { return new Set(["terminal_a"]); },
      async disconnectTerminal() { return false; },
    },
    runtimeAuthorization: {
      async authorize(headers) {
        authorizationHeaders.push({ kind: headers.kind, memberId: headers.memberId });
        return headers.kind === "company" && headers.memberId === "member_a" && headers.authorization === "Bearer callback_a"
          ? { actor_id: "member_a", company_id: "company_a" }
          : null;
      },
    },
    createTerminalToken: () => "x".repeat(32),
  });
  const app = Fastify();
  registerEmbodimentHttpApi(app, {
    application,
    internalAuthorization: { matches: async () => false },
    resolveOwner: async () => ({ actor_id: "owner_b", company_id: "company_b" }),
  });
  await app.ready();
  try {
    const owner = await app.inject({ method: "GET", url: "/api/v1/embodiment/terminals" });
    assert.equal(owner.statusCode, 200);
    assert.deepEqual(owner.json(), {
      items: [{ terminal_id: "terminal_b", label: "Private", status: "active", paired_at_ms: 2, connection_status: "offline" }],
    });

    const rejected = await app.inject({ method: "GET", url: "/api/v1/embodiment/terminals/runtime" });
    assert.equal(rejected.statusCode, 403);
    assert.deepEqual(rejected.json(), {
      code: "runtime_identity_invalid",
      message: "Embodiment runtime identity is not authorized.",
      retryable: false,
    });

    const runtime = await app.inject({
      method: "GET",
      url: "/api/v1/embodiment/terminals/runtime",
      headers: {
        authorization: "Bearer callback_a",
        "x-fields-member-id": "member_a",
        "x-fields-runtime-kind": "company",
        "x-fields-runtime-id": "company_a",
        "x-fields-runtime-instance-id": "runtime_a",
        "x-fields-runtime-generation": "1",
        "x-fields-runtime-lease-id": "lease_a",
      },
    });
    assert.equal(runtime.statusCode, 200);
    assert.deepEqual(runtime.json(), {
      items: [{ terminal_id: "terminal_a", label: "Office", status: "active", paired_at_ms: 2, connection_status: "online" }],
    });
    assert.deepEqual(authorizationHeaders, [
      { kind: undefined, memberId: undefined },
      { kind: "company", memberId: "member_a" },
    ]);
  } finally {
    await app.close();
  }
});
