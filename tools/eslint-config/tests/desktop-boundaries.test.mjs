import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

import { createFieldsDesktopConfig } from "../index.js";

const fixtureRoot = fileURLToPath(new URL("./fixtures/desktop-boundaries/", import.meta.url));

async function lint(files) {
  const eslint = new ESLint({
    cwd: fixtureRoot,
    overrideConfigFile: true,
    overrideConfig: createFieldsDesktopConfig({ tsconfigRootDir: fixtureRoot }),
  });

  return eslint.lintFiles(files);
}

function messagesFor(results, relativeFile) {
  const result = results.find((entry) => path.relative(fixtureRoot, entry.filePath) === relativeFile);
  assert.ok(result, `Expected lint result for ${relativeFile}`);
  return result.messages;
}

function assertBoundaryError(results, relativeFile) {
  assert.ok(
    messagesFor(results, relativeFile).some((message) => message.ruleId === "boundaries/dependencies"),
    `Expected boundaries/dependencies for ${relativeFile}`,
  );
}

function assertRestrictedImportError(results, relativeFile) {
  assert.ok(
    messagesFor(results, relativeFile).some((message) => message.ruleId === "no-restricted-imports"),
    `Expected no-restricted-imports for ${relativeFile}`,
  );
}

test("Desktop boundary configuration accepts the approved dependencies", async () => {
  const results = await lint([
    "app/allowed.ts",
    "app/from-approved-contracts.ts",
    "data/allowed-i18n.ts",
    "data/allowed-types.ts",
    "features/allowed.ts",
    "tests/allowed.ts",
  ]);

  assert.deepEqual(results.flatMap((result) => result.messages), []);
});

test("Desktop contracts imports reject internal, generated, root, and unapproved router surfaces", async () => {
  const files = [
    "app/from-codex-protocol.ts",
    "app/from-contracts-root.ts",
    "app/from-internal-contracts.ts",
    "app/from-unapproved-contracts-router.ts",
  ];
  const results = await lint(files);

  for (const file of files) assertRestrictedImportError(results, file);
});

test("Desktop boundary configuration rejects prohibited dependencies", async () => {
  const results = await lint([
    "data/from-app.ts",
    "data/from-feature.ts",
    "data/from-shared-platform.ts",
    "data/from-shared-ui.ts",
    "features/from-app.ts",
    "shared/i18n/from-app.ts",
    "shared/platform/from-data.ts",
    "shared/types/from-feature.ts",
    "shared/ui/from-data.ts",
  ]);

  for (const file of [
    "data/from-app.ts",
    "data/from-feature.ts",
    "data/from-shared-platform.ts",
    "data/from-shared-ui.ts",
    "features/from-app.ts",
    "shared/i18n/from-app.ts",
    "shared/platform/from-data.ts",
    "shared/types/from-feature.ts",
    "shared/ui/from-data.ts",
  ]) {
    assertBoundaryError(results, file);
  }
});
