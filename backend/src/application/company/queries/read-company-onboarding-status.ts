import type { CompanyStatus } from "../../../domain/company/index.js";
import { ApplicationError, isApplicationError } from "../../platform/errors.js";
import type {
  CompanyOnboardingStage,
  CompanyQueryRepository,
} from "../ports/index.js";

export const COMPANY_ONBOARDING_STATUS_NOT_FOUND_CODE = "COMPANY_ONBOARDING_STATUS_NOT_FOUND";
export const COMPANY_ONBOARDING_STATUS_INVALID_CODE = "COMPANY_ONBOARDING_STATUS_INVALID";
export const COMPANY_ONBOARDING_STATUS_UNAVAILABLE_CODE = "COMPANY_ONBOARDING_STATUS_UNAVAILABLE";

export type CompanyOnboardingStatusQueryInput = { companyId: string; isOwner: boolean };
export type CompanyOnboardingPublicError = { code: string; retryable: boolean };
export type CompanyOnboardingStatusView = {
  stage: CompanyOnboardingStage;
  company: { companyId: string; name: string; status: CompanyStatus };
  runtime: {
    runtimeId: string;
    status: "pending" | "provisioning" | "initializing" | "ready" | "failed";
    error: CompanyOnboardingPublicError | null;
  };
};

export interface ReadCompanyOnboardingStatusUseCase {
  execute(input: CompanyOnboardingStatusQueryInput): Promise<CompanyOnboardingStatusView>;
}

export type ReadCompanyOnboardingStatusDependencies = {
  companies: CompanyQueryRepository;
};

export class ReadCompanyOnboardingStatus implements ReadCompanyOnboardingStatusUseCase {
  constructor(private readonly dependencies: ReadCompanyOnboardingStatusDependencies) {}

  async execute(input: CompanyOnboardingStatusQueryInput): Promise<CompanyOnboardingStatusView> {
    if (!input.companyId) {
      throw new ApplicationError(COMPANY_ONBOARDING_STATUS_INVALID_CODE, false);
    }
    try {
      const [company, process] = await Promise.all([
        this.dependencies.companies.findById(input.companyId),
        this.dependencies.companies.readOnboarding(input.companyId),
      ]);
      if (!company || !process) {
        throw new ApplicationError(COMPANY_ONBOARDING_STATUS_NOT_FOUND_CODE, false);
      }
      const error = process.lastErrorCode === null
        ? null
        : {
          code: process.lastErrorCode,
          retryable: process.lastErrorRetryable === true,
        };
      return {
        stage: process.stage,
        company: {
          companyId: company.id,
          name: company.name,
          status: company.status,
        },
        runtime: {
          runtimeId: process.runtimeId,
          status: runtimeStatus(process.stage),
          error,
        },
      };
    } catch (error) {
      if (isApplicationError(error)) throw error;
      throw new ApplicationError(COMPANY_ONBOARDING_STATUS_UNAVAILABLE_CODE, true);
    }
  }
}

function runtimeStatus(stage: CompanyOnboardingStage): CompanyOnboardingStatusView["runtime"]["status"] {
  if (stage === "creatingRuntime") return "provisioning";
  if (stage === "initializingRuntime") return "initializing";
  if (stage === "ready") return "ready";
  return "failed";
}
