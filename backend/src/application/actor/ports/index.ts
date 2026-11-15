import type { Actor, ActorStatus } from "../../../domain/actor/index.js";
import type { OwnerTransaction } from "../../platform/ports/index.js";

export type {
  ActiveInvitationCompany,
  ActorInvitationHumanQuery,
  CompanyInvitationQuery,
  HumanInvitationAdmissionInvitation,
  InvitationAuthorityQuery,
  InvitationEmailAuthority,
  InvitationHumanActor,
} from "./human-invitation-admission.js";
export type {
  CompanyInvitationOrganization,
  CompanyInvitationOrganizationQuery,
  PendingCompanyMemberInvitation,
  PendingCompanyMemberInvitationQuery,
} from "./company-invitation-directory.js";

/**
 * Transaction-bound Actor writes. Reads used to decide a Human projection are
 * deliberately on this port so the adapter can lock the same authoritative
 * rows before it writes the Human projection and its Outbox event.
 */
export interface ActorCommandRepository {
  findHumanForReconciliation(transaction: OwnerTransaction, authUserId: string): Promise<Actor | null>;
  create(transaction: OwnerTransaction, actor: Actor): Promise<void>;
  updateHumanProjection(
    transaction: OwnerTransaction,
    input: {
      actorId: string;
      authUserId: string;
      companyId: string;
      displayName: string;
      mark: string;
      companyRole: "owner" | "member";
      status: ActorStatus;
      updatedAtMs: number;
    },
  ): Promise<Actor | null>;
  inactivate(transaction: OwnerTransaction, actorId: string, updatedAtMs: number): Promise<Actor | null>;
  removeOrdinaryAgent(transaction: OwnerTransaction, actorId: string, updatedAtMs: number): Promise<Actor | null>;
}

export interface ActorQueryRepository {
  findById(actorId: string): Promise<Actor | null>;
  findByAuthUserId(userId: string): Promise<Actor | null>;
  listByCompanyId(companyId: string): Promise<readonly Actor[]>;
}

/** Stable adapter failures for the isolated Actor Directory ports. */
export const ACTOR_DIRECTORY_ACCESS_DENIED_CODE = "ACTOR_DIRECTORY_ACCESS_DENIED";
export const ACTOR_DIRECTORY_DATA_INVALID_CODE = "ACTOR_DIRECTORY_DATA_INVALID";
export const ACTOR_DIRECTORY_CONFLICT_CODE = "ACTOR_DIRECTORY_CONFLICT";
export const ACTOR_DIRECTORY_UNAVAILABLE_CODE = "ACTOR_DIRECTORY_UNAVAILABLE";

export type ActiveHumanDirectoryCaller = {
  actorId: string;
  companyId: string;
  companyRole: "owner" | "member";
};

/**
 * Actor-owned directory read boundary. It exposes only active Actor facts;
 * Company activation remains a Company-side query.
 */
export interface ActorDirectoryQueryRepository {
  requireActiveHumanCaller(input: {
    actorId: string;
    companyId: string;
  }): Promise<ActiveHumanDirectoryCaller>;
  listActiveActors(companyId: string): Promise<readonly Actor[]>;
  findActiveActor(input: { actorId: string; companyId: string }): Promise<Actor | null>;
}

/** Safe, provider-neutral identity projection for cross-owner member views. */
export type ActiveOrdinaryActorProfile = {
  actorId: string;
  companyId: string;
  displayName: string;
  mark: string;
  actorType: "human" | "agent";
};

/**
 * Actor-owned batch profile query. It has no Room dependency and omits any
 * requested ID that is no longer an active Actor.
 */
export interface ActorDirectoryProfileQuery {
  listActiveOrdinaryProfiles(input: {
    companyId: string;
    actorIds: readonly string[];
  }): Promise<readonly ActiveOrdinaryActorProfile[]>;
}

/**
 * Actor-owned directory mutation boundary. Removal reads lock the target in
 * the same Actor UoW as the subsequent ordinary-Agent transition.
 */
export interface ActorDirectoryCommandRepository {
  createOrdinaryAgent(
    transaction: OwnerTransaction,
    actor: Actor,
    createdAtMs: number,
  ): Promise<Actor | null>;
  findActorForRemoval(
    transaction: OwnerTransaction,
    input: { actorId: string; companyId: string },
  ): Promise<Actor | null>;
  deactivateOrdinaryAgent(
    transaction: OwnerTransaction,
    input: { actorId: string; companyId: string; updatedAtMs: number },
  ): Promise<Actor | null>;
}

/**
 * The only Directory path to a Human email. It never exposes Auth-provider
 * records or credentials and is called solely for already selected Humans.
 */
export interface HumanActorEmailQuery {
  findEmailsByAuthUserIds(authUserIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

export type ActiveActorAccess = {
  actorId: string;
  companyId: string;
  companyRole: "owner" | "member";
};

/** Cross-owner Actor authorization projection. */
export interface ActorAccessQuery {
  requireActiveActor(input: { actorId: string; companyId: string }): Promise<ActiveActorAccess>;
}

export type ProductSessionActor = {
  actorId: string;
  companyId: string;
  companyRole: "owner" | "member";
  displayName: string;
  actorType: "human";
  companyStatus: "provisioning" | "active" | "setup_failed";
};

/**
 * A repair attempt is deliberately narrow and provider-neutral. It can read
 * the authoritative Better Auth membership and invoke reconciliation, but it
 * must not return a session or grant access by itself.
 */
export interface ProductSessionProjectionRepair {
  repair(input: { authUserId: string; activeOrganizationId: string }): Promise<void>;
}

/**
 * The narrow Better Auth authority proof required only when a verified
 * session has no active Organization selected. It returns no provider record
 * and cannot create or repair an Actor projection.
 */
export interface ProductSessionMembershipAuthority {
  resolveMembership(input: {
    organizationId: string;
    userId: string;
  }): Promise<{ role: "owner" | "member" } | null>;
}

/**
 * Provider-neutral post-commit membership boundary. The auth interface calls
 * this only after its membership mutation has committed; the implementation
 * rereads authoritative identity, membership, and Company mapping facts.
 */
export type CommittedMembershipProjectionInput = {
  authUserId: string;
  organizationId: string;
};

export interface CommittedMembershipActorProjection {
  reconcileAcceptedMembership(input: CommittedMembershipProjectionInput): Promise<void>;
  reconcileRemovedMembership(input: CommittedMembershipProjectionInput): Promise<void>;
}

export interface ProductSessionQuery {
  resolveVerifiedSession(input: { authUserId: string; activeOrganizationId: string | null }): Promise<ProductSessionActor | null>;
}
