#!/usr/bin/env node

import {
  createBackendDatabaseService,
} from "../infrastructure/persistence/postgres/database-service.js";
import { resetDevelopmentRuntimeState } from "./reset-development-runtimes.js";

const expectedScope = "fields-dev";

async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (env.FIELDS_DEV_RESET_RUNTIME_STATE !== "true") {
    process.stdout.write("[dev-runtime-reset] Existing running development stack retained.\n");
    return;
  }
  if (env.FIELDS_DEV_RESOURCE_SCOPE !== expectedScope) {
    throw new Error(`FIELDS_DEV_RESOURCE_SCOPE must be ${expectedScope}.`);
  }

  const database = createBackendDatabaseService();
  try {
    const result = await resetDevelopmentRuntimeState(database.db);
    process.stdout.write(
      `[dev-runtime-reset] Reset ${result.companyCount} persisted Runtime projection(s).\n`,
    );
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  process.stderr.write(
    `[dev-runtime-reset] ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
