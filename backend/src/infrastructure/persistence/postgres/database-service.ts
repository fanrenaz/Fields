import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import { backendDatabaseUrlFromEnv, postgresDriverUrl, requireBackendDatabaseUrl } from "../../configuration/env.js";

export type BackendDatabase = NodePgDatabase;

export type BackendDatabaseService = {
  db: BackendDatabase;
  pool: Pool;
  close: () => Promise<void>;
};

export type BackendDatabaseServiceOptions = {
  databaseUrl?: string | null;
  pool?: PoolConfig;
};

export function createBackendDatabaseService(
  options: BackendDatabaseServiceOptions = {},
): BackendDatabaseService {
  const databaseUrl = databaseUrlFromOptions(options);
  const pool = new Pool({
    connectionString: databaseUrl,
    ...(options.pool ?? {}),
  });
  return {
    db: drizzle(pool),
    pool,
    close: () => pool.end(),
  };
}

export function backendDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  return backendDatabaseUrlFromEnv(env);
}

function databaseUrlFromOptions(options: BackendDatabaseServiceOptions): string {
  const databaseUrl = options.databaseUrl ?? requireBackendDatabaseUrl();
  return postgresDriverUrl(databaseUrl);
}
