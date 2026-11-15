import { defineConfig } from "drizzle-kit";

import { loadBackendEnvFiles, requireBackendDatabaseUrl } from "./src/infrastructure/configuration/env.js";

loadBackendEnvFiles();

export default defineConfig({
  schema: "./src/infrastructure/persistence/postgres/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: requireBackendDatabaseUrl()
  }
});
