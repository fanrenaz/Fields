import assert from "node:assert/strict";
import test from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

import {
  resetDevelopmentRuntimeState,
} from "../../../src/ops/reset-development-runtimes.js";

test("development Runtime reset clears status and returns onboarding to discovery", async () => {
  const dialect = new PgDialect();
  const queries: Array<{ params: unknown[]; sql: string }> = [];
  const database = {
    transaction: async (callback: (transaction: {
      execute: (query: unknown) => Promise<unknown>;
    }) => Promise<unknown>) => callback({
      execute: async (query: unknown) => {
        const compiled = dialect.sqlToQuery(query as never);
        queries.push({ params: compiled.params, sql: compiled.sql.replaceAll(/\s+/gu, " ").trim() });
        if (queries.length === 1) {
          return [{
            company_id: "company-1",
          }];
        }
        return [];
      },
    }),
  };

  const result = await resetDevelopmentRuntimeState(database as never, 1234);

  assert.deepEqual(result, { companyCount: 1 });
  assert.equal(queries.length, 3);
  assert.match(queries[0]!.sql, /delete from company_runtime_status returning company_id/u);
  assert.match(queries[1]!.sql, /update company_onboarding_processes.*stage = 'creatingRuntime'/u);
  assert.match(queries[2]!.sql, /update companies set status = 'provisioning'/u);
  assert.equal(queries.slice(1).every(({ params }) => params.includes(1234)), true);
});
