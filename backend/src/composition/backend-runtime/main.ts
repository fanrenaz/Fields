import { spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export type BackendRuntimeProcessDefinition = {
  name: "backend" | "company-runtime";
  cwd: string;
  args: readonly string[];
  serviceName: string;
};

export type BackendRuntimeSignalSource = {
  once(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  off(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
};

export type BackendRuntimeSupervisorOptions = {
  definitions?: readonly BackendRuntimeProcessDefinition[];
  env?: NodeJS.ProcessEnv;
  signalSource?: BackendRuntimeSignalSource;
  spawnProcess?: typeof spawn;
  forceShutdownAfterMs?: number;
  killProcess?: typeof process.kill;
  writeError?: (message: string) => void;
};

export function backendRuntimeProcessDefinitions(
  moduleUrl: string = import.meta.url,
): readonly BackendRuntimeProcessDefinition[] {
  const backendRoot = resolve(dirname(fileURLToPath(moduleUrl)), "../../..");
  return [
    {
      name: "backend",
      cwd: backendRoot,
      args: [
        "--import",
        "./dist/observability/bootstrap.js",
        "dist/index.js",
      ],
      serviceName: "fields-backend",
    },
    {
      name: "company-runtime",
      cwd: resolve(backendRoot, "../company-runtime"),
      args: [
        "--import",
        "./dist/observability/bootstrap.js",
        "dist/interface/server.js",
        "--workdir",
        "/workdir",
        "--host",
        "0.0.0.0",
      ],
      serviceName: "fields-company-runtime",
    },
  ];
}

export async function superviseBackendRuntime(
  options: BackendRuntimeSupervisorOptions = {},
): Promise<number> {
  const definitions = options.definitions ?? backendRuntimeProcessDefinitions();
  const sourceEnvironment = options.env ?? process.env;
  const signalSource = options.signalSource ?? process;
  const spawnProcess = options.spawnProcess ?? spawn;
  const forceShutdownAfterMs = options.forceShutdownAfterMs ?? 20_000;
  const killProcess = options.killProcess ?? process.kill;
  const writeError = options.writeError ?? ((message: string) => process.stderr.write(message));
  const children = new Map<string, ChildProcess>();
  const closed = new Map<string, Promise<void>>();
  let stopping = false;
  let requestedExitCode = 0;
  let resolveExit!: (code: number) => void;
  const exit = new Promise<number>((resolvePromise) => {
    resolveExit = resolvePromise;
  });

  const stop = (code: number) => {
    if (stopping) {
      if (code !== 0) requestedExitCode = code;
      return;
    }
    stopping = true;
    requestedExitCode = code;
    for (const child of children.values()) {
      if (child.exitCode === null && child.signalCode === null) {
        signalChildProcessGroup(child, "SIGTERM", killProcess);
      }
    }
    const timer = setTimeout(() => {
      for (const child of children.values()) {
        if (child.exitCode === null && child.signalCode === null) {
          signalChildProcessGroup(child, "SIGKILL", killProcess);
        }
      }
    }, forceShutdownAfterMs);
    timer.unref();
    void Promise.all(closed.values()).then(() => {
      clearTimeout(timer);
      resolveExit(requestedExitCode);
    });
  };

  for (const definition of definitions) {
    const child = spawnProcess(process.execPath, [...definition.args], {
      cwd: definition.cwd,
      detached: process.platform !== "win32",
      env: {
        ...sourceEnvironment,
        OTEL_SERVICE_NAME: definition.serviceName,
      },
      stdio: "inherit",
    });
    children.set(definition.name, child);
    closed.set(definition.name, new Promise((resolvePromise) => {
      child.once("close", () => resolvePromise());
    }));
    child.once("error", (error) => {
      writeError(`[backend-runtime-supervisor] ${definition.name} failed to start: ${error.message}\n`);
      stop(1);
    });
    child.once("exit", (code, signal) => {
      if (stopping) return;
      writeError(
        `[backend-runtime-supervisor] ${definition.name} exited unexpectedly (${signal ?? code ?? "unknown"}).\n`,
      );
      stop(code !== null && code > 0 ? code : 1);
    });
  }

  const onSignal = () => stop(0);
  signalSource.once("SIGINT", onSignal);
  signalSource.once("SIGTERM", onSignal);
  try {
    return await exit;
  } finally {
    signalSource.off("SIGINT", onSignal);
    signalSource.off("SIGTERM", onSignal);
  }
}

export function signalChildProcessGroup(
  child: Pick<ChildProcess, "pid" | "kill">,
  signal: NodeJS.Signals,
  killProcess: typeof process.kill = process.kill,
): void {
  if (process.platform !== "win32" && Number.isSafeInteger(child.pid) && child.pid! > 0) {
    try {
      killProcess(-child.pid!, signal);
      return;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") return;
      throw error;
    }
  }
  child.kill(signal);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await superviseBackendRuntime();
}
