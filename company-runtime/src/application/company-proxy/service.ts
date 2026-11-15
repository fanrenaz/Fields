import { once } from "node:events";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { chmod, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { connect as connectTls, type TLSSocket } from "node:tls";

import type {
  CompanyProxyDisableInput,
  CompanyProxySetInput,
  CompanyProxyStatus,
} from "@fields/contracts/public/executor";

const LOOPBACK_BYPASS = "localhost,127.0.0.1,::1";
const PROBE_TARGETS = ["chatgpt.com", "auth.openai.com", "api.openai.com"] as const;
const PROBE_TIMEOUT_MS = 10_000;

type StoredProxy = {
  protocol: CompanyProxySetInput["protocol"];
  endpoint_host: string;
  endpoint_port: number;
  credentials: CompanyProxySetInput["credentials"];
};
type StoredState = {
  revision: number;
  updated_at_ms: number;
  proxy: StoredProxy | null;
};

export type CompanyProxyServiceOptions = {
  prepare: () => Promise<void>;
  activate: () => Promise<void>;
  rollback: () => Promise<void>;
  stopExecutorAppServers: () => Promise<void>;
  closeBrowserTunnels?: () => Promise<void>;
  hasPendingAuthorization: () => boolean;
  nowMs?: () => number;
  probe?: (proxy: StoredProxy) => Promise<void>;
};

export class CompanyProxyError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "CompanyProxyError";
  }
}

export class CompanyProxyService {
  private readonly activePath: string;
  private readonly pendingPath: string;
  private current: StoredProxy | null = null;
  private revision = 0;
  private updatedAtMs: number | null = null;
  private flight: Promise<CompanyProxyStatus> | null = null;

  constructor(
    workdir: string,
    private readonly options: CompanyProxyServiceOptions,
  ) {
    const root = join(workdir, "company");
    this.activePath = join(root, "proxy.json");
    this.pendingPath = join(root, "proxy.pending.json");
  }

  async initialize(): Promise<void> {
    await mkdir(dirname(this.activePath), { recursive: true, mode: 0o700 });
    await chmod(dirname(this.activePath), 0o700);
    await unlink(this.pendingPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    const stored = await this.readStored(this.activePath);
    this.current = stored?.proxy ?? null;
    this.revision = stored?.revision ?? 0;
    this.updatedAtMs = stored?.updated_at_ms ?? null;
  }

  status(): CompanyProxyStatus {
    const proxy = this.current;
    return {
      enabled: proxy !== null,
      protocol: proxy?.protocol ?? null,
      endpoint_host: proxy?.endpoint_host ?? null,
      endpoint_port: proxy?.endpoint_port ?? null,
      authentication: proxy
        ? proxy.credentials ? "username_password" : "none"
        : null,
      revision: this.revision,
      updated_at_ms: this.updatedAtMs,
    };
  }

  environment(): NodeJS.ProcessEnv {
    const proxy = this.current;
    if (!proxy) {
      return {
        HTTP_PROXY: undefined,
        HTTPS_PROXY: undefined,
        ALL_PROXY: undefined,
        NO_PROXY: LOOPBACK_BYPASS,
        http_proxy: undefined,
        https_proxy: undefined,
        all_proxy: undefined,
        no_proxy: LOOPBACK_BYPASS,
      };
    }
    const authority = proxy.credentials
      ? `${encodeURIComponent(proxy.credentials.username)}:${encodeURIComponent(proxy.credentials.password)}@`
      : "";
    const scheme = proxy.protocol === "socks5" ? "socks5h" : proxy.protocol;
    const endpoint = `${scheme}://${authority}${formatHost(proxy.endpoint_host)}:${proxy.endpoint_port}`;
    if (proxy.protocol === "socks5") {
      return {
        HTTP_PROXY: undefined,
        HTTPS_PROXY: undefined,
        ALL_PROXY: endpoint,
        NO_PROXY: LOOPBACK_BYPASS,
        http_proxy: undefined,
        https_proxy: undefined,
        all_proxy: endpoint,
        no_proxy: LOOPBACK_BYPASS,
      };
    }
    return {
      HTTP_PROXY: endpoint,
      HTTPS_PROXY: endpoint,
      ALL_PROXY: undefined,
      NO_PROXY: LOOPBACK_BYPASS,
      http_proxy: endpoint,
      https_proxy: endpoint,
      all_proxy: undefined,
      no_proxy: LOOPBACK_BYPASS,
    };
  }

  async openBrowserTunnel(targetAddress: string): Promise<Socket | TLSSocket> {
    const proxy = this.current;
    if (!proxy) return tcpSocket(targetAddress, 443);
    const socket = proxy.protocol === "https"
      ? await tlsSocket(proxy.endpoint_host, proxy.endpoint_port, proxy.endpoint_host)
      : await tcpSocket(proxy.endpoint_host, proxy.endpoint_port);
    try {
      if (proxy.protocol === "socks5") {
        await socksHandshake(socket as Socket, proxy, targetAddress);
      } else {
        await connectHandshake(socket, proxy, targetAddress);
      }
      socket.setTimeout(0);
      return socket;
    } catch (error) {
      socket.destroy();
      throw error;
    }
  }

  set(input: CompanyProxySetInput): Promise<CompanyProxyStatus> {
    return this.mutate(input.expected_revision, {
      protocol: input.protocol,
      endpoint_host: input.endpoint_host,
      endpoint_port: input.endpoint_port,
      credentials: input.credentials,
    }, true);
  }

  disable(input: CompanyProxyDisableInput): Promise<CompanyProxyStatus> {
    return this.mutate(input.expected_revision, null, false);
  }

  private mutate(
    expectedRevision: number,
    candidate: StoredProxy | null,
    shouldProbe: boolean,
  ): Promise<CompanyProxyStatus> {
    if (this.flight) {
      throw new CompanyProxyError(
        "company_proxy_reconfigure_in_progress",
        "A Company proxy change is already in progress.",
        true,
      );
    }
    if (expectedRevision !== this.revision) {
      throw new CompanyProxyError(
        "company_proxy_revision_conflict",
        "The Company proxy was changed by another request.",
      );
    }
    if (this.options.hasPendingAuthorization()) {
      throw new CompanyProxyError(
        "company_proxy_authorization_in_progress",
        "Finish or cancel the active Codex authorization before changing the proxy.",
      );
    }
    const flight = this.applyCandidate(candidate, shouldProbe).finally(() => {
      if (this.flight === flight) this.flight = null;
    });
    this.flight = flight;
    return flight;
  }

  private async applyCandidate(
    candidate: StoredProxy | null,
    shouldProbe: boolean,
  ): Promise<CompanyProxyStatus> {
    const previous: StoredState = {
      proxy: this.current,
      revision: this.revision,
      updated_at_ms: this.updatedAtMs ?? 0,
    };
    if (candidate && shouldProbe) {
      await (this.options.probe ?? probeCompanyProxy)(candidate);
    }
    const next: StoredState = {
      proxy: candidate,
      revision: this.revision + 1,
      updated_at_ms: (this.options.nowMs ?? Date.now)(),
    };
    await this.writeStored(this.pendingPath, next);
    let prepared = false;
    try {
      prepared = true;
      await this.options.prepare();
      await this.writeStored(this.activePath, next);
      this.current = candidate;
      this.revision = next.revision;
      this.updatedAtMs = next.updated_at_ms;
      await this.options.stopExecutorAppServers();
      await this.options.closeBrowserTunnels?.();
      await this.options.activate();
      await unlink(this.pendingPath).catch(() => undefined);
      return this.status();
    } catch (error) {
      await this.writeStored(this.activePath, previous).catch(() => undefined);
      this.current = previous.proxy;
      this.revision = previous.revision;
      this.updatedAtMs = previous.updated_at_ms || null;
      if (prepared) await this.options.rollback().catch(() => undefined);
      await unlink(this.pendingPath).catch(() => undefined);
      if (error instanceof CompanyProxyError) throw error;
      throw new CompanyProxyError(
        "company_proxy_reconfigure_failed",
        "The Company proxy change could not be applied.",
        true,
      );
    }
  }

  private async readStored(path: string): Promise<StoredState | null> {
    let handle;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const metadata = await handle.stat();
      if (!metadata.isFile()) throw new Error("Proxy state is not a regular file.");
      const parsed = JSON.parse(await handle.readFile("utf8")) as unknown;
      if (!isStoredState(parsed)) throw new Error("Proxy state shape is invalid.");
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new CompanyProxyError("company_proxy_store_invalid", "The stored Company proxy is invalid.");
    } finally {
      await handle?.close();
    }
  }

  private async writeStored(path: string, state: StoredState): Promise<void> {
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    const temporaryHandle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    try {
      await temporaryHandle.writeFile(`${JSON.stringify(state)}\n`, "utf8");
      await temporaryHandle.sync();
    } finally {
      await temporaryHandle.close();
    }
    await rename(temporary, path).catch(async (error) => {
      await unlink(temporary).catch(() => undefined);
      throw error;
    });
    const handle = await open(path, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}

async function probeCompanyProxy(proxy: StoredProxy): Promise<void> {
  try {
    await Promise.all(PROBE_TARGETS.map((target) => probeTarget(proxy, target)));
  } catch (error) {
    if (error instanceof CompanyProxyError) throw error;
    throw new CompanyProxyError(
      "company_proxy_probe_failed",
      "The proxy could not reach the required OpenAI services.",
      true,
    );
  }
}

async function probeTarget(proxy: StoredProxy, target: string): Promise<void> {
  const socket = proxy.protocol === "https"
    ? await tlsSocket(proxy.endpoint_host, proxy.endpoint_port, proxy.endpoint_host)
    : await tcpSocket(proxy.endpoint_host, proxy.endpoint_port);
  try {
    if (proxy.protocol === "socks5") {
      await socksHandshake(socket, proxy, target);
    } else {
      await connectHandshake(socket, proxy, target);
    }
    const targetTls = connectTls({ socket, servername: target });
    targetTls.setTimeout(PROBE_TIMEOUT_MS);
    await Promise.race([
      once(targetTls, "secureConnect"),
      once(targetTls, "error").then(([error]) => Promise.reject(error)),
      once(targetTls, "timeout").then(() => Promise.reject(new Error("timeout"))),
    ]);
    targetTls.destroy();
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

async function connectHandshake(socket: Socket | TLSSocket, proxy: StoredProxy, target: string) {
  const authorization = proxy.credentials
    ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.credentials.username}:${proxy.credentials.password}`).toString("base64")}\r\n`
    : "";
  socket.write(`CONNECT ${target}:443 HTTP/1.1\r\nHost: ${target}:443\r\n${authorization}Connection: keep-alive\r\n\r\n`);
  const response = await readUntil(socket, "\r\n\r\n");
  const status = /^HTTP\/1\.[01] (\d{3})/u.exec(response)?.[1];
  if (status === "407") {
    throw new CompanyProxyError("company_proxy_authentication_failed", "The proxy rejected the supplied credentials.");
  }
  if (!status || !status.startsWith("2")) {
    throw new CompanyProxyError("company_proxy_unreachable", "The proxy could not open the required tunnel.", true);
  }
}

async function socksHandshake(socket: Socket, proxy: StoredProxy, target: string) {
  socket.write(proxy.credentials ? Buffer.from([5, 2, 0, 2]) : Buffer.from([5, 1, 0]));
  const greeting = await readBytes(socket, 2);
  if (greeting[0] !== 5 || greeting[1] === 0xff) {
    throw new CompanyProxyError("company_proxy_authentication_failed", "The SOCKS5 proxy rejected authentication.");
  }
  if (greeting[1] === 2) {
    if (!proxy.credentials) {
      throw new CompanyProxyError("company_proxy_authentication_failed", "The SOCKS5 proxy requires credentials.");
    }
    const username = Buffer.from(proxy.credentials.username);
    const password = Buffer.from(proxy.credentials.password);
    if (username.length > 255 || password.length > 255) {
      throw new CompanyProxyError("company_proxy_authentication_failed", "SOCKS5 credentials are too long.");
    }
    socket.write(Buffer.concat([
      Buffer.from([1, username.length]), username,
      Buffer.from([password.length]), password,
    ]));
    const auth = await readBytes(socket, 2);
    if (auth[1] !== 0) {
      throw new CompanyProxyError("company_proxy_authentication_failed", "The SOCKS5 proxy rejected the supplied credentials.");
    }
  } else if (greeting[1] !== 0) {
    throw new CompanyProxyError("company_proxy_authentication_failed", "The SOCKS5 authentication method is unsupported.");
  }
  const domain = Buffer.from(target);
  socket.write(Buffer.concat([
    Buffer.from([5, 1, 0, 3, domain.length]),
    domain,
    Buffer.from([1, 187]),
  ]));
  const reply = await readBytes(socket, 4);
  if (reply[1] !== 0) {
    throw new CompanyProxyError("company_proxy_unreachable", "The SOCKS5 proxy could not reach the required service.", true);
  }
  const addressLength = reply[3] === 1 ? 4 : reply[3] === 4 ? 16 : (await readBytes(socket, 1))[0]!;
  await readBytes(socket, addressLength + 2);
}

async function tcpSocket(host: string, port: number): Promise<Socket> {
  const socket = createConnection({ host, port });
  socket.setTimeout(PROBE_TIMEOUT_MS);
  try {
    await Promise.race([
      once(socket, "connect"),
      once(socket, "error").then(([error]) => Promise.reject(error)),
      once(socket, "timeout").then(() => Promise.reject(new Error("timeout"))),
    ]);
    return socket;
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

async function tlsSocket(host: string, port: number, servername: string): Promise<TLSSocket> {
  const socket = connectTls({ host, port, servername });
  socket.setTimeout(PROBE_TIMEOUT_MS);
  try {
    await Promise.race([
      once(socket, "secureConnect"),
      once(socket, "error").then(([error]) => Promise.reject(error)),
      once(socket, "timeout").then(() => Promise.reject(new Error("timeout"))),
    ]);
    return socket;
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

async function readBytes(socket: Socket | TLSSocket, length: number): Promise<Buffer> {
  while (true) {
    const value = socket.read(length) as Buffer | null;
    if (value) return value;
    await Promise.race([
      once(socket, "readable"),
      once(socket, "error").then(([error]) => Promise.reject(error)),
      once(socket, "timeout").then(() => Promise.reject(new Error("timeout"))),
      once(socket, "end").then(() => Promise.reject(new Error("Proxy closed the connection."))),
    ]);
  }
}

async function readUntil(socket: Socket | TLSSocket, marker: string): Promise<string> {
  let value = "";
  while (!value.includes(marker)) {
    const chunk = socket.read() as Buffer | null;
    if (!chunk) {
      await Promise.race([
        once(socket, "readable"),
        once(socket, "error").then(([error]) => Promise.reject(error)),
        once(socket, "timeout").then(() => Promise.reject(new Error("timeout"))),
        once(socket, "end").then(() => Promise.reject(new Error("Proxy closed the connection."))),
      ]);
      continue;
    }
    value += chunk.toString("latin1");
    if (value.length > 16_384) throw new Error("Proxy response is too large.");
  }
  return value;
}

function formatHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function isStoredState(value: unknown): value is StoredState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<StoredState>;
  if (
    !Number.isInteger(state.revision)
    || (state.revision ?? -1) < 0
    || !Number.isInteger(state.updated_at_ms)
    || (state.updated_at_ms ?? -1) < 0
  ) return false;
  if (state.proxy === null) return true;
  const proxy = state.proxy;
  if (!proxy || typeof proxy !== "object") return false;
  if (!["http", "https", "socks5"].includes(proxy.protocol)) return false;
  if (typeof proxy.endpoint_host !== "string" || proxy.endpoint_host.length === 0) return false;
  if (!Number.isInteger(proxy.endpoint_port) || proxy.endpoint_port < 1 || proxy.endpoint_port > 65_535) return false;
  if (proxy.credentials === null) return true;
  return Boolean(
    proxy.credentials
    && typeof proxy.credentials.username === "string"
    && proxy.credentials.username.length > 0
    && typeof proxy.credentials.password === "string"
    && proxy.credentials.password.length > 0,
  );
}
