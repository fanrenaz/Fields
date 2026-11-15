import type { Company } from "../../../domain/company/index.js";

export type CreateCompanyCommand = {
  name: string;
  ownerUserId: string;
  ownerDisplayName: string;
};

export type CreateCompanyResult = {
  company: Company;
  ownerActorId: string;
  runtimeId: string;
  executorId: null;
  operationId: string;
};

export interface CreateCompanyUseCase {
  execute(command: CreateCompanyCommand): Promise<CreateCompanyResult>;
}

export {
  COMPANY_ONBOARDING_RETRY_CONFLICT_CODE,
  COMPANY_ONBOARDING_RETRY_FORBIDDEN_CODE,
  COMPANY_ONBOARDING_RETRY_INVALID_CODE,
  COMPANY_ONBOARDING_RETRY_UNAVAILABLE_CODE,
  RetryCompanyOnboarding,
  type RetryCompanyOnboardingDependencies,
  type RetryCompanyOnboardingInput,
  type RetryCompanyOnboardingUseCase,
} from "./retry-company-onboarding.js";
