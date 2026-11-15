#!/usr/bin/env node
import websocket from "@fastify/websocket";
import { fastifyTRPCPlugin, type CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import Fastify, { type FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { argv, env, exit } from "node:process";
import { fileURLToPath } from "node:url";

import type {
  CompanyRuntimeIdentity,
} from "@fields/contracts/internal/company-runtime";
import { mailMcpMailboxListResultSchema } from "@fields/contracts/internal/mail";

import { AgentRoomExecutionCoordinator } from "../application/agent-room/coordinator.js";
import { ExecutorAuthWorker } from "../application/company-executor/service.js";
import {
  CompanyRuntimeLifecycle,
  companyRuntimeIdentityFromEnv,
  type CompanyRuntimeLifecycleOptions,
} from "../application/company-runtime/lifecycle.js";
import { MemberRuntimeManager } from "../application/member-runtime/manager.js";
import {
  companyRuntimeLayout,
  ensureCompanyRuntimeLayout,
  memberWorkspaceLayout,
  removeLegacySharedDirectories,
} from "../infrastructure/filesystem/workspace.js";
import {
  CallMcpError,
  callEndFromCompanyRuntime,
  callExchangeFromCompanyRuntime,
  callStartFromCompanyRuntime,
  listTerminalsFromCompanyRuntime,
} from "../application/mcp/embodiment-call.js";
import {
  handleEmbodimentMcpHttpRequest,
  handleAssetsMcpHttpRequest,
  handleMailMcpHttpRequest,
  handleRoomMessagesMcpHttpRequest,
  handleSearchMcpHttpRequest,
  type CompanyRuntimeMailMcpGateway,
  type CompanyRuntimeMcpGateway,
} from "./mcp-server.js";
import {
  createCompanyRuntimeTrpcRouter,
  type CompanyRuntimeTrpcContext,
  type CompanyRuntimeTrpcDependencies,
} from "./trpc-router.js";
import { registerFilesystemTransferRoutes } from "./filesystem-transfer.js";
import { registerAssetPackageRoutes } from "./asset-package.js";
import {
  AssetStoreError,
  CompanyAssetStore,
  type AssetThreadWorkspaceResolver,
} from "../application/assets/service.js";
import { MemberAssetService } from "../application/member-assets/service.js";
import { CompanyMailService } from "../application/mail/service.js";
import { CompanyProxyService } from "../application/company-proxy/service.js";
import { registerDesktopBrowserTunnel } from "../application/desktop-browser/tunnel.js";
import { MemberMemoryCapabilityService } from "../application/member-memory/capability.js";
import {
  companyAssetObjectStoreConfigFromEnv,
  S3CompanyAssetObjectStore,
} from "../infrastructure/object-storage/company-asset-object-store.js";

export const DEFAULT_SERVER_HOST = "127.0.0.1";
export const DEFAULT_SERVER_PORT = 4110;
const AGENT_BUILDER_ASSET_TOOLS: ReadonlySet<string> = new Set([
  "assets.list",
  "assets.read",
  "assets.content.read",
]);
const ASSET_BUILDER_ASSET_TOOLS: ReadonlySet<string> = new Set([
  "assets.list",
  "assets.read",
  "assets.content.read",
  "assets.draft.import_git",
  "assets.draft.import_workspace_zip",
  "assets.draft.create_mcp",
  "assets.draft.update",
  "assets.draft.validate",
]);

export type CompanyRuntimeServerDependencies = CompanyRuntimeTrpcDependencies & {
  identity?: CompanyRuntimeIdentity;
  runtimeEnv?: NodeJS.ProcessEnv;
  lifecycleOptions?: CompanyRuntimeLifecycleOptions;
  companyExecutor?: ExecutorAuthWorker;
  memberRuntime?: MemberRuntimeManager;
  assetStore?: CompanyAssetStore;
  memberAssetService?: MemberAssetService;
  memberMemoryService?: MemberMemoryCapabilityService;
  mailService?: CompanyMailService;
  assetThreadWorkspaceResolver?: AssetThreadWorkspaceResolver;
  mcpGateway?: CompanyRuntimeMcpGateway;
  mailMcpGateway?: CompanyRuntimeMailMcpGateway;
  controlTokenFile?: string;
};

export type CompanyRuntimeServerOptions = {
  workdir: string;
  host?: string | null;
  port?: number | null;
  dependencies?: CompanyRuntimeServerDependencies;
};

export type ShutdownSignalSource = {
  once(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  off(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
};

export function createCompanyRuntimeApp(options: CompanyRuntimeServerOptions): FastifyInstance {
  const workdir = options.workdir;
  const port = options.port ?? DEFAULT_SERVER_PORT;
  const dependencies = options.dependencies ?? {};
  const runtimeEnv = dependencies.runtimeEnv ?? process.env;
  const identity = dependencies.identity ?? companyRuntimeIdentityFromEnv(runtimeEnv);
  const layout = companyRuntimeLayout(workdir);
  let lifecycle!: CompanyRuntimeLifecycle;
  let memberRuntime!: MemberRuntimeManager;
  let memberAssets!: MemberAssetService;
  let memberMemory!: MemberMemoryCapabilityService;
  let companyProxy!: CompanyProxyService;
  let desktopBrowserTunnels: ReturnType<typeof registerDesktopBrowserTunnel> | undefined;
  let staticInitializationTimer: ReturnType<typeof setInterval> | null = null;
  const companyExecutor = dependencies.companyExecutor ?? new ExecutorAuthWorker(workdir, {
    proxyEnv: () => companyProxy.environment(),
    onConnected: (connected) => lifecycle.executorConnected(connected),
    onUnavailable: (unavailable) => lifecycle.executorUnavailable(unavailable),
    onCredentialChanged: (input) => memberRuntime.activateExecutorCredential(
      input.executorId,
      input.credentialVersion,
    ),
    onCredentialRollback: (input) => memberRuntime.rollbackExecutorCredential(
      input.executorId,
      input.previousCredentialVersion,
    ),
  });
  memberRuntime = dependencies.memberRuntime ?? new MemberRuntimeManager(workdir, {
    runtimeUrl: `http://127.0.0.1:${port}`,
    issueTokens: async (input) => companyExecutor.issueToken({
      executor_id: input.executorId,
      previous_credential_version: input.previousCredentialVersion,
      reason: input.reason,
    }),
    proxyEnv: () => companyProxy.environment(),
    onExecutorUnauthorized: (input) => lifecycle.executorUnavailable({
      executorId: input.executorId,
      status: "failed",
      code: "EXECUTOR_INVALID_CREDENTIALS",
    }),
    publishAgentRoomActivity: (event) => lifecycle.agentActivity(event),
    publishHomeTerminalNotification: (event) => lifecycle.homeTerminalNotification(event),
    resolveMemberAssets: (memberId) => memberAssets.resolve(memberId),
    activateMemberAssets: (socketPath, assets) => memberAssets.activate(socketPath, assets),
  });
  companyProxy = new CompanyProxyService(workdir, {
    prepare: async () => {
      companyExecutor.beginProxyChange();
      try {
        await memberRuntime.prepareCompanyProxyChange();
      } catch (error) {
        companyExecutor.endProxyChange();
        throw error;
      }
    },
    activate: async () => {
      try {
        await memberRuntime.activateCompanyProxyChange();
      } finally {
        companyExecutor.endProxyChange();
      }
    },
    rollback: async () => {
      try {
        await memberRuntime.rollbackCompanyProxyChange();
      } finally {
        companyExecutor.endProxyChange();
      }
    },
    stopExecutorAppServers: () => companyExecutor.stopAllAppServersForProxyChange(),
    closeBrowserTunnels: async () => desktopBrowserTunnels?.closeAll(),
    hasPendingAuthorization: () => companyExecutor.hasPendingAuthorization(),
  });
  lifecycle = new CompanyRuntimeLifecycle(identity, {
    members_root: layout.members,
    rooms_root: layout.rooms,
    executors_root: layout.executors,
  }, memberRuntime, dependencies.lifecycleOptions);
  const assetThreadWorkspaceResolver = dependencies.assetThreadWorkspaceResolver ?? {
    async resolve(input: { member_id: string; thread_id: string }) {
      const status = memberRuntime.memberStatus(input.member_id);
      if (!status || status.state !== "running") {
        throw new AssetStoreError(
          "asset_thread_workspace_unavailable",
          "Current Member App Server is not running.",
        );
      }
      const builderWorkspace = memberRuntime.builderWorkspace(
        input.member_id,
        input.thread_id,
      );
      if (builderWorkspace) {
        return {
          scope: "home" as const,
          member_id: input.member_id,
          thread_id: input.thread_id,
          root: builderWorkspace,
        };
      }
      const matches = status.threads.filter((thread) => thread.threadId === input.thread_id);
      if (matches.length !== 1) {
        throw new AssetStoreError(
          "asset_thread_workspace_unavailable",
          "Current Thread has no unambiguous authoritative workspace mapping.",
        );
      }
      const thread = matches[0]!;
      if (thread.roomId) {
        return {
          scope: "room" as const,
          member_id: input.member_id,
          thread_id: input.thread_id,
          room_id: thread.roomId,
          root: thread.workspaceRoots[0]
            ?? memberWorkspaceLayout(workdir, input.member_id).workspace,
        };
      }
      return {
        scope: "home" as const,
        member_id: input.member_id,
        thread_id: input.thread_id,
        root: thread.workspaceRoots[0]
          ?? memberWorkspaceLayout(workdir, input.member_id).workspace,
      };
    },
  };
  const assetStore = dependencies.assetStore ?? new CompanyAssetStore(workdir, {
    quotaBytes: assetQuotaBytes(runtimeEnv.FIELDS_COMPANY_ASSET_QUOTA_BYTES),
    threadWorkspaceResolver: assetThreadWorkspaceResolver,
    objectStore: new S3CompanyAssetObjectStore(
      companyAssetObjectStoreConfigFromEnv(identity.company_id, runtimeEnv),
    ),
  });
  memberAssets = dependencies.memberAssetService ?? new MemberAssetService(
    workdir,
    memberRuntime,
    assetStore,
    (input) => lifecycle.memberAssetCompleted(input),
  );
  memberMemory = dependencies.memberMemoryService ?? new MemberMemoryCapabilityService(
    memberRuntime,
    (input) => lifecycle.memberMemoryCompleted(input),
  );
  const mail = dependencies.mailService ?? new CompanyMailService(workdir);
  const agentExecutions = new AgentRoomExecutionCoordinator(
    workdir,
    memberRuntime,
    lifecycle,
  );
  const controlTokenFile = dependencies.controlTokenFile
    ?? runtimeEnv.FIELDS_INTERNAL_CONTROL_TOKEN_FILE
    ?? "/run/secrets/fields-control-token";
  const app = Fastify({ logger: false });
  const mcpGateway = dependencies.mcpGateway ?? {
    async resolveMemberContext(memberId: string) {
      const status = memberRuntime.memberStatus(memberId);
      if (!status || status.state !== "running") {
        throw new CallMcpError(
          "mcp_identity_invalid",
          "MCP requires a running Member App Server.",
        );
      }
      return { memberId };
    },
    async authorizeAssetTool(memberId, threadId, toolName) {
      if (!threadId) return;
      const scope = memberRuntime.builderScope(memberId, threadId);
      if (!scope) return;
      const allowed = scope.kind === "agent"
        ? AGENT_BUILDER_ASSET_TOOLS
        : ASSET_BUILDER_ASSET_TOOLS;
      if (!allowed.has(toolName)) {
        throw new CallMcpError(
          "asset_builder_tool_forbidden",
          `${toolName} is unavailable in this ${scope.kind} Builder Thread.`,
        );
      }
    },
    listTerminals: (memberId: string) => {
      const connection = lifecycle.backendConnection();
      return listTerminalsFromCompanyRuntime({
        ...connection,
        memberId,
        runtime: connection.identity,
      });
    },
    callStart: (memberId: string, call: Parameters<CompanyRuntimeMcpGateway["callStart"]>[1]) => {
      const connection = lifecycle.backendConnection();
      return callStartFromCompanyRuntime({
        ...connection,
        memberId,
        runtime: connection.identity,
        call,
      });
    },
    callExchange: (
      memberId: string,
      call: Parameters<CompanyRuntimeMcpGateway["callExchange"]>[1],
    ) => {
      const connection = lifecycle.backendConnection();
      return callExchangeFromCompanyRuntime({
        ...connection,
        memberId,
        runtime: connection.identity,
        call,
      });
    },
    callEnd: (memberId: string, call: Parameters<CompanyRuntimeMcpGateway["callEnd"]>[1]) => {
      const connection = lifecycle.backendConnection();
      return callEndFromCompanyRuntime({
        ...connection,
        memberId,
        runtime: connection.identity,
        call,
      });
    },
    async resolveRoomContext(memberId: string, threadId: string) {
      try {
        return memberRuntime.resolveRoomContext(memberId, threadId);
      } catch (error) {
        if (
          error instanceof Error
          && "code" in error
          && (
            error.code === "mcp_room_context_unavailable"
            || error.code === "mcp_room_context_ambiguous"
          )
        ) {
          throw new CallMcpError(error.code, error.message);
        }
        throw error;
      }
    },
    readRoomMessages: (
      memberId: string,
      roomId: string,
      accessMode: Parameters<CompanyRuntimeMcpGateway["readRoomMessages"]>[2],
      resource: Parameters<CompanyRuntimeMcpGateway["readRoomMessages"]>[3],
    ) => lifecycle.readRoomMessages(memberId, roomId, accessMode, resource),
    search: (memberId: string, input: Parameters<CompanyRuntimeMcpGateway["search"]>[1]) => (
      lifecycle.search(memberId, input)
    ),
    fileList: (memberId, input) => lifecycle.fileList(memberId, input),
    fileRead: (memberId, input) => lifecycle.fileRead(memberId, input),
    filePublishWorkspace: (memberId, input) => lifecycle.filePublishWorkspace(memberId, input),
    assetList: (memberId, input) => lifecycle.assetList(memberId, input),
    assetRead: (memberId, input) => lifecycle.assetRead(memberId, input),
    assetContentRead: (memberId, input) => lifecycle.assetContentRead(memberId, input),
    assetImportGit: (memberId, input) => lifecycle.assetImportGit(memberId, input),
    assetImportWorkspaceZip: (memberId, input) => (
      lifecycle.assetImportWorkspaceZip(memberId, input)
    ),
    assetCreateMcp: (memberId, input) => lifecycle.assetCreateMcp(memberId, input),
    assetUpdateDraft: (memberId, input) => lifecycle.assetUpdateDraft(memberId, input),
    assetValidateDraft: (memberId, input) => lifecycle.assetValidateDraft(memberId, input),
    assetDeleteDraft: (memberId, input) => lifecycle.assetDeleteDraft(memberId, input),
    assetPublish: (memberId, input) => lifecycle.assetPublish(memberId, input),
    assetArchive: (memberId, input) => lifecycle.assetArchive(memberId, input),
    assetRestore: (memberId, input) => lifecycle.assetRestore(memberId, input),
    assetReplaceCredential: (memberId, input) => (
      lifecycle.assetReplaceCredential(memberId, input)
    ),
    memberAssetCurrent: (memberId) => lifecycle.memberAssetCurrent(memberId),
    memberAssetOptions: (memberId, input) => lifecycle.memberAssetOptions(memberId, input),
    memberAssetApply: (memberId, input) => lifecycle.memberAssetApply(memberId, input),
  } satisfies CompanyRuntimeMcpGateway;
  const resolveMemberContext = async (memberId: string) => {
    const status = memberRuntime.memberStatus(memberId);
    if (!status || status.state !== "running") {
      throw new CallMcpError(
        "mcp_identity_invalid",
        "MCP requires a running Member App Server.",
      );
    }
    return { memberId };
  };
  const mailboxAuthority = async (memberId: string, mailboxId: string) => {
    await resolveMemberContext(memberId);
    const available = await lifecycle.mailListMailboxes(memberId);
    const mailbox = available.items.find((item) => item.mailbox_id === mailboxId);
    if (!mailbox) {
      throw new CallMcpError("mail_access_denied", "Mailbox is not available to this Member.");
    }
    return {
      company_id: identity.company_id,
      requested_by_actor_id: memberId,
      mailbox_id: mailbox.mailbox_id,
      access: mailbox.access,
    } as const;
  };
  const mailMcpGateway = dependencies.mailMcpGateway ?? {
    async authenticateMember(bearerToken, claimedMemberId) {
      try {
        return {
          memberId: memberRuntime.resolveMailMcpMember(bearerToken, claimedMemberId),
        };
      } catch {
        throw new CallMcpError(
          "mail_mcp_identity_invalid",
          "Mail MCP identity is invalid or revoked.",
        );
      }
    },
    mailListMailboxes: async (memberId) => {
      await resolveMemberContext(memberId);
      const available = await lifecycle.mailListMailboxes(memberId);
      return mailMcpMailboxListResultSchema.parse({
        items: await Promise.all(available.items.map(async (mailbox) => {
          if (
            mailbox.connection_state !== "connected"
            && mailbox.connection_state !== "limited"
          ) {
            return { mailbox, folders: [], folders_partial: false };
          }
          const authority = {
            company_id: identity.company_id,
            requested_by_actor_id: memberId,
            mailbox_id: mailbox.mailbox_id,
            access: mailbox.access,
          } as const;
          try {
            const folders = await mail.listFolders({ authority });
            return { mailbox, folders: folders.items, folders_partial: false };
          } catch {
            return { mailbox, folders: [], folders_partial: true };
          }
        })),
      });
    },
    mailListMessages: async (memberId, input) => mail.listMessages({
      authority: await mailboxAuthority(memberId, input.mailbox_id),
      request: withoutMailboxId(input),
    }),
    mailSearchMessages: async (memberId, input) => {
      await resolveMemberContext(memberId);
      const available = await lifecycle.mailListMailboxes(memberId);
      const requestedIds = input.mailbox_ids ?? available.items
        .filter((item) => (
          item.connection_state === "connected" || item.connection_state === "limited"
        ))
        .map((item) => item.mailbox_id);
      const byId = new Map(available.items.map((item) => [item.mailbox_id, item]));
      const authorities = requestedIds.map((mailboxId) => {
        const mailbox = byId.get(mailboxId);
        if (!mailbox) {
          throw new CallMcpError(
            "mail_access_denied",
            "Mailbox is not available to this Member.",
          );
        }
        if (
          mailbox.connection_state !== "connected"
          && mailbox.connection_state !== "limited"
        ) {
          throw new CallMcpError("MAILBOX_NOT_CONNECTED", "Mailbox is not connected.");
        }
        return {
          company_id: identity.company_id,
          requested_by_actor_id: memberId,
          mailbox_id: mailbox.mailbox_id,
          access: mailbox.access,
        } as const;
      });
      if (authorities.length === 0) {
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
      }
      return mail.searchMessages({
        authorities,
        request: withoutMailboxIds(input),
      });
    },
    mailReadMessage: async (memberId, input) => mail.readMessage({
      authority: await mailboxAuthority(memberId, input.mailbox_id),
      request: withoutMailboxId(input),
    }),
    mailSendMessage: async (memberId, input) => runMailMcpMutationWithAudit(
      async () => mail.sendWorkspaceMessageWithMetrics({
        authority: await mailboxAuthority(memberId, input.mailbox_id),
        member_id: memberId,
        request: withoutMailboxId(input),
      }),
      (sent) => lifecycle.mailAudit({
        member_id: memberId,
        operation_id: input.idempotency_key,
        mailbox_id: input.mailbox_id,
        operation: "send",
        item_count: 1,
        size_bytes: sent.attachmentSizeBytes,
        outcome: sent.result.outcome,
      }),
    ).then((sent) => sent.result),
    mailUpdateMessage: async (memberId, input) => {
      const { idempotency_key: operationId, ...request } = input;
      return runMailMcpMutationWithAudit(
        async () => mail.updateMessage({
          authority: await mailboxAuthority(memberId, input.mailbox_id),
          request: withoutMailboxId(request),
          operation_id: operationId,
        }),
        () => lifecycle.mailAudit({
          member_id: memberId,
          operation_id: operationId,
          mailbox_id: input.mailbox_id,
          operation: input.operation,
          item_count: 1,
          size_bytes: 0,
          outcome: "succeeded",
        }),
      );
    },
    mailSaveAttachment: async (memberId, input) => {
      const {
        mailbox_id: mailboxId,
        workspace_relative_path: workspaceRelativePath,
        ...request
      } = input;
      const { idempotency_key: operationId, ...attachmentRequest } = request;
      return runMailMcpMutationWithAudit(
        async () => mail.saveAttachment({
          authority: await mailboxAuthority(memberId, mailboxId),
          request: attachmentRequest,
          member_id: memberId,
          workspace_relative_path: workspaceRelativePath,
          operation_id: operationId,
        }),
        (result) => lifecycle.mailAudit({
          member_id: memberId,
          operation_id: operationId,
          mailbox_id: mailboxId,
          operation: "save_attachment",
          item_count: 1,
          size_bytes: result.size_bytes,
          outcome: "succeeded",
        }),
      );
    },
  } satisfies CompanyRuntimeMailMcpGateway;

  void app.register(websocket);
  desktopBrowserTunnels = registerDesktopBrowserTunnel(app, { companyProxy, controlTokenFile });
  void app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    useWSS: true,
    trpcOptions: {
      router: createCompanyRuntimeTrpcRouter(),
      createContext: ({ req, info }: CreateFastifyContextOptions): CompanyRuntimeTrpcContext => ({
        workdir,
        runtime: memberRuntime,
        lifecycle,
        companyExecutor,
        companyProxy,
        assetStore,
        memberAssets,
        memberMemory,
        mail,
        agentExecutions,
        authorization: internalAuthorizationHeader(req.headers, info.connectionParams),
        traceparent: traceparentFromConnectionParams(info.connectionParams),
        controlTokenFile,
        dependencies,
      }),
    },
  });
  registerFilesystemTransferRoutes(app, { workdir, controlTokenFile, runtime: memberRuntime });
  registerAssetPackageRoutes(app, { assetStore, controlTokenFile });

  app.addHook("onReady", async () => {
    await ensureCompanyRuntimeLayout(workdir);
    await companyProxy.initialize();
    await assetStore.initialize();
    await removeLegacySharedDirectories(workdir);
    await memberRuntime.prepareFieldsPluginMarketplace();
    await companyExecutor.restoreAll();
    await agentExecutions.start();
    mail.startBackgroundIndexing();
    const initialize = async () => {
      if (lifecycle.isReady()) return;
      try {
        const tokenFile = runtimeEnv.FIELDS_INTERNAL_CONTROL_TOKEN_FILE
          ?? "/run/secrets/fields-control-token";
        const callbackToken = (await readFile(tokenFile, "utf8")).trim();
        await lifecycle.initialize({
          ...identity,
          backend_callback_url: requiredRuntimeEnv(
            runtimeEnv,
            "FIELDS_COMPANY_RUNTIME_CALLBACK_BASE_URL",
          ).replace(/\/+$/u, ""),
          runtime_callback_token: callbackToken,
          layout: {
            members_root: layout.members,
            rooms_root: layout.rooms,
            executors_root: layout.executors,
          },
          storage_policy: {
            member_workspace_pattern: "members/<member_id>/workspace",
            codex_home_directory: ".codex",
            room_file_inputs: "execution_scoped_company_file_snapshots",
            executor_credentials_pattern: "executors/<executor_id>/credentials",
            codex_home_auth_json: "forbidden",
            codex_home_visibility: "excluded_from_files_search_upload_export_git",
          },
          execution_policy: {
            idle_timeout_ms: 1_800_000,
            same_agent_room_thread: "serial",
            different_room_threads: "parallel",
            thread_recovery: "resume",
            executor_auth: "chatgptAuthTokens",
          },
        });
      } catch (error) {
        app.log.debug({
          event: "company_runtime_initialization_pending",
          code: error instanceof Error ? error.message : "company_runtime_initialization_failed",
        }, "Company Runtime initialization is pending; retrying.");
      }
    };
    await initialize();
    staticInitializationTimer = setInterval(() => { void initialize(); }, 1_000);
    staticInitializationTimer.unref();
  });
  app.addHook("onClose", async () => {
    if (staticInitializationTimer) clearInterval(staticInitializationTimer);
    await runCleanupTasks([
      () => mail.shutdown(),
      () => agentExecutions.shutdown(),
      () => lifecycle.shutdown(),
      () => companyExecutor.shutdown(),
      () => memberRuntime.shutdown(),
    ]);
  });

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/ready", async (_request, reply) => {
    if (!lifecycle.isReady()) {
      return reply.code(503).send({ status: "starting" });
    }
    return reply.send({ status: "ready" });
  });
  app.all("/mcp/embodiment", async (request, reply) => {
    await handleEmbodimentMcpHttpRequest(request, reply, mcpGateway);
    return reply;
  });
  app.all("/mcp/room-messages", async (request, reply) => {
    await handleRoomMessagesMcpHttpRequest(request, reply, mcpGateway);
    return reply;
  });
  app.all("/mcp/search", async (request, reply) => {
    await handleSearchMcpHttpRequest(request, reply, mcpGateway);
    return reply;
  });
  app.all("/mcp/assets", async (request, reply) => {
    await handleAssetsMcpHttpRequest(request, reply, mcpGateway);
    return reply;
  });
  app.all("/mcp/mail", async (request, reply) => {
    await handleMailMcpHttpRequest(request, reply, mailMcpGateway);
    return reply;
  });
  return app;
}

function requiredRuntimeEnv(source: NodeJS.ProcessEnv, name: string): string {
  const value = source[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function withoutMailboxId<T extends { mailbox_id: string }>(input: T): Omit<T, "mailbox_id"> {
  const { mailbox_id: _mailboxId, ...rest } = input;
  return rest;
}

function withoutMailboxIds<T extends { mailbox_ids?: string[] }>(
  input: T,
): Omit<T, "mailbox_ids"> {
  const { mailbox_ids: _mailboxIds, ...rest } = input;
  return rest;
}

async function retryMailAudit(run: () => Promise<unknown>): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await run();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function runMailMcpMutationWithAudit<T>(
  mutation: () => Promise<T>,
  audit: (result: T) => Promise<unknown>,
): Promise<T> {
  const result = await mutation();
  await retryMailAudit(() => audit(result));
  return result;
}

function assetQuotaBytes(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("FIELDS_COMPANY_ASSET_QUOTA_BYTES must be a positive integer.");
  }
  return parsed;
}

export async function runServer(
  options: CompanyRuntimeServerOptions,
  signalSource: ShutdownSignalSource = process,
): Promise<number> {
  const host = options.host ?? DEFAULT_SERVER_HOST;
  const port = options.port ?? DEFAULT_SERVER_PORT;
  const app = createCompanyRuntimeApp({ ...options, host, port });
  const closed = new Promise<void>((resolvePromise) => app.server.once("close", resolvePromise));
  let listening = false;
  let closePromise: Promise<void> | null = null;
  let closeRequested = false;
  const close = () => {
    closeRequested = true;
    if (!listening) return;
    closePromise ??= app.close();
    void closePromise.catch(() => undefined);
  };
  signalSource.once("SIGINT", close);
  signalSource.once("SIGTERM", close);
  try {
    await app.listen({ host, port });
    listening = true;
    if (closeRequested) close();
    await closed;
    if (closePromise) await closePromise;
    return 0;
  } finally {
    signalSource.off("SIGINT", close);
    signalSource.off("SIGTERM", close);
  }
}

export function internalAuthorizationHeader(
  headers: { authorization?: string | string[] },
  connectionParams: unknown,
): string | undefined {
  const header = Array.isArray(headers.authorization) ? headers.authorization[0] : headers.authorization;
  if (typeof header === "string") return header;
  if (!isRecord(connectionParams)) return undefined;
  const value = connectionParams.Authorization ?? connectionParams.authorization;
  return typeof value === "string" ? value : undefined;
}

async function runCleanupTasks(tasks: Array<() => void | Promise<void>>): Promise<void> {
  const results = await Promise.allSettled(tasks.map((task) => task()));
  const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
  if (errors.length > 0) {
    throw new AggregateError(errors, "Company Runtime shutdown failed.");
  }
}

function traceparentFromConnectionParams(connectionParams: unknown): string | undefined {
  if (!isRecord(connectionParams)) return undefined;
  const traceparent = connectionParams.traceparent;
  return typeof traceparent === "string"
    && /^[\da-f]{2}-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}(?:-[\da-z-]+)?$/u.test(traceparent)
    ? traceparent
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionValue(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1]! : null;
}

function parsePort(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("Company Runtime port must be an integer from 1 to 65535.");
  }
  return parsed;
}

async function main(): Promise<void> {
  const args = argv.slice(2);
  const workdir = optionValue(args, "--workdir") ?? env.FIELDS_COMPANY_RUNTIME_WORKDIR ?? "/workdir";
  const host = optionValue(args, "--host") ?? env.FIELDS_COMPANY_RUNTIME_HOST ?? DEFAULT_SERVER_HOST;
  const port = parsePort(optionValue(args, "--port") ?? env.FIELDS_COMPANY_RUNTIME_PORT ?? String(DEFAULT_SERVER_PORT));
  exit(await runServer({ workdir, host, port }));
}

if (argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${argv[1]}`))) {
  void main().catch((error) => {
    process.stderr.write(`Company Runtime start failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    exit(1);
  });
}
