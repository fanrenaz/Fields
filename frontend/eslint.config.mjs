import { createFieldsDesktopConfig } from "@fields/eslint-config";

export default createFieldsDesktopConfig({
  ignores: ["vendor/lobehub/**"],
  tsconfigRootDir: import.meta.dirname,
});
