import assert from "node:assert/strict";
import test from "node:test";

import { runtimeConfig } from "../../../../shared/config/runtime";

test("Vite runtime config exposes only approved public values", () => {
  assert.deepEqual(runtimeConfig({
    VITE_FIELDS_BACKEND_TRPC_URL: " /api/v1/trpc ",
    VITE_FIELDS_DESKTOP_VERSION: " 1.2.3 ",
    VITE_FIELDS_HOME_TURN_TIMEOUT_MS: " 9000 ",
  }), {
    backendTrpcUrl: "/api/v1/trpc",
    desktopVersion: "1.2.3",
    homeTurnTimeoutMs: "9000",
  });
});

test("missing and blank Vite values are unset", () => {
  assert.deepEqual(runtimeConfig({
    VITE_FIELDS_BACKEND_TRPC_URL: "   ",
  }), {
    backendTrpcUrl: undefined,
    desktopVersion: undefined,
    homeTurnTimeoutMs: undefined,
  });
});
