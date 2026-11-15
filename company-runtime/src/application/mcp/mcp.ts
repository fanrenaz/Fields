import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { runtimeDir } from "../codex/codex-process.js";

export const MCP_STATE_FILE = "mcp-state.json";
export const MCP_PATHS = {
  assets: "/mcp/assets",
  embodiment: "/mcp/embodiment",
  mail: "/mcp/mail",
  roomMessages: "/mcp/room-messages",
  search: "/mcp/search",
} as const;

export type McpStatus = {
  mode: "embedded";
  runtime_pid: {
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
};

export async function mcpStatus(workdir: string): Promise<McpStatus> {
  const runtime = runtimeDir(workdir);
  const runtimePidPath = join(runtime, "runtime.pid");
  const statePath = join(runtime, MCP_STATE_FILE);
  const runtimePidData = (await pathExists(runtimePidPath)) ? await readJson(runtimePidPath) : {};
  const runtimePid = typeof runtimePidData.pid === "number" ? runtimePidData.pid : null;
  const statePresent = await pathExists(statePath);
  return {
    mode: "embedded",
    runtime_pid: {
      path: runtimePidPath,
      present: await pathExists(runtimePidPath),
      value: runtimePid,
      alive: runtimePid === null ? false : pidAlive(runtimePid),
    },
    state: {
      path: statePath,
      present: statePresent,
      data: statePresent ? await readJson(statePath) : null,
    },
  };
}

export async function writeEmbeddedMcpState(
  workdir: string,
  input: {
    status: string;
    host?: string | null;
    port?: number | null;
    runtimeUrl?: string | null;
    lastError?: unknown;
  },
): Promise<void> {
  await writeJson(join(runtimeDir(workdir), MCP_STATE_FILE), {
    status: input.status,
    updated_at: Date.now(),
    mode: "embedded",
    host: input.host ?? null,
    port: input.port ?? null,
    urls: mcpUrlsFromRuntimeUrl(input.runtimeUrl ?? null),
    last_error: input.lastError ?? null,
  });
}

export function mcpUrlsFromRuntimeUrl(
  runtimeUrl: string | null | undefined,
): Record<keyof typeof MCP_PATHS, string> | null {
  if (!runtimeUrl) {
    return null;
  }
  const base = runtimeUrl.endsWith("/health")
    ? runtimeUrl.slice(0, -"/health".length)
    : runtimeUrl.replace(/\/+$/, "");
  return {
    assets: `${base}${MCP_PATHS.assets}`,
    embodiment: `${base}${MCP_PATHS.embodiment}`,
    mail: `${base}${MCP_PATHS.mail}`,
    roomMessages: `${base}${MCP_PATHS.roomMessages}`,
    search: `${base}${MCP_PATHS.search}`,
  };
}

async function writeJson(path: string, data: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
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
  } catch (_error) {
    return false;
  }
}
