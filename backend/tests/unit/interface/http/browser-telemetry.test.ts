import assert from "node:assert/strict";
import test from "node:test";

import type {
  BrowserTelemetryRecord,
} from "@fields/contracts/public/observability";
import type {
  ProductSession,
} from "@fields/contracts/public/company";

import { BrowserTelemetryRelay } from "../../../../src/interface/http/browser-telemetry.js";

const session: ProductSession = {
  actor_id: "actor_one",
  company_id: "company_one",
  display_name: "Owner",
  actor_type: "human",
  company_role: "owner",
  company_status: "active",
};

function record(overrides: Partial<BrowserTelemetryRecord> = {}): BrowserTelemetryRecord {
  return {
    trace_id: "0123456789abcdef0123456789abcdef",
    span_id: "0123456789abcdef",
    parent_span_id: null,
    name: "browser.fetch",
    occurred_at_ms: 1_700_000_000_000,
    duration_ms: 12,
    status: "ok",
    error_class: null,
    route: "trpc",
    company_id: session.company_id,
    room_id: null,
    actor_id: session.actor_id,
    sandbox_id: null,
    thread_id: null,
    turn_id: null,
    operation_id: null,
    ...overrides,
  };
}

function accept(relay: BrowserTelemetryRelay, body: unknown, inputSession: ProductSession | null = session) {
  return relay.accept({
    body,
    session: inputSession,
    sessionKey: "session_one",
    client: { kind: "web", version: null, runtimeRelease: null },
  });
}

test("browser telemetry relay accepts only a bounded, authenticated ProductSession batch", () => {
  const relay = new BrowserTelemetryRelay({ env: {} });

  assert.deepEqual(accept(relay, { records: [record()] }), {
    statusCode: 202,
    body: { accepted: 1 },
  });
  assert.deepEqual(accept(relay, { records: [record()] }, null), {
    statusCode: 401,
    body: { code: "OBSERVABILITY_UNAUTHENTICATED" },
  });
});

test("browser telemetry relay rejects unknown fields, oversized batches, and scope spoofing", () => {
  const relay = new BrowserTelemetryRelay({ env: {} });
  const unknownField = { ...record(), query: "access_token=secret" };
  const unknownErrorClass = { ...record(), error_class: "provider_message" };

  assert.equal(accept(relay, { records: [unknownField] }).statusCode, 400);
  assert.equal(accept(relay, { records: [unknownErrorClass] }).statusCode, 400);
  assert.equal(accept(relay, { records: Array.from({ length: 65 }, () => record()) }).statusCode, 400);
  assert.deepEqual(accept(relay, { records: [record({ company_id: "other_company" })] }), {
    statusCode: 403,
    body: { code: "OBSERVABILITY_SCOPE_DENIED" },
  });
  assert.deepEqual(accept(relay, { records: [record({ operation_id: "x".repeat(300_000) })] }), {
    statusCode: 413,
    body: { code: "OBSERVABILITY_BATCH_TOO_LARGE" },
  });
});

test("browser telemetry accepts only pre-classified error metadata without exception detail", () => {
  const relay = new BrowserTelemetryRelay({ env: {} });

  assert.deepEqual(accept(relay, {
    records: [record({
      name: "browser.error",
      status: "error",
      error_class: "browser_extension",
      route: "app",
    })],
  }), {
    statusCode: 202,
    body: { accepted: 1 },
  });
});

test("browser telemetry accepts controlled Executor onboarding and access failure categories", () => {
  const relay = new BrowserTelemetryRelay({ env: {} });

  for (const errorClass of [
    "executor_onboarding_assignment",
    "executor_access_assignment",
    "executor_access_options",
    "executor_access_binding",
  ] as const) {
    assert.equal(accept(relay, {
      records: [record({
        name: "browser.error",
        status: "error",
        error_class: errorClass,
        route: "trpc",
      })],
    }).statusCode, 202);
  }
});

test("browser telemetry relay limits a session to sixty batches in one minute", () => {
  let now = 1000;
  const relay = new BrowserTelemetryRelay({ env: {}, now: () => now });

  for (let index = 0; index < 60; index += 1) {
    assert.equal(accept(relay, { records: [record()] }).statusCode, 202);
  }
  assert.deepEqual(accept(relay, { records: [record()] }), {
    statusCode: 429,
    body: { code: "OBSERVABILITY_RATE_LIMITED" },
  });
  now += 60_001;
  assert.equal(accept(relay, { records: [record()] }).statusCode, 202);
});
