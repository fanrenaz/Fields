import type {
  CompanyExecutorSafeListResult,
  CompanyExecutorSharingGovernanceResult,
  ExecutorDeleteResult,
  ExecutorDeviceAuthorizationCancelResult,
  ExecutorDeviceAuthorizationStartResult,
  ExecutorDeviceAuthorizationStatusResult,
  ExecutorAuthorizationMethod,
  ExecutorCustomApiConfigureInput,
  ExecutorModelCatalogResult,
  ExecutorModelPolicyResult,
  ExecutorModelPolicyUpdateInput,
  ExecutorModelValidationInput,
  ExecutorModelValidationResult,
  PersonalExecutorMutationResult,
  PersonalExecutorsListResult,
  PersonalExecutorUsageResult,
} from "@fields/contracts/public/executor";
import type {
  ProductSession,
  CompanyRegistrationSettings,
  RegistrationClaimResult,
  RegistrationPrepareInput,
  RegistrationPrepareResult,
} from "@fields/contracts/public/company";
import type {
  DesktopBrowserSetInput,
  DesktopBrowserStatus,
  DesktopBrowserTunnelStartResult,
} from "@fields/contracts/public/desktop-browser";
import type {
  AgentTurnSnapshot,
} from "@fields/contracts/public/agent-activity";
import { context, propagation, SpanStatusCode, trace } from "@opentelemetry/api";
import { initTRPC, TRPCError } from "@trpc/server";

import type {
  CommittedMembershipActorProjection,
  CreateCompanyDirectoryActorUseCase,
  GetCompanyDirectoryActorUseCase,
  ListCompanyDirectoryActorsUseCase,
  ListCompanyInvitationsUseCase,
  ProductSessionQuery,
  RemoveOrdinaryAgentUseCase,
  RequireActiveOrdinaryActorUseCase,
  RequireActiveHumanCompanyOwnerUseCase,
} from "../../application/actor/index.js";
import type {
  CreateCompanyUseCase,
  RetryCompanyOnboardingUseCase,
} from "../../application/company/commands/index.js";
import type {
  ReadCompanyOnboardingStatusUseCase,
} from "../../application/company/queries/index.js";
import type {
  AddRoomMemberUseCase,
  CreateRoomUseCase,
  ListRoomMembersUseCase,
  ListRoomsUseCase,
  RemoveRoomMemberUseCase,
  RoomAccessQuery,
} from "../../application/room/index.js";
import { ApplicationError } from "../../application/platform/errors.js";
import { emitObservabilityLog } from "../../observability/events.js";
import type {
  CompanyRuntimeCallbackRepository,
  CompanyRuntimePublicGateway,
  CompanyRuntimeStatusQuery,
  MemberExecutorAssignmentApplication,
} from "../../application/execution/ports/index.js";
import type { RoomMessageApplication } from "../../application/room/ports/index.js";
import type { ProductAuthContext } from "./product-session.js";
import type { ClientTelemetryContext } from "../http/client-telemetry.js";
import type {
  CompanyAssetApplication,
  MemberAssetApplication,
} from "../../application/company/ports/company-assets.js";
import type { CompanyFileApplication } from "../../application/company/ports/company-files.js";
import type { MailApplication } from "../../application/mail/index.js";
import type { AgentBuilderApplication } from "../../application/agent-builder/index.js";
import type { MemberMemoryApplication } from "../../application/member-memory/index.js";
import type { AssetBuilderApplication } from "../../application/asset-builder/index.js";
import type { RoomSideChatApplication } from "../../application/room-side-chat/index.js";
import type { ScheduledTaskApplication } from "../../application/scheduled-task/index.js";
import type { NotificationApplication } from "../../application/notification/index.js";

export type CompanyActorApplication = {
  createCompany: CreateCompanyUseCase;
  onboardingStatus: ReadCompanyOnboardingStatusUseCase;
  retryCompanyOnboarding: RetryCompanyOnboardingUseCase;
  listCompanyDirectoryActors: ListCompanyDirectoryActorsUseCase;
  listCompanyInvitations: ListCompanyInvitationsUseCase;
  getCompanyDirectoryActor: GetCompanyDirectoryActorUseCase;
  createCompanyDirectoryActor: CreateCompanyDirectoryActorUseCase;
  removeOrdinaryAgent: RemoveOrdinaryAgentUseCase;
  committedMembershipProjection: CommittedMembershipActorProjection;
  productSessionQuery: ProductSessionQuery;
  requireActiveOrdinaryActor: RequireActiveOrdinaryActorUseCase;
  requireActiveHumanCompanyOwner: RequireActiveHumanCompanyOwnerUseCase;
  isCompanyCreationAvailable: () => Promise<boolean>;
};

export type RoomApplication = {
  createRoom: CreateRoomUseCase;
  listRooms: ListRoomsUseCase;
  listRoomMembers: ListRoomMembersUseCase;
  addRoomMember: AddRoomMemberUseCase;
  removeRoomMember: RemoveRoomMemberUseCase;
  roomAccess: RoomAccessQuery;
};

export type PersonalExecutorApplication = {
  list(companyId: string, memberId: string): Promise<PersonalExecutorsListResult>;
  create(companyId: string, memberId: string, name: string, authorizationMethod: ExecutorAuthorizationMethod): Promise<PersonalExecutorMutationResult>;
  rename(companyId: string, memberId: string, executorId: string, name: string): Promise<PersonalExecutorMutationResult>;
  authorizationStart(companyId: string, memberId: string, executorId: string): Promise<ExecutorDeviceAuthorizationStartResult>;
  authorizationStatus(companyId: string, memberId: string, executorId: string, attemptId: string): Promise<ExecutorDeviceAuthorizationStatusResult>;
  authorizationCancel(companyId: string, memberId: string, executorId: string, attemptId: string): Promise<ExecutorDeviceAuthorizationCancelResult>;
  configureCustomAuthorization(companyId: string, memberId: string, input: ExecutorCustomApiConfigureInput): Promise<PersonalExecutorMutationResult>;
  modelCatalog(companyId: string, memberId: string, executorId: string): Promise<ExecutorModelCatalogResult>;
  validateModels(companyId: string, memberId: string, input: ExecutorModelValidationInput): Promise<ExecutorModelValidationResult>;
  modelPolicy(companyId: string, memberId: string, executorId: string): Promise<ExecutorModelPolicyResult>;
  configureModelPolicy(companyId: string, memberId: string, input: ExecutorModelPolicyUpdateInput): Promise<ExecutorModelPolicyResult>;
  disconnect(companyId: string, memberId: string, executorId: string): Promise<PersonalExecutorMutationResult>;
  setSharing(companyId: string, memberId: string, executorId: string, shared: boolean): Promise<PersonalExecutorMutationResult>;
  usage(companyId: string, memberId: string, executorId: string): Promise<PersonalExecutorUsageResult>;
  delete(companyId: string, memberId: string, executorId: string): Promise<ExecutorDeleteResult>;
  sharedPool(companyId: string, requestedByMemberId: string): Promise<CompanyExecutorSafeListResult>;
  governSharing(companyId: string, requestedByMemberId: string, executorId: string, blocked: boolean): Promise<CompanyExecutorSharingGovernanceResult>;
};

export type BackendTrpcContext = {
  authContext: ProductAuthContext;
  companyActors: CompanyActorApplication;
  rooms: RoomApplication;
  personalExecutors: PersonalExecutorApplication;
  memberExecutors: MemberExecutorAssignmentApplication;
  roomMessages: RoomMessageApplication;
  runtimeStatus: CompanyRuntimeStatusQuery;
  runtimeRepository: CompanyRuntimeCallbackRepository;
  runtime: CompanyRuntimePublicGateway;
  assets: CompanyAssetApplication;
  companyFiles: CompanyFileApplication;
  memberAssets: MemberAssetApplication;
  mail: MailApplication;
  agentBuilder: AgentBuilderApplication;
  memberMemory: MemberMemoryApplication;
  assetBuilder: AssetBuilderApplication;
  roomSideChat: RoomSideChatApplication;
  scheduledTasks: ScheduledTaskApplication;
  notifications: NotificationApplication;
  registration: {
    prepare(input: RegistrationPrepareInput): Promise<RegistrationPrepareResult>;
    claim(authUserId: string): Promise<RegistrationClaimResult>;
    hasPendingGrant(authUserId: string): Promise<boolean>;
    getSettings(companyId: string): Promise<CompanyRegistrationSettings>;
    rotate(companyId: string, actorId: string): Promise<CompanyRegistrationSettings>;
    setEnabled(companyId: string, actorId: string, enabled: boolean): Promise<CompanyRegistrationSettings>;
  };
  desktopBrowser: {
    status(companyId: string): Promise<DesktopBrowserStatus>;
    set(companyId: string, input: DesktopBrowserSetInput): Promise<DesktopBrowserStatus>;
    start(companyId: string, actorId: string, clientNonce: string): Promise<DesktopBrowserTunnelStartResult>;
  };
  agentRuntimeActivity: {
    project(input: {
      previous: AgentTurnSnapshot | null;
      event: unknown;
    }): {
      snapshot: AgentTurnSnapshot;
      interaction: import("@fields/contracts/public/room").RoomMessageInteraction | null;
      resolvedInteractionId: string | null;
    };
  };
  authorizationHeader?: string;
  traceparent?: string;
  clientTelemetry: ClientTelemetryContext;
};

const baseTrpc = initTRPC.context<BackendTrpcContext>().create();
const tracingMiddleware = baseTrpc.middleware(async ({ ctx, path, type, next }) => {
  const parent = ctx.traceparent
    ? propagation.extract(context.active(), { traceparent: ctx.traceparent })
    : context.active();
  return context.with(parent, async () => {
    const span = trace.getTracer("fields.backend.trpc").startSpan(`trpc.${type}`, {
      attributes: {
        "fields.procedure": path,
        "fields.client_kind": ctx.clientTelemetry.kind,
        "fields.client_version": ctx.clientTelemetry.version ?? undefined,
        "fields.runtime_release_sha": ctx.clientTelemetry.runtimeRelease ?? undefined,
      },
    });
    try {
      const downstream = await context.with(trace.setSpan(context.active(), span), () => next());
      const result = downstream.ok
        ? downstream
        : { ...downstream, error: publicTrpcError(downstream.error) };
      if (!result.ok) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        emitObservabilityLog("trpc.request.failed", {
          code: result.error.code,
          retryable: trpcErrorRetryable(result.error.code),
          "fields.procedure": path,
          "fields.client_kind": ctx.clientTelemetry.kind,
          "fields.client_version": ctx.clientTelemetry.version,
          "fields.runtime_release_sha": ctx.clientTelemetry.runtimeRelease,
        });
      }
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      publicError(error);
    } finally {
      span.end();
    }
  });
});

export const t = {
  ...baseTrpc,
  procedure: baseTrpc.procedure.use(tracingMiddleware),
};

function trpcErrorRetryable(code: TRPCError["code"]): boolean {
  return code === "INTERNAL_SERVER_ERROR"
    || code === "SERVICE_UNAVAILABLE"
    || code === "TIMEOUT";
}

export function requireCompanySession(ctx: BackendTrpcContext): ProductSession {
  if (!ctx.authContext.authSession) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication is required." });
  }
  if (!ctx.authContext.productSession) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No Company membership is available." });
  }
  return ctx.authContext.productSession;
}

export function requireProductSession(ctx: BackendTrpcContext): ProductSession {
  const session = requireCompanySession(ctx);
  if (session.company_status !== "active") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Company Runtime is not ready." });
  }
  return session;
}

export function requireAuthenticatedUserWithoutCompany(ctx: BackendTrpcContext) {
  if (!ctx.authContext.authSession) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication is required." });
  }
  if (ctx.authContext.productSession) {
    throw new TRPCError({ code: "CONFLICT", message: "This account already belongs to a Company." });
  }
  return ctx.authContext.authSession;
}

export function publicError(error: unknown): never {
  throw publicTrpcError(error);
}

function publicTrpcError(error: unknown): TRPCError {
  if (error instanceof TRPCError) {
    return error.cause instanceof ApplicationError ? publicTrpcError(error.cause) : error;
  }
  if (error instanceof ApplicationError) {
    const code = error.code.includes("ACCESS_DENIED") || error.code === "FORBIDDEN"
      ? "FORBIDDEN"
      : error.code.includes("NOT_FOUND")
        ? "NOT_FOUND"
        : error.code.includes("CONFLICT")
          ? "CONFLICT"
          : error.retryable
            ? "SERVICE_UNAVAILABLE"
            : "BAD_REQUEST";
    return new TRPCError({ code, message: error.code });
  }
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The request could not be completed." });
}

export function bearerToken(authorizationHeader: string | undefined): string {
  const match = /^Bearer ([^\s]+)$/u.exec(authorizationHeader ?? "");
  if (!match) throw new TRPCError({ code: "UNAUTHORIZED", message: "A runtime bearer token is required." });
  return match[1]!;
}
