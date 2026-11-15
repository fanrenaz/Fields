import assert from "node:assert/strict";
import test from "node:test";

import type { Company } from "../../../../../src/domain/company/index.js";
import { ApplicationError } from "../../../../../src/application/platform/errors.js";
import type { CompanyQueryRepository } from "../../../../../src/application/company/ports/index.js";

import {
  COMPANY_STATUS_INVALID_CODE,
  COMPANY_STATUS_NOT_FOUND_CODE,
  COMPANY_STATUS_UNAVAILABLE_CODE,
  ReadCompanyStatus,
} from "../../../../../src/application/company/queries/read-company-status.js";

test("Company status query returns only the current lifecycle fact", async () => {
  const companies = new RecordingCompanies(company({ status: "active" }));
  const query = new ReadCompanyStatus({ companies });

  assert.deepEqual(await query.execute({ companyId: "company_one" }), {
    companyId: "company_one",
    status: "active",
  });
  assert.deepEqual(companies.inputs, ["company_one"]);
});

test("Company status query rejects invalid or absent Company facts", async () => {
  const invalid = new ReadCompanyStatus({ companies: new RecordingCompanies(company()) });
  await assert.rejects(invalid.execute({ companyId: "" }), applicationError(COMPANY_STATUS_INVALID_CODE, false));

  const missing = new ReadCompanyStatus({ companies: new RecordingCompanies(null) });
  await assert.rejects(missing.execute({ companyId: "company_one" }), applicationError(COMPANY_STATUS_NOT_FOUND_CODE, false));

  const inconsistent = new ReadCompanyStatus({
    companies: new RecordingCompanies(company({ id: "company_other" })),
  });
  await assert.rejects(
    inconsistent.execute({ companyId: "company_one" }),
    applicationError(COMPANY_STATUS_UNAVAILABLE_CODE, true),
  );
});

test("Company status query redacts persistence failures", async () => {
  const secret = "postgres://company-status-secret.example/fields";
  const query = new ReadCompanyStatus({
    companies: new RecordingCompanies(null, new Error(secret)),
  });

  await assert.rejects(
    query.execute({ companyId: "company_one" }),
    (error: unknown) => error instanceof ApplicationError
      && error.code === COMPANY_STATUS_UNAVAILABLE_CODE
      && error.retryable === true
      && !error.message.includes(secret)
      && !("cause" in error),
  );
});

class RecordingCompanies implements CompanyQueryRepository {
  readonly inputs: string[] = [];

  constructor(private readonly current: Company | null, private readonly failure: Error | null = null) {}

  async findById(companyId: string): Promise<Company | null> {
    this.inputs.push(companyId);
    if (this.failure !== null) {
      throw this.failure;
    }
    return this.current;
  }

  async findByAuthOrganizationId(): Promise<Company | null> {
    return null;
  }

  async readOnboarding() {
    return null;
  }
}

function company(overrides: Partial<Company> = {}): Company {
  return {
    id: "company_one",
    name: "Fields",
    status: "provisioning",
    authOrganizationId: "organization_one",
    createdAtMs: 1,
    updatedAtMs: 1,
    ...overrides,
  };
}

function applicationError(code: string, retryable: boolean): (error: unknown) => boolean {
  return (error: unknown) => error instanceof ApplicationError
    && error.code === code
    && error.retryable === retryable;
}
