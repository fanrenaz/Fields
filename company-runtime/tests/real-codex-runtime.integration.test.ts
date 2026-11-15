import assert from "node:assert/strict";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CodexAppServerClient } from "../src/application/adapter/codex-app-server-client.js";
import { threadStartParams } from "../src/application/adapter/codex-bridge.js";
import { CompanyExecutorService } from "../src/application/company-executor/service.js";
import { MemberRuntimeManager } from "../src/application/member-runtime/manager.js";
import {
  companyExecutorAuthPath,
  companyExecutorCodexHome,
} from "../src/application/init/executor.js";
import type { ListMcpServerStatusResponse } from "../src/generated/codex-app-server-protocol/v2/ListMcpServerStatusResponse.js";
import type { McpServerToolCallResponse } from "../src/generated/codex-app-server-protocol/v2/McpServerToolCallResponse.js";
import type { ThreadStartResponse } from "../src/generated/codex-app-server-protocol/v2/ThreadStartResponse.js";

const optIn = process.env.FIELDS_REAL_CODEX_RUNTIME_TEST === "1";
const credentialSource = process.env.FIELDS_REAL_CODEX_AUTH_JSON?.trim() ?? "";
const skipReason = !optIn
  ? "set FIELDS_REAL_CODEX_RUNTIME_TEST=1 to run the real Codex integration"
  : credentialSource.length === 0
    ? "FIELDS_REAL_CODEX_AUTH_JSON is required for the real Codex integration"
    : false;

test("real Codex starts through Company Runtime and preserves a Home Thread across idle restart", {
  skip: skipReason,
  timeout: 180_000,
}, async () => {
  const workdir = await mkdtemp(join(tmpdir(), "company-runtime-real-codex-"));
  const executorId = "executor-real";
  const memberId = "member-real";
  let service: CompanyExecutorService | null = null;
  let runtime: MemberRuntimeManager | null = null;
  let probe: McpProbe | null = null;
  try {
    probe = await startMcpProbe();
    await mkdir(companyExecutorCodexHome(workdir, executorId), { recursive: true });
    const target = companyExecutorAuthPath(workdir, executorId);
    await copyFile(credentialSource, target);
    await chmod(target, 0o600);
    service = new CompanyExecutorService(workdir);
    runtime = new MemberRuntimeManager(workdir, {
      runtimeUrl: probe.url,
      idleTimeoutMs: 1,
      issueTokens: (input) => service!.issueToken({
        executor_id: input.executorId,
        previous_credential_version: input.previousCredentialVersion,
        reason: input.reason,
      }),
    });
    const firstActivation = await runtime.ensureMemberAppServer(memberId, { executorId });
    assert.equal(firstActivation.plugin?.pluginId, "fields-core@fields");
    assert.equal(firstActivation.plugin?.version, "1.0.10");
    const config = await readFile(
      join(workdir, "members", memberId, "workspace", ".codex", "config.toml"),
      "utf8",
    );
    assert.doesNotMatch(
      config,
      /\[mcp_servers\.(?:fields|fields_embodiment|fields_search|fields_room_messages|fields_assets)(?:\.|\])/u,
    );
    assert.ok(firstActivation.socketPath);
    await assertRealMcpDiscovery(
      firstActivation.socketPath,
      firstActivation.workspace,
      memberId,
      probe,
    );
    const first = await runtime.submitHomeTurn({
      memberId,
      prompt: "Reply with exactly OK.",
    });
    await runtime.stopIdleMembers(Date.now() + 10);
    const restarted = await runtime.ensureMemberAppServer(memberId, { executorId });
    assert.equal(restarted.plugin?.pluginId, "fields-core@fields");
    const second = await runtime.submitHomeTurn({
      memberId,
      threadId: first.thread_id,
      prompt: "Reply with exactly OK again.",
    });

    assert.equal(second.thread_id, first.thread_id);
  } finally {
    await runtime?.shutdown().catch(() => undefined);
    await service?.shutdown().catch(() => undefined);
    await probe?.close().catch(() => undefined);
    await rm(workdir, { recursive: true, force: true });
  }
});

const inventory = {
  "/mcp/embodiment": [
    "embodiment.terminal.list",
    "embodiment.call.start",
    "embodiment.call.exchange",
    "embodiment.call.end",
  ],
  "/mcp/search": ["search.query"],
  "/mcp/room-messages": ["room.messages.read"],
  "/mcp/assets": [
    "assets.list",
    "assets.read",
    "assets.content.read",
    "assets.draft.import_git",
    "assets.draft.import_workspace_zip",
    "assets.draft.create_mcp",
    "assets.draft.update",
    "assets.draft.validate",
    "assets.draft.delete",
    "assets.publish",
    "assets.archive",
    "assets.restore",
    "assets.mcp.credential.replace",
  ],
} as const;

type McpProbe = {
  url: string;
  receivedMemberIds: string[];
  receivedRoomThreadIds: string[];
  close: () => Promise<void>;
};

async function assertRealMcpDiscovery(
  socketPath: string,
  workspace: string,
  memberId: string,
  probe: McpProbe,
): Promise<void> {
  const client = CodexAppServerClient.fromUnixSocket(socketPath);
  try {
    await client.request("initialize", {
      clientInfo: {
        name: "fields-real-mcp-test",
        title: "Fields real MCP test",
        version: "1.0.0",
      },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        optOutNotificationMethods: [],
      },
    });
    await client.notify({ method: "initialized" });

    const home = await client.request<ThreadStartResponse>(
      "thread/start",
      threadStartParams({ cwd: workspace, runtimeWorkspaceRoots: [workspace] }),
    );
    const homeStatuses = await client.request<ListMcpServerStatusResponse>(
      "mcpServerStatus/list",
      { detail: "full", threadId: home.thread.id },
    );
    const homeRoom = homeStatuses.data.find((status) => status.name === "fields_room_messages");
    assert.equal(Boolean(homeRoom?.tools["room.messages.read"]), false);

    const room = await client.request<ThreadStartResponse>(
      "thread/start",
      threadStartParams({
        cwd: workspace,
        runtimeWorkspaceRoots: [workspace],
        config: {
          plugins: {
            "fields-core@fields": {
              mcp_servers: {
                fields_room_messages: { enabled: true },
              },
            },
          },
        },
      }),
    );
    const roomStatuses = await client.request<ListMcpServerStatusResponse>(
      "mcpServerStatus/list",
      { detail: "full", threadId: room.thread.id },
    );
    assert.deepEqual(
      roomStatuses.data.map((status) => status.name).sort(),
      [
        "fields_assets",
        "fields_embodiment",
        "fields_room_messages",
        "fields_search",
      ],
    );
    for (const status of roomStatuses.data) {
      const path = status.name === "fields_embodiment"
        ? "/mcp/embodiment"
        : status.name === "fields_search"
          ? "/mcp/search"
          : status.name === "fields_room_messages"
            ? "/mcp/room-messages"
            : "/mcp/assets";
      assert.deepEqual(Object.keys(status.tools).sort(), [...inventory[path]].sort());
      assert.deepEqual(status.resources, []);
      assert.deepEqual(status.resourceTemplates, []);
    }

    const called = await client.request<McpServerToolCallResponse>(
      "mcpServer/tool/call",
      {
        threadId: room.thread.id,
        server: "fields_room_messages",
        tool: "room.messages.read",
        arguments: { kind: "latest" },
      },
    );
    assert.equal(called.isError, false);
    assert.deepEqual(called.structuredContent, { thread_id: room.thread.id });
    assert.ok(probe.receivedMemberIds.every((value) => value === memberId));
    assert.deepEqual(probe.receivedRoomThreadIds, [room.thread.id]);
  } finally {
    await client.close();
  }
}

async function startMcpProbe(): Promise<McpProbe> {
  const receivedMemberIds: string[] = [];
  const receivedRoomThreadIds: string[] = [];
  const server = createServer((request, response) => {
    void handleMcpProbeRequest(
      request,
      response,
      receivedMemberIds,
      receivedRoomThreadIds,
    ).catch(() => {
      response.writeHead(500).end();
    });
  });
  await listen(server);
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    receivedMemberIds,
    receivedRoomThreadIds,
    close: () => closeServer(server),
  };
}

async function handleMcpProbeRequest(
  request: IncomingMessage,
  response: import("node:http").ServerResponse,
  receivedMemberIds: string[],
  receivedRoomThreadIds: string[],
): Promise<void> {
  const tools = inventory[request.url as keyof typeof inventory];
  if (!tools || request.method !== "POST") {
    response.writeHead(404).end();
    return;
  }
  const memberId = request.headers["x-fields-member-id"];
  if (typeof memberId === "string") receivedMemberIds.push(memberId);
  const message = JSON.parse(await requestText(request)) as {
    id?: string | number;
    method?: string;
    params?: Record<string, unknown>;
  };
  if (message.id === undefined) {
    response.writeHead(202).end();
    return;
  }
  let result: unknown;
  if (message.method === "initialize") {
    const protocolVersion = typeof message.params?.protocolVersion === "string"
      ? message.params.protocolVersion
      : "2025-06-18";
    result = {
      protocolVersion,
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
      serverInfo: { name: `probe-${request.url}`, version: "1.0.0" },
    };
  } else if (message.method === "tools/list") {
    result = {
      tools: tools.map((name) => ({
        name,
        description: `Probe ${name}`,
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: true,
        },
      })),
    };
  } else if (
    message.method === "resources/list"
    || message.method === "resources/templates/list"
    || message.method === "prompts/list"
  ) {
    result = message.method === "resources/list"
      ? { resources: [] }
      : message.method === "resources/templates/list"
        ? { resourceTemplates: [] }
        : { prompts: [] };
  } else if (
    message.method === "tools/call"
    && request.url === "/mcp/room-messages"
    && message.params?.name === "room.messages.read"
  ) {
    const meta = record(message.params._meta);
    const threadId = typeof meta?.threadId === "string" ? meta.threadId : null;
    if (threadId) receivedRoomThreadIds.push(threadId);
    result = {
      content: [{ type: "text", text: threadId ?? "missing-thread-id" }],
      structuredContent: { thread_id: threadId },
      isError: threadId === null,
    };
  } else {
    respondJson(response, {
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: "Method not found" },
    });
    return;
  }
  respondJson(response, { jsonrpc: "2.0", id: message.id, result });
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function requestText(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function respondJson(
  response: import("node:http").ServerResponse,
  body: Record<string, unknown>,
): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function listen(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolvePromise();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolvePromise();
    });
  });
}
