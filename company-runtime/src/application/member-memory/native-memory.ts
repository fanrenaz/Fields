import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CodexAppServerClient } from "../adapter/codex-app-server-client.js";

const NATIVE_MEMORY_STATE_FILE = "fields-native-memory.json";
const NATIVE_MEMORY_STATE_VERSION = 1;

export type NativeMemoryTarget = {
  enabled: boolean;
  model: string;
};

export type NativeMemoryClient = Pick<CodexAppServerClient, "request" | "sendNotification" | "close">;

type NativeMemoryState = NativeMemoryTarget & {
  version: typeof NATIVE_MEMORY_STATE_VERSION;
  historyPrepared: boolean;
};

export async function nativeMemoryNeedsReconciliation(
  codexHome: string,
  target: NativeMemoryTarget,
): Promise<boolean> {
  const state = await readNativeMemoryState(codexHome);
  return state === null
    || state.enabled !== target.enabled
    || state.model !== target.model
    || (target.enabled && !state.historyPrepared);
}

export async function reconcileNativeMemory(input: {
  socketPath: string;
  codexHome: string;
  target: NativeMemoryTarget;
  client?: NativeMemoryClient;
}): Promise<void> {
  const previous = await readNativeMemoryState(input.codexHome);
  const client = input.client ?? CodexAppServerClient.fromUnixSocket(input.socketPath);
  try {
    await client.request("initialize", {
      clientInfo: { name: "fields-native-memory", title: "Fields Native Memory", version: "0.1.0" },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    await client.sendNotification({ method: "initialized" });

    const historyPrepared = previous?.historyPrepared === true
      || (input.target.enabled && await disableExistingThreads(client));
    await client.request("config/batchWrite", {
      edits: [
        configEdit("features.memories", true),
        configEdit("memories.generate_memories", input.target.enabled),
        configEdit("memories.use_memories", input.target.enabled),
        configEdit("memories.dedicated_tools", input.target.enabled),
        configEdit("memories.extract_model", input.target.model),
        configEdit("memories.consolidation_model", input.target.model),
      ],
      reloadUserConfig: true,
    });
    await writeNativeMemoryState(input.codexHome, {
      version: NATIVE_MEMORY_STATE_VERSION,
      enabled: input.target.enabled,
      model: input.target.model,
      historyPrepared,
    });
  } finally {
    await client.close();
  }
}

async function disableExistingThreads(client: NativeMemoryClient): Promise<boolean> {
  for (const archived of [false, true]) {
    let cursor: string | null = null;
    const seen = new Set<string>();
    do {
      const page = await client.request("thread/list", {
        archived,
        cursor,
        limit: 100,
        useStateDbOnly: false,
      }) as { data?: Array<{ id?: unknown }>; nextCursor?: unknown };
      for (const thread of page.data ?? []) {
        if (typeof thread.id !== "string" || thread.id.length === 0) continue;
        await client.request("thread/memoryMode/set", { threadId: thread.id, mode: "disabled" });
      }
      const next = typeof page.nextCursor === "string" && page.nextCursor.length > 0
        ? page.nextCursor
        : null;
      if (next !== null && seen.has(next)) throw new Error("native_memory_thread_cursor_repeated");
      if (next !== null) seen.add(next);
      cursor = next;
    } while (cursor !== null);
  }
  return true;
}

function configEdit(keyPath: string, value: string | boolean) {
  return { keyPath, value, mergeStrategy: "upsert" as const };
}

async function readNativeMemoryState(codexHome: string): Promise<NativeMemoryState | null> {
  try {
    const parsed = JSON.parse(await readFile(join(codexHome, NATIVE_MEMORY_STATE_FILE), "utf8")) as Partial<NativeMemoryState>;
    if (
      parsed.version !== NATIVE_MEMORY_STATE_VERSION
      || typeof parsed.enabled !== "boolean"
      || typeof parsed.model !== "string"
      || parsed.model.length === 0
      || typeof parsed.historyPrepared !== "boolean"
    ) return null;
    return parsed as NativeMemoryState;
  } catch {
    return null;
  }
}

async function writeNativeMemoryState(codexHome: string, state: NativeMemoryState): Promise<void> {
  await mkdir(codexHome, { recursive: true });
  const path = join(codexHome, NATIVE_MEMORY_STATE_FILE);
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}
