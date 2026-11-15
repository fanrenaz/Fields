import assert from "node:assert/strict";
import test from "node:test";

import { DesktopBrowserService } from "../../src/application/desktop-browser/service.js";

test("Desktop browser tokens are single-use and bound to an enabled Company", async () => {
  let enabled = true;
  const service = new DesktopBrowserService({
    async get() { return { enabled, updated_at_ms: null }; },
    async set(_companyId, input) { enabled = input.enabled; return { enabled, updated_at_ms: 10 }; },
  }, async () => ({ enabled: false, protocol: null, endpoint_host: null, endpoint_port: null, authentication: null, revision: 0, updated_at_ms: null }), "test-partition-secret", () => 1_000);

  const ticket = await service.start("company_one", "actor_one", "nonce_1234567890123456");
  assert.equal(ticket.storage_partition.length, 43);
  assert.equal(await service.consume(ticket.token, "wrong_nonce_123456789"), null);
  const secondTicket = await service.start("company_one", "actor_one", "nonce_1234567890123456");
  assert.deepEqual(await service.consume(secondTicket.token, "nonce_1234567890123456"), {
    companyId: "company_one",
    actorId: "actor_one",
    clientNonce: "nonce_1234567890123456",
    expiresAtMs: 61_000,
  });
  assert.equal(await service.consume(secondTicket.token, "nonce_1234567890123456"), null);
  await service.set("company_one", { enabled: false });
  await assert.rejects(service.start("company_one", "actor_one", "nonce_1234567890123456"));
});

test("Desktop browser status exposes only safe proxy metadata", async () => {
  const service = new DesktopBrowserService({
    async get() { return { enabled: true, updated_at_ms: 10 }; },
    async set() { return { enabled: true, updated_at_ms: 10 }; },
  }, async () => ({ enabled: true, protocol: "https", endpoint_host: "proxy.internal", endpoint_port: 8443, authentication: "username_password", revision: 4, updated_at_ms: 10 }), "test-partition-secret");
  assert.deepEqual(await service.status("company_one"), {
    enabled: true,
    updated_at_ms: 10,
    proxy: { enabled: true, protocol: "https", revision: 4 },
  });
});
