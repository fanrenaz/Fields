#!/usr/bin/env node
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { fastifyTRPCPlugin, type CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { env } from "node:process";

import type { HumanInvitationAdmissionPolicyUseCase } from "../../application/actor/index.js";
import {
  ACTOR_ORDINARY_ACCESS_DENIED_CODE,
  ACTOR_ORDINARY_ACCESS_UNAVAILABLE_CODE,
} from "../../application/actor/queries/index.js";
import { EmbodimentApplication } from "../../application/embodiment/index.js";
import { ApplicationError } from "../../application/platform/errors.js";
import {
  ROOM_ACTOR_ACCESS_DENIED_CODE,
  ROOM_ACTOR_ACCESS_UNAVAILABLE_CODE,
} from "../../application/room/ports/index.js";
import {
  betterAuthHeadersFromHttp,
  betterAuthHeadersFromWebSocket,
  createFieldsAuth,
  dispatchBetterAuthHttpRequest,
  getBetterAuthSession,
  materializeBetterAuthHttpResponse,
  type FieldsAuth,
} from "../../infrastructure/auth/better-auth/index.js";
import { loadBackendEnvFiles } from "../../infrastructure/configuration/env.js";
import {
  createBackendDatabaseService,
  type BackendDatabaseService,
} from "../../infrastructure/persistence/postgres/database-service.js";
import { CompanyTerminalRepository, newTerminalToken } from "../../infrastructure/persistence/postgres/embodiment/terminal-repository.js";
import { PostgresRuntimeEmbodimentAuthorization } from "../../infrastructure/persistence/postgres/embodiment/runtime-call-authorization.js";
import {
  MemberExecutorAssignmentService,
  PostgresCompanyRuntimeRepository,
  PostgresCompanyRuntimeStatusRepository,
  PostgresMemberExecutorAssignmentRepository,
  PostgresPersonalExecutorRepository,
  PostgresRoomMessageRepository,
  PostgresAgentBuilderApplication,
  PostgresMemberMemoryApplication,
  PostgresAssetBuilderApplication,
  PostgresCompanyFileApplication,
  PostgresCompanyFileActorSummaryQuery,
  PostgresRoomSideChatApplication,
  PostgresScheduledTaskApplication,
  PostgresDesktopBrowserRepository,
  PostgresRegistrationApplication,
  PostgresNotificationApplication,
} from "../../infrastructure/persistence/postgres/repositories/index.js";
import { TrpcCompanyRuntimeGateway } from "../../infrastructure/runtime/company-runtime/index.js";
import {
  CodexActivityAdapter,
  projectCodexInteraction,
  type AgentActivityProjection,
} from "../../infrastructure/runtime/codex-activity/index.js";
import { EmbodimentRuntimeGateway } from "../../infrastructure/runtime/embodiment/embodiment-runtime-gateway.js";
import { embodimentInternalControlTokenMatches } from "../../infrastructure/runtime/embodiment/internal-auth.js";
import {
  BrowserTelemetryRelay,
  clientTelemetryContext,
  DesktopTelemetryRelay,
  handleBetterAuthHttpRoute,
  FIELDS_INVITATION_ID_HEADER,
  FIELDS_REGISTRATION_CREDENTIAL_HEADER,
  resolveInvitationPreviewHttpRequest,
} from "../../interface/http/index.js";
import { registerEmbodimentHttpApi } from "../../interface/http/embodiment/http-api.js";
import { createBackendTrpcContext } from "../../interface/trpc/context.js";
import { ProductSessionResolver } from "../../interface/trpc/product-session.js";
import { createBackendTrpcRouter } from "../../interface/trpc/router.js";
import { emitObservabilityLog } from "../../observability/events.js";
import { createSafeFastifyLogger } from "../../observability/fastify-logger.js";
import { completeHttpMetric, startHttpMetric } from "../../observability/http-metrics.js";
import {
  createCompanyActorApplication,
  createHumanInvitationAdmissionPolicy,
  createRoomApplication,
  type CompanyActorApplication,
} from "./index.js";
import { registerFilesystemTransferHttpApi } from "../../interface/http/filesystem-transfer.js";
import { registerAssetPackageHttpApi } from "../../interface/http/asset-package.js";
import { registerDesktopBrowserTunnelProxy } from "../../interface/http/desktop-browser-tunnel.js";
import { DesktopBrowserService } from "../../application/desktop-browser/service.js";
import { PostgresCompanyAssetApplication } from "../../infrastructure/persistence/postgres/repositories/company/company-asset-repository.js";
import { PostgresMemberAssetApplication } from "../../infrastructure/persistence/postgres/repositories/company/member-asset-installation-repository.js";
import { PostgresMailApplication } from "../../infrastructure/persistence/postgres/repositories/company/mail-repository.js";
import {
  companyFileObjectStoreConfigFromEnv,
  S3CompanyFileObjectStore,
} from "../../infrastructure/object-storage/company-file-object-store.js";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 4102;
export const DEFAULT_CLIENT_ORIGIN = "http://127.0.0.1:3102";
export const DEFAULT_CLIENT_ORIGINS = [DEFAULT_CLIENT_ORIGIN, "http://localhost:3102"] as const;
export const DEFAULT_AUTH_BASE_URL = DEFAULT_CLIENT_ORIGIN;
export const DEFAULT_AUTH_TRUSTED_ORIGINS = [DEFAULT_CLIENT_ORIGIN] as const;
const DEVELOPMENT_AUTH_SECRET = "fields-development-better-auth-secret-32";

export type ServerOptions = {
  host?: string | null;
  port?: number | null;
  auth?: FieldsAuth | null;
  invitationPolicy?: HumanInvitationAdmissionPolicyUseCase | null;
  authSecret?: string | null;
  fileShareSecret?: string | null;
  authBaseURL?: string | null;
  authTrustedOrigins?: string[] | null;
  companyRuntimeControlTokenFile?: string | null;
  internalControlTokenFile?: string | null;
  clientOrigins?: string[] | null;
  databaseService?: BackendDatabaseService | null;
};

export function createApp(options: Omit<ServerOptions, "host" | "port"> = {}): FastifyInstance {
  loadBackendEnvFiles();
  const app = Fastify({
    logger: createSafeFastifyLogger(),
    disableRequestLogging: true,
    routerOptions: { maxParamLength: 5_000 },
  });
  const databaseService = options.databaseService ?? createBackendDatabaseService();
  const authBaseURL = options.authBaseURL ?? env.BETTER_AUTH_URL ?? DEFAULT_AUTH_BASE_URL;
  const authTrustedOrigins = options.authTrustedOrigins ?? parseOriginList(
    env.FIELDS_AUTH_TRUSTED_ORIGINS,
    [new URL(authBaseURL).origin],
  );
  const internalControlTokenFile = options.internalControlTokenFile
    ?? env.FIELDS_INTERNAL_CONTROL_TOKEN_FILE
    ?? "";
  const runtimeControlTokenFile = options.companyRuntimeControlTokenFile
    ?? internalControlTokenFile;
  const resolvedAuthSecret = authSecret(options.authSecret ?? env.BETTER_AUTH_SECRET);
  const invitationPolicy = options.invitationPolicy
    ?? createHumanInvitationAdmissionPolicy({ database: databaseService.db });
  if (options.auth && !options.invitationPolicy) {
    throw new Error("An invitation policy is required with an injected Better Auth instance.");
  }

  let companyActors: CompanyActorApplication | null = null;
  const registration = new PostgresRegistrationApplication(databaseService.db, {
    reconcileAcceptedMembership: async (input) => {
      if (!companyActors) throw new Error("Company Actor application is not ready.");
      await companyActors.committedMembershipProjection.reconcileAcceptedMembership(input);
    },
    reconcileRemovedMembership: async (input) => {
      if (!companyActors) throw new Error("Company Actor application is not ready.");
      await companyActors.committedMembershipProjection.reconcileRemovedMembership(input);
    },
  });
  const auth = options.auth ?? createFieldsAuth({
    database: databaseService.db,
    secret: resolvedAuthSecret,
    baseURL: authBaseURL,
    trustedOrigins: authTrustedOrigins,
    invitationPolicy,
    invitationIdHeader: FIELDS_INVITATION_ID_HEADER,
    registrationCredentialHeader: FIELDS_REGISTRATION_CREDENTIAL_HEADER,
    registrationAdmission: registration,
    committedMembershipProjection: {
      reconcileAcceptedMembership: async (input) => {
        if (!companyActors) throw new Error("Company Actor application is not ready.");
        await companyActors.committedMembershipProjection.reconcileAcceptedMembership(input);
      },
      reconcileRemovedMembership: async (input) => {
        if (!companyActors) throw new Error("Company Actor application is not ready.");
        await companyActors.committedMembershipProjection.reconcileRemovedMembership(input);
      },
    },
  });
  companyActors = createCompanyActorApplication({
    database: databaseService.db,
    auth,
    internalCompanyId: runtimeEnvValue(
      env,
      "FIELDS_INTERNAL_COMPANY_ID",
      "company_internal",
    ),
  });
  const activeCompanyActors = companyActors;
  const productSessionResolver = new ProductSessionResolver(activeCompanyActors.productSessionQuery);
  const rooms = createRoomApplication({
    database: databaseService.db,
    memberActorProfiles: {
      listActiveOrdinaryProfiles: (input) => activeCompanyActors.listActiveOrdinaryActorProfiles.execute(input),
    },
    actorAccess: {
      requireActiveOrdinaryActor: async (input) => {
        try {
          return await activeCompanyActors.requireActiveOrdinaryActor.execute(input);
        } catch (error) {
          if (error instanceof ApplicationError) {
            if (error.code === ACTOR_ORDINARY_ACCESS_DENIED_CODE) {
              throw new ApplicationError(ROOM_ACTOR_ACCESS_DENIED_CODE, false);
            }
            if (error.code === ACTOR_ORDINARY_ACCESS_UNAVAILABLE_CODE) {
              throw new ApplicationError(ROOM_ACTOR_ACCESS_UNAVAILABLE_CODE, error.retryable);
            }
          }
          throw error;
        }
      },
    },
  });
  const runtimeRepository = new PostgresCompanyRuntimeRepository(databaseService.db, {
    companyId: runtimeEnvValue(env, "FIELDS_INTERNAL_COMPANY_ID", "company_internal"),
    runtimeUrl: runtimeEnvValue(env, "FIELDS_COMPANY_RUNTIME_URL", "http://127.0.0.1:4110"),
    controlTokenFile: runtimeControlTokenFile,
  });
  const assignmentRepository = new PostgresMemberExecutorAssignmentRepository(databaseService.db);
  const runtime = new TrpcCompanyRuntimeGateway(
    runtimeRepository,
    runtimeControlTokenFile,
    assignmentRepository,
  );
  const memberExecutors = new MemberExecutorAssignmentService(
    assignmentRepository,
    runtime,
    Date.now,
    () => `executor_switch_${randomUUID()}`,
  );
  const personalExecutors = new PostgresPersonalExecutorRepository(databaseService.db, runtime, Date.now);
  const roomMessages = new PostgresRoomMessageRepository(databaseService.db);
  const assets = new PostgresCompanyAssetApplication(databaseService.db, runtime);
  const companyFiles = new PostgresCompanyFileApplication(
    databaseService.db,
    new S3CompanyFileObjectStore(companyFileObjectStoreConfigFromEnv(env)),
    Date.now,
    randomUUID,
    companyFileShareSecret(options.fileShareSecret ?? env.FIELDS_FILE_SHARE_SECRET),
    new PostgresCompanyFileActorSummaryQuery(databaseService.db),
  );
  const memberAssets = new PostgresMemberAssetApplication(databaseService.db, runtime);
  const scheduledTasks = new PostgresScheduledTaskApplication(databaseService.db, {
    runtime,
    companyFiles,
  });
  const notifications = new PostgresNotificationApplication(
    databaseService.db,
    env.FIELDS_WEB_PUSH_VAPID_PUBLIC_KEY ?? "",
  );
  const desktopBrowser = new DesktopBrowserService(
    new PostgresDesktopBrowserRepository(databaseService.db),
    (companyId) => runtime.companyProxyStatus(companyId),
    resolvedAuthSecret,
    Date.now,
  );
  const mail = new PostgresMailApplication(
    databaseService.db,
    runtime,
    activeCompanyActors.listActiveOrdinaryActorProfiles,
  );
  const runtimeStatus = new PostgresCompanyRuntimeStatusRepository(databaseService.db);
  const memberMemory = new PostgresMemberMemoryApplication(databaseService.db, runtime, Date.now);
  const agentBuilder = new PostgresAgentBuilderApplication(
    databaseService.db,
    runtime,
    Date.now,
    undefined,
    memberAssets,
    memberMemory,
  );
  const assetBuilder = new PostgresAssetBuilderApplication(
    databaseService.db,
    runtime,
    assets,
  );
  const roomSideChat = new PostgresRoomSideChatApplication(
    databaseService.db,
    runtime,
    roomMessages,
  );
  const browserTelemetry = new BrowserTelemetryRelay();
  const desktopTelemetry = new DesktopTelemetryRelay();
  const clientOrigins = options.clientOrigins
    ?? parseOriginList(env.FIELDS_CLIENT_ORIGINS, [...DEFAULT_CLIENT_ORIGINS]);
  const embodimentApplication = new EmbodimentApplication({
    terminals: new CompanyTerminalRepository(databaseService.db),
    runtime: new EmbodimentRuntimeGateway(
      env.FIELDS_EMBODIMENT_RUNTIME_URL ?? "http://127.0.0.1:4105",
      internalControlTokenFile,
    ),
    runtimeAuthorization: new PostgresRuntimeEmbodimentAuthorization(databaseService.db, {
      companyId: runtimeEnvValue(env, "FIELDS_INTERNAL_COMPANY_ID", "company_internal"),
      controlTokenFile: runtimeControlTokenFile,
    }),
    createTerminalToken: newTerminalToken,
  });

  app.addHook("onClose", async () => {
    desktopBrowser.closeAll();
    if (!options.databaseService) await databaseService.close();
  });
  app.addHook("onRequest", (request, _reply, done) => {
    startHttpMetric(request);
    done();
  });
  app.addHook("onResponse", (request, reply, done) => {
    const route = controlledRoute(request.routeOptions.url);
    const client = clientTelemetryContext(request.headers, defaultClientKind(route));
    completeHttpMetric(request, route, reply.statusCode, client.kind);
    emitObservabilityLog("http.request.completed", {
      code: "http_request_completed",
      retryable: reply.statusCode >= 500,
      "http.status_code": reply.statusCode,
      "fields.route": route,
      "fields.client_kind": client.kind,
      "fields.client_version": client.version,
      "fields.runtime_release_sha": client.runtimeRelease,
    });
    done();
  });
  app.addHook("onError", (request, reply, _error, done) => {
    const route = controlledRoute(request.routeOptions.url);
    const client = clientTelemetryContext(request.headers, defaultClientKind(route));
    emitObservabilityLog("http.request.failed", {
      code: "http_request_failed",
      retryable: reply.statusCode >= 500,
      "http.status_code": reply.statusCode,
      "fields.route": route,
      "fields.client_kind": client.kind,
      "fields.client_version": client.version,
      "fields.runtime_release_sha": client.runtimeRelease,
    });
    done();
  });

  void app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || clientOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  });
  void app.register(websocket);
  registerDesktopBrowserTunnelProxy(app, {
    browser: desktopBrowser,
    openRuntimeTunnel: (companyId) => runtime.openDesktopBrowserTunnel(companyId),
  });
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    handler: (request, reply) => handleBetterAuthHttpRoute({
      dispatch: async (input) => materializeBetterAuthHttpResponse(
        await dispatchBetterAuthHttpRequest(auth, input),
      ),
    }, authBaseURL, request, reply),
  });
  app.post("/api/v1/auth/invitation/preview", async (request, reply) => {
    const output = await resolveInvitationPreviewHttpRequest(invitationPolicy, request.headers);
    return reply.code(output.statusCode).send(output.body);
  });
  app.post("/api/v1/observability/browser", { bodyLimit: 256 * 1024 }, async (request, reply) => {
    const authSession = await getBetterAuthSession(auth, betterAuthHeadersFromHttp(request.headers));
    const session = authSession ? await productSessionResolver.resolve(authSession) : null;
    const client = clientTelemetryContext(request.headers, "web");
    const result = browserTelemetry.accept({
      body: request.body,
      session,
      sessionKey: authSession?.session.id ?? authSession?.user.id ?? null,
      client,
    });
    return reply.code(result.statusCode).send(result.body);
  });
  app.post("/api/v1/observability/desktop", { bodyLimit: 256 * 1024 }, async (request, reply) => {
    const authSession = await getBetterAuthSession(auth, betterAuthHeadersFromHttp(request.headers));
    const session = authSession ? await productSessionResolver.resolve(authSession) : null;
    const result = desktopTelemetry.accept({
      body: request.body,
      session,
      sessionKey: authSession?.session.id ?? authSession?.user.id ?? null,
      client: clientTelemetryContext(request.headers, "unknown"),
    });
    return reply.code(result.statusCode).send(result.body);
  });
  registerEmbodimentHttpApi(app, {
    application: embodimentApplication,
    internalAuthorization: {
      matches: (authorization) => embodimentInternalControlTokenMatches(
        authorization,
        internalControlTokenFile,
      ),
    },
    resolveOwner: async (request) => {
      const authSession = await getBetterAuthSession(auth, betterAuthHeadersFromHttp(request.headers));
      if (!authSession) return null;
      const session = await productSessionResolver.resolve(authSession);
      return session?.actor_type === "human"
        && session.company_role === "owner"
        && session.company_status === "active"
        ? { actor_id: session.actor_id, company_id: session.company_id }
        : null;
    },
  });
  registerFilesystemTransferHttpApi(app, {
    runtime,
    resolveSession: async (request) => {
      const authSession = await getBetterAuthSession(
        auth,
        betterAuthHeadersFromHttp(request.headers),
      );
      return authSession ? productSessionResolver.resolve(authSession) : null;
    },
  });
  registerAssetPackageHttpApi(app, {
    assets,
    resolveSession: async (request) => {
      const authSession = await getBetterAuthSession(
        auth,
        betterAuthHeadersFromHttp(request.headers),
      );
      return authSession ? productSessionResolver.resolve(authSession) : null;
    },
  });
  void app.register(fastifyTRPCPlugin, {
    prefix: "/api/v1/trpc",
    useWSS: true,
    trpcOptions: {
      router: createBackendTrpcRouter(),
      createContext: ({ req, info }: CreateFastifyContextOptions) => createBackendTrpcContext({
        authentication: {
          headersFromHttp: betterAuthHeadersFromHttp,
          headersFromWebSocket: betterAuthHeadersFromWebSocket,
          resolve: (headers) => getBetterAuthSession(auth, headers),
        },
        productSessionResolver,
        authTrustedOrigins,
        companyActors: activeCompanyActors,
        rooms,
        personalExecutors,
        memberExecutors,
        roomMessages,
        runtimeStatus,
        runtimeRepository,
        runtime,
        assets,
        companyFiles,
        memberAssets,
        mail,
        agentBuilder,
        memberMemory,
        assetBuilder,
        roomSideChat,
        scheduledTasks,
        notifications,
        registration,
        desktopBrowser,
        agentRuntimeActivity: {
          project: ({ previous, event }) => {
            if (
              event === null
              || typeof event !== "object"
              || Array.isArray(event)
              || !("scope" in event)
            ) {
              throw new ApplicationError("AGENT_ACTIVITY_INVALID", false);
            }
            const runtimeEvent = event as {
              type: string;
              scope: AgentActivityProjection["scope"];
            };
            const projection: AgentActivityProjection = {
              scope: runtimeEvent.scope,
              snapshot: previous ?? emptyActivitySnapshot(),
            };
            const adapter = new CodexActivityAdapter();
            if (runtimeEvent.type === "agent_runtime.snapshot") {
              adapter.convertSnapshot(projection, event as never);
            } else if (runtimeEvent.type === "agent_runtime.event") {
              adapter.convertEvent(projection, event as never);
            }
            return {
              snapshot: projection.snapshot,
              interaction: runtimeEvent.type === "agent_runtime.interaction_request"
                ? projectCodexInteraction(event as never)
                : null,
              resolvedInteractionId: runtimeEvent.type === "agent_runtime.event"
                && (event as { method?: unknown }).method === "fields/questionInteractionResolved"
                ? resolvedInteractionId(event)
                : null,
            };
          },
        },
      }, req, info.connectionParams),
    },
  });
  app.get("/health", async () => ({ ok: true, service: "fields-backend" }));
  return app;
}

function emptyActivitySnapshot() {
  return {
    turn_id: null,
    status: "queued" as const,
    started_at_ms: null,
    completed_at_ms: null,
    duration_ms: null,
    error: null,
    narrative_items: [],
    activity_items: [],
  };
}

function resolvedInteractionId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = "payload" in value ? value.payload : null;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  return "interaction_id" in payload && typeof payload.interaction_id === "string"
    ? payload.interaction_id
    : null;
}

export async function runServer(options: ServerOptions = {}): Promise<number> {
  const app = createApp(options);
  const serverClosed = new Promise<void>((resolve) => {
    app.server.once("close", resolve);
  });
  let closePromise: Promise<void> | null = null;
  const close = () => {
    closePromise ??= app.close();
    void closePromise.catch(() => undefined);
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  try {
    await app.listen({
      host: options.host ?? DEFAULT_HOST,
      port: options.port ?? DEFAULT_PORT,
    });
    await serverClosed;
    if (closePromise) await closePromise;
    return 0;
  } finally {
    process.off("SIGINT", close);
    process.off("SIGTERM", close);
  }
}

export async function main(): Promise<number> {
  loadBackendEnvFiles();
  try {
    return await runServer({
      host: env.FIELDS_BACKEND_HOST ?? DEFAULT_HOST,
      port: parsePort(env.FIELDS_BACKEND_PORT),
      authSecret: env.BETTER_AUTH_SECRET,
      fileShareSecret: env.FIELDS_FILE_SHARE_SECRET,
      authBaseURL: env.BETTER_AUTH_URL ?? DEFAULT_AUTH_BASE_URL,
      authTrustedOrigins: env.FIELDS_AUTH_TRUSTED_ORIGINS
        ? parseOriginList(env.FIELDS_AUTH_TRUSTED_ORIGINS, [...DEFAULT_AUTH_TRUSTED_ORIGINS])
        : null,
      companyRuntimeControlTokenFile: env.FIELDS_INTERNAL_CONTROL_TOKEN_FILE,
      internalControlTokenFile: env.FIELDS_INTERNAL_CONTROL_TOKEN_FILE,
      clientOrigins: parseOriginList(env.FIELDS_CLIENT_ORIGINS, [...DEFAULT_CLIENT_ORIGINS]),
    });
  } catch {
    emitObservabilityLog("backend.process.failed", { code: "backend_start_failed", retryable: false });
    process.stderr.write("backend start failed\n");
    return 1;
  }
}

function authSecret(value: string | null | undefined): string {
  const secret = value?.trim();
  if (secret) return secret;
  if (env.NODE_ENV === "production") throw new Error("BETTER_AUTH_SECRET is required in production.");
  return DEVELOPMENT_AUTH_SECRET;
}

function companyFileShareSecret(value: string | null | undefined): string {
  const secret = value?.trim();
  if (secret && secret.length >= 32) return secret;
  if (env.NODE_ENV === "production") {
    throw new Error("FIELDS_FILE_SHARE_SECRET must contain at least 32 characters in production.");
  }
  return "fields-development-company-file-share-secret";
}

function parsePort(value: string | undefined): number {
  if (value == null || value.length === 0) return DEFAULT_PORT;
  if (!/^\d+$/u.test(value)) throw new Error(`FIELDS_BACKEND_PORT must be an integer, got ${value}.`);
  return Number(value);
}

function controlledRoute(route: string | undefined): string {
  if (route?.startsWith("/api/v1/trpc")) return "/api/v1/trpc";
  if (route?.startsWith("/api/auth")) return "/api/auth";
  if (route === "/api/v1/observability/desktop") return "/api/v1/observability/desktop";
  if (route?.startsWith("/api/v1/observability")) return "/api/v1/observability/browser";
  if (route?.startsWith("/api/v1/embodiment")) return "/api/v1/embodiment";
  return route === "/health" ? "/health" : "other";
}

function defaultClientKind(route: string): "web" | "unknown" {
  return route === "/health" || route === "other" ? "unknown" : "web";
}

function parseOriginList(value: string | undefined, fallback: string[]): string[] {
  const origins = value
    ?.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  return origins && origins.length > 0 ? origins : fallback;
}

function requiredEnv(source: NodeJS.ProcessEnv, name: string): string {
  const value = source[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function runtimeEnvValue(
  source: NodeJS.ProcessEnv,
  name: string,
  developmentFallback: string,
): string {
  if (source[name]?.trim()) return requiredEnv(source, name);
  if (source.NODE_ENV === "production") return requiredEnv(source, name);
  return developmentFallback;
}
