import { markFromDisplayName, type Actor } from "../../../domain/actor/index.js";
import type { Company } from "../../../domain/company/index.js";
import type { ActorCommandRepository, ActorQueryRepository } from "../../actor/ports/index.js";
import type {
  CreateCompanyCommand,
  CreateCompanyResult,
  CreateCompanyUseCase,
} from "../../company/commands/index.js";
import type {
  AuthOrganizationGateway,
  CompanyCommandRepository,
  CompanyCreationEligibilityQuery,
  CompanyOnboardingProcess,
} from "../../company/ports/index.js";
import { ApplicationError, isApplicationError } from "../../platform/errors.js";
import type {
  Clock,
  CreateCompanyUnitOfWork,
  IdGenerator,
} from "../../platform/ports/index.js";

export const COMPANY_NAME_INVALID_CODE = "COMPANY_NAME_INVALID";
export const COMPANY_CREATION_CONFLICT_CODE = "COMPANY_CREATION_CONFLICT";
export const COMPANY_CREATION_ELIGIBILITY_UNAVAILABLE_CODE = "COMPANY_CREATION_ELIGIBILITY_UNAVAILABLE";
export const COMPANY_AUTH_ORGANIZATION_UNAVAILABLE_CODE = "COMPANY_AUTH_ORGANIZATION_UNAVAILABLE";
export const COMPANY_OWNER_MEMBERSHIP_UNAVAILABLE_CODE = "COMPANY_OWNER_MEMBERSHIP_UNAVAILABLE";
export const COMPANY_CREATION_FAILED_CODE = "COMPANY_CREATION_FAILED";
export const COMPANY_ORGANIZATION_COMPENSATION_REQUIRED_CODE = "COMPANY_ORGANIZATION_COMPENSATION_REQUIRED";

export type CreateCompanyProcessDependencies = {
  eligibility: CompanyCreationEligibilityQuery;
  actorQueries: ActorQueryRepository;
  organizations: AuthOrganizationGateway;
  companyCommands: CompanyCommandRepository;
  actorCommands: ActorCommandRepository;
  createCompanyUnitOfWork: CreateCompanyUnitOfWork;
  ids: IdGenerator;
  clock: Clock;
};

/** Creates one Human owner and onboarding state that waits for the fixed Runtime. */
export class CreateCompanyProcess implements CreateCompanyUseCase {
  constructor(private readonly dependencies: CreateCompanyProcessDependencies) {}

  async execute(command: CreateCompanyCommand): Promise<CreateCompanyResult> {
    const name = requiredCompanyName(command.name);
    await this.assertEligible(command.ownerUserId);
    const ids = this.allocateIds();
    const nowMs = this.dependencies.clock.now();
    const ownerActor = createOwnerHumanActor({
      actorId: ids.ownerActorId,
      companyId: ids.companyId,
      authUserId: command.ownerUserId,
      displayName: ownerDisplayName(command.ownerDisplayName),
    });
    const schedulerActor = createSchedulerActor({
      actorId: ids.schedulerActorId,
      companyId: ids.companyId,
    });

    let organizationId: string | null = null;
    let phase: "organization" | "membership" | "product-transaction" = "organization";
    try {
      const organization = await this.dependencies.organizations.createOrganization({
        name,
        ownerUserId: command.ownerUserId,
      });
      organizationId = organization.organizationId;
      phase = "membership";
      const membership = await this.dependencies.organizations.resolveMembership({
        organizationId,
        userId: command.ownerUserId,
      });
      if (!membership || membership.role !== "owner") {
        throw new ApplicationError(COMPANY_OWNER_MEMBERSHIP_UNAVAILABLE_CODE, true);
      }

      phase = "product-transaction";
      const company: Company = {
        id: ids.companyId,
        name,
        status: "provisioning",
        authOrganizationId: organizationId,
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
      };
      const onboarding: CompanyOnboardingProcess = {
        companyId: ids.companyId,
        ownerActorId: ids.ownerActorId,
        runtimeId: ids.runtimeId,
        executorId: null,
        initialOperationId: ids.operationId,
        stage: "creatingRuntime",
        version: 1,
        lastErrorCode: null,
        lastErrorRetryable: null,
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
      };
      await this.dependencies.createCompanyUnitOfWork.execute(async (transaction) => {
        await this.dependencies.companyCommands.create(transaction.company, company);
        await this.dependencies.actorCommands.create(transaction.actor, ownerActor);
        await this.dependencies.actorCommands.create(transaction.actor, schedulerActor);
        await this.dependencies.companyCommands.createOnboardingProcess(transaction.company, onboarding);
      });
      return {
        company,
        ownerActorId: ownerActor.id,
        runtimeId: ids.runtimeId,
        executorId: null,
        operationId: ids.operationId,
      };
    } catch (error) {
      if (organizationId) await this.compensateOrganization(organizationId);
      if (phase === "organization" && await this.ownerBecameIneligible(command.ownerUserId)) {
        throw new ApplicationError(COMPANY_CREATION_CONFLICT_CODE, false);
      }
      throw normalizeCreationFailure(error, phase);
    }
  }

  private async assertEligible(ownerUserId: string): Promise<void> {
    try {
      const [companyId, actor, companyCreationAvailable] = await Promise.all([
        this.dependencies.eligibility.findCompanyIdForAuthUser(ownerUserId),
        this.dependencies.actorQueries.findByAuthUserId(ownerUserId),
        this.dependencies.eligibility.isCompanyCreationAvailable(),
      ]);
      if (companyId || actor || !companyCreationAvailable) {
        throw new ApplicationError(COMPANY_CREATION_CONFLICT_CODE, false);
      }
    } catch (error) {
      if (isApplicationError(error)) throw error;
      throw new ApplicationError(COMPANY_CREATION_ELIGIBILITY_UNAVAILABLE_CODE, true);
    }
  }

  private async ownerBecameIneligible(ownerUserId: string): Promise<boolean> {
    try {
      await this.assertEligible(ownerUserId);
      return false;
    } catch (error) {
      return isApplicationError(error) && error.code === COMPANY_CREATION_CONFLICT_CODE;
    }
  }

  private allocateIds() {
    return {
      companyId: this.dependencies.ids.next("company"),
      ownerActorId: this.dependencies.ids.next("actor"),
      schedulerActorId: this.dependencies.ids.next("actor"),
      runtimeId: this.dependencies.ids.next("runtime"),
      operationId: this.dependencies.ids.next("operation"),
    };
  }

  private async compensateOrganization(organizationId: string): Promise<void> {
    try {
      await this.dependencies.organizations.deleteOrganization(organizationId);
    } catch {
      throw new ApplicationError(COMPANY_ORGANIZATION_COMPENSATION_REQUIRED_CODE, false);
    }
  }
}

function requiredCompanyName(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 255) {
    throw new ApplicationError(COMPANY_NAME_INVALID_CODE, false);
  }
  return normalized;
}

function ownerDisplayName(value: string): string {
  const normalized = value.trim();
  return normalized && normalized.length <= 255 ? normalized : "Company Owner";
}

function createOwnerHumanActor(input: {
  actorId: string;
  companyId: string;
  authUserId: string;
  displayName: string;
}): Actor {
  return {
    id: input.actorId,
    companyId: input.companyId,
    type: "human",
    displayName: input.displayName,
    mark: markFromDisplayName(input.displayName),
    companyRole: "owner",
    status: "active",
    authUserId: input.authUserId,
  };
}

function createSchedulerActor(input: { actorId: string; companyId: string }): Actor {
  return {
    id: input.actorId,
    companyId: input.companyId,
    type: "human",
    displayName: "定时任务",
    mark: "定时",
    companyRole: "member",
    status: "active",
    authUserId: null,
    systemRole: "scheduler",
  };
}

function normalizeCreationFailure(
  error: unknown,
  phase: "organization" | "membership" | "product-transaction",
): ApplicationError {
  if (isApplicationError(error)) return error;
  if (phase === "organization") {
    return new ApplicationError(COMPANY_AUTH_ORGANIZATION_UNAVAILABLE_CODE, true);
  }
  if (phase === "membership") {
    return new ApplicationError(COMPANY_OWNER_MEMBERSHIP_UNAVAILABLE_CODE, true);
  }
  return new ApplicationError(COMPANY_CREATION_FAILED_CODE, true);
}
