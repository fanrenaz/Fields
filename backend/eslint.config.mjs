import { createFieldsBackendConfig } from "@fields/eslint-config";

export default createFieldsBackendConfig({
  tsconfigRootDir: import.meta.dirname,
  ignores: ["drizzle.config.ts"],
});
