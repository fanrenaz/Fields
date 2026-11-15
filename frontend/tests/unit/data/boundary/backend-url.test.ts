import assert from "node:assert/strict";
import test from "node:test";

import { backendApiUrl, backendAuthBaseUrl, backendTrpcHttpUrl, backendTrpcWsUrl } from "../../../../data/boundary/backend-url";

test("backend URLs normalize HTTP, API base, and websocket inputs", () => {
  assert.equal(
    backendTrpcHttpUrl("https://fields.example/api/v1"),
    "https://fields.example/api/v1/trpc",
  );
  assert.equal(
    backendTrpcHttpUrl("wss://fields.example/api/v1/trpc?ignored=1"),
    "https://fields.example/api/v1/trpc",
  );
  assert.equal(
    backendTrpcWsUrl("http://127.0.0.1:4102/api/v1/trpc"),
    "ws://127.0.0.1:4102/api/v1/trpc",
  );
});

test("Better Auth uses the backend origin", () => {
  assert.equal(
    backendAuthBaseUrl("https://fields.example/api/v1/trpc"),
    "https://fields.example",
  );
});

test("public Backend REST routes keep the configured Backend origin", () => {
  assert.equal(
    backendApiUrl("/api/v1/embodiment/terminals", "https://fields.example/api/v1/trpc?ignored=1"),
    "https://fields.example/api/v1/embodiment/terminals",
  );
  assert.throws(() => backendApiUrl("/embodiment/terminals", "https://fields.example/api/v1"));
});
