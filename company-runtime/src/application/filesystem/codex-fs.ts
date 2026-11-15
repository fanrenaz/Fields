import { randomUUID } from "node:crypto";

import type { InitializeParams } from "../../generated/codex-app-server-protocol/InitializeParams.js";
import type { FsGetMetadataResponse } from "../../generated/codex-app-server-protocol/v2/FsGetMetadataResponse.js";
import type { FsReadDirectoryEntry } from "../../generated/codex-app-server-protocol/v2/FsReadDirectoryEntry.js";
import type { FsReadDirectoryResponse } from "../../generated/codex-app-server-protocol/v2/FsReadDirectoryResponse.js";
import { CodexAppServerClient } from "../adapter/codex-app-server-client.js";

const FS_REQUEST_TIMEOUT_MS = 60_000;
const WATCH_READ_INTERVAL_MS = 1_000;

export type CodexFilesystemChangedEvent = {
  changedPaths: string[];
};

export type HomeCodexFilesystem = {
  readDirectory(path: string): Promise<FsReadDirectoryEntry[]>;
  getMetadata(path: string): Promise<FsGetMetadataResponse>;
  writeFile(path: string, dataBase64: string): Promise<void>;
  createDirectory(path: string, input?: { recursive?: boolean | null }): Promise<void>;
  remove(path: string, input?: { recursive?: boolean | null; force?: boolean | null }): Promise<void>;
  copy(input: { sourcePath: string; destinationPath: string; recursive?: boolean }): Promise<void>;
  watch(input: { path: string; signal?: AbortSignal | null }): AsyncGenerator<CodexFilesystemChangedEvent>;
};

export class AppServerCodexFilesystem implements HomeCodexFilesystem {
  readonly socketPath: string;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  async readDirectory(path: string): Promise<FsReadDirectoryEntry[]> {
    return this.withClient(async (client) => {
      const result = await client.request<FsReadDirectoryResponse>("fs/readDirectory", { path }, { timeoutMs: FS_REQUEST_TIMEOUT_MS });
      return result.entries;
    });
  }

  async getMetadata(path: string): Promise<FsGetMetadataResponse> {
    return this.withClient((client) => client.request<FsGetMetadataResponse>("fs/getMetadata", { path }, { timeoutMs: FS_REQUEST_TIMEOUT_MS }));
  }

  async writeFile(path: string, dataBase64: string): Promise<void> {
    await this.withClient((client) => client.request("fs/writeFile", { path, dataBase64 }, { timeoutMs: FS_REQUEST_TIMEOUT_MS }));
  }

  async createDirectory(path: string, input: { recursive?: boolean | null } = {}): Promise<void> {
    await this.withClient((client) => client.request("fs/createDirectory", {
      path,
      recursive: input.recursive ?? false,
    }, { timeoutMs: FS_REQUEST_TIMEOUT_MS }));
  }

  async remove(path: string, input: { recursive?: boolean | null; force?: boolean | null } = {}): Promise<void> {
    await this.withClient((client) => client.request("fs/remove", {
      path,
      recursive: input.recursive ?? true,
      force: input.force ?? false,
    }, { timeoutMs: FS_REQUEST_TIMEOUT_MS }));
  }

  async copy(input: { sourcePath: string; destinationPath: string; recursive?: boolean }): Promise<void> {
    await this.withClient((client) => client.request("fs/copy", {
      sourcePath: input.sourcePath,
      destinationPath: input.destinationPath,
      recursive: input.recursive,
    }, { timeoutMs: FS_REQUEST_TIMEOUT_MS }));
  }

  async *watch(input: { path: string; signal?: AbortSignal | null }): AsyncGenerator<CodexFilesystemChangedEvent> {
    const client = CodexAppServerClient.fromUnixSocket(this.socketPath);
    const watchId = `member-filesystem-${randomUUID()}`;
    let closed = false;
    const close = () => { closed = true; };
    input.signal?.addEventListener("abort", close, { once: true });
    if (input.signal?.aborted) {
      closed = true;
    }

    try {
      await initializeCodexFsClient(client);
      await client.request("fs/watch", { watchId, path: input.path }, { timeoutMs: FS_REQUEST_TIMEOUT_MS });
      while (!closed) {
        const message = await client.readNext(Date.now() + WATCH_READ_INTERVAL_MS);
        if (message?.type !== "notification" || message.method !== "fs/changed") {
          continue;
        }
        const params = asRecord(message.params);
        if (params?.watchId !== watchId || !Array.isArray(params.changedPaths)) {
          continue;
        }
        yield {
          changedPaths: params.changedPaths.filter((value): value is string => typeof value === "string"),
        };
      }
    } finally {
      input.signal?.removeEventListener("abort", close);
      await client.request("fs/unwatch", { watchId }, { timeoutMs: 2_000 }).catch(() => undefined);
      await client.close().catch(() => undefined);
    }
  }

  private async withClient<T>(fn: (client: CodexAppServerClient) => Promise<T>): Promise<T> {
    const client = CodexAppServerClient.fromUnixSocket(this.socketPath);
    try {
      await initializeCodexFsClient(client);
      return await fn(client);
    } finally {
      await client.close().catch(() => undefined);
    }
  }
}

async function initializeCodexFsClient(client: CodexAppServerClient): Promise<void> {
  await client.request("initialize", initializeParams(), { timeoutMs: FS_REQUEST_TIMEOUT_MS });
  await client.sendNotification({ method: "initialized" });
}

function initializeParams(): InitializeParams {
  return {
    clientInfo: {
      name: "fields-member-filesystem",
      title: "Fields Member Filesystem",
      version: "0.1.3",
    },
    capabilities: {
      experimentalApi: true,
      requestAttestation: false,
      optOutNotificationMethods: [],
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
