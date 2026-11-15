import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CodexAppServerProcessError,
  CODEX_APP_SERVER_LOG_FILE,
  codexAppServerSocketPath,
  codexEnv,
  startCodexAppServerProcess,
  stopCodexAppServerProcess,
} from "../src/application/codex/codex-process.js";
import {
  assertFieldsRoomMessagesNotGloballyEnabled,
  configureCodexIntegration,
} from "../src/application/codex/codex.js";
import { companyExecutorCodexHome } from "../src/application/init/executor.js";

test("Company Executor Codex socket stays below the Unix SUN_LEN limit", () => {
  const executorRoot = join(
    "/workdir",
    "executors",
    `executor_${"a".repeat(36)}`,
  );
  const socketPath = codexAppServerSocketPath(executorRoot);

  assert.equal(socketPath, join(executorRoot, ".runtime", "codex.sock"));
  assert.ok(socketPath.length < 108);
});

test("Company Runtime Codex start rejects a symlinked app-server log without touching its target", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "company-runtime-codex-log-symlink-"));
  try {
    const runtime = join(workdir, ".runtime");
    const target = join(workdir, "protected-target");
    await mkdir(runtime, { recursive: true });
    await writeFile(target, "protected\n", { mode: 0o644 });
    await symlink(target, join(runtime, CODEX_APP_SERVER_LOG_FILE));

    await assert.rejects(
      startCodexAppServerProcess(workdir, { timeoutMs: 10 }),
      (error: unknown) => error instanceof CodexAppServerProcessError
        && error.code === "codex_app_server_not_ready",
    );
    assert.equal(await readFile(target, "utf8"), "protected\n");
    assert.equal((await stat(target)).mode & 0o777, 0o644);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("Company Runtime Codex start maps a missing executable to the stable process error", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "company-runtime-codex-missing-executable-"));
  const previousPath = process.env.PATH;
  try {
    process.env.PATH = join(workdir, "empty-bin");
    await mkdir(process.env.PATH, { recursive: true });

    await assert.rejects(
      startCodexAppServerProcess(workdir, { timeoutMs: 100 }),
      (error: unknown) => error instanceof CodexAppServerProcessError
        && error.code === "codex_app_server_not_ready"
        && error.details.reason === "spawn_failed",
    );
    const state = JSON.parse(
      await readFile(join(workdir, ".runtime", "codex-app-server-state.json"), "utf8"),
    ) as { status?: string; last_error?: { reason?: string } };
    assert.equal(state.status, "failed");
    assert.equal(state.last_error?.reason, "spawn_failed");
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await rm(workdir, { recursive: true, force: true });
  }
});

test("Company Runtime Codex env allowlist keeps Member and canonical Executor homes isolated from runtime secrets", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "company-runtime-codex-env-"));
  try {
    const memberWorkspace = join(workdir, "members", "member_owner", "workspace");
    const canonicalHome = companyExecutorCodexHome(workdir, "executor_1");
    const source = {
      PATH: "/usr/local/bin:/usr/bin",
      HTTP_PROXY: "http://proxy.internal:8080",
      CODEX_HOME: canonicalHome,
      FIELDS_COMPANY_RUNTIME_CALLBACK_TOKEN: "callback-secret",
      FIELDS_INTERNAL_CONTROL_TOKEN_FILE: "/run/secrets/fields-control-token",
      OPENAI_API_KEY: "host-provider-secret",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://lgtm:4318",
      OTEL_SERVICE_NAME: "fields-company-runtime",
    };

    const memberEnv = codexEnv(memberWorkspace, { memberId: "member_1" }, source);
    assert.equal(memberEnv.PATH, "/usr/local/bin:/usr/bin");
    assert.equal(memberEnv.HTTP_PROXY, undefined);
    assert.equal(memberEnv.CODEX_HOME, join(memberWorkspace, ".codex"));
    assert.notEqual(memberEnv.CODEX_HOME, canonicalHome);
    assert.equal(memberEnv.FIELDS_COMPANY_RUNTIME_CALLBACK_TOKEN, undefined);
    assert.equal(memberEnv.FIELDS_INTERNAL_CONTROL_TOKEN_FILE, undefined);
    assert.equal(memberEnv.OPENAI_API_KEY, undefined);
    assert.equal(memberEnv.OTEL_EXPORTER_OTLP_ENDPOINT, undefined);
    assert.equal(memberEnv.OTEL_SERVICE_NAME, undefined);
    assert.equal(memberEnv.FIELDS_MCP_MEMBER_ID, "member_1");
    assert.equal(memberEnv.GIT_CONFIG_COUNT, "1");
    assert.equal(memberEnv.GIT_CONFIG_KEY_0, "core.excludesFile");
    assert.equal(
      memberEnv.GIT_CONFIG_VALUE_0,
      join(memberWorkspace, ".codex", "fields-git-excludes"),
    );

    const executorEnv = codexEnv(workdir, { codexHomePath: canonicalHome }, source);
    assert.equal(executorEnv.CODEX_HOME, canonicalHome);
    assert.equal(executorEnv.FIELDS_COMPANY_RUNTIME_CALLBACK_TOKEN, undefined);
    assert.equal(executorEnv.FIELDS_INTERNAL_CONTROL_TOKEN_FILE, undefined);
    assert.equal(executorEnv.FIELDS_MCP_MEMBER_ID, undefined);
    assert.equal(executorEnv.GIT_CONFIG_COUNT, undefined);
    assert.equal(executorEnv.OTEL_EXPORTER_OTLP_ENDPOINT, undefined);
    assert.equal(executorEnv.OTEL_SERVICE_NAME, undefined);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("Company Runtime Codex configuration removes legacy direct Fields MCP servers and preserves plugin state", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "company-runtime-codex-mcp-identity-"));
  try {
    await mkdir(join(workdir, ".codex"), { recursive: true });
    await writeFile(join(workdir, ".codex", "config.toml"), [
      "[mcp_servers.fields]",
      'url = "http://legacy.invalid/mcp"',
      "[mcp_servers.fields_embodiment]",
      'url = "http://legacy.invalid/mcp/embodiment"',
      "[mcp_servers.fields_search]",
      'url = "http://legacy.invalid/mcp/search"',
      "[mcp_servers.fields_room_messages]",
      'url = "http://legacy.invalid/mcp/room-messages"',
      "[mcp_servers.fields_room_messages.env_http_headers]",
      'X-Fields-Member-Id = "FIELDS_MCP_MEMBER_ID"',
      "[mcp_servers.fields_assets]",
      'url = "http://legacy.invalid/mcp/assets"',
      "[mcp_servers.keep]",
      'url = "http://keep.invalid/mcp"',
      '[plugins."fields-core@fields"]',
      "enabled = true",
      "",
    ].join("\n"), "utf8");
    const result = await configureCodexIntegration(workdir);
    const config = await readFile(result.configPath, "utf8");
    assert.doesNotMatch(
      config,
      /\[mcp_servers\.(?:fields|fields_embodiment|fields_search|fields_room_messages|fields_assets)(?:\.|\])/,
    );
    assert.doesNotMatch(config, /legacy\.invalid/);
    assert.match(config, /\[mcp_servers\.keep\]\nurl = "http:\/\/keep\.invalid\/mcp"/);
    assert.match(config, /\[plugins\."fields-core@fields"\]\nenabled = true/);
    assert.equal(
      await readFile(join(workdir, ".codex", "fields-git-excludes"), "utf8"),
      ".codex/\n",
    );
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("Company Runtime Codex configuration removes quoted and inline legacy Fields MCP entries only", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "company-runtime-codex-mcp-quoted-"));
  try {
    await mkdir(join(workdir, ".codex"), { recursive: true });
    await writeFile(join(workdir, ".codex", "config.toml"), [
      'mcp_servers.fields_assets = { type = "http", url = "http://legacy.invalid/mcp/assets" }',
      'mcp_servers.keep_dotted = { type = "http", url = "http://keep.invalid/dotted" }',
      '[mcp_servers."fields_search"] # legacy quoted table',
      'url = "http://legacy.invalid/mcp/search"',
      "[mcp_servers.'fields_room_messages'.env_http_headers]",
      'X-Fields-Member-Id = "FIELDS_MCP_MEMBER_ID"',
      "[mcp_servers.keep_table]",
      'url = "http://keep.invalid/table"',
      '[plugins."fields-core@fields"]',
      "enabled = true",
      "# unrelated comment",
      "",
    ].join("\n"), "utf8");

    const result = await configureCodexIntegration(workdir);
    const config = await readFile(result.configPath, "utf8");

    assert.doesNotMatch(config, /legacy\.invalid/u);
    assert.doesNotMatch(config, /fields_(?:assets|search|room_messages)/u);
    assert.match(config, /mcp_servers\.keep_dotted = \{ type = "http", url = "http:\/\/keep\.invalid\/dotted" \}/u);
    assert.match(config, /\[mcp_servers\.keep_table\]\nurl = "http:\/\/keep\.invalid\/table"/u);
    assert.match(config, /\[plugins\."fields-core@fields"\]\nenabled = true/u);
    assert.match(config, /# unrelated comment/u);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("Company Runtime Codex configuration preserves unrelated entries in a root inline MCP table", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "company-runtime-codex-mcp-inline-"));
  try {
    await mkdir(join(workdir, ".codex"), { recursive: true });
    await writeFile(join(workdir, ".codex", "config.toml"), [
      'mcp_servers = { fields_search = { url = "http://legacy.invalid/search" }, keep = { url = "http://keep.invalid/mcp" } }',
      "",
    ].join("\n"), "utf8");

    const result = await configureCodexIntegration(workdir);
    const config = await readFile(result.configPath, "utf8");

    assert.doesNotMatch(config, /legacy\.invalid|fields_search/u);
    assert.match(config, /\[mcp_servers\.keep\]\nurl = "http:\/\/keep\.invalid\/mcp"/u);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("Member Codex configuration rejects persisted global Room Messages enablement", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "company-runtime-codex-room-global-"));
  try {
    await mkdir(join(workdir, ".codex"), { recursive: true });
    await writeFile(join(workdir, ".codex", "config.toml"), [
      '[plugins."fields-core@fields".mcp_servers.fields_room_messages]',
      "enabled = true",
      "",
    ].join("\n"), "utf8");

    await assert.rejects(
      assertFieldsRoomMessagesNotGloballyEnabled(workdir),
      (error: unknown) => (
        error instanceof Error
        && "code" in error
        && error.code === "fields_room_messages_globally_enabled"
      ),
    );
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("custom provider configuration uses Responses API and excludes its key from agent shells", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "company-runtime-custom-provider-"));
  try {
    const result = await configureCodexIntegration(workdir, {
      customProvider: {
        baseUrl: "https://api.example.test/v1",
        envKey: "FIELDS_EXECUTOR_API_KEY",
      },
    });
    const config = await readFile(result.configPath, "utf8");
    assert.match(config, /model_provider = "fields_custom"/);
    assert.match(config, /wire_api = "responses"/);
    assert.match(config, /env_key = "FIELDS_EXECUTOR_API_KEY"/);
    assert.match(config, /exclude = \["FIELDS_EXECUTOR_API_KEY"\]/);
    assert.doesNotMatch(config, /custom-secret/);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("Member asset MCP configuration pins HTTPS endpoints and hides bearer environment variables", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "company-runtime-asset-mcp-"));
  try {
    const result = await configureCodexIntegration(workdir, {
      assetMcps: [{
        name: "company-search",
        url: "https://mcp.example.test/service",
        bearerTokenEnvVar: "FIELDS_ASSET_MCP_VERSION_ONE_TOKEN",
      }],
    });
    const config = await readFile(result.configPath, "utf8");
    assert.match(config, /\[mcp_servers\."company-search"\]/u);
    assert.match(config, /url = "https:\/\/mcp\.example\.test\/service"/u);
    assert.match(config, /enabled = true/u);
    assert.match(config, /required = false/u);
    assert.match(
      config,
      /bearer_token_env_var = "FIELDS_ASSET_MCP_VERSION_ONE_TOKEN"/u,
    );
    assert.match(
      config,
      /exclude = \["FIELDS_ASSET_MCP_VERSION_ONE_TOKEN"\]/u,
    );
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("Company Runtime start timeout terminates the spawned Codex process before reporting failure", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "company-runtime-codex-timeout-"));
  try {
    const signals: NodeJS.Signals[] = [];
    let alive = true;
    await assert.rejects(
      startCodexAppServerProcess(workdir, {
        timeoutMs: 1,
        spawnProcess: () => ({ pid: 12345, exitCode: null }),
        pidAlive: () => alive,
        terminateProcess: (_pid, signal) => {
          signals.push(signal);
          alive = false;
        },
        terminationTimeoutMs: 1,
      }),
      (error) => {
        assert.equal(error instanceof CodexAppServerProcessError, true);
        assert.deepEqual(
          (error as CodexAppServerProcessError).details.termination,
          { attempted: true, terminated: true, forced: false, signal_error: false },
        );
        return true;
      },
    );
    assert.deepEqual(signals, ["SIGTERM"]);
    await assert.rejects(() => stat(join(workdir, ".runtime", "codex-app-server.pid")), { code: "ENOENT" });
    const state = JSON.parse(
      await readFile(join(workdir, ".runtime", "codex-app-server-state.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.equal(state.status, "failed");
    assert.deepEqual(state.last_error, { reason: "timeout" });
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("Company Runtime start failure never signals an already exited child even when its pid appears alive", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "company-runtime-codex-start-failure-"));
  try {
    const signals: NodeJS.Signals[] = [];
    await assert.rejects(
      startCodexAppServerProcess(workdir, {
        timeoutMs: 500,
        spawnProcess: () => ({ pid: 12345, exitCode: 19 }),
        pidAlive: () => true,
        terminateProcess: (_pid, signal) => {
          signals.push(signal);
        },
        terminationTimeoutMs: 1,
      }),
      (error) => {
        assert.equal(error instanceof CodexAppServerProcessError, true);
        assert.deepEqual(
          (error as CodexAppServerProcessError).details.termination,
          { attempted: false, terminated: true, forced: false, signal_error: false },
        );
        return true;
      },
    );
    assert.deepEqual(signals, []);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("Company Runtime start rejects an exited child even when its socket already exists", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "company-runtime-codex-exited-socket-"));
  try {
    const signals: NodeJS.Signals[] = [];
    await assert.rejects(
      startCodexAppServerProcess(workdir, {
        timeoutMs: 500,
        spawnProcess: () => {
          writeFileSync(codexAppServerSocketPath(workdir), "", "utf8");
          return { pid: 12345, exitCode: 0 };
        },
        pidAlive: () => true,
        terminateProcess: (_pid, signal) => { signals.push(signal); },
      }),
      (error) => {
        assert.equal(error instanceof CodexAppServerProcessError, true);
        const processError = error as CodexAppServerProcessError;
        assert.equal(processError.details.reason, "process_exited");
        assert.equal(processError.details.exit_code, 0);
        return true;
      },
    );
    assert.deepEqual(signals, []);
    const state = JSON.parse(
      await readFile(join(workdir, ".runtime", "codex-app-server-state.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.equal(state.status, "failed");
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("Company Runtime start cleans up a live child when post-spawn pid metadata I/O fails", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "company-runtime-codex-post-spawn-io-"));
  try {
    const pidPath = join(workdir, ".runtime", "codex-app-server.pid");
    const signals: NodeJS.Signals[] = [];
    let alive = true;
    await assert.rejects(
      startCodexAppServerProcess(workdir, {
        timeoutMs: 500,
        spawnProcess: () => {
          mkdirSync(pidPath);
          return { pid: 12345, exitCode: null };
        },
        pidAlive: () => alive,
        terminateProcess: (_pid, signal) => {
          signals.push(signal);
          alive = false;
        },
        terminationTimeoutMs: 1,
      }),
      (error) => {
        assert.equal(error instanceof CodexAppServerProcessError, true);
        const processError = error as CodexAppServerProcessError;
        assert.equal(processError.details.reason, "startup_io_failed");
        assert.equal(processError.details.stage, "pid_metadata_write");
        assert.deepEqual(processError.details.termination, {
          attempted: true,
          terminated: true,
          forced: false,
          signal_error: false,
        });
        assert.equal(JSON.stringify(processError.details).includes("12345"), false);
        return true;
      },
    );
    assert.deepEqual(signals, ["SIGTERM"]);
    const state = JSON.parse(
      await readFile(join(workdir, ".runtime", "codex-app-server-state.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.deepEqual(state.last_error, { reason: "startup_io_failed", stage: "pid_metadata_write" });
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("Company Runtime stop keeps runtime evidence and throws when a process resists TERM and KILL", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "company-runtime-codex-resistant-stop-"));
  try {
    const runtime = join(workdir, ".runtime");
    const socketPath = codexAppServerSocketPath(workdir);
    await mkdir(runtime, { recursive: true });
    await writeFile(socketPath, "active", "utf8");
    await writeFile(join(runtime, "codex-app-server.pid"), `${JSON.stringify({ pid: 12345 })}\n`, "utf8");
    const signals: NodeJS.Signals[] = [];

    await assert.rejects(
      stopCodexAppServerProcess(workdir, {
        timeoutMs: 1,
        pidAlive: () => true,
        killProcess: (_pid, signal) => { signals.push(signal); },
      }),
      (error) => {
        assert.equal(error instanceof CodexAppServerProcessError, true);
        const processError = error as CodexAppServerProcessError;
        assert.equal(processError.code, "codex_app_server_stop_failed");
        assert.equal(JSON.stringify(processError.details).includes("12345"), false);
        return true;
      },
    );

    assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
    assert.equal(await readFile(socketPath, "utf8"), "active");
    const stateText = await readFile(join(runtime, "codex-app-server-state.json"), "utf8");
    const state = JSON.parse(stateText) as Record<string, unknown>;
    assert.equal(state.status, "failed");
    assert.deepEqual(state.last_error, { reason: "termination_failed", forced: true, signal_error: false });
    assert.equal(stateText.includes("12345"), false);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("Company Runtime ownership-required stop rejects a newly appeared forged pid without signaling it", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "company-runtime-codex-unowned-new-pid-"));
  try {
    const runtime = join(workdir, ".runtime");
    const socketPath = codexAppServerSocketPath(workdir);
    const signals: NodeJS.Signals[] = [];
    await mkdir(runtime, { recursive: true });
    await writeFile(join(runtime, "codex-app-server.pid"), `${JSON.stringify({
      pid: process.pid,
      command: ["codex", "app-server", "--listen", `unix://${socketPath}`],
      socket_path: socketPath,
    })}\n`, "utf8");

    await assert.rejects(
      () => stopCodexAppServerProcess(workdir, {
        requireOwned: true,
        pidAlive: () => true,
        killProcess: (_pid, signal) => { signals.push(signal); },
      }),
      (error: unknown) => error instanceof CodexAppServerProcessError
        && error.code === "codex_app_server_process_unowned",
    );
    assert.deepEqual(signals, []);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});
