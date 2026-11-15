import assert from "node:assert/strict";
import test from "node:test";

import { redactSpan } from "../../../src/observability/sanitizing-span-processor.js";

test("trace export preserves only allowlisted facts and strips automatic network and error diagnostics", () => {
  const span = {
    attributes: {
      "http.response.status_code": 500,
      "url.full": "https://example.test/api?token=do-not-export",
      "http.request.header.authorization": "Bearer do-not-export",
      "server.address": "private.example.test",
      "exception.message": "provider diagnostic do-not-export",
      "fields.operation_category": "runtime_call",
      "fields.runtime_release_sha": "0123456789abcdef0123456789abcdef01234567",
    },
    events: [{ name: "exception", time: [0, 0] as [number, number], attributes: { "exception.stacktrace": "do-not-export" } }],
    status: { code: 2, message: "provider diagnostic do-not-export" },
  };

  redactSpan(span);

  assert.deepEqual(span.attributes, {
    "http.response.status_code": 500,
    "fields.operation_category": "runtime_call",
    "fields.runtime_release_sha": "0123456789abcdef0123456789abcdef01234567",
  });
  assert.deepEqual(span.events, []);
  assert.deepEqual(span.status, { code: 2 });
});
