import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ApplicationError } from "../../../../../../src/application/platform/errors.js";
import type { BackendDatabase } from "../../../../../../src/infrastructure/persistence/postgres/database-service.js";
import {
  COMPANY_RUNTIME_ACCESS_DENIED_CODE,
  COMPANY_RUNTIME_SCOPE_INVALID_CODE,
  PostgresCompanyRuntimeRepository,
} from "../../../../../../src/infrastructure/persistence/postgres/repositories/execution/company-runtime-repository.js";

test("fixed Company Runtime resolution returns only the configured Company and URL", async () => {
  const repository = new PostgresCompanyRuntimeRepository({} as BackendDatabase, {
    companyId: "company_one",
    runtimeUrl: "http://127.0.0.1:4110",
    controlTokenFile: "/unused",
  });

  assert.deepEqual(await repository.resolveReady("company_one"), {
    company_id: "company_one",
    runtimeUrl: "http://127.0.0.1:4110",
  });
  await assert.rejects(
    () => repository.resolveReady("company_two"),
    (error: unknown) => error instanceof ApplicationError
      && error.code === COMPANY_RUNTIME_SCOPE_INVALID_CODE,
  );
});

test("fixed Company Runtime callbacks require the configured Company and shared token", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "fields-fixed-runtime-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tokenFile = join(directory, "control-token");
  await writeFile(tokenFile, "control-secret\n", { mode: 0o600 });
  const repository = new PostgresCompanyRuntimeRepository({} as BackendDatabase, {
    companyId: "company_one",
    runtimeUrl: "http://127.0.0.1:4110",
    controlTokenFile: tokenFile,
  });

  await repository.authorize({ company_id: "company_one" }, "control-secret");
  for (const [companyId, token] of [
    ["company_two", "control-secret"],
    ["company_one", "wrong-secret"],
  ] as const) {
    await assert.rejects(
      () => repository.authorize({ company_id: companyId }, token),
      (error: unknown) => error instanceof ApplicationError
        && error.code === COMPANY_RUNTIME_ACCESS_DENIED_CODE,
    );
  }
});
