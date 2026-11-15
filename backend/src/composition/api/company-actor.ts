import { randomUUID } from "node:crypto";

import {
  CreateCompanyDirectoryActor,
  RemoveOrdinaryAgent,
  ReconcileHumanActor,
  ReconcileRemovedHuman,
  type CreateCompanyDirectoryActorUseCase,
  type RemoveOrdinaryAgentUseCase,
  type ReconcileHumanActorUseCase,
  type ReconcileRemovedHumanUseCase,
} from "../../application/actor/commands/index.js";
import {
  GetCompanyDirectoryActor,
  ListActiveOrdinaryActorProfiles,
  ListCompanyInvitations,
  ListCompanyDirectoryActors,
  RequireActiveHumanCompanyOwner,
  RequireActiveOrdinaryActor,
  ResolveProductSessionActorQuery,
  type GetCompanyDirectoryActorUseCase,
  type ListActiveOrdinaryActorProfilesUseCase,
  type ListCompanyInvitationsUseCase,
  type ListCompanyDirectoryActorsUseCase,
  type ProductSessionQuery,
  type RequireActiveHumanCompanyOwnerUseCase,
  type RequireActiveOrdinaryActorUseCase,
} from "../../application/actor/queries/index.js";
import type { CommittedMembershipActorProjection } from "../../application/actor/ports/index.js";
import type { CompanyAccessQuery } from "../../application/company/ports/index.js";
import {
  COMPANY_ONBOARDING_RETRY_FORBIDDEN_CODE,
  COMPANY_ONBOARDING_RETRY_UNAVAILABLE_CODE,
  RetryCompanyOnboarding,
  type CreateCompanyUseCase,
  type RetryCompanyOnboardingUseCase,
} from "../../application/company/commands/index.js";
import { ApplicationError } from "../../application/platform/errors.js";
import type { IdGenerator } from "../../application/platform/ports/index.js";
import {
  ReadCompanyStatus,
  ReadCompanyOnboardingStatus,
  type ReadCompanyStatusUseCase,
  type ReadCompanyOnboardingStatusUseCase,
} from "../../application/company/queries/index.js";
import { CreateCompanyProcess } from "../../application/processes/company-onboarding/index.js";
import {
  BetterAuthOrganizationGateway,
  BetterAuthCommittedMembershipProjection,
  BetterAuthInvitationAuthorityQuery,
  BetterAuthProductSessionProjectionRepair,
  type BetterAuthOrganizationApi,
} from "../../infrastructure/auth/better-auth/index.js";
import { SystemClock, UuidIdGenerator } from "../../infrastructure/configuration/index.js";
import {
  PostgresActorDirectoryRepository,
  PostgresActorRepository,
  PostgresCompanyRepository,
  PostgresCompanyInvitationQuery,
  PostgresHumanActorEmailQuery,
} from "../../infrastructure/persistence/postgres/repositories/index.js";
import {
  PostgresCreateCompanyUnitOfWork,
  PostgresOwnerUnitOfWork,
  postgresTransactionForOwner,
} from "../../infrastructure/persistence/postgres/unit-of-work/index.js";
import type { BackendDatabase } from "../../infrastructure/persistence/postgres/database-service.js";

export type CompanyActorApplicationDependencies = {
  database: BackendDatabase;
  auth: BetterAuthOrganizationApi;
  internalCompanyId: string;
  nextOrganizationSlug?: () => string;
};

/**
 * The provider-neutral Application surface that API transport migration uses
 * for Company creation, committed-membership reconciliation, and Product
 * Session resolution. Provider and PostgreSQL objects remain composition-only.
 */
export type CompanyActorApplication = {
  createCompany: CreateCompanyUseCase;
  onboardingStatus: ReadCompanyOnboardingStatusUseCase;
  retryCompanyOnboarding: RetryCompanyOnboardingUseCase;
  readCompanyStatus: ReadCompanyStatusUseCase;
  listCompanyDirectoryActors: ListCompanyDirectoryActorsUseCase;
  listCompanyInvitations: ListCompanyInvitationsUseCase;
  getCompanyDirectoryActor: GetCompanyDirectoryActorUseCase;
  createCompanyDirectoryActor: CreateCompanyDirectoryActorUseCase;
  removeOrdinaryAgent: RemoveOrdinaryAgentUseCase;
  listActiveOrdinaryActorProfiles: ListActiveOrdinaryActorProfilesUseCase;
  requireActiveOrdinaryActor: RequireActiveOrdinaryActorUseCase;
  requireActiveHumanCompanyOwner: RequireActiveHumanCompanyOwnerUseCase;
  reconcileHumanActor: ReconcileHumanActorUseCase;
  reconcileRemovedHuman: ReconcileRemovedHumanUseCase;
  committedMembershipProjection: CommittedMembershipActorProjection;
  companyAccess: CompanyAccessQuery;
  productSessionQuery: ProductSessionQuery;
  isCompanyCreationAvailable: () => Promise<boolean>;
};

export function createCompanyActorApplication(
  dependencies: CompanyActorApplicationDependencies,
): CompanyActorApplication {
  const clock = new SystemClock();
  const generatedIds = new UuidIdGenerator();
  const ids: IdGenerator = {
    next: (kind) => kind === "company"
      ? requiredInternalCompanyId(dependencies.internalCompanyId)
      : generatedIds.next(kind),
  };
  const ownerUnitOfWork = new PostgresOwnerUnitOfWork(dependencies.database);
  const createCompanyUnitOfWork = new PostgresCreateCompanyUnitOfWork(dependencies.database);
  const actors = new PostgresActorRepository(dependencies.database, postgresTransactionForOwner);
  const actorDirectory = new PostgresActorDirectoryRepository(
    dependencies.database,
    postgresTransactionForOwner,
  );
  const humanActorEmails = new PostgresHumanActorEmailQuery(dependencies.database);
  const companies = new PostgresCompanyRepository(
    dependencies.database,
    postgresTransactionForOwner,
  );
  const invitationCompanies = new PostgresCompanyInvitationQuery(dependencies.database);
  const invitationAuthority = new BetterAuthInvitationAuthorityQuery(dependencies.database);
  const onboardingStatus = new ReadCompanyOnboardingStatus({
    companies,
  });
  const readCompanyStatus = new ReadCompanyStatus({ companies });
  const organizations = new BetterAuthOrganizationGateway(
    dependencies.auth,
    dependencies.database,
    dependencies.nextOrganizationSlug ?? defaultOrganizationSlug,
  );
  const reconcileHumanActor = new ReconcileHumanActor({
    actorCommands: actors,
    actorUnitOfWork: ownerUnitOfWork,
    ids,
    clock,
  });
  const reconcileRemovedHuman = new ReconcileRemovedHuman({
    actorCommands: actors,
    actorUnitOfWork: ownerUnitOfWork,
    ids,
    clock,
  });
  const committedMembershipProjection = new BetterAuthCommittedMembershipProjection(
    dependencies.database,
    reconcileHumanActor,
    reconcileRemovedHuman,
  );
  const productSessionRepair = new BetterAuthProductSessionProjectionRepair(
    dependencies.database,
    reconcileHumanActor,
  );
  const directoryAccess = { companies, directory: actorDirectory };
  const directoryCommands = {
    ...directoryAccess,
    commands: actorDirectory,
    actorUnitOfWork: ownerUnitOfWork,
    ids,
    clock,
  };
  const requireActiveHumanCompanyOwner = new RequireActiveHumanCompanyOwner({
    directory: actorDirectory,
  });
  const retryOnboardingOwner = {
    async requireActiveOwner(input: { actorId: string; companyId: string }) {
      try {
        return await requireActiveHumanCompanyOwner.execute({
          companyId: input.companyId,
          requestedByActorId: input.actorId,
        });
      } catch (error) {
        if (
          error instanceof ApplicationError
          && (error.code === "COMPANY_DIRECTORY_UNAUTHENTICATED" || error.code === "COMPANY_OWNER_REQUIRED")
        ) {
          throw new ApplicationError(COMPANY_ONBOARDING_RETRY_FORBIDDEN_CODE, false);
        }
        throw new ApplicationError(COMPANY_ONBOARDING_RETRY_UNAVAILABLE_CODE, true);
      }
    },
  };
  return {
    createCompany: new CreateCompanyProcess({
      eligibility: companies,
      actorQueries: actors,
      organizations,
      companyCommands: companies,
      actorCommands: actors,
      createCompanyUnitOfWork,
      ids,
      clock,
    }),
    onboardingStatus,
    retryCompanyOnboarding: new RetryCompanyOnboarding({
      ownerAuthorization: retryOnboardingOwner,
      companyCommands: companies,
      companyUnitOfWork: ownerUnitOfWork,
      clock,
    }),
    readCompanyStatus,
    listCompanyDirectoryActors: new ListCompanyDirectoryActors({
      ...directoryAccess,
      humanEmails: humanActorEmails,
    }),
    listCompanyInvitations: new ListCompanyInvitations({
      ownerAuthorization: requireActiveHumanCompanyOwner,
      companies: invitationCompanies,
      invitations: invitationAuthority,
      now: Date.now,
    }),
    getCompanyDirectoryActor: new GetCompanyDirectoryActor({
      ...directoryAccess,
      humanEmails: humanActorEmails,
    }),
    createCompanyDirectoryActor: new CreateCompanyDirectoryActor(directoryCommands),
    removeOrdinaryAgent: new RemoveOrdinaryAgent(directoryCommands),
    listActiveOrdinaryActorProfiles: new ListActiveOrdinaryActorProfiles({
      profiles: actorDirectory,
    }),
    requireActiveOrdinaryActor: new RequireActiveOrdinaryActor({
      profiles: actorDirectory,
    }),
    requireActiveHumanCompanyOwner,
    reconcileHumanActor,
    reconcileRemovedHuman,
    committedMembershipProjection,
    companyAccess: companies,
    productSessionQuery: new ResolveProductSessionActorQuery({
      actors,
      companies,
      memberships: organizations,
      repair: productSessionRepair,
    }),
    isCompanyCreationAvailable: () => companies.isCompanyCreationAvailable(),
  };
}

function requiredInternalCompanyId(value: string): string {
  const normalized = value.trim();
  if (!/^company_[A-Za-z0-9._:-]{1,119}$/u.test(normalized)) {
    throw new Error("FIELDS_INTERNAL_COMPANY_ID is invalid.");
  }
  return normalized;
}

function defaultOrganizationSlug(): string {
  return `company-${randomUUID()}`;
}
