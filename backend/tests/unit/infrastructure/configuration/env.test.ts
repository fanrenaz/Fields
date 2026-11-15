import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";

import { loadBackendEnvFiles } from "../../../../src/infrastructure/configuration/env.js";

const ROOT_ONLY_KEY = "FIELDS_ENV_ROOT_ONLY_TEST";
const BACKEND_ONLY_KEY = "FIELDS_ENV_BACKEND_ONLY_TEST";
const PRECEDENCE_KEY = "FIELDS_ENV_PRECEDENCE_TEST";
const PARENT_ONLY_KEY = "FIELDS_ENV_PARENT_ONLY_TEST";
const LOAD_ENV_FILES_KEY = "FIELDS_BACKEND_LOAD_ENV_FILES";

test("backend environment loading reads the workspace file before the backend override", async () => {
  await withEnvironmentKeys([ROOT_ONLY_KEY, BACKEND_ONLY_KEY, PRECEDENCE_KEY], async () => {
    const root = await mkdtemp(join(tmpdir(), "fields-backend-env-"));
    const backendRoot = join(root, "backend");
    try {
      await mkdir(backendRoot, { recursive: true });
      await writeFile(join(root, "package.json"), "{}\n");
      await writeFile(join(backendRoot, "package.json"), "{}\n");
      await mkdir(join(backendRoot, "src"));
      await writeFile(
        join(root, ".env"),
        `${ROOT_ONLY_KEY}=workspace\n${PRECEDENCE_KEY}=workspace\n`,
      );
      await writeFile(
        join(backendRoot, ".env"),
        `${BACKEND_ONLY_KEY}=backend\n${PRECEDENCE_KEY}=backend\n`,
      );

      loadBackendEnvFiles(backendRoot);

      assert.equal(process.env[ROOT_ONLY_KEY], "workspace");
      assert.equal(process.env[BACKEND_ONLY_KEY], "backend");
      assert.equal(process.env[PRECEDENCE_KEY], "backend");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test("production package roots do not probe a parent environment file", async () => {
  await withEnvironmentKeys([PARENT_ONLY_KEY], async () => {
    const root = await mkdtemp(join(tmpdir(), "fields-backend-production-env-"));
    const packageRoot = join(root, "app");
    try {
      await mkdir(join(packageRoot, "src"), { recursive: true });
      await writeFile(join(packageRoot, "package.json"), "{}\n");
      await writeFile(join(root, ".env"), `${PARENT_ONLY_KEY}=must-not-load\n`);

      loadBackendEnvFiles(packageRoot);

      assert.equal(process.env[PARENT_ONLY_KEY], undefined);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test("backend environment file loading can be explicitly disabled", async () => {
  await withEnvironmentKeys([ROOT_ONLY_KEY, LOAD_ENV_FILES_KEY], async () => {
    const root = await mkdtemp(join(tmpdir(), "fields-backend-env-disabled-"));
    const backendRoot = join(root, "backend");
    try {
      await mkdir(join(backendRoot, "src"), { recursive: true });
      await writeFile(join(root, "package.json"), "{}\n");
      await writeFile(join(backendRoot, "package.json"), "{}\n");
      await writeFile(join(root, ".env"), `${ROOT_ONLY_KEY}=must-not-load\n`);
      process.env[LOAD_ENV_FILES_KEY] = "false";

      loadBackendEnvFiles(backendRoot);

      assert.equal(process.env[ROOT_ONLY_KEY], undefined);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test("backend environment file loading rejects ambiguous values", async () => {
  await withEnvironmentKeys([LOAD_ENV_FILES_KEY], async () => {
    process.env[LOAD_ENV_FILES_KEY] = "0";
    assert.throws(
      () => loadBackendEnvFiles(process.cwd()),
      /FIELDS_BACKEND_LOAD_ENV_FILES must be "true" or "false"/u,
    );
  });
});

async function withEnvironmentKeys(
  keys: readonly string[],
  operation: () => Promise<void>,
): Promise<void> {
  const original = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) {
    delete process.env[key];
  }
  try {
    await operation();
  } finally {
    for (const key of keys) {
      const value = original.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
