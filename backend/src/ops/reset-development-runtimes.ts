import { sql } from "drizzle-orm";

import type { BackendDatabase } from "../infrastructure/persistence/postgres/database-service.js";

export async function resetDevelopmentRuntimeState(
  database: BackendDatabase,
  nowMs = Date.now(),
): Promise<{ companyCount: number }> {
  return database.transaction(async (transaction) => {
    const companies = rowsFromResult<{ company_id: string }>(await transaction.execute(sql`
      delete from company_runtime_status returning company_id
    `));
    for (const company of companies) {
      await transaction.execute(sql`
        update company_onboarding_processes
        set stage = 'creatingRuntime', version = version + 1,
          last_error_code = null, last_error_retryable = null, updated_at_ms = ${nowMs}
        where company_id = ${company.company_id}
      `);
      await transaction.execute(sql`
        update companies set status = 'provisioning', updated_at_ms = ${nowMs}
        where id = ${company.company_id}
      `);
    }
    return { companyCount: companies.length };
  });
}

function rowsFromResult<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && "rows" in value) {
    const rows = (value as { rows?: unknown }).rows;
    return Array.isArray(rows) ? rows as T[] : [];
  }
  return [];
}
