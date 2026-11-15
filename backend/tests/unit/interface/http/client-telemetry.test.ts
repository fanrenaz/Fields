import assert from "node:assert/strict";
import test from "node:test";

import { clientTelemetryContext } from "../../../../src/interface/http/client-telemetry.js";

test("client telemetry recognizes only a complete desktop header pair", () => {
  assert.deepEqual(clientTelemetryContext({
    "x-fields-client-kind": "desktop",
    "x-fields-client-version": "1.0.15",
    "x-fields-runtime-release": "0123456789abcdef0123456789abcdef01234567",
  }, "web"), {
    kind: "desktop",
    version: "1.0.15",
    runtimeRelease: "0123456789abcdef0123456789abcdef01234567",
  });
  assert.deepEqual(clientTelemetryContext({
    "x-fields-client-kind": "desktop",
    "x-fields-client-version": "1.0.15",
  }, "web"), { kind: "desktop", version: "1.0.15", runtimeRelease: null });
  assert.deepEqual(clientTelemetryContext({}, "web"), { kind: "web", version: null, runtimeRelease: null });
});

test("client telemetry maps malformed or partial claims to unknown", () => {
  for (const headers of [
    { "x-fields-client-kind": "desktop" },
    { "x-fields-client-version": "1.0.15" },
    { "x-fields-client-kind": "desktop", "x-fields-client-version": "latest" },
    { "x-fields-client-kind": "web", "x-fields-client-version": "1.0.15" },
    {
      "x-fields-client-kind": "desktop",
      "x-fields-client-version": "1.0.15",
      "x-fields-runtime-release": "UPPERCASE-OR-NOT-A-SHA",
    },
  ]) {
    assert.deepEqual(clientTelemetryContext(headers, "web"), {
      kind: "unknown",
      version: null,
      runtimeRelease: null,
    });
  }
});
