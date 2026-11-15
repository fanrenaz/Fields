import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  backendRuntimeProcessDefinitions,
  signalChildProcessGroup,
  superviseBackendRuntime,
  type BackendRuntimeProcessDefinition,
} from "../../src/composition/backend-runtime/main.js";

const definitions: readonly BackendRuntimeProcessDefinition[] = [
  { name: "backend", cwd: "/app/backend", args: ["backend.js"], serviceName: "fields-backend" },
  {
    name: "company-runtime",
    cwd: "/app/company-runtime",
    args: ["runtime.js"],
    serviceName: "fields-company-runtime",
  },
];

test("production definitions keep Backend and Company Runtime as separate Node processes", () => {
  const resolved = backendRuntimeProcessDefinitions(
    "file:///app/backend/dist/composition/backend-runtime/main.js",
  );
  assert.deepEqual(resolved, [
    {
      name: "backend",
      cwd: "/app/backend",
      args: ["--import", "./dist/observability/bootstrap.js", "dist/index.js"],
      serviceName: "fields-backend",
    },
    {
      name: "company-runtime",
      cwd: "/app/company-runtime",
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
  ]);
});

test("process signaling targets the complete POSIX process group", () => {
  const calls: Array<{ pid: number; signal: NodeJS.Signals }> = [];
  signalChildProcessGroup(
    { pid: 42, kill: () => assert.fail("group signaling must be used") },
    "SIGTERM",
    (pid, signal) => {
      calls.push({ pid, signal: signal as NodeJS.Signals });
      return true;
    },
  );
  assert.deepEqual(calls, [{ pid: -42, signal: "SIGTERM" }]);
});

test("supervisor gives each child its own telemetry identity and stops siblings on failure", async () => {
  const children: FakeChild[] = [];
  const spawnOptions: Array<Record<string, unknown>> = [];
  const result = superviseBackendRuntime({
    definitions,
    env: { SHARED: "yes" },
    signalSource: new EventEmitter(),
    spawnProcess: ((_command: string, _args: readonly string[], options: Record<string, unknown>) => {
      spawnOptions.push(options);
      const child = new FakeChild(children.length + 100);
      children.push(child);
      return child;
    }) as never,
    forceShutdownAfterMs: 100,
    killProcess: fakeGroupKill(children),
    writeError: () => undefined,
  });

  children[0]!.finish(7, null);
  assert.equal(await result, 7);
  assert.equal(children[1]!.receivedSignals.includes("SIGTERM"), true);
  assert.deepEqual(spawnOptions.map((options) => options.env), [
    { SHARED: "yes", OTEL_SERVICE_NAME: "fields-backend" },
    { SHARED: "yes", OTEL_SERVICE_NAME: "fields-company-runtime" },
  ]);
});

test("supervisor forwards shutdown signals and exits successfully", async () => {
  const signals = new EventEmitter();
  const children: FakeChild[] = [];
  const result = superviseBackendRuntime({
    definitions,
    signalSource: signals,
    spawnProcess: (() => {
      const child = new FakeChild(children.length + 200);
      children.push(child);
      return child;
    }) as never,
    forceShutdownAfterMs: 100,
    killProcess: fakeGroupKill(children),
    writeError: () => undefined,
  });

  signals.emit("SIGTERM");
  assert.equal(await result, 0);
  assert.equal(children.every((child) => child.receivedSignals.includes("SIGTERM")), true);
});

class FakeChild extends EventEmitter {
  readonly pid: number;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly receivedSignals: NodeJS.Signals[] = [];

  constructor(pid: number) {
    super();
    this.pid = pid;
  }

  kill(signal: NodeJS.Signals): boolean {
    this.receivedSignals.push(signal);
    this.finish(0, signal);
    return true;
  }

  finish(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.signalCode = signal;
    queueMicrotask(() => {
      this.emit("exit", code, signal);
      this.emit("close", code, signal);
    });
  }
}

function fakeGroupKill(children: FakeChild[]): typeof process.kill {
  return ((pid: number, signal: NodeJS.Signals) => {
    const child = children.find((candidate) => candidate.pid === Math.abs(pid));
    if (!child) {
      const error = new Error("missing process") as NodeJS.ErrnoException;
      error.code = "ESRCH";
      throw error;
    }
    return child.kill(signal);
  }) as typeof process.kill;
}
