import { ApplicationError, isApplicationError } from "../../platform/errors.js";
import type { Clock, OwnerUnitOfWork } from "../../platform/ports/index.js";
import type {
  CompanyCommandRepository,
  CompanyOwnerAuthorizationQuery,
} from "../ports/index.js";

export const COMPANY_ONBOARDING_RETRY_INVALID_CODE = "COMPANY_ONBOARDING_RETRY_INVALID";
export const COMPANY_ONBOARDING_RETRY_FORBIDDEN_CODE = "COMPANY_ONBOARDING_RETRY_FORBIDDEN";
export const COMPANY_ONBOARDING_RETRY_CONFLICT_CODE = "COMPANY_ONBOARDING_RETRY_CONFLICT";
export const COMPANY_ONBOARDING_RETRY_UNAVAILABLE_CODE = "COMPANY_ONBOARDING_RETRY_UNAVAILABLE";

export type RetryCompanyOnboardingInput = { companyId: string; actorId: string };
export interface RetryCompanyOnboardingUseCase {
  execute(input: RetryCompanyOnboardingInput): Promise<void>;
}

export type RetryCompanyOnboardingDependencies = {
  ownerAuthorization: CompanyOwnerAuthorizationQuery;
  companyCommands: Pick<CompanyCommandRepository, "beginRetry">;
  companyUnitOfWork: OwnerUnitOfWork;
  clock: Clock;
};

export class RetryCompanyOnboarding implements RetryCompanyOnboardingUseCase {
  constructor(private readonly dependencies: RetryCompanyOnboardingDependencies) {}

  async execute(input: RetryCompanyOnboardingInput): Promise<void> {
    if (!input.companyId || !input.actorId) {
      throw new ApplicationError(COMPANY_ONBOARDING_RETRY_INVALID_CODE, false);
    }
    try {
      await this.dependencies.ownerAuthorization.requireActiveOwner({
        actorId: input.actorId,
        companyId: input.companyId,
      });
      const nowMs = this.dependencies.clock.now();
      await this.dependencies.companyUnitOfWork.execute("company", async (transaction) => {
        await this.dependencies.companyCommands.beginRetry(
          transaction,
          input.companyId,
          nowMs,
        );
      });
    } catch (error) {
      if (isApplicationError(error)) throw error;
      throw new ApplicationError(COMPANY_ONBOARDING_RETRY_UNAVAILABLE_CODE, true);
    }
  }
}
