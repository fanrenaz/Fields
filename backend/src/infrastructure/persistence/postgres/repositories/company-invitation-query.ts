import { sql } from "drizzle-orm";

import type {
  ActiveInvitationCompany,
  CompanyInvitationQuery,
} from "../../../../application/actor/ports/human-invitation-admission.js";
import type {
  CompanyInvitationOrganization,
  CompanyInvitationOrganizationQuery,
} from "../../../../application/actor/ports/company-invitation-directory.js";
import type { BackendDatabase } from "../database-service.js";

type ActiveCompanyRow = {
  company_id: unknown;
  company_name: unknown;
  auth_organization_id: unknown;
};

/**
 * Company-owned active Organization mapping for Human invitation admission.
 * It reads no Better Auth or Actor tables.
 */
export class PostgresCompanyInvitationQuery implements
  CompanyInvitationQuery,
  CompanyInvitationOrganizationQuery {
  constructor(private readonly db: BackendDatabase) {}

  async findActiveCompanyByAuthOrganizationId(organizationId: string): Promise<ActiveInvitationCompany | null> {
    try {
      if (!isAuthorityIdentifier(organizationId)) {
        throw unavailable();
      }
      const rows = rowsFromResult<ActiveCompanyRow>(await this.db.execute(sql`
        select
          id as company_id,
          name as company_name,
          auth_organization_id
        from companies
        where status = 'active'
          and auth_organization_id is not null
          and auth_organization_id = ${organizationId}
        limit 2
      `));
      if (rows.length !== 1) {
        return null;
      }
      return companyFromRow(rows[0], organizationId);
    } catch {
      throw unavailable();
    }
  }

  async findActiveOrganizationByCompanyId(
    companyId: string,
  ): Promise<CompanyInvitationOrganization | null> {
    try {
      if (!isCompanyIdentifier(companyId)) {
        throw unavailable();
      }
      const rows = rowsFromResult<ActiveCompanyRow>(await this.db.execute(sql`
        select
          id as company_id,
          name as company_name,
          auth_organization_id
        from companies
        where status = 'active'
          and id = ${companyId}
          and auth_organization_id is not null
        limit 2
      `));
      if (rows.length !== 1) {
        return null;
      }
      const row = rows[0];
      if (
        !row
        || row.company_id !== companyId
        || !isCompanyName(row.company_name)
        || !isAuthorityIdentifier(row.auth_organization_id)
      ) {
        throw unavailable();
      }
      return {
        companyId,
        companyName: row.company_name,
        organizationId: row.auth_organization_id,
      };
    } catch {
      throw unavailable();
    }
  }
}

function companyFromRow(
  row: ActiveCompanyRow | undefined,
  expectedOrganizationId: string,
): ActiveInvitationCompany | null {
  if (!row || !isCompanyIdentifier(row.company_id) || !isCompanyName(row.company_name)) {
    throw unavailable();
  }
  if (row.auth_organization_id !== expectedOrganizationId) {
    return null;
  }
  return {
    companyId: row.company_id,
    companyName: row.company_name,
  };
}

function rowsFromResult<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) {
      return rows as T[];
    }
  }
  throw unavailable();
}

function isAuthorityIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 512
    && value.trim() === value
    && !/[\r\n]/u.test(value);
}

function isCompanyIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 128
    && value.trim() === value
    && !/[\r\n]/u.test(value);
}

function isCompanyName(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= 255
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function unavailable(): Error {
  return new Error("Invitation company mapping is temporarily unavailable.");
}
