import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CompanyExecutorService,
  type CompanyExecutorClient,
} from "../src/application/company-executor/service.js";
import {
  companyExecutorAuthPath,
  companyExecutorCodexHome,
  companyExecutorCustomApiPath,
  companyExecutorRoot,
} from "../src/application/init/executor.js";
import {
  CODEX_APP_SERVER_PID_FILE,
  codexAppServerSocketPath,
} from "../src/application/codex/codex-process.js";

test("Company Executor returns only external tokens from its canonical credential", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "company-runtime-executor-"));
  const credential = companyExecutorAuthPath(workdir, "executor-1");
  try {
    assert.equal(
      credential,
      join(workdir, "executors", "executor-1", "credentials", "auth.json"),
    );
    await mkdir(companyExecutorCodexHome(workdir, "executor-1"), { recursive: true });
    await writeFile(credential, `${JSON.stringify({
      tokens: {
        access_token: "access-secret",
        refresh_token: "refresh-secret",
        account_id: "account-1",
      },
    })}\n`, "utf8");
    await chmod(credential, 0o644);
    const service = new CompanyExecutorService(workdir, {
      ensureAppServer: async () => "/fake/executor.sock",
      clientFactory: () => accountClient(),
    });

    const issued = await service.issueToken({
      executor_id: "executor-1",
      reason: "authorization",
    });

    assert.equal(issued.executor_id, "executor-1");
    assert.equal(issued.credential.type, "chatgpt_auth_tokens");
    if (issued.credential.type !== "chatgpt_auth_tokens") assert.fail("expected ChatGPT tokens");
    assert.equal(issued.credential.access_token, "access-secret");
    assert.equal(issued.credential.account_id, "account-1");
    assert.equal(issued.credential.plan_type, "plus");
    assert.equal(JSON.stringify(issued).includes("refresh-secret"), false);
    assert.equal((await stat(credential)).mode & 0o777, 0o600);
    await service.shutdown();
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("Company Executor replaces stale cross-container App Server metadata when its socket refuses connections", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "company-runtime-executor-stale-socket-"));
  const executorId = "executor-stale";
  const root = companyExecutorRoot(workdir, executorId);
  const runtime = join(root, ".runtime");
  const socketPath = codexAppServerSocketPath(root);
  const credential = companyExecutorAuthPath(workdir, executorId);
  let starts = 0;
  try {
    await mkdir(companyExecutorCodexHome(workdir, executorId), { recursive: true });
    await mkdir(runtime, { recursive: true });
    await writeFile(credential, `${JSON.stringify({
      tokens: {
        access_token: "access-secret",
        refresh_token: "refresh-secret",
        account_id: "account-stale",
      },
    })}\n`, { mode: 0o600 });
    await writeFile(
      join(runtime, CODEX_APP_SERVER_PID_FILE),
      `${JSON.stringify({ pid: process.pid })}\n`,
      "utf8",
    );
    await writeFile(socketPath, "stale socket marker", "utf8");
    const service = new CompanyExecutorService(workdir, {
      appServerSocketReady: async (candidate) => {
        assert.equal(candidate, socketPath);
        return false;
      },
      startAppServer: async (candidateRoot) => {
        starts += 1;
        assert.equal(candidateRoot, root);
        return {
          started: true,
          pid: 4321,
          status: "running",
          socketPath,
          statePath: join(runtime, "codex-app-server-state.json"),
          logPath: join(runtime, "codex-app-server.log"),
        };
      },
      clientFactory: () => accountClient(),
    });

    const issued = await service.issueToken({
      executor_id: executorId,
      reason: "app_server_start",
    });

    assert.equal(starts, 1);
    assert.equal(issued.executor_id, executorId);
    await service.shutdown();
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("Company Executor cleanup removes only the selected credential", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "company-runtime-executor-cleanup-"));
  const selected = companyExecutorAuthPath(workdir, "executor-1");
  const retained = companyExecutorAuthPath(workdir, "executor-2");
  try {
    await mkdir(companyExecutorCodexHome(workdir, "executor-1"), { recursive: true });
    await mkdir(companyExecutorCodexHome(workdir, "executor-2"), { recursive: true });
    await writeFile(selected, "selected", { mode: 0o600 });
    await writeFile(retained, "retained", { mode: 0o600 });
    const service = new CompanyExecutorService(workdir);

    assert.deepEqual(await service.cleanupCredential({ executor_id: "executor-1" }), {
      executor_id: "executor-1",
      cleaned: true,
    });
    await assert.rejects(stat(selected), { code: "ENOENT" });
    assert.equal(await readFile(retained, "utf8"), "retained");
    await service.shutdown();
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("Company Executor projects the live Codex model catalog without provider credentials", async () => {
  const requests: Array<{ method: string; params: unknown }> = [];
  const service = new CompanyExecutorService("/unused", {
    ensureAppServer: async () => "/fake/executor.sock",
    clientFactory: () => ({
      request: (async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "model/list") return {
          data: [{
            id: "gpt-5.3-codex",
            displayName: "GPT-5.3 Codex",
            supportedReasoningEfforts: [{ reasoningEffort: "medium" }, { reasoningEffort: "high" }],
          }],
          nextCursor: null,
        };
        return {};
      }) as CompanyExecutorClient["request"],
      notify: async () => undefined,
      readMessage: async () => null,
      close: async () => undefined,
    }),
  });

  assert.deepEqual(await service.modelCatalog({ executor_id: "executor-1" }), {
    executor_id: "executor-1",
    items: [{
      model: "gpt-5.3-codex",
      display_name: "GPT-5.3 Codex",
      source: "catalog",
      supported_reasoning_efforts: ["medium", "high"],
      validation_status: "unvalidated",
      last_validated_at_ms: null,
    }],
  });
  assert.deepEqual(requests.map((request) => request.method), ["initialize", "model/list"]);
  assert.equal(JSON.stringify(requests).includes("api_key"), false);
  await service.shutdown();
});

test("Company Executor validates models independently and removes its probe workspace", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "company-runtime-model-probe-"));
  const requestedModels: string[] = [];
  try {
    const service = new CompanyExecutorService(workdir, {
      ensureAppServer: async () => "/fake/executor.sock",
      nowMs: () => 1234,
      clientFactory: () => ({
        request: (async (method: string, params: unknown) => {
          if (method === "thread/start") {
            const model = (params as { model: string }).model;
            requestedModels.push(model);
            if (model === "unavailable-model") throw new Error("not found");
            return { thread: { id: `probe-${model}` } };
          }
          return {};
        }) as CompanyExecutorClient["request"],
        notify: async () => undefined,
        readMessage: async () => ({ method: "turn/completed" }),
        close: async () => undefined,
      }),
    });
    const result = await service.validateModels({
      executor_id: "executor-1",
      models: [
        { model: "available-model", display_name: "Available", source: "manual", supported_reasoning_efforts: ["medium"] },
        { model: "unavailable-model", display_name: "Unavailable", source: "manual", supported_reasoning_efforts: ["medium"] },
      ],
    });

    assert.deepEqual(requestedModels, ["available-model", "unavailable-model"]);
    assert.deepEqual(result.items.map((item) => item.validation_status), ["available", "unavailable"]);
    await assert.rejects(stat(join(companyExecutorRoot(workdir, "executor-1"), "probe-workspace")), { code: "ENOENT" });
    await service.shutdown();
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("Auth Worker stores and issues custom API credentials without echoing the key", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "company-runtime-custom-api-"));
  try {
    const service = new CompanyExecutorService(workdir);
    const configured = await service.configureCustom({
      executor_id: "executor-custom",
      base_url: "https://api.example.test/v1/",
      api_key: "custom-secret",
      previous_credential_version: 0,
    });
    assert.equal(configured.endpoint_host, "api.example.test");
    assert.equal(JSON.stringify(configured).includes("custom-secret"), false);

    const path = companyExecutorCustomApiPath(workdir, "executor-custom");
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const issued = await service.issueToken({
      executor_id: "executor-custom",
      reason: "app_server_start",
    });
    assert.deepEqual(issued.credential, {
      type: "custom_api_key",
      base_url: "https://api.example.test/v1",
      api_key: "custom-secret",
    });
    await service.shutdown();
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("custom credential rotation restores the previous credential when activation cannot commit", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "company-runtime-custom-rollback-"));
  try {
    const initial = new CompanyExecutorService(workdir);
    const configured = await initial.configureCustom({
      executor_id: "executor-custom",
      base_url: "https://old.example.test/v1",
      api_key: "old-secret",
      previous_credential_version: 0,
    });
    await initial.shutdown();

    let rolledBack = false;
    const failing = new CompanyExecutorService(workdir, {
      onConnected: async () => {
        throw new Error("callback unavailable");
      },
      onCredentialRollback: async () => {
        rolledBack = true;
      },
    });
    await assert.rejects(failing.configureCustom({
      executor_id: "executor-custom",
      base_url: "https://new.example.test/v1",
      api_key: "new-secret",
      previous_credential_version: configured.credential_version,
    }), /callback unavailable/u);
    assert.equal(rolledBack, true);
    const issued = await failing.issueToken({
      executor_id: "executor-custom",
      reason: "app_server_start",
    });
    assert.equal(issued.credential.type, "custom_api_key");
    if (issued.credential.type !== "custom_api_key") assert.fail("expected custom API key");
    assert.equal(issued.credential.base_url, "https://old.example.test/v1");
    assert.equal(issued.credential.api_key, "old-secret");
    await failing.shutdown();
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("an auth attempt lost with the Runtime process is explicitly retryable", async () => {
  const service = new CompanyExecutorService("/unused");
  assert.deepEqual(service.status({ executor_id: "executor-1", attempt_id: "attempt-lost" }), {
    attempt_id: "attempt-lost",
    status: "failed",
    login_id: null,
    verification_url: null,
    user_code: null,
    error: { code: "AUTH_ATTEMPT_NOT_FOUND", retryable: true },
  });
  await service.shutdown();
});

test("token issuance reports the requested credential version when authorization is unavailable", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "company-runtime-executor-unavailable-"));
  const unavailable: unknown[] = [];
  try {
    const service = new CompanyExecutorService(workdir, {
      ensureAppServer: async () => "/fake/executor.sock",
      clientFactory: () => ({
        ...accountClient(),
        request: async <TResult>() => ({ account: null }) as TResult,
      }),
      onUnavailable: (input) => {
        unavailable.push(input);
      },
    });

    await assert.rejects(service.issueToken({
      executor_id: "executor-1",
      previous_credential_version: 42,
      reason: "app_server_start",
    }), /not connected/u);
    assert.deepEqual(unavailable, [{
      executorId: "executor-1",
      credentialVersion: 42,
      status: "expired",
      code: "EXECUTOR_AUTH_REQUIRED",
    }]);
    await service.shutdown();
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

function accountClient(): CompanyExecutorClient {
  return {
    request: (async (method: string) => (
      method === "account/read"
        ? { account: { type: "chatgpt", email: null, planType: "plus" }, requiresOpenaiAuth: true }
        : {}
    )) as CompanyExecutorClient["request"],
    notify: async () => undefined,
    readMessage: async () => null,
    close: async () => undefined,
  };
}
