import assert from "node:assert/strict";
import test from "node:test";

import { executorAuthorizationRuntimeUnavailableCode } from "@fields/contracts/public/executor";

import { ApplicationError } from "../../../../../../src/application/platform/errors.js";
import type { TrpcCompanyRuntimeGateway } from "../../../../../../src/infrastructure/runtime/company-runtime/index.js";
import type { BackendDatabase } from "../../../../../../src/infrastructure/persistence/postgres/database-service.js";
import {
  COMPANY_RUNTIME_SCOPE_INVALID_CODE,
  COMPANY_RUNTIME_PERSISTENCE_UNAVAILABLE_CODE,
} from "../../../../../../src/infrastructure/persistence/postgres/repositories/execution/company-runtime-repository.js";
import {
  PostgresPersonalExecutorRepository,
} from "../../../../../../src/infrastructure/persistence/postgres/repositories/execution/personal-executor-repository.js";

const executorRow = {
  executor_id: "executor_one",
  owner_member_id: "actor_owner",
  owner_display_name: "Owner",
  name: "Personal Executor",
  authorization_method: "chatgpt",
  sharing_state: "private",
  status: "pending_auth",
  account_id: null,
  plan_type: null,
  endpoint_host: null,
  credential_version: 0,
  connected_at_ms: null,
  updated_at_ms: 1_000,
};

for (const runtimeCode of [
  COMPANY_RUNTIME_SCOPE_INVALID_CODE,
  COMPANY_RUNTIME_PERSISTENCE_UNAVAILABLE_CODE,
]) {
  test(`authorizationStart maps ${runtimeCode} to the public Runtime unavailable error`, async () => {
    const database = {
      execute: async () => [executorRow],
    } as unknown as BackendDatabase;
    const runtime = {
      authStart: async () => {
        throw new ApplicationError(runtimeCode, true);
      },
    } as unknown as TrpcCompanyRuntimeGateway;
    const repository = new PostgresPersonalExecutorRepository(database, runtime, () => 2_000);

    await assert.rejects(
      () => repository.authorizationStart("company_one", "actor_owner", "executor_one"),
      (error: unknown) => error instanceof ApplicationError
        && error.code === executorAuthorizationRuntimeUnavailableCode
        && error.retryable === true,
    );
  });
}

test("authorizationStart preserves unrelated Runtime errors", async () => {
  const original = new ApplicationError("COMPANY_RUNTIME_AUTH_REJECTED", false);
  const database = {
    execute: async () => [executorRow],
  } as unknown as BackendDatabase;
  const runtime = {
    authStart: async () => {
      throw original;
    },
  } as unknown as TrpcCompanyRuntimeGateway;
  const repository = new PostgresPersonalExecutorRepository(database, runtime, () => 2_000);

  await assert.rejects(
    () => repository.authorizationStart("company_one", "actor_owner", "executor_one"),
    (error: unknown) => error === original,
  );
});
