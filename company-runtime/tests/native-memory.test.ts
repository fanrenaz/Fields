import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  nativeMemoryNeedsReconciliation,
  reconcileNativeMemory,
  type NativeMemoryClient,
} from "../src/application/member-memory/native-memory.js";

test("native Memory disables existing active and archived Threads before enabling Codex", async () => {
  const codexHome = await mkdtemp(join(tmpdir(), "fields-native-memory-"));
  const requests: Array<{ method: string; params: unknown }> = [];
  const client: NativeMemoryClient = {
    request: async (method, params) => {
      requests.push({ method, params });
      if (method === "thread/list") {
        const archived = (params as { archived?: boolean }).archived === true;
        return { data: [{ id: archived ? "archived-thread" : "active-thread" }], nextCursor: null } as never;
      }
      return {} as never;
    },
    sendNotification: async () => undefined,
    close: async () => undefined,
  };

  const target = { enabled: true, model: "provider-codex-model" };
  await reconcileNativeMemory({ socketPath: "unused", codexHome, target, client });

  assert.deepEqual(
    requests.filter((request) => request.method === "thread/memoryMode/set").map((request) => request.params),
    [
      { threadId: "active-thread", mode: "disabled" },
      { threadId: "archived-thread", mode: "disabled" },
    ],
  );
  const config = requests.find((request) => request.method === "config/batchWrite")?.params as {
    edits: Array<{ keyPath: string; value: unknown }>;
  };
  assert.deepEqual(Object.fromEntries(config.edits.map((edit) => [edit.keyPath, edit.value])), {
    "features.memories": true,
    "memories.generate_memories": true,
    "memories.use_memories": true,
    "memories.dedicated_tools": true,
    "memories.extract_model": "provider-codex-model",
    "memories.consolidation_model": "provider-codex-model",
  });
  assert.equal(await nativeMemoryNeedsReconciliation(codexHome, target), false);
});

test("disabled native Memory keeps generated memory unavailable without preparing history", async () => {
  const codexHome = await mkdtemp(join(tmpdir(), "fields-native-memory-disabled-"));
  const requests: Array<{ method: string; params: unknown }> = [];
  const client: NativeMemoryClient = {
    request: async (method, params) => {
      requests.push({ method, params });
      return {} as never;
    },
    sendNotification: async () => undefined,
    close: async () => undefined,
  };
  await reconcileNativeMemory({
    socketPath: "unused",
    codexHome,
    target: { enabled: false, model: "provider-codex-model" },
    client,
  });
  assert.equal(requests.some((request) => request.method === "thread/list"), false);
  assert.equal(
    await nativeMemoryNeedsReconciliation(codexHome, { enabled: true, model: "provider-codex-model" }),
    true,
  );
});
