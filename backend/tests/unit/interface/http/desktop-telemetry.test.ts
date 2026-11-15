import assert from "node:assert/strict";
import test from "node:test";

import type { ProductSession } from "@fields/contracts/public/company";
import type { DesktopTelemetryRecord } from "@fields/contracts/public/observability";

import { DesktopTelemetryRelay } from "../../../../src/interface/http/desktop-telemetry.js";

const session: ProductSession = {
  actor_id: "actor_one",
  company_id: "company_one",
  display_name: "Owner",
  actor_type: "human",
  company_role: "owner",
  company_status: "active",
};
const client = {
  kind: "desktop" as const,
  version: "1.0.15",
  runtimeRelease: "0123456789abcdef0123456789abcdef01234567",
};

function record(overrides: Partial<DesktopTelemetryRecord> = {}): DesktopTelemetryRecord {
  return {
    schema_version: 1,
    event: "desktop.app.ready",
    occurred_at_ms: 1_700_000_000_000,
    status: "ok",
    code: null,
    duration_ms: 42,
    desktop_session_id: "01234567-89ab-4def-8123-456789abcdef",
    platform: "win32",
    arch: "x64",
    ...overrides,
  };
}

test("desktop telemetry requires an active authenticated desktop session", () => {
  const relay = new DesktopTelemetryRelay();
  const body = { records: [record()], dropped_count: 0 };
  assert.equal(relay.accept({ body, session, sessionKey: "session_one", client }).statusCode, 202);
  assert.equal(relay.accept({ body, session: null, sessionKey: null, client }).statusCode, 401);
  assert.equal(relay.accept({
    body,
    session,
    sessionKey: "session_one",
    client: { kind: "web", version: null, runtimeRelease: null },
  }).statusCode, 403);
});

test("desktop telemetry emits only server-owned identity and controlled client facts", () => {
  const emitted: Array<{ event: string; attributes: Record<string, unknown> }> = [];
  const relay = new DesktopTelemetryRelay(Date.now, (event, attributes) => {
    emitted.push({ event, attributes: attributes ?? {} });
  });
  const result = relay.accept({
    body: { records: [record({ event: "desktop.update.download_failed", status: "error", code: "network" })], dropped_count: 3 },
    session,
    sessionKey: "session_one",
    client,
  });
  assert.equal(result.statusCode, 202);
  assert.equal(emitted.length, 2);
  assert.deepEqual(emitted[0], {
    event: "desktop.update.download_failed",
    attributes: {
      code: "network",
      retryable: true,
      "fields.company_id": "company_one",
      "fields.actor_id": "actor_one",
      "fields.client_kind": "desktop",
      "fields.client_version": "1.0.15",
      "fields.runtime_release_sha": "0123456789abcdef0123456789abcdef01234567",
      "fields.client_platform": "win32",
      "fields.client_arch": "x64",
      "fields.desktop_session_id": "01234567-89ab-4def-8123-456789abcdef",
      "fields.duration_ms": 42,
    },
  });
  assert.equal(emitted[1]?.event, "desktop.telemetry.dropped");
});

test("desktop telemetry rejects arbitrary diagnostics and rate limits batches", () => {
  let now = 1_000;
  const relay = new DesktopTelemetryRelay(() => now, () => undefined);
  const unsafe = { records: [{ ...record(), message: "secret" }], dropped_count: 0 };
  assert.equal(relay.accept({ body: unsafe, session, sessionKey: "session_one", client }).statusCode, 400);
  const body = { records: [record()], dropped_count: 0 };
  for (let index = 0; index < 60; index += 1) {
    assert.equal(relay.accept({ body, session, sessionKey: "session_one", client }).statusCode, 202);
  }
  assert.equal(relay.accept({ body, session, sessionKey: "session_one", client }).statusCode, 429);
  now += 60_001;
  assert.equal(relay.accept({ body, session, sessionKey: "session_one", client }).statusCode, 202);
});
