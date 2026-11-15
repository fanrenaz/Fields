import type { Company, CompanyStatus } from "../../../domain/company/index.js";
import type { OwnerTransaction } from "../../platform/ports/index.js";

export type CompanyOnboardingStage =
  | "creatingRuntime"
  | "initializingRuntime"
  | "failed"
  | "ready";

export type CompanyOnboardingProcess = {
  companyId: string;
  ownerActorId: string;
  runtimeId: string;
  executorId: string | null;
  initialOperationId: string;
  stage: CompanyOnboardingStage;
  version: number;
  lastErrorCode: string | null;
  lastErrorRetryable: boolean | null;
  createdAtMs: number;
  updatedAtMs: number;
};

/**
 * The Company-owned, persisted projection of current Execution setup facts.
 * It is deliberately named for this use case: it is not a general-purpose
 * cross-owner write capability.
 */
export type CompanySetupProjection = {
  companyId: string;
  status: CompanyStatus;
  stage: CompanyOnboardingStage;
  errorCode: string | null;
  errorRetryable: boolean | null;
  updatedAtMs: number;
};

export type CompanySetupProjectionResult = "projected" | "unchanged" | "ignored";

/**
 * Atomically updates the Company public status and its onboarding projection.
 * Implementations must only act while the Company is still provisioning.
 */
export interface CompanySetupProjectionCommandRepository {
  projectCurrentSetup(
    transaction: OwnerTransaction,
    projection: CompanySetupProjection,
  ): Promise<CompanySetupProjectionResult>;
}

/** Writes that belong to the Company side of the one approved cross-owner UoW. */
export interface CompanyCommandRepository {
  create(transaction: OwnerTransaction, company: Company): Promise<void>;
  createOnboardingProcess(transaction: OwnerTransaction, process: CompanyOnboardingProcess): Promise<void>;
  transitionStatus(
    transaction: OwnerTransaction,
    companyId: string,
    status: CompanyStatus,
    updatedAtMs: number,
  ): Promise<Company | null>;
  markSetupFailure(
    transaction: OwnerTransaction,
    companyId: string,
    errorCode: string,
    retryable: boolean,
    updatedAtMs: number,
  ): Promise<void>;
  /**
   * Compare-and-set the terminal Company/process pair from
   * setup_failed/failed to provisioning/creatingRuntime and clear its failure
   * metadata. A non-terminal Company is an idempotent no-op.
   */
  beginRetry(transaction: OwnerTransaction, companyId: string, updatedAtMs: number): Promise<CompanyOnboardingProcess | null>;
}

export interface CompanyQueryRepository {
  findById(companyId: string): Promise<Company | null>;
  findByAuthOrganizationId(organizationId: string): Promise<Company | null>;
  readOnboarding(companyId: string): Promise<CompanyOnboardingProcess | null>;
}

export type ActiveCompanyAccess = {
  companyId: string;
  status: "active";
};

/** Cross-owner callers use this narrow query, never a Company repository. */
export interface CompanyAccessQuery {
  requireActiveCompany(companyId: string): Promise<ActiveCompanyAccess>;
}

/**
 * Company commands authorize an owner through this local projection rather
 * than depending on Actor's repository or Port. Composition adapts Actor's
 * public access query at the owner boundary.
 */
export type ActiveCompanyOwnerAccess = {
  actorId: string;
  companyId: string;
};

export interface CompanyOwnerAuthorizationQuery {
  requireActiveOwner(input: { actorId: string; companyId: string }): Promise<ActiveCompanyOwnerAccess>;
}

/**
 * Company creation must reject a pre-existing product association before it
 * creates a Better Auth Organization. Implementations may compose the mapped
 * Company and authoritative membership facts, but expose no Auth SDK types.
 */
export interface CompanyCreationEligibilityQuery {
  findCompanyIdForAuthUser(authUserId: string): Promise<string | null>;
  isCompanyCreationAvailable(): Promise<boolean>;
}

export type ProductSessionCompany = {
  companyId: string;
  authOrganizationId: string;
  status: CompanyStatus;
};

/** The only Company fact Actor needs to form a Product Session projection. */
export interface CompanyProductSessionQuery {
  findForProductSession(companyId: string): Promise<ProductSessionCompany | null>;
}

export interface AuthOrganizationGateway {
  createOrganization(input: { name: string; ownerUserId: string }): Promise<{ organizationId: string }>;
  deleteOrganization(organizationId: string): Promise<void>;
  resolveMembership(input: { organizationId: string; userId: string }): Promise<{ role: "owner" | "member" } | null>;
}

export * from "./company-assets.js";
