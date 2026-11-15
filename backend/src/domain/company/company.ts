export const companyStatuses = ["provisioning", "active", "setup_failed"] as const;

export type CompanyStatus = typeof companyStatuses[number];

export type Company = {
  id: string;
  name: string;
  status: CompanyStatus;
  authOrganizationId: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type CompanyStatusTransition = {
  from: CompanyStatus;
  to: CompanyStatus;
};

/**
 * The Company lifecycle is deliberately smaller than the execution lifecycle.
 * Execution may retry its work, but it is the Company Owner that exposes the
 * final provisioning status to the product.
 */
export function canTransitionCompanyStatus(from: CompanyStatus, to: CompanyStatus): boolean {
  if (from === to) {
    return true;
  }

  return (from === "provisioning" && (to === "active" || to === "setup_failed"))
    || (from === "setup_failed" && to === "provisioning");
}

export function transitionCompanyStatus(
  company: Company,
  nextStatus: CompanyStatus,
  updatedAtMs: number,
): Company {
  if (!canTransitionCompanyStatus(company.status, nextStatus)) {
    throw new CompanyStatusTransitionError({ from: company.status, to: nextStatus });
  }
  if (company.status === nextStatus) {
    return company;
  }

  return {
    ...company,
    status: nextStatus,
    updatedAtMs,
  };
}

export class CompanyStatusTransitionError extends Error {
  constructor(readonly transition: CompanyStatusTransition) {
    super(`Company status cannot transition from ${transition.from} to ${transition.to}.`);
    this.name = "CompanyStatusTransitionError";
  }
}
