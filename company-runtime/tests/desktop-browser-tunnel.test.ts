import assert from "node:assert/strict";
import test from "node:test";

import { resolvePublicBrowserTarget } from "../src/application/desktop-browser/tunnel.js";

test("browser tunnel accepts only hostnames resolving entirely to public addresses", async () => {
  const publicLookup = async () => [{ address: "93.184.216.34", family: 4 as const }];
  assert.equal(await resolvePublicBrowserTarget("example.com", publicLookup as never), "93.184.216.34");
  await assert.rejects(resolvePublicBrowserTarget("127.0.0.1", publicLookup as never));
  await assert.rejects(resolvePublicBrowserTarget("internal.example", (async () => [{ address: "10.0.0.8", family: 4 as const }]) as never));
  await assert.rejects(resolvePublicBrowserTarget("mapped.example", (async () => [{ address: "::ffff:127.0.0.1", family: 6 as const }]) as never));
  await assert.rejects(resolvePublicBrowserTarget("rebind.example", (async () => [
    { address: "93.184.216.34", family: 4 as const },
    { address: "192.168.1.8", family: 4 as const },
  ]) as never));
});
