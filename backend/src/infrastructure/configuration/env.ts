import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

export function loadBackendEnvFiles(cwd: string = process.cwd()): void {
  const enabled = process.env.FIELDS_BACKEND_LOAD_ENV_FILES;
  if (enabled === "false") {
    return;
  }
  if (enabled !== undefined && enabled !== "true") {
    throw new Error('FIELDS_BACKEND_LOAD_ENV_FILES must be "true" or "false" when set.');
  }
  const roots = backendEnvRoots(cwd);
  if (roots.workspaceRoot) {
    loadEnvFile(resolve(roots.workspaceRoot, ".env"));
  }
  loadEnvFile(resolve(roots.backendRoot, ".env"), { override: true });
}

export function backendDatabaseUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.FIELDS_BACKEND_DATABASE_URL ?? env.DATABASE_URL ?? null;
}

export function requireBackendDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const databaseUrl = backendDatabaseUrlFromEnv(env);
  if (!databaseUrl || databaseUrl.length === 0) {
    throw new Error("FIELDS_BACKEND_DATABASE_URL or DATABASE_URL must be set before using backend DB.");
  }
  return postgresDriverUrl(databaseUrl);
}

export function postgresDriverUrl(databaseUrl: string): string {
  if (databaseUrl.startsWith("postgresql+psycopg://")) {
    return `postgresql://${databaseUrl.slice("postgresql+psycopg://".length)}`;
  }
  if (databaseUrl.startsWith("postgresql+asyncpg://")) {
    return `postgresql://${databaseUrl.slice("postgresql+asyncpg://".length)}`;
  }
  return databaseUrl;
}

function backendEnvRoots(cwd: string): { backendRoot: string; workspaceRoot: string | null } {
  const workingDirectory = resolve(cwd);
  const backendRoot = isBackendPackageRoot(workingDirectory)
    ? workingDirectory
    : isBackendPackageRoot(resolve(workingDirectory, "backend"))
      ? resolve(workingDirectory, "backend")
      : workingDirectory;
  const workspaceRoot = dirname(backendRoot);
  return {
    backendRoot,
    workspaceRoot: isWorkspaceRootForBackend(workspaceRoot, backendRoot) ? workspaceRoot : null,
  };
}

function isBackendPackageRoot(directory: string): boolean {
  return basename(directory) === "backend"
    && existsSync(resolve(directory, "package.json"))
    && existsSync(resolve(directory, "src"));
}

function isWorkspaceRootForBackend(workspaceRoot: string, backendRoot: string): boolean {
  return resolve(workspaceRoot, "backend") === backendRoot
    && existsSync(resolve(workspaceRoot, "package.json"));
}

function loadEnvFile(path: string, options: { override?: boolean } = {}): void {
  if (!existsSync(path)) {
    return;
  }
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const [, key, rawValue] = match;
    if (process.env[key] && !options.override) {
      continue;
    }
    process.env[key] = parseEnvValue(rawValue.trim());
  }
}

function parseEnvValue(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
