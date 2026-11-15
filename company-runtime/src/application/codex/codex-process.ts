import { spawn, type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createConnection } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

import { codexHome } from "../init/executor.js";
import { FIELDS_GIT_EXCLUDES_FILE } from "./codex.js";
import { emitLifecycleEvent } from "../../observability/events.js";

export const CODEX_APP_SERVER_STATE_FILE = "codex-app-server-state.json";
export const CODEX_APP_SERVER_PID_FILE = "codex-app-server.pid";
export const CODEX_APP_SERVER_LOG_FILE = "codex-app-server.log";
export const CODEX_APP_SERVER_SOCKET_FILE = "codex.sock";
export const READY_TIMEOUT_MS = 10_000;
const CODEX_ENV_PASSTHROUGH = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "TZ",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
] as const;

export type CodexAppServerStartResult = {
  started: boolean;
  pid: number;
  status: string;
  socketPath: string;
  statePath: string;
  logPath: string;
};

export type SpawnedProcessLike = Pick<ChildProcess, "pid" | "exitCode">;

export type SpawnAppServerProcess = (
  command: readonly string[],
  input: { cwd: string; env: NodeJS.ProcessEnv; logPath: string },
) => SpawnedProcessLike;

export class CodexAppServerProcessError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, options: { details?: Record<string, unknown> } = {}) {
    super(message);
    this.name = "CodexAppServerProcessError";
    this.code = code;
    this.details = options.details ?? {};
  }
}

export type CodexAppServerStatus = {
  pid: {
    path: string;
    present: boolean;
    value: number | null;
    alive: boolean;
  };
  state: {
    path: string;
    present: boolean;
    data: Record<string, unknown> | null;
  };
  socket: {
    path: string;
    present: boolean;
  };
  log: {
    path: string;
    present: boolean;
  };
};

export type CodexAppServerStopOptions = {
  timeoutMs?: number;
  pidAlive?: (pid: number) => boolean;
  killProcess?: (pid: number, signal: NodeJS.Signals) => void;
  expectedPid?: number;
  requireOwned?: boolean;
};

export async function startCodexAppServerProcess(
  workdir: string,
  options: {
    timeoutMs?: number;
    spawnProcess?: SpawnAppServerProcess;
    codexHomePath?: string;
    memberId?: string | null;
    secretEnv?: NodeJS.ProcessEnv;
    terminateProcess?: (pid: number, signal: NodeJS.Signals) => void;
    pidAlive?: (pid: number) => boolean;
    terminationTimeoutMs?: number;
  } = {},
): Promise<CodexAppServerStartResult> {
  const runtime = runtimeDir(workdir);
  await mkdir(runtime, { recursive: true });
  const socketPath = codexAppServerSocketPath(workdir);
  await unlinkIfExists(socketPath);
  const logPath = join(runtime, CODEX_APP_SERVER_LOG_FILE);
  const pidPath = join(runtime, CODEX_APP_SERVER_PID_FILE);
  const statePath = join(runtime, CODEX_APP_SERVER_STATE_FILE);
  const command = ["codex", "--enable", "default_mode_request_user_input", "app-server", "--listen", `unix://${socketPath}`];
  await writeCodexAppServerState(workdir, { status: "starting", socketPath });
  emitLifecycleEvent("codex.app_server.start", { code: "starting", retryable: false });
  let processHandle: SpawnedProcessLike;
  try {
    processHandle = await (options.spawnProcess ?? spawnCodexAppServerProcess)(command, {
      cwd: workdir,
      env: {
        ...codexEnv(workdir, { codexHomePath: options.codexHomePath, memberId: options.memberId }),
        ...options.secretEnv,
      },
      logPath,
    });
  } catch (_error) {
    const statePersisted = await tryWriteCodexAppServerState(workdir, {
      status: "failed",
      socketPath,
      lastError: { reason: "spawn_failed" },
    });
    throw new CodexAppServerProcessError("codex_app_server_not_ready", "Codex app-server process could not be started.", {
      details: { reason: "spawn_failed", log_path: logPath, state_persisted: statePersisted },
    });
  }
  if (typeof processHandle.pid !== "number") {
    const statePersisted = await tryWriteCodexAppServerState(workdir, {
      status: "failed",
      socketPath,
      lastError: { reason: "pid_missing" },
    });
    throw new CodexAppServerProcessError("codex_app_server_not_ready", "Codex app-server process did not expose a pid.", {
      details: { reason: "pid_missing", log_path: logPath, state_persisted: statePersisted },
    });
  }
  const processId = processHandle.pid;
  const deadline = Date.now() + (options.timeoutMs ?? READY_TIMEOUT_MS);
  let startupStage = "pid_metadata_write";
  let failureHandled = false;

  const failAfterExit = async (exitCode: number): Promise<never> => {
    emitLifecycleEvent("codex.app_server.exit", { code: "exited_before_ready", retryable: true });
    failureHandled = true;
    const metadataRemoved = await tryUnlinkIfExists(pidPath);
    const statePersisted = await tryWriteCodexAppServerState(workdir, {
      status: "failed",
      socketPath,
      lastError: { reason: "process_exited", exit_code: exitCode },
    });
    throw new CodexAppServerProcessError("codex_app_server_not_ready", "Codex app-server exited before it became ready.", {
      details: {
        reason: "process_exited",
        exit_code: exitCode,
        log_path: logPath,
        termination: exitedProcessEvidence(),
        cleanup: { metadata_removed: metadataRemoved, state_persisted: statePersisted },
      },
    });
  };

  try {
    await writeJson(pidPath, {
      pid: processId,
      started_at: nowMs(),
      command,
      socket_path: socketPath,
    });

    while (Date.now() < deadline) {
      const exitCode = processHandle.exitCode;
      if (exitCode !== null) {
        return await failAfterExit(exitCode);
      }

      startupStage = "socket_probe";
      if (await pathExists(socketPath)) {
        const exitAfterSocketProbe = processHandle.exitCode;
        if (exitAfterSocketProbe !== null) {
          return await failAfterExit(exitAfterSocketProbe);
        }
        startupStage = "running_state_write";
        await writeCodexAppServerState(workdir, { status: "running", socketPath });
        const exitAfterStateWrite = processHandle.exitCode;
        if (exitAfterStateWrite !== null) {
          return await failAfterExit(exitAfterStateWrite);
        }
        emitLifecycleEvent("codex.app_server.ready", { code: "ready", retryable: false });
        return {
          started: true,
          pid: processId,
          status: "running",
          socketPath,
          statePath,
          logPath,
        };
      }

      startupStage = "state_probe";
      if (await pathExists(statePath)) {
        await readJson(statePath);
      }
      startupStage = "readiness_wait";
      await sleep(100);
    }

    const exitAtTimeout = processHandle.exitCode;
    if (exitAtTimeout !== null) {
      return await failAfterExit(exitAtTimeout);
    }
    failureHandled = true;
    const termination = await terminateFailedProcessSafely(processId, {
      terminateProcess: options.terminateProcess,
      pidAlive: options.pidAlive,
      timeoutMs: options.terminationTimeoutMs,
    });
    const metadataRemoved = termination.terminated ? await tryUnlinkIfExists(pidPath) : false;
    const statePersisted = await tryWriteCodexAppServerState(workdir, {
      status: "failed",
      socketPath,
      lastError: { reason: "timeout" },
    });
    throw new CodexAppServerProcessError("codex_app_server_not_ready", "Codex app-server did not create its Unix socket in time.", {
      details: {
        reason: "timeout",
        socket_path: socketPath,
        log_path: logPath,
        termination: terminationEvidence(termination),
        cleanup: { metadata_removed: metadataRemoved, state_persisted: statePersisted },
      },
    });
  } catch (error) {
    if (failureHandled) {
      throw error;
    }
    const termination = processHandle.exitCode === null
      ? await terminateFailedProcessSafely(processId, {
        terminateProcess: options.terminateProcess,
        pidAlive: options.pidAlive,
        timeoutMs: options.terminationTimeoutMs,
      })
      : exitedProcessTermination();
    const metadataRemoved = termination.terminated ? await tryUnlinkIfExists(pidPath) : false;
    const statePersisted = await tryWriteCodexAppServerState(workdir, {
      status: "failed",
      socketPath,
      lastError: { reason: "startup_io_failed", stage: startupStage },
    });
    throw new CodexAppServerProcessError(
      "codex_app_server_not_ready",
      "Codex app-server startup bookkeeping failed.",
      {
        details: {
          reason: "startup_io_failed",
          stage: startupStage,
          log_path: logPath,
          termination: terminationEvidence(termination),
          cleanup: { metadata_removed: metadataRemoved, state_persisted: statePersisted },
        },
      },
    );
  }
}

export async function runCodexAppServerService(
  workdir: string,
  options: { socketPath?: string | null; codexHomePath?: string; memberId?: string | null } = {},
): Promise<number> {
  const selectedSocket = options.socketPath ?? codexAppServerSocketPath(workdir);
  await unlinkIfExists(selectedSocket);
  await mkdir(dirname(selectedSocket), { recursive: true });
  await writeCodexAppServerState(workdir, { status: "running", socketPath: selectedSocket });
  try {
    return await new Promise<number>((resolve, reject) => {
      const child = spawn("codex", ["--enable", "default_mode_request_user_input", "app-server", "--listen", `unix://${selectedSocket}`], {
        cwd: workdir,
        env: codexEnv(workdir, { codexHomePath: options.codexHomePath, memberId: options.memberId }),
        stdio: "inherit",
      });
      child.once("error", () => reject(new CodexAppServerProcessError(
        "codex_app_server_not_ready",
        "Codex app-server process could not be started.",
        { details: { reason: "spawn_failed" } },
      )));
      child.once("exit", (code) => resolve(code ?? 0));
    });
  } finally {
    await unlinkIfExists(selectedSocket);
  }
}

export async function ensureCodexAppServerReady(
  workdir: string,
  options: {
    restart?: (workdir: string) => Promise<Record<string, unknown>> | Record<string, unknown>;
    pidAlive?: (pid: number) => boolean;
    memberId?: string | null;
  } = {},
): Promise<Record<string, unknown>> {
  const status = await codexAppServerStatus(workdir, { pidAlive: options.pidAlive });
  if (status.pid.alive && status.socket.present) {
    return {
      ready: true,
      restarted: false,
      status,
    };
  }
  const restart = await (options.restart ?? ((target) => restartCodexAppServerProcess(target, { memberId: options.memberId })))(workdir);
  const restartedStatus = await codexAppServerStatus(workdir, { pidAlive: options.pidAlive });
  if (!restartedStatus.pid.alive || !restartedStatus.socket.present) {
    throw new CodexAppServerProcessError("codex_app_server_unavailable", "Codex app-server is not available after restart.", {
      details: { before: status, restart, after: restartedStatus },
    });
  }
  return {
    ready: true,
    restarted: true,
    before: status,
    restart,
    status: restartedStatus,
  };
}

export async function codexAppServerStatus(
  workdir: string,
  options: { pidAlive?: (pid: number) => boolean } = {},
): Promise<CodexAppServerStatus> {
  const runtime = runtimeDir(workdir);
  const pidPath = join(runtime, CODEX_APP_SERVER_PID_FILE);
  const statePath = join(runtime, CODEX_APP_SERVER_STATE_FILE);
  const logPath = join(runtime, CODEX_APP_SERVER_LOG_FILE);
  const socketPath = codexAppServerSocketPath(workdir);
  const pidData = (await pathExists(pidPath)) ? await readJson(pidPath) : {};
  const pid = typeof pidData.pid === "number" ? pidData.pid : null;
  return {
    pid: {
      path: pidPath,
      present: await pathExists(pidPath),
      value: pid,
      alive: pid === null ? false : (options.pidAlive ?? pidAlive)(pid),
    },
    state: {
      path: statePath,
      present: await pathExists(statePath),
      data: (await pathExists(statePath)) ? await readJson(statePath) : null,
    },
    socket: {
      path: socketPath,
      present: await pathExists(socketPath),
    },
    log: {
      path: logPath,
      present: await pathExists(logPath),
    },
  };
}

export async function codexAppServerProcessOwned(status: CodexAppServerStatus): Promise<boolean> {
  const processId = status.pid.value;
  if (processId === null || !status.pid.present) {
    return false;
  }
  try {
    const pidData = await readJson(status.pid.path);
    const command = pidData.command;
    const expectedListen = `unix://${status.socket.path}`;
    if (
      pidData.socket_path !== status.socket.path ||
      !Array.isArray(command) ||
      command[0] !== "codex" ||
      command[1] !== "app-server" ||
      !command.includes(expectedListen)
    ) {
      return false;
    }
    const args = (await readFile(`/proc/${processId}/cmdline`, "utf8")).split("\0").filter(Boolean);
    return (
      args.some((value) => basename(value).startsWith("codex")) &&
      args.includes("app-server") &&
      args.includes(expectedListen)
    );
  } catch (_error) {
    return false;
  }
}

export async function restartCodexAppServerProcess(
  workdir: string,
  options: {
    timeoutMs?: number;
    pidAlive?: (pid: number) => boolean;
    killProcess?: (pid: number, signal: NodeJS.Signals) => void;
    spawnProcess?: SpawnAppServerProcess;
    codexHomePath?: string;
    memberId?: string | null;
    terminationTimeoutMs?: number;
  } = {},
): Promise<Record<string, unknown>> {
  const stopped = await stopCodexAppServerProcess(workdir, {
    pidAlive: options.pidAlive,
    killProcess: options.killProcess,
  });
  const started = await startCodexAppServerProcess(workdir, {
    timeoutMs: options.timeoutMs,
    spawnProcess: options.spawnProcess,
    codexHomePath: options.codexHomePath,
    memberId: options.memberId,
    terminateProcess: options.killProcess,
    pidAlive: options.pidAlive,
    terminationTimeoutMs: options.terminationTimeoutMs,
  });
  return {
    restarted: true,
    stopped,
    started: codexAppServerStartResultData(started),
  };
}

export async function stopCodexAppServerProcess(
  workdir: string,
  options: CodexAppServerStopOptions = {},
): Promise<Record<string, unknown>> {
  const status = await codexAppServerStatus(workdir, { pidAlive: options.pidAlive });
  const pid = status.pid.value;
  const socketPath = codexAppServerSocketPath(workdir);
  if (options.expectedPid !== undefined && pid !== options.expectedPid) {
    throw new CodexAppServerProcessError(
      "codex_app_server_process_unowned",
      "Codex app-server process identity could not be verified before stop.",
      { details: { reason: "process_identity_mismatch" } },
    );
  }
  const alive = typeof pid === "number" && status.pid.alive;
  if (alive && options.requireOwned && !(await codexAppServerProcessOwned(status))) {
    throw new CodexAppServerProcessError(
      "codex_app_server_process_unowned",
      "Codex app-server process ownership could not be verified before stop.",
      { details: { reason: "process_ownership_unverified" } },
    );
  }
  if (!alive) {
    await unlinkIfExists(socketPath);
    await unlinkIfExists(join(runtimeDir(workdir), CODEX_APP_SERVER_PID_FILE));
    await writeCodexAppServerState(workdir, { status: "stopped", socketPath });
    return { attempted: false, pid, was_alive: false, terminated: true };
  }
  const termination = await terminateFailedProcess(pid, {
    terminateProcess: options.killProcess,
    pidAlive: options.pidAlive,
    timeoutMs: options.timeoutMs ?? 5_000,
  });
  if (!termination.terminated) {
    await writeCodexAppServerState(workdir, {
      status: "failed",
      socketPath,
      lastError: {
        reason: "termination_failed",
        forced: termination.forced,
        signal_error: termination.error !== null,
      },
    });
    throw new CodexAppServerProcessError(
      "codex_app_server_stop_failed",
      "Codex app-server could not be stopped.",
      {
        details: {
          attempted: termination.attempted,
          was_alive: true,
          terminated: false,
          forced: termination.forced,
          signal_error: termination.error !== null,
        },
      },
    );
  }
  await unlinkIfExists(socketPath);
  await unlinkIfExists(join(runtimeDir(workdir), CODEX_APP_SERVER_PID_FILE));
  await writeCodexAppServerState(workdir, { status: "stopped", socketPath });
  return {
    attempted: termination.attempted,
    pid,
    was_alive: true,
    terminated: true,
    forced: termination.forced,
  };
}

export function codexAppServerStartResultData(value: CodexAppServerStartResult): Record<string, unknown> {
  return {
    started: value.started,
    pid: value.pid,
    status: value.status,
    socket_path: value.socketPath,
    state_path: value.statePath,
    log_path: value.logPath,
  };
}

export function codexAppServerSocketPath(workdir: string): string {
  return join(workdir, ".runtime", CODEX_APP_SERVER_SOCKET_FILE);
}

export async function codexAppServerSocketReady(
  socketPath: string,
  timeoutMs = 250,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection(socketPath);
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(ready);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

export function runtimeDir(workdir: string): string {
  return join(workdir, ".runtime");
}

export function codexEnv(
  workdir: string,
  options: { codexHomePath?: string; memberId?: string | null } = {},
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {
    ...allowedCodexEnvironment(source),
    CODEX_HOME: options.codexHomePath ?? codexHome(workdir),
  };
  if (options.memberId) {
    result.FIELDS_MCP_MEMBER_ID = options.memberId;
    result.GIT_CONFIG_COUNT = "1";
    result.GIT_CONFIG_KEY_0 = "core.excludesFile";
    result.GIT_CONFIG_VALUE_0 = join(result.CODEX_HOME!, FIELDS_GIT_EXCLUDES_FILE);
  } else {
    delete result.FIELDS_MCP_MEMBER_ID;
    delete result.GIT_CONFIG_COUNT;
    delete result.GIT_CONFIG_KEY_0;
    delete result.GIT_CONFIG_VALUE_0;
  }
  return result;
}

function allowedCodexEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const output: NodeJS.ProcessEnv = {};
  for (const name of CODEX_ENV_PASSTHROUGH) {
    const value = nonEmptyEnv(source[name]);
    if (value) output[name] = value;
  }
  return output;
}

export async function writeCodexAppServerState(
  workdir: string,
  input: { status: string; socketPath?: string | null; lastError?: unknown },
): Promise<void> {
  await writeJson(join(runtimeDir(workdir), CODEX_APP_SERVER_STATE_FILE), {
    status: input.status,
    updated_at: Date.now(),
    transport: "unix_socket",
    socket_path: input.socketPath ?? null,
    last_error: input.lastError ?? null,
  });
}

async function writeJson(path: string, data: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await renamePath(tmpPath, path);
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  const value = JSON.parse(await readFile(path, "utf8")) as unknown;
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isPermissionError(error);
  }
}

function nonEmptyEnv(value: string | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function spawnCodexAppServerProcess(
  command: readonly string[],
  input: { cwd: string; env: NodeJS.ProcessEnv; logPath: string },
): Promise<SpawnedProcessLike> {
  await mkdir(dirname(input.logPath), { recursive: true });
  const log = await open(
    input.logPath,
    constants.O_APPEND
      | constants.O_CREAT
      | constants.O_WRONLY
      | constants.O_NOFOLLOW
      | constants.O_NONBLOCK,
    0o600,
  );
  try {
    const logStat = await log.stat();
    if (!logStat.isFile() || logStat.nlink !== 1) {
      throw new Error("Codex app-server log must be a single-link regular file.");
    }
    await log.chmod(0o600);
    const child = spawn(command[0] ?? "", command.slice(1), {
      cwd: input.cwd,
      env: input.env,
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
    });
    await new Promise<void>((resolveSpawn, rejectSpawn) => {
      child.once("spawn", resolveSpawn);
      child.once("error", rejectSpawn);
    });
    return child;
  } finally {
    await log.close();
  }
}

async function terminateFailedProcess(
  processId: number,
  options: {
    terminateProcess?: (pid: number, signal: NodeJS.Signals) => void;
    pidAlive?: (pid: number) => boolean;
    timeoutMs?: number;
  },
): Promise<{ attempted: boolean; terminated: boolean; forced: boolean; error: string | null }> {
  const terminate = options.terminateProcess ?? ((targetPid, signal) => process.kill(targetPid, signal));
  const isAlive = options.pidAlive ?? pidAlive;
  const timeoutMs = options.timeoutMs ?? 1_000;
  if (!isAlive(processId)) {
    return { attempted: false, terminated: true, forced: false, error: null };
  }
  let signalError: string | null = null;
  try {
    terminate(processId, "SIGTERM");
  } catch (error) {
    if (isProcessLookupError(error)) {
      return { attempted: true, terminated: true, forced: false, error: null };
    }
    signalError = errorMessage(error);
  }
  if (await waitForProcessExit(processId, isAlive, timeoutMs)) {
    return { attempted: true, terminated: true, forced: false, error: signalError };
  }
  try {
    terminate(processId, "SIGKILL");
  } catch (error) {
    if (isProcessLookupError(error)) {
      return { attempted: true, terminated: true, forced: true, error: signalError };
    }
    signalError = errorMessage(error);
  }
  return {
    attempted: true,
    terminated: await waitForProcessExit(processId, isAlive, timeoutMs),
    forced: true,
    error: signalError,
  };
}

type ProcessTermination = Awaited<ReturnType<typeof terminateFailedProcess>>;

async function terminateFailedProcessSafely(
  processId: number,
  options: Parameters<typeof terminateFailedProcess>[1],
): Promise<ProcessTermination> {
  try {
    return await terminateFailedProcess(processId, options);
  } catch (_error) {
    return { attempted: false, terminated: false, forced: false, error: "cleanup_failed" };
  }
}

function exitedProcessTermination(): ProcessTermination {
  return { attempted: false, terminated: true, forced: false, error: null };
}

function exitedProcessEvidence(): Record<string, unknown> {
  return terminationEvidence(exitedProcessTermination());
}

function terminationEvidence(value: ProcessTermination): Record<string, unknown> {
  return {
    attempted: value.attempted,
    terminated: value.terminated,
    forced: value.forced,
    signal_error: value.error !== null,
  };
}

async function tryWriteCodexAppServerState(
  workdir: string,
  input: Parameters<typeof writeCodexAppServerState>[1],
): Promise<boolean> {
  try {
    await writeCodexAppServerState(workdir, input);
    return true;
  } catch (_error) {
    return false;
  }
}

async function tryUnlinkIfExists(path: string): Promise<boolean> {
  try {
    await unlinkIfExists(path);
    return true;
  } catch (_error) {
    return false;
  }
}

async function waitForProcessExit(
  processId: number,
  isAlive: (pid: number) => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (isAlive(processId) && Date.now() < deadline) {
    await sleep(Math.min(25, Math.max(1, timeoutMs)));
  }
  return !isAlive(processId);
}

async function unlinkIfExists(path: string): Promise<void> {
  const { rm } = await import("node:fs/promises");
  await rm(path, { force: true });
}

async function renamePath(from: string, to: string): Promise<void> {
  const { rename } = await import("node:fs/promises");
  await rename(from, to);
}

function isProcessLookupError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ESRCH";
}

function isPermissionError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EPERM";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nowMs(): number {
  return Date.now();
}
