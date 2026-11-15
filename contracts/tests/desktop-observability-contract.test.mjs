import assert from "node:assert/strict";
import test from "node:test";

import {
  desktopTelemetryBatchSchema,
  desktopTelemetryRecordSchema,
} from "../dist/public/observability.js";

const record = {
  schema_version: 1,
  event: "desktop.app.ready",
  occurred_at_ms: 1_700_000_000_000,
  status: "ok",
  code: null,
  duration_ms: 42,
  desktop_session_id: "01234567-89ab-4def-8123-456789abcdef",
  platform: "win32",
  arch: "x64",
};

test("desktop observability accepts only bounded structured operational facts", () => {
  assert.equal(desktopTelemetryRecordSchema.safeParse(record).success, true);
  assert.equal(desktopTelemetryBatchSchema.safeParse({ records: [record], dropped_count: 0 }).success, true);
  assert.equal(desktopTelemetryBatchSchema.safeParse({ records: Array.from({ length: 33 }, () => record), dropped_count: 0 }).success, false);
});

test("desktop observability rejects arbitrary diagnostics and identity fields", () => {
  for (const unsafe of [
    { ...record, message: "secret" },
    { ...record, stack: "stack" },
    { ...record, url: "https://auth.example.com" },
    { ...record, actor_id: "actor_one" },
    { ...record, code: "ECONNRESET" },
  ]) {
    assert.equal(desktopTelemetryRecordSchema.safeParse(unsafe).success, false);
  }
});
