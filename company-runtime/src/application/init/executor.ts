import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  EXECUTORS_DIR,
  MEMBER_CODEX_HOME_DIR,
  safePathComponent,
} from "../../infrastructure/filesystem/workspace.js";

export const CODEX_HOME_DIR = MEMBER_CODEX_HOME_DIR;
export const COMPANY_EXECUTOR_AUTH_FILE = "auth.json";
export const COMPANY_EXECUTOR_CUSTOM_API_FILE = "custom-api.json";
export const CODEX_CONFIG_FILE = "config.toml";
export const COMPANY_EXECUTORS_DIR = EXECUTORS_DIR;

export function codexHome(workdir: string): string {
  return join(workdir, CODEX_HOME_DIR);
}

export function companyExecutorRoot(workdir: string, executorId: string): string {
  return join(workdir, COMPANY_EXECUTORS_DIR, safePathComponent(executorId, "executor_id"));
}

export function companyExecutorCodexHome(workdir: string, executorId: string): string {
  return join(companyExecutorRoot(workdir, executorId), "credentials");
}

export function companyExecutorAuthPath(workdir: string, executorId: string): string {
  return join(companyExecutorCodexHome(workdir, executorId), COMPANY_EXECUTOR_AUTH_FILE);
}

export function companyExecutorCustomApiPath(workdir: string, executorId: string): string {
  return join(companyExecutorCodexHome(workdir, executorId), COMPANY_EXECUTOR_CUSTOM_API_FILE);
}

export async function ensureCompanyExecutorCodexHome(workdir: string, executorId: string): Promise<string> {
  const home = companyExecutorCodexHome(workdir, executorId);
  await mkdir(home, { recursive: true, mode: 0o700 });
  await chmod(home, 0o700);
  return home;
}
