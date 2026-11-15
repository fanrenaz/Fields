import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { FastifyInstance } from "fastify";

import {
  CallMcpError,
  callStartFromCompanyRuntime,
} from "../src/application/mcp/embodiment-call.js";
import { MailServiceError } from "../src/application/mail/index.js";
import {
  EmbodimentMcpServer,
  mailToolResult,
  type CompanyRuntimeMcpGateway,
} from "../src/interface/mcp-server.js";
import {
  createCompanyRuntimeApp,
  runMailMcpMutationWithAudit,
} from "../src/interface/server.js";

const unusedAssetGateway = {
  authorizeAssetTool: async () => {},
  assetList: async () => { throw new Error("not used"); },
  assetRead: async () => { throw new Error("not used"); },
  assetContentRead: async () => { throw new Error("not used"); },
  assetImportGit: async () => { throw new Error("not used"); },
  assetImportWorkspaceZip: async () => { throw new Error("not used"); },
  assetCreateMcp: async () => { throw new Error("not used"); },
  assetUpdateDraft: async () => { throw new Error("not used"); },
  assetValidateDraft: async () => { throw new Error("not used"); },
  assetDeleteDraft: async () => { throw new Error("not used"); },
  assetPublish: async () => { throw new Error("not used"); },
  assetArchive: async () => { throw new Error("not used"); },
  assetRestore: async () => { throw new Error("not used"); },
  assetReplaceCredential: async () => { throw new Error("not used"); },
  memberAssetCurrent: async () => { throw new Error("not used"); },
  memberAssetOptions: async () => { throw new Error("not used"); },
  memberAssetApply: async () => { throw new Error("not used"); },
  fileList: async () => { throw new Error("not used"); },
  fileRead: async () => { throw new Error("not used"); },
  filePublishWorkspace: async () => { throw new Error("not used"); },
};

test("Embodiment exposes only the four approved tools", async () => {
  const calls: unknown[] = [];
  const gateway = {
    resolveMemberContext: async (memberId) => {
      if (memberId === "member-revoked") {
        throw new CallMcpError(
          "mcp_identity_invalid",
          "MCP requires a running Member App Server.",
        );
      }
      return { memberId };
    },
    resolveRoomContext: async (memberId, threadId) => ({
      accessMode: "agent_execution" as const,
      memberId,
      roomId: "room-1",
      threadId,
    }),
    listTerminals: async (memberId) => {
      calls.push(memberId);
      return { items: [] };
    },
    callStart: async () => { throw new Error("not used"); },
    callExchange: async () => { throw new Error("not used"); },
    callEnd: async () => { throw new Error("not used"); },
    readRoomMessages: async () => { throw new Error("not used"); },
    search: async () => { throw new Error("not used"); },
    ...unusedAssetGateway,
  } satisfies CompanyRuntimeMcpGateway;
  const server = new EmbodimentMcpServer({ memberId: "member-1" }, gateway);

  assert.deepEqual(server.listTools().map((tool) => tool.name), [
    "embodiment.terminal.list",
    "embodiment.call.start",
    "embodiment.call.exchange",
    "embodiment.call.end",
  ]);
  assert.deepEqual(await server.callTool("embodiment.terminal.list", {}), {
    ok: true,
    data: { items: [] },
  });
  assert.deepEqual(calls, ["member-1"]);
});

test("Embodiment requests carry fixed Company Runtime and Member identity", async () => {
  const originalFetch = globalThis.fetch;
  let headers: Headers | null = null;
  globalThis.fetch = async (_input, init) => {
    headers = new Headers(init?.headers);
    return new Response(JSON.stringify({
      schema_version: 2,
      ok: true,
      operation_id: "operation-1",
      call_state: "connected",
      call_active: true,
      retryable: false,
      status: "answered",
      call_id: "call-1",
      reason: null,
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    await callStartFromCompanyRuntime({
      apiUrl: "http://backend:4100/api/v1",
      callbackToken: "callback-token",
      memberId: "member-1",
      runtime: {
        company_id: "company-1",
      },
      call: {
        operation_id: "operation-1",
        terminal_id: "terminal-1",
        caller_label: "Agent",
      },
    });
    const captured = headers as unknown as Headers;
    assert.equal(captured.get("x-fields-member-id"), "member-1");
    assert.equal(captured.get("x-fields-runtime-kind"), "company");
    assert.equal(captured.get("x-fields-runtime-id"), "company-1");
    assert.equal(captured.get("x-fields-runtime-instance-id"), null);
    assert.equal(captured.get("x-fields-runtime-generation"), null);
    assert.equal(captured.get("x-fields-runtime-lease-id"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("four MCP HTTP surfaces expose only their approved tools", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-mcp-surfaces-"));
  const roomReads: Array<{
    memberId: string;
    roomId: string;
    accessMode: "agent_execution" | "human_side_chat";
    resource: unknown;
  }> = [];
  const searches: unknown[] = [];
  const fileLists: unknown[] = [];
  const filePublishes: unknown[] = [];
  const fileReads: unknown[] = [];
  const workspaceImports: unknown[] = [];
  const assetCalls: Array<{ method: string; memberId: string; input: unknown }> = [];
  let reentrantRuntimeChecks = 0;
  let app!: FastifyInstance;
  const gateway = {
    resolveMemberContext: async (memberId) => {
      if (memberId === "member-revoked") {
        throw new CallMcpError(
          "mcp_identity_invalid",
          "MCP requires a running Member App Server.",
        );
      }
      return { memberId };
    },
    resolveRoomContext: async (memberId, threadId) => {
      if (threadId === "thread-ambiguous") {
        throw new CallMcpError(
          "mcp_room_context_ambiguous",
          "Room context is ambiguous for this Codex Thread.",
        );
      }
      return {
        accessMode: "agent_execution" as const,
        memberId,
        roomId: threadId === "thread-room-1" ? "room-1" : "room-unexpected",
        threadId,
      };
    },
    listTerminals: async () => ({ items: [] }),
    callStart: async () => { throw new Error("not used"); },
    callExchange: async () => { throw new Error("not used"); },
    callEnd: async () => { throw new Error("not used"); },
    readRoomMessages: async (memberId, roomId, accessMode, resource) => {
      roomReads.push({ memberId, roomId, accessMode, resource });
      const uri = resource.kind === "latest"
        ? "fields://room/messages/latest"
        : resource.kind === "before"
          ? `fields://room/messages/before/${resource.sequence}`
          : `fields://room/messages/around/${resource.message_id}`;
      return {
        uri,
        mime_type: "text/markdown" as const,
        text: "Human:\nHello",
      };
    },
    search: async (_memberId, input) => {
      const callback = await app.inject({ method: "GET", url: "/health" });
      assert.equal(callback.statusCode, 200);
      reentrantRuntimeChecks += 1;
      searches.push(input);
      return {
        query: input.search_term,
        groups: [],
        coverage: {
          visible_room_count: 0,
          searched_room_count: 0,
          failed_sources: [],
          email: {
            indexed_from_ms: null,
            includes_remote_results: false,
            partial: false,
            failed_mailbox_ids: [],
          },
        },
      };
    },
    fileList: async (memberId, input) => {
      fileLists.push({ memberId, input });
      return { folders: [], files: [] };
    },
    fileRead: async (memberId, input) => {
      fileReads.push({ memberId, input });
      return { file_id: input.file_id, version_id: input.version_id ?? "current", local_path: "/runtime/file" };
    },
    filePublishWorkspace: async (memberId, input) => {
      filePublishes.push({ memberId, input });
      return { file_id: "file-1", version_id: "version-1" };
    },
    authorizeAssetTool: async (_memberId, threadId, toolName) => {
      if (
        threadId === "thread-agent-builder"
        && !["assets.list", "assets.read", "assets.content.read"].includes(toolName)
      ) {
        throw new CallMcpError(
          "asset_builder_tool_forbidden",
          "Mutation is unavailable in this Agent Builder Thread.",
        );
      }
    },
    assetList: async (memberId, input) => {
      assetCalls.push({ method: "assets.list", memberId, input });
      return { operation: "assets.list" };
    },
    assetRead: async (memberId, input) => {
      assetCalls.push({ method: "assets.read", memberId, input });
      return { operation: "assets.read" };
    },
    assetContentRead: async (memberId, input) => {
      assetCalls.push({ method: "assets.content.read", memberId, input });
      return { operation: "assets.content.read" };
    },
    assetImportGit: async (memberId, input) => {
      assetCalls.push({ method: "assets.draft.import_git", memberId, input });
      return { operation: "assets.draft.import_git" };
    },
    assetImportWorkspaceZip: async (memberId, input) => {
      workspaceImports.push({ memberId, input });
      return { draft: { draft_id: "draft-1" } };
    },
    assetCreateMcp: async (memberId, input) => {
      assetCalls.push({ method: "assets.draft.create_mcp", memberId, input });
      return { operation: "assets.draft.create_mcp" };
    },
    assetUpdateDraft: async (memberId, input) => {
      assetCalls.push({ method: "assets.draft.update", memberId, input });
      return { operation: "assets.draft.update" };
    },
    assetValidateDraft: async (memberId, input) => {
      assetCalls.push({ method: "assets.draft.validate", memberId, input });
      return { operation: "assets.draft.validate" };
    },
    assetDeleteDraft: async (memberId, input) => {
      assetCalls.push({ method: "assets.draft.delete", memberId, input });
      return { operation: "assets.draft.delete" };
    },
    assetPublish: async (memberId, input) => {
      assetCalls.push({ method: "assets.publish", memberId, input });
      return { operation: "assets.publish" };
    },
    assetArchive: async (memberId, input) => {
      assetCalls.push({ method: "assets.archive", memberId, input });
      return { operation: "assets.archive" };
    },
    assetRestore: async (memberId, input) => {
      assetCalls.push({ method: "assets.restore", memberId, input });
      return { operation: "assets.restore" };
    },
    assetReplaceCredential: async (memberId, input) => {
      assetCalls.push({ method: "assets.mcp.credential.replace", memberId, input });
      return { operation: "assets.mcp.credential.replace" };
    },
    memberAssetCurrent: async (memberId) => {
      assetCalls.push({ method: "assets.installations.read", memberId, input: {} });
      return { operation: "assets.installations.read" };
    },
    memberAssetOptions: async (memberId, input) => {
      assetCalls.push({ method: "assets.installations.options", memberId, input });
      return { operation: "assets.installations.options" };
    },
    memberAssetApply: async (memberId, input) => {
      assetCalls.push({ method: "assets.installations.apply", memberId, input });
      return { operation: "assets.installations.apply" };
    },
  } satisfies CompanyRuntimeMcpGateway;
  app = createCompanyRuntimeApp({
    workdir,
    dependencies: {
      identity: {
        company_id: "company-1",
      },
      mcpGateway: gateway,
    },
  });
  try {
    const embodiment = await mcpRpc(app, "/mcp/embodiment", "tools/list");
    assert.deepEqual(toolNames(embodiment), [
      "embodiment.terminal.list",
      "embodiment.call.start",
      "embodiment.call.exchange",
      "embodiment.call.end",
    ]);

    const search = await mcpRpc(app, "/mcp/search", "tools/list");
    assert.deepEqual(toolNames(search), [
      "search.query",
      "company.files.list",
      "company.files.read",
      "company.files.publish",
    ]);
    const searchTools = search.result.tools as Array<{ name: string; description?: string }>;
    assert.match(searchTools.find((tool) => tool.name === "search.query")?.description ?? "", /company\.files\.read/u);
    assert.match(searchTools.find((tool) => tool.name === "company.files.list")?.description ?? "", /company\.files\.read/u);
    assert.match(searchTools.find((tool) => tool.name === "company.files.read")?.description ?? "", /read-only runtime cache/u);
    const readCall = await mcpRpc(app, "/mcp/search", "tools/call", {
      name: "company.files.read",
      arguments: { file_id: "file-1", version_id: "version-1" },
    });
    assert.equal(readCall.result.structuredContent.ok, true);
    assert.deepEqual(fileReads, [{
      memberId: "member-1",
      input: { file_id: "file-1", version_id: "version-1" },
    }]);
    const searchCall = await mcpRpc(app, "/mcp/search", "tools/call", {
      name: "search.query",
      arguments: { search_term: "needle", kind: "message", limit: 5 },
    });
    assert.equal(searchCall.result.structuredContent.ok, true);
    assert.deepEqual(searches, [{
      search_term: "needle",
      kind: "message",
      limit: 5,
    }]);
    assert.equal(reentrantRuntimeChecks, 1);
    const fileListCall = await mcpRpc(app, "/mcp/search", "tools/call", {
      name: "company.files.list",
      arguments: { folder_id: null, search_term: "plan" },
    });
    assert.equal(fileListCall.result.structuredContent.ok, true);
    assert.deepEqual(fileLists, [{
      memberId: "member-1",
      input: { folder_id: null, recursive: false, search_term: "plan" },
    }]);
    const filePublishCall = await mcpRpc(app, "/mcp/search", "tools/call", {
      name: "company.files.publish",
      arguments: {
        workspace_relative_path: "reports/plan.txt",
        folder_id: null,
        name: "plan.txt",
        idempotency_key: "publish-plan",
      },
    });
    assert.equal(filePublishCall.result.structuredContent.ok, true);
    assert.deepEqual(filePublishes, [{
      memberId: "member-1",
      input: {
        workspace_relative_path: "reports/plan.txt",
        folder_id: null,
        name: "plan.txt",
        idempotency_key: "publish-plan",
      },
    }]);

    const assets = await mcpRpc(app, "/mcp/assets", "tools/list");
    assert.deepEqual(toolNames(assets), [
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
      "assets.installations.read",
      "assets.installations.options",
      "assets.installations.apply",
    ]);
    const bearerToken = "mcp-tool-runtime-only-secret";
    const directAssetCalls = [
      { name: "assets.list", arguments: { kind: "skill", limit: 10 } },
      { name: "assets.read", arguments: { asset_id: "asset-1" } },
      {
        name: "assets.content.read",
        arguments: {
          asset_id: "asset-1",
          version: "1.0.0",
          path: "SKILL.md",
        },
      },
      {
        name: "assets.draft.import_git",
        arguments: {
          kind: "skill",
          repository_url: "https://example.com/company/skill.git",
          version: "1.0.0",
          idempotency_key: "asset-import-git",
        },
      },
      {
        name: "assets.draft.create_mcp",
        arguments: {
          name: "Company MCP",
          slug: "company-mcp",
          version: "1.0.0",
          endpoint_url: "https://example.com/mcp",
          authentication: "bearer",
          bearer_token: bearerToken,
          idempotency_key: "asset-create-mcp",
        },
      },
      {
        name: "assets.draft.update",
        arguments: {
          draft_id: "draft-1",
          expected_revision: 1,
          description: "Updated",
          idempotency_key: "asset-update",
        },
      },
      {
        name: "assets.draft.validate",
        arguments: {
          draft_id: "draft-1",
          expected_revision: 1,
          idempotency_key: "asset-validate",
        },
      },
      {
        name: "assets.draft.delete",
        arguments: {
          draft_id: "draft-1",
          expected_revision: 1,
          idempotency_key: "asset-delete",
        },
      },
      {
        name: "assets.publish",
        arguments: {
          draft_id: "draft-1",
          expected_revision: 1,
          idempotency_key: "asset-publish",
        },
      },
      {
        name: "assets.archive",
        arguments: {
          asset_id: "asset-1",
          expected_revision: 1,
          idempotency_key: "asset-archive",
        },
      },
      {
        name: "assets.restore",
        arguments: {
          asset_id: "asset-1",
          expected_revision: 2,
          idempotency_key: "asset-restore",
        },
      },
      {
        name: "assets.mcp.credential.replace",
        arguments: {
          asset_id: "asset-1",
          target: {
            type: "version",
            version_id: "version-1",
            expected_revision: 1,
          },
          bearer_token: bearerToken,
          idempotency_key: "asset-credential",
        },
      },
      { name: "assets.installations.read", arguments: {} },
      {
        name: "assets.installations.options",
        arguments: { kind: "skill", search_term: "review" },
      },
      {
        name: "assets.installations.apply",
        arguments: {
          expected_revision: 0,
          installations: [{ asset_id: "asset-1", version_id: "version-1" }],
          idempotency_key: "member-assets-apply",
        },
      },
    ] as const;
    const directAssetResponses = [];
    for (const call of directAssetCalls) {
      directAssetResponses.push(await mcpRpc(app, "/mcp/assets", "tools/call", call));
    }
    assert.deepEqual(
      assetCalls.map((call) => call.method),
      directAssetCalls.map((call) => call.name),
    );
    assert.ok(assetCalls.every((call) => call.memberId === "member-1"));
    assert.ok(directAssetResponses.every((response) => (
      response.result.structuredContent.ok === true
    )));
    assert.doesNotMatch(JSON.stringify(directAssetResponses), new RegExp(bearerToken, "u"));
    const callsBeforeBuilderDenial = assetCalls.length;
    const builderDenied = await mcpRpc(app, "/mcp/assets", "tools/call", {
      name: "assets.publish",
      arguments: {
        draft_id: "draft-1",
        expected_revision: 1,
        idempotency_key: "agent-builder-must-not-publish",
      },
      _meta: { threadId: "thread-agent-builder" },
    });
    assert.equal(builderDenied.result.structuredContent.ok, false);
    const builderDeniedContent = builderDenied.result.structuredContent as {
      ok: false;
      error: { code: string };
    };
    assert.equal(
      builderDeniedContent.error.code,
      "asset_builder_tool_forbidden",
    );
    assert.equal(assetCalls.length, callsBeforeBuilderDenial);
    const callsBeforeRevokedMember = assetCalls.length;
    const revokedMember = await app.inject({
      method: "POST",
      url: "/mcp/assets",
      headers: {
        ...mcpHeaders(),
        "x-fields-member-id": "member-revoked",
      },
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "assets.list", arguments: {} },
      },
    });
    assert.equal(revokedMember.statusCode, 500);
    assert.match(revokedMember.body, /mcp_identity_invalid|Internal Server Error/u);
    assert.equal(assetCalls.length, callsBeforeRevokedMember);
    const forgedThreadHeader = await mcpRpc(
      app,
      "/mcp/assets",
      "tools/call",
      {
        name: "assets.draft.import_workspace_zip",
        arguments: {
          kind: "skill",
          name: "Workspace Skill",
          slug: "workspace-skill",
          version: "1.0.0",
          workspace_relative_path: "skill.zip",
          idempotency_key: "workspace-forged",
        },
      },
      { "x-fields-thread-id": "forged-thread" },
    );
    assert.equal(forgedThreadHeader.result.structuredContent.ok, false);
    const forgedStructuredContent = forgedThreadHeader.result.structuredContent as {
      ok: boolean;
      error?: { code: string };
    };
    assert.equal(
      forgedStructuredContent.error?.code,
      "mcp_thread_identity_invalid",
    );
    assert.deepEqual(workspaceImports, []);

    const trustedThread = await mcpRpc(app, "/mcp/assets", "tools/call", {
      name: "assets.draft.import_workspace_zip",
      arguments: {
        kind: "skill",
        name: "Workspace Skill",
        slug: "workspace-skill",
        version: "1.0.0",
        workspace_relative_path: "skill.zip",
        idempotency_key: "workspace-real",
      },
      _meta: { threadId: "thread-real" },
    });
    assert.equal(trustedThread.result.structuredContent.ok, true);
    assert.deepEqual(workspaceImports, [{
      memberId: "member-1",
      input: {
        kind: "skill",
        name: "Workspace Skill",
        slug: "workspace-skill",
        version: "1.0.0",
        workspace_relative_path: "skill.zip",
        idempotency_key: "workspace-real",
        thread_id: "thread-real",
      },
    }]);

    const roomTools = await mcpRpc(app, "/mcp/room-messages", "tools/list");
    assert.deepEqual(toolNames(roomTools), ["room.messages.read"]);
    assert.deepEqual(roomTools.result.tools[0]?.inputSchema, {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {},
      additionalProperties: {},
      oneOf: [
        {
          type: "object",
          properties: {
            kind: {
              type: "string",
              const: "latest",
            },
          },
          required: ["kind"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            kind: {
              type: "string",
              const: "before",
            },
            sequence: {
              type: "integer",
              exclusiveMinimum: 0,
              maximum: Number.MAX_SAFE_INTEGER,
            },
          },
          required: ["kind", "sequence"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            kind: {
              type: "string",
              const: "around",
            },
            message_id: {
              type: "string",
              minLength: 1,
            },
          },
          required: ["kind", "message_id"],
          additionalProperties: false,
        },
      ],
    });
    const resources = await mcpRpc(
      app,
      "/mcp/room-messages",
      "resources/list",
      {},
      {},
      -32601,
    );
    assert.equal(resources.error?.message, "Method not found");
    const templates = await mcpRpc(
      app,
      "/mcp/room-messages",
      "resources/templates/list",
      {},
      {},
      -32601,
    );
    assert.equal(templates.error?.message, "Method not found");
    const read = await mcpRpc(
      app,
      "/mcp/room-messages",
      "tools/call",
      {
        name: "room.messages.read",
        arguments: { kind: "latest" },
        _meta: { threadId: "thread-room-1" },
      },
    );
    assert.equal(read.result.content[0].text, "Human:\nHello");
    assert.deepEqual(read.result.structuredContent, {
      uri: "fields://room/messages/latest",
      mime_type: "text/markdown",
      text: "Human:\nHello",
    });
    await mcpRpc(
      app,
      "/mcp/room-messages",
      "tools/call",
      {
        name: "room.messages.read",
        arguments: { kind: "before", sequence: 51 },
        _meta: { threadId: "thread-room-1" },
      },
    );
    await mcpRpc(
      app,
      "/mcp/room-messages",
      "tools/call",
      {
        name: "room.messages.read",
        arguments: { kind: "around", message_id: "message-7" },
        _meta: { threadId: "thread-room-1" },
      },
    );
    assert.deepEqual(roomReads, [
      {
        accessMode: "agent_execution",
        memberId: "member-1",
        roomId: "room-1",
        resource: { kind: "latest" },
      },
      {
        accessMode: "agent_execution",
        memberId: "member-1",
        roomId: "room-1",
        resource: { kind: "before", sequence: 51 },
      },
      {
        accessMode: "agent_execution",
        memberId: "member-1",
        roomId: "room-1",
        resource: { kind: "around", message_id: "message-7" },
      },
    ]);
    const missingContext = await mcpRpc(
      app,
      "/mcp/room-messages",
      "tools/call",
      {
        name: "room.messages.read",
        arguments: { kind: "latest" },
      },
    );
    assert.equal(missingContext.result.isError, true);
    assert.deepEqual(missingContext.result.structuredContent, {
      error: {
        code: "mcp_room_context_unavailable",
        message: "Room context is unavailable for this Codex Thread.",
      },
    });
    const ambiguousContext = await mcpRpc(
      app,
      "/mcp/room-messages",
      "tools/call",
      {
        name: "room.messages.read",
        arguments: { kind: "latest" },
        _meta: { threadId: "thread-ambiguous" },
      },
    );
    assert.equal(ambiguousContext.result.isError, true);
    assert.deepEqual(ambiguousContext.result.structuredContent, {
      error: {
        code: "mcp_room_context_ambiguous",
        message: "Room context is ambiguous for this Codex Thread.",
      },
    });
    const modelSuppliedIdentity = await mcpRpc(
      app,
      "/mcp/room-messages",
      "tools/call",
      {
        name: "room.messages.read",
        arguments: {
          kind: "latest",
          member_id: "member-other",
          room_id: "room-other",
          thread_id: "thread-other",
        },
        _meta: { threadId: "thread-room-1" },
      },
    );
    assert.equal(modelSuppliedIdentity.result.isError, true);
    assert.deepEqual(modelSuppliedIdentity.result.structuredContent, {
      error: {
        code: "mcp_room_messages_invalid_argument",
        message: "Room message selector is invalid.",
      },
    });
    const malformedSelector = await mcpRpc(
      app,
      "/mcp/room-messages",
      "tools/call",
      {
        name: "room.messages.read",
        arguments: { kind: "before", sequence: "not-a-number" },
        _meta: { threadId: "thread-room-1" },
      },
    );
    assert.equal(malformedSelector.result.isError, true);
    assert.deepEqual(malformedSelector.result.structuredContent, {
      error: {
        code: "mcp_room_messages_invalid_argument",
        message: "Room message selector is invalid.",
      },
    });
    assert.equal(roomReads.length, 3);

    const legacy = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: mcpHeaders(),
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      },
    });
    assert.equal(legacy.statusCode, 404);
  } finally {
    await app.close();
    await rm(workdir, { recursive: true, force: true });
  }
});

test("Mail MCP authenticates the Member and exposes folders before listing messages", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-mail-mcp-"));
  const validToken = "member-token-12345678901234567890";
  const calls: Array<{ memberId: string; input: unknown }> = [];
  const mailbox = {
    mailbox_id: "mailbox-1",
    kind: "personal" as const,
    target_actor_id: "member-1",
    display_name: "Member",
    email_address: "member@example.test",
    connection_state: "connected" as const,
    capabilities: {
      folders: true,
      search: true,
      flags: true,
      move: true,
      trash: true,
      append_sent: true,
    },
    last_checked_at_ms: 1,
    last_error_code: null,
    access: "personal" as const,
  };
  const folder = {
    folder_id: "folder-inbox",
    mailbox_id: mailbox.mailbox_id,
    name: "Inbox",
    path: "INBOX",
    role: "inbox" as const,
    selectable: true,
    total_count: 1,
    unread_count: 1,
    uid_validity: "7",
  };
  const gateway = {
    authenticateMember: async (bearerToken: string, claimedMemberId: string) => {
      if (bearerToken !== validToken || claimedMemberId !== "member-1") {
        throw new CallMcpError("mail_mcp_identity_invalid", "revoked");
      }
      return { memberId: "member-1" };
    },
    mailListMailboxes: async () => ({
      items: [{ mailbox, folders: [folder], folders_partial: false }],
    }),
    mailListMessages: async (memberId: string, input: unknown) => {
      calls.push({ memberId, input });
      return {
        items: [],
        next_cursor: null,
        coverage: {
          indexed_from_ms: null,
          includes_remote_results: false,
          partial: false,
          failed_mailbox_ids: [],
        },
      };
    },
    mailSearchMessages: async () => { throw new Error("not used"); },
    mailReadMessage: async () => { throw new Error("not used"); },
    mailSendMessage: async () => { throw new Error("not used"); },
    mailUpdateMessage: async () => { throw new Error("not used"); },
    mailSaveAttachment: async () => { throw new Error("not used"); },
  };
  const app = createCompanyRuntimeApp({
    workdir,
    dependencies: {
      identity: {
        company_id: "company-1",
      },
      mailMcpGateway: gateway,
    },
  });
  const authorization = { authorization: `Bearer ${validToken}` };
  try {
    const tools = await mcpRpc(app, "/mcp/mail", "tools/list", {}, authorization);
    assert.deepEqual(toolNames(tools), [
      "mail_list_mailboxes",
      "mail_list_messages",
      "mail_search_messages",
      "mail_read_message",
      "mail_send_message",
      "mail_update_message",
      "mail_save_attachment",
    ]);
    const listed = await mcpRpc(
      app,
      "/mcp/mail",
      "tools/call",
      { name: "mail_list_mailboxes", arguments: {} },
      authorization,
    );
    const data = listed.result.structuredContent.data as {
      items: Array<{ mailbox: typeof mailbox; folders: Array<typeof folder> }>;
    };
    const discovered = data.items[0]!.folders[0]!;
    const messages = await mcpRpc(
      app,
      "/mcp/mail",
      "tools/call",
      {
        name: "mail_list_messages",
        arguments: {
          mailbox_id: data.items[0]!.mailbox.mailbox_id,
          folder_id: discovered.folder_id,
          limit: 10,
        },
      },
      authorization,
    );
    assert.equal(messages.result.structuredContent.ok, true);
    assert.deepEqual(calls, [{
      memberId: "member-1",
      input: {
        mailbox_id: "mailbox-1",
        folder_id: "folder-inbox",
        limit: 10,
      },
    }]);

    const callsBeforeSpoof = calls.length;
    const spoofed = await mcpRpc(
      app,
      "/mcp/mail",
      "tools/call",
      {
        name: "mail_list_messages",
        arguments: {
          mailbox_id: "mailbox-1",
          folder_id: "folder-inbox",
          limit: 10,
          actor_id: "member-other",
        },
      },
      authorization,
    );
    assert.equal(spoofed.result.isError, true);
    assert.equal(calls.length, callsBeforeSpoof);

    const revoked = await app.inject({
      method: "POST",
      url: "/mcp/mail",
      headers: {
        ...mcpHeaders(),
        authorization: "Bearer revoked-token-12345678901234567890",
      },
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      },
    });
    assert.equal(revoked.statusCode, 500);
  } finally {
    await app.close();
    await rm(workdir, { recursive: true, force: true });
  }
});

test("Mail MCP mutation returns only after durable audit retry succeeds", async () => {
  const calls: string[] = [];
  let auditAttempts = 0;
  const result = await runMailMcpMutationWithAudit(
    async () => {
      calls.push("mutation");
      return { outcome: "unknown", secret: "runtime-only" };
    },
    async (mutationResult) => {
      calls.push("audit");
      assert.equal(mutationResult.outcome, "unknown");
      auditAttempts += 1;
      if (auditAttempts === 1) throw new Error("audit unavailable");
    },
  );
  assert.deepEqual(result, { outcome: "unknown", secret: "runtime-only" });
  assert.deepEqual(calls, ["mutation", "audit", "audit"]);

  let auditedFailedMutation = false;
  await assert.rejects(runMailMcpMutationWithAudit(
    async () => {
      throw new Error("mutation failed");
    },
    async () => {
      auditedFailedMutation = true;
    },
  ));
  assert.equal(auditedFailedMutation, false);
});

test("Mail MCP returns only allowlisted error codes and secret-free payloads", async () => {
  const runtimeError = await mailToolResult(async () => {
    throw new MailServiceError("MAIL_CURSOR_INVALID", false);
  });
  assert.deepEqual(runtimeError.structuredContent, {
    ok: false,
    error: {
      code: "MAIL_CURSOR_INVALID",
      message: "The mail operation could not be completed.",
    },
  });

  const backendSecret = "postgres://mail-admin:backend-secret@example.test/mail";
  const backendError = await mailToolResult(async () => {
    throw Object.assign(new Error(backendSecret), {
      code: "BACKEND_DATABASE_DRIVER_FAILURE",
      data: { providerMessage: backendSecret },
    });
  });
  assert.deepEqual(backendError.structuredContent, {
    ok: false,
    error: {
      code: "mail_operation_failed",
      message: "The mail operation could not be completed.",
    },
  });

  const providerSecret = "application_password=provider-secret";
  const providerError = await mailToolResult(async () => {
    throw new Error(providerSecret);
  });
  assert.deepEqual(providerError.structuredContent, {
    ok: false,
    error: {
      code: "mail_operation_failed",
      message: "The mail operation could not be completed.",
    },
  });

  const serialized = JSON.stringify([backendError, providerError]);
  assert.equal(serialized.includes(backendSecret), false);
  assert.equal(serialized.includes(providerSecret), false);
  assert.equal(serialized.includes("stack"), false);
});

function toolNames(response: McpRpcResponse): string[] {
  return response.result.tools.map((tool: { name: string }) => tool.name);
}

type McpRpcResponse = {
  result: {
    tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
    structuredContent: Record<string, unknown>;
    content: Array<{ text: string }>;
    isError?: boolean;
  };
  error?: { code: number; message: string };
};

async function mcpRpc(
  app: FastifyInstance,
  url: string,
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
  expectedErrorCode?: number,
): Promise<McpRpcResponse> {
  const response = await app.inject({
    method: "POST",
    url,
    headers: { ...mcpHeaders(), ...headers },
    payload: {
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    },
  });
  assert.equal(response.statusCode, 200, response.body);
  const payload = response.headers["content-type"]?.includes("text/event-stream")
    ? JSON.parse(
      response.body
        .split(/\r?\n/u)
        .find((line) => line.startsWith("data: "))!
        .slice("data: ".length),
    )
    : response.json();
  const rpcResponse = payload as McpRpcResponse;
  // Streamable HTTP transport closes its injected response socket on the next
  // turn; keep the Fastify light-my-request socket alive until that cleanup.
  await new Promise<void>((resolve) => setImmediate(resolve));
  if (expectedErrorCode !== undefined) {
    assert.equal(rpcResponse.error?.code, expectedErrorCode);
    return rpcResponse;
  }
  assert.equal(rpcResponse.error, undefined, JSON.stringify(rpcResponse.error));
  return rpcResponse;
}

function mcpHeaders(): Record<string, string> {
  return {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "x-fields-member-id": "member-1",
  };
}
