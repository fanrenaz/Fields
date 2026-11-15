import { ApplicationError, isApplicationError } from "../../platform/errors.js";
import type { CompanyQueryRepository } from "../ports/index.js";

export const COMPANY_STATUS_INVALID_CODE = "COMPANY_STATUS_INVALID";
export const COMPANY_STATUS_NOT_FOUND_CODE = "COMPANY_STATUS_NOT_FOUND";
export const COMPANY_STATUS_UNAVAILABLE_CODE = "COMPANY_STATUS_UNAVAILABLE";

export type ReadCompanyStatusInput = {
  companyId: string;
};

export type CurrentCompanyStatus = {
  companyId: string;
  status: "provisioning" | "active" | "setup_failed";
};

export type ReadCompanyStatusDependencies = {
  companies: CompanyQueryRepository;
};

/**
 * Narrow Company-owned lifecycle read for other owners. It intentionally
 * exposes no organization, Actor, or onboarding-process data.
 */
export interface ReadCompanyStatusUseCase {
  execute(input: ReadCompanyStatusInput): Promise<CurrentCompanyStatus>;
}

export class ReadCompanyStatus implements ReadCompanyStatusUseCase {
  constructor(private readonly dependencies: ReadCompanyStatusDependencies) {}

  async execute(input: ReadCompanyStatusInput): Promise<CurrentCompanyStatus> {
    if (!isInput(input)) {
      throw invalid();
    }
    try {
      const company = await this.dependencies.companies.findById(input.companyId);
      if (company === null) {
        throw notFound();
      }
      if (
        company.id !== input.companyId
        || !isCompanyStatus(company.status)
      ) {
        throw unavailable();
      }
      return { companyId: company.id, status: company.status };
    } catch (error) {
      if (isApplicationError(error)) {
        if (
          error.code === COMPANY_STATUS_INVALID_CODE
          || error.code === COMPANY_STATUS_NOT_FOUND_CODE
          || error.code === COMPANY_STATUS_UNAVAILABLE_CODE
        ) {
          throw error;
        }
      }
      throw unavailable();
    }
  }
}

function isInput(value: unknown): value is ReadCompanyStatusInput {
  return isRecord(value) && isIdentifier(value.companyId);
}

function isCompanyStatus(value: unknown): value is CurrentCompanyStatus["status"] {
  return value === "provisioning" || value === "active" || value === "setup_failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function invalid(): ApplicationError {
  return new ApplicationError(COMPANY_STATUS_INVALID_CODE, false);
}

function notFound(): ApplicationError {
  return new ApplicationError(COMPANY_STATUS_NOT_FOUND_CODE, false);
}

function unavailable(): ApplicationError {
  return new ApplicationError(COMPANY_STATUS_UNAVAILABLE_CODE, true);
}
