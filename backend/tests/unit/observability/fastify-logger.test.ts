import assert from "node:assert/strict";
import test from "node:test";

import { safeFastifyPinoAttributes } from "../../../src/observability/fastify-logger.js";

test("Fastify Pino mirroring keeps only an allowed level and HTTP status", () => {
  assert.deepEqual(safeFastifyPinoAttributes(JSON.stringify({
    level: 50,
    msg: "access_token=secret",
    err: { message: "provider payload", stack: "sensitive stack" },
    req: { url: "/api?token=secret" },
    res: { statusCode: 503 },
  })), {
    code: "fastify_error",
    retryable: true,
    "http.status_code": 503,
  });
});

test("Fastify Pino mirroring fails closed on malformed records", () => {
  assert.deepEqual(safeFastifyPinoAttributes("not-json"), {
    code: "fastify_log_invalid",
    retryable: false,
  });
});
