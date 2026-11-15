import assert from "node:assert/strict";
import test from "node:test";

import {
  backendTrpc,
  backendTrpcConfig,
  backendWsClient,
  rebuildBackendTransport,
} from "../../../../data/boundary/backend-trpc";

test("HTTP batches are split before browser and proxy URL limits", () => {
  assert.equal(backendTrpcConfig.maxBatchItems, 3);
  assert.equal(backendTrpcConfig.maxURLLength, 2_083);
});

test("rebuilding backend transport replaces both client and WebSocket state", () => {
  const previousClient = backendTrpc;
  const previousWsClient = backendWsClient;
  rebuildBackendTransport();
  assert.notEqual(backendTrpc, previousClient);
  assert.notEqual(backendWsClient, previousWsClient);
});
