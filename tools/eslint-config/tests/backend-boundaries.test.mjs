import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

import { resetArchitectureRuleState } from "../architecture-rules.js";
import { createFieldsBackendConfig } from "../index.js";

const fixtureRoot = fileURLToPath(new URL("./fixtures/backend-boundaries/", import.meta.url));
const require = createRequire(import.meta.url);
const nodeNextResolver = require("../node-next-resolver.cjs");

async function lint(files) {
  resetArchitectureRuleState();
  const eslint = new ESLint({
    cwd: fixtureRoot,
    overrideConfigFile: true,
    overrideConfig: createFieldsBackendConfig({ tsconfigRootDir: fixtureRoot }),
  });

  return eslint.lintFiles(files);
}

function messagesFor(results, relativeFile) {
  const result = results.find((entry) => path.relative(fixtureRoot, entry.filePath) === relativeFile);
  assert.ok(result, `Expected lint result for ${relativeFile}`);
  return result.messages;
}

function assertRule(results, relativeFile, ruleId) {
  assert.ok(
    messagesFor(results, relativeFile).some((message) => message.ruleId === ruleId),
    `Expected ${ruleId} for ${relativeFile}`,
  );
}

function assertRuleMessageCount(results, relativeFile, ruleId, messageId, expectedCount) {
  assert.equal(
    messagesFor(results, relativeFile).filter((message) => (
      message.ruleId === ruleId && message.messageId === messageId
    )).length,
    expectedCount,
    `Expected ${expectedCount} ${ruleId}/${messageId} errors for ${relativeFile}`,
  );
}

test("NodeNext resolver maps a .js source specifier to the TypeScript source file", () => {
  const importer = path.join(fixtureRoot, "src/domain/company/public.ts");
  const resolved = nodeNextResolver.resolve("./model.js", importer, {});

  assert.deepEqual(resolved, {
    found: true,
    path: path.join(fixtureRoot, "src/domain/company/model.ts"),
  });
});

test("Backend boundary configuration accepts allowed layer dependencies", async () => {
  const results = await lint([
    "src/domain/company/model.ts",
    "src/domain/company/public.ts",
    "src/application/company/ports/company-reader.ts",
    "src/application/company/commands/read-company.ts",
    "src/infrastructure/persistence/postgres/repositories/company/company-repository-allowed.ts",
    "src/interface/trpc/public/router.ts",
    "src/composition/api/wire.ts",
  ]);

  assert.deepEqual(
    results.flatMap((result) => result.messages),
    [],
  );
});

test("Backend boundary configuration rejects prohibited layer, provider, and owner imports", async () => {
  const results = await lint([
    "src/domain/company/from-application.ts",
    "src/domain/company/from-contracts.ts",
    "src/application/company/commands/from-provider.ts",
    "src/application/company/commands/from-actor-command.ts",
    "src/application/company/queries/from-execution-domain.ts",
    "src/interface/trpc/public/from-infrastructure.ts",
    "src/infrastructure/runtime/company/from-interface.ts",
    "src/infrastructure/persistence/postgres/repositories/company/from-actor-repository.ts",
  ]);

  assertRule(results, "src/domain/company/from-application.ts", "boundaries/dependencies");
  assertRule(results, "src/domain/company/from-contracts.ts", "boundaries/dependencies");
  assertRule(results, "src/application/company/commands/from-provider.ts", "boundaries/dependencies");
  assertRule(
    results,
    "src/application/company/commands/from-actor-command.ts",
    "fields-architecture/no-layer-dependency",
  );
  assertRule(
    results,
    "src/application/company/queries/from-execution-domain.ts",
    "fields-architecture/no-layer-dependency",
  );
  assertRule(results, "src/interface/trpc/public/from-infrastructure.ts", "boundaries/dependencies");
  assertRule(results, "src/infrastructure/runtime/company/from-interface.ts", "boundaries/dependencies");
  assertRule(
    results,
    "src/infrastructure/persistence/postgres/repositories/company/from-actor-repository.ts",
    "boundaries/dependencies",
  );
});

test("Backend boundary configuration rejects Port and Adapter co-imports outside Composition", async () => {
  const results = await lint(["src/application/company/commands/port-adapter-co-import.ts"]);

  assertRule(
    results,
    "src/application/company/commands/port-adapter-co-import.ts",
    "fields-architecture/no-port-adapter-co-import",
  );
});

test("Backend boundary configuration rejects Interface imports from Composition, including type-only imports", async () => {
  const results = await lint(["src/interface/trpc/public/from-composition.ts"]);

  assertRule(results, "src/interface/trpc/public/from-composition.ts", "boundaries/dependencies");
});

test("Backend root entrypoint remains a compatibility export and direct launcher only", async () => {
  const results = await lint(["src/index.ts"]);

  assertRule(results, "src/index.ts", "fields-architecture/no-root-entrypoint-implementation");
});

test("Backend boundary configuration maps nested Execution persistence files to their owner", async () => {
  const results = await lint([
    "src/infrastructure/persistence/postgres/repositories/company/from-execution-repository.ts",
    "src/infrastructure/persistence/postgres/repositories/execution/company-runtime-repository.ts",
  ]);

  assertRule(
    results,
    "src/infrastructure/persistence/postgres/repositories/company/from-execution-repository.ts",
    "fields-architecture/no-layer-dependency",
  );
  assertRule(
    results,
    "src/infrastructure/persistence/postgres/repositories/execution/company-runtime-repository.ts",
    "fields-architecture/no-layer-dependency",
  );
});

test("Backend boundary configuration classifies every flat product-owner persistence file", async () => {
  const ownerFiles = [
    "src/infrastructure/persistence/postgres/schema/actor.ts",
    "src/infrastructure/persistence/postgres/schema/company.ts",
    "src/infrastructure/persistence/postgres/schema/room.ts",
    "src/infrastructure/persistence/postgres/repositories/actor-directory-repository.ts",
    "src/infrastructure/persistence/postgres/repositories/actor-invitation-human-query.ts",
    "src/infrastructure/persistence/postgres/repositories/actor-repository.ts",
    "src/infrastructure/persistence/postgres/repositories/actor-room-access-query.ts",
    "src/infrastructure/persistence/postgres/repositories/company-invitation-query.ts",
    "src/infrastructure/persistence/postgres/repositories/company-repository.ts",
    "src/infrastructure/persistence/postgres/repositories/room-repository.ts",
  ];
  const unclassifiedFile = "src/infrastructure/persistence/postgres/repositories/unclassified-repository.ts";
  const results = await lint([...ownerFiles, unclassifiedFile]);

  for (const file of ownerFiles) {
    assertRuleMessageCount(
      results,
      file,
      "fields-architecture/no-layer-dependency",
      "crossOwnerPersistence",
      1,
    );
    assertRuleMessageCount(
      results,
      file,
      "fields-architecture/no-layer-dependency",
      "unclassifiedFlatPersistence",
      0,
    );
  }
  assertRuleMessageCount(
    results,
    unclassifiedFile,
    "fields-architecture/no-layer-dependency",
    "unclassifiedFlatPersistence",
    1,
  );
});

test("Backend boundary configuration permits cross-owner reads only through public Query entries", async () => {
  const results = await lint(["src/application/company/commands/from-actor-query.ts"]);

  assert.deepEqual(results.flatMap((result) => result.messages), []);
});

test("Backend boundary configuration rejects local circular dependencies", async () => {
  const results = await lint([
    "src/domain/company/cycle-a.ts",
    "src/domain/company/cycle-b.ts",
  ]);

  assert.ok(
    results.some((result) =>
      result.messages.some((message) => message.ruleId === "fields-architecture/no-circular-dependencies"),
    ),
  );
});
