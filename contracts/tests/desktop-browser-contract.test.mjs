import assert from "node:assert/strict";
import test from "node:test";

import {
  desktopBrowserSetInputSchema,
  desktopBrowserStatusSchema,
  desktopBrowserTunnelStartInputSchema,
  desktopBrowserTunnelStartResultSchema,
} from "../dist/public/desktop-browser.js";

test("Desktop browser contracts are strict and credential-free", () => {
  assert.equal(desktopBrowserSetInputSchema.safeParse({ enabled: true }).success, true);
  assert.equal(desktopBrowserSetInputSchema.safeParse({ enabled: true, proxy_password: "secret" }).success, false);
  assert.equal(desktopBrowserStatusSchema.safeParse({
    enabled: true,
    updated_at_ms: null,
    proxy: { enabled: true, protocol: "socks5", revision: 2 },
  }).success, true);
  assert.equal(desktopBrowserTunnelStartInputSchema.safeParse({ client_nonce: "nonce_1234567890123456" }).success, true);
  assert.equal(desktopBrowserTunnelStartResultSchema.safeParse({
    websocket_path: "/api/v1/desktop-browser/tunnel",
    token: "a".repeat(43),
    storage_partition: "b".repeat(43),
    expires_at_ms: 10,
  }).success, true);
});
