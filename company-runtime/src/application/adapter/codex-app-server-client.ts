import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

import type { ClientNotification } from "../../generated/codex-app-server-protocol/ClientNotification.js";
import type { ClientRequest } from "../../generated/codex-app-server-protocol/ClientRequest.js";
import type { RequestId } from "../../generated/codex-app-server-protocol/RequestId.js";
import { codexEnv } from "../codex/codex-process.js";

export type JsonRpcId = RequestId;
export type JsonObject = Record<string, unknown>;

export type CodexAppServerNotification = {
  method: string;
  params?: unknown;
  message: JsonObject;
};

export type CodexAppServerRequest = {
  id: JsonRpcId;
  method: string;
  params?: unknown;
  message: JsonObject;
};

export type CodexAppServerMessage =
  | { type: "response"; id: JsonRpcId; result: unknown; message: JsonObject }
  | { type: "error"; id: JsonRpcId | null; error: JsonObject; message: JsonObject }
  | ({ type: "notification" } & CodexAppServerNotification)
  | ({ type: "request" } & CodexAppServerRequest);

export interface CodexAppServerTransport {
  readMessage(deadlineMs: number): Promise<string | null> | string | null;
  writeMessage(message: JsonObject): Promise<void> | void;
  close(): Promise<void> | void;
}

type ClientRequestMethod = ClientRequest["method"];

export interface AppServerClient {
  readMessage(deadlineMs: number): Promise<JsonObject | null> | JsonObject | null;
  writeMessage(message: JsonObject): Promise<void> | void;
  sendRequest(method: ClientRequestMethod, params: ClientRequest["params"]): Promise<RequestId>;
  sendNotification(notification: ClientNotification): Promise<void>;
  sendResponse(id: RequestId, result: unknown): Promise<void>;
  close(): Promise<void> | void;
}

export type CodexAppServerClientOptions = {
  defaultTimeoutMs?: number;
  idFactory?: () => JsonRpcId;
  onNotification?: (notification: CodexAppServerNotification) => Promise<void> | void;
  onRequest?: (request: CodexAppServerRequest) => Promise<unknown> | unknown;
  onUnmatchedError?: (error: CodexAppServerJsonRpcError) => Promise<void> | void;
};

export class CodexAppServerClientError extends Error {
  readonly code: string;
  readonly details: JsonObject;

  constructor(code: string, message: string, options: { details?: JsonObject } = {}) {
    super(message);
    this.name = "CodexAppServerClientError";
    this.code = code;
    this.details = options.details ?? {};
  }
}

export class CodexAppServerJsonRpcError extends CodexAppServerClientError {
  readonly requestId: JsonRpcId | null;
  readonly appServerError: JsonObject;

  constructor(requestId: JsonRpcId | null, appServerError: JsonObject, message = "Codex app-server returned an error.") {
    super("app_server_error", appServerErrorMessage(appServerError) || message, {
      details: { request_id: requestId, app_server_error: appServerError },
    });
    this.name = "CodexAppServerJsonRpcError";
    this.requestId = requestId;
    this.appServerError = appServerError;
  }
}

export class CodexAppServerClient implements AppServerClient {
  private readonly transport: CodexAppServerTransport;
  private readonly options: Required<Pick<CodexAppServerClientOptions, "defaultTimeoutMs" | "idFactory">> &
    Omit<CodexAppServerClientOptions, "defaultTimeoutMs" | "idFactory">;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private closed = false;

  constructor(transport: CodexAppServerTransport, options: CodexAppServerClientOptions = {}) {
    this.transport = transport;
    this.options = {
      defaultTimeoutMs: options.defaultTimeoutMs ?? 60_000,
      idFactory: options.idFactory ?? randomUUID,
      onNotification: options.onNotification,
      onRequest: options.onRequest,
      onUnmatchedError: options.onUnmatchedError,
    };
  }

  static fromProcess(
    command: readonly string[],
    input: { workdir: string; codexHomePath?: string },
    options: CodexAppServerClientOptions = {},
  ): CodexAppServerClient {
    return new CodexAppServerClient(new ProcessCodexAppServerTransport(command, input), options);
  }

  static fromUnixSocket(socketPath: string, options: CodexAppServerClientOptions = {}): CodexAppServerClient {
    return new CodexAppServerClient(new UnixSocketCodexAppServerTransport(socketPath), options);
  }

  async request<TResult = unknown>(
    method: ClientRequestMethod,
    params: ClientRequest["params"],
    options: { timeoutMs?: number } = {},
  ): Promise<TResult> {
    const id = await this.sendRequest(method, params);
    return (await this.waitForResponse(id, options)) as TResult;
  }

  async sendRequest(method: ClientRequestMethod, params: ClientRequest["params"]): Promise<RequestId> {
    const id = this.options.idFactory();
    const message: JsonObject = { id, method };
    if (params !== undefined) {
      message.params = params;
    }
    this.pending.set(id, { id, method });
    await this.write(message);
    return id;
  }

  async notify(notification: ClientNotification): Promise<void> {
    await this.sendNotification(notification);
  }

  async sendNotification(notification: ClientNotification): Promise<void> {
    await this.write(notification);
  }

  async sendResponse(id: RequestId, result: unknown): Promise<void> {
    await this.write({ id, result });
  }

  async writeMessage(message: JsonObject): Promise<void> {
    await this.write(message);
  }

  async readMessage(deadlineMs: number): Promise<JsonObject | null> {
    const raw = await this.transport.readMessage(deadlineMs);
    if (raw === null) {
      return null;
    }
    return jsonObject(raw);
  }

  async readNext(deadlineMs: number): Promise<CodexAppServerMessage | null> {
    const message = await this.readMessage(deadlineMs);
    if (message === null) {
      return null;
    }
    return this.routeMessage(message);
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.transport.close();
  }

  private async waitForResponse(id: JsonRpcId, options: { timeoutMs?: number }): Promise<unknown> {
    const deadlineMs = Date.now() + (options.timeoutMs ?? this.options.defaultTimeoutMs);
    while (Date.now() < deadlineMs) {
      const routed = await this.readNext(deadlineMs);
      if (routed === null) {
        break;
      }
      if ((routed.type === "response" || routed.type === "error") && routed.id === id) {
        const pending = this.pending.get(id);
        this.pending.delete(id);
        if (pending?.error !== undefined) {
          throw pending.error;
        }
        return pending?.result;
      }
    }
    this.pending.delete(id);
    throw new CodexAppServerClientError("app_server_timeout", `Timed out waiting for Codex app-server response to ${String(id)}.`);
  }

  private async routeMessage(message: JsonObject): Promise<CodexAppServerMessage> {
    if ("error" in message) {
      const id = jsonRpcIdOrNull(message.id);
      const error = asRecord(message.error);
      if (error === null) {
        throw new CodexAppServerClientError("invalid_app_server_message", "Codex app-server error response is missing error object.", {
          details: { message },
        });
      }
      const routedError = new CodexAppServerJsonRpcError(id, error);
      if (id !== null && this.pending.has(id)) {
        this.pending.set(id, { ...this.pending.get(id), id, error: routedError });
      } else {
        await this.options.onUnmatchedError?.(routedError);
      }
      return { type: "error", id, error, message };
    }

    const id = jsonRpcIdOrNull(message.id);
    if (id !== null && "result" in message) {
      if (this.pending.has(id)) {
        this.pending.set(id, { ...this.pending.get(id), id, result: message.result });
      }
      return { type: "response", id, result: message.result, message };
    }

    if (typeof message.method !== "string") {
      throw new CodexAppServerClientError("invalid_app_server_message", "Codex app-server message is missing method.", {
        details: { message },
      });
    }

    if (id !== null) {
      const request: CodexAppServerRequest = { id, method: message.method, params: message.params, message };
      const response = await this.options.onRequest?.(request);
      if (response !== undefined) {
        await this.write({ id, result: response });
      }
      return { type: "request", ...request };
    }

    const notification: CodexAppServerNotification = { method: message.method, params: message.params, message };
    await this.options.onNotification?.(notification);
    return { type: "notification", ...notification };
  }

  private async write(message: JsonObject): Promise<void> {
    if (this.closed) {
      throw new CodexAppServerClientError("app_server_unavailable", "Codex app-server client is closed.");
    }
    await this.transport.writeMessage(message);
  }
}

export class ProcessCodexAppServerTransport implements CodexAppServerTransport {
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly queue: string[] = [];
  private readonly waiters: Array<() => void> = [];
  private buffer = "";
  private closed = false;
  private failure: Error | null = null;

  constructor(
    command: readonly string[],
    input: { workdir: string; codexHomePath?: string },
  ) {
    this.process = spawn(command[0] ?? "", command.slice(1), {
      cwd: input.workdir,
      env: codexEnv(input.workdir, { codexHomePath: input.codexHomePath }),
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process.stdout.setEncoding("utf8");
    this.process.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let newline = this.buffer.indexOf("\n");
      while (newline !== -1) {
        const line = this.buffer.slice(0, newline + 1);
        this.buffer = this.buffer.slice(newline + 1);
        this.queue.push(line);
        this.wake();
        newline = this.buffer.indexOf("\n");
      }
    });
    // Provider stderr can contain arbitrary diagnostics. Drain it so a noisy
    // child cannot block, but never forward it to process logs or telemetry.
    this.process.stderr.on("data", () => undefined);
    this.process.once("error", (error) => {
      this.failure = error;
      this.closed = true;
      this.wake();
    });
    this.process.once("close", () => {
      this.closed = true;
      if (this.buffer.length > 0) {
        this.queue.push(this.buffer);
        this.buffer = "";
      }
      this.wake();
    });
  }

  async readMessage(deadlineMs: number): Promise<string | null> {
    while (Date.now() < deadlineMs) {
      const queued = this.queue.shift();
      if (queued !== undefined) {
        return queued;
      }
      if (this.failure !== null) {
        throw this.failure;
      }
      if (this.closed || this.process.exitCode !== null) {
        throw new CodexAppServerClientError("app_server_exited", "Codex app-server exited before a response was received.", {
          details: { exit_code: this.process.exitCode },
        });
      }
      await this.waitForActivity(Math.min(500, Math.max(0, deadlineMs - Date.now())));
    }
    return null;
  }

  writeMessage(message: JsonObject): void {
    if (this.process.stdin.destroyed) {
      throw new CodexAppServerClientError("app_server_unavailable", "Codex app-server stdin is unavailable.");
    }
    this.process.stdin.write(`${stableStringify(message)}\n`, "utf8");
  }

  async close(): Promise<void> {
    await terminateProcess(this.process);
  }

  private waitForActivity(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timeout);
        const index = this.waiters.indexOf(done);
        if (index !== -1) {
          this.waiters.splice(index, 1);
        }
        resolve();
      };
      const timeout = setTimeout(done, timeoutMs);
      this.waiters.push(done);
    });
  }

  private wake(): void {
    for (const waiter of [...this.waiters]) {
      waiter();
    }
  }
}

export class UnixSocketCodexAppServerTransport implements CodexAppServerTransport {
  private readonly websocket: WebSocket;
  private readonly ready: Promise<void>;
  private readonly queue: string[] = [];
  private readonly waiters: Array<() => void> = [];
  private closed = false;
  private failure: Error | null = null;

  constructor(socketPath: string) {
    this.websocket = new WebSocket(`ws+unix://${socketPath}:/`, {
      perMessageDeflate: false,
    });
    this.ready = new Promise((resolve, reject) => {
      this.websocket.once("open", resolve);
      this.websocket.once("error", reject);
    });
    this.websocket.on("message", (data, isBinary) => {
      if (isBinary) {
        this.failure = new CodexAppServerClientError("invalid_app_server_message", "Codex app-server websocket message must be text.");
      } else {
        this.queue.push(typeof data === "string" ? data : data.toString("utf8"));
      }
      this.wake();
    });
    this.websocket.on("close", () => {
      this.closed = true;
      this.wake();
    });
    this.websocket.on("error", (error) => {
      this.failure = error;
      this.wake();
    });
  }

  async readMessage(deadlineMs: number): Promise<string | null> {
    await this.ready;
    while (Date.now() < deadlineMs) {
      const queued = this.queue.shift();
      if (queued !== undefined) {
        return queued;
      }
      if (this.failure !== null) {
        throw this.failure;
      }
      if (this.closed) {
        throw new CodexAppServerClientError("app_server_exited", "Codex app-server websocket closed before a response was received.");
      }
      await this.waitForActivity(Math.min(500, Math.max(0, deadlineMs - Date.now())));
    }
    return null;
  }

  async writeMessage(message: JsonObject): Promise<void> {
    await this.ready;
    this.websocket.send(stableStringify(message));
  }

  close(): void {
    this.websocket.close();
  }

  private waitForActivity(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timeout);
        const index = this.waiters.indexOf(done);
        if (index !== -1) {
          this.waiters.splice(index, 1);
        }
        resolve();
      };
      const timeout = setTimeout(done, timeoutMs);
      this.waiters.push(done);
    });
  }

  private wake(): void {
    for (const waiter of [...this.waiters]) {
      waiter();
    }
  }
}

type PendingRequest = {
  id: JsonRpcId;
  method?: string;
  result?: unknown;
  error?: CodexAppServerJsonRpcError;
};

async function terminateProcess(processToTerminate: ChildProcessWithoutNullStreams): Promise<void> {
  if (processToTerminate.exitCode !== null) {
    return;
  }
  processToTerminate.kill("SIGTERM");
  const terminated = await waitForProcessExit(processToTerminate, 5_000);
  if (terminated) {
    return;
  }
  processToTerminate.kill("SIGKILL");
  await waitForProcessExit(processToTerminate, 5_000);
}

function waitForProcessExit(processToWaitFor: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (processToWaitFor.exitCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      processToWaitFor.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = (): void => {
      clearTimeout(timeout);
      resolve(true);
    };
    processToWaitFor.once("exit", onExit);
  });
}

function jsonObject(raw: string): JsonObject {
  const value = JSON.parse(raw) as unknown;
  if (!isRecord(value)) {
    throw new CodexAppServerClientError("invalid_app_server_message", "Codex app-server message must be a JSON object.");
  }
  return value;
}

function appServerErrorMessage(error: JsonObject): string {
  return typeof error.message === "string" ? error.message : "";
}

function jsonRpcIdOrNull(value: unknown): JsonRpcId | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function asRecord(value: unknown): JsonObject | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (!isRecord(value)) {
    return value;
  }
  const output: JsonObject = {};
  for (const key of Object.keys(value).sort()) {
    output[key] = sortJson(value[key]);
  }
  return output;
}
