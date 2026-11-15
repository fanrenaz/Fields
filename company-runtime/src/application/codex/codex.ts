import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse as parseToml, stringify as stringifyToml, type TomlTable } from "smol-toml";

import { codexHome } from "../init/executor.js";

export const CODEX_CONFIG_FILE = "config.toml";
export const FIELDS_GIT_EXCLUDES_FILE = "fields-git-excludes";
export const FIELDS_CONFIG_BEGIN = "# BEGIN FIELDS AGENT CLIENT";
export const FIELDS_CONFIG_END = "# END FIELDS AGENT CLIENT";
export const LEGACY_FIELDS_CONFIG_BEGIN = "# BEGIN FIELDS AGENT CLI";
export const LEGACY_FIELDS_CONFIG_END = "# END FIELDS AGENT CLI";
export const CODEX_APPROVAL_POLICY =
  "{ granular = { sandbox_approval = false, rules = false, skill_approval = false, request_permissions = false, mcp_elicitations = false } }";
export const CODEX_DEFAULT_PERMISSIONS = ":danger-full-access";

export type CodexIntegrationResult = {
  configPath: string;
};

export type CodexCustomProvider = {
  baseUrl: string;
  envKey: string;
};

export type CodexManagedAssetMcp = {
  name: string;
  url: string;
  bearerTokenEnvVar?: string;
};

export class CodexIntegrationConfigurationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CodexIntegrationConfigurationError";
    this.code = code;
  }
}

export async function configureCodexIntegration(
  workdir: string,
  input: {
    customProvider?: CodexCustomProvider;
    assetMcps?: CodexManagedAssetMcp[];
    excludedSecretEnv?: string[];
  } = {},
): Promise<CodexIntegrationResult> {
  const resolvedWorkdir = resolve(workdir);
  const codexDir = codexHome(resolvedWorkdir);
  await mkdir(codexDir, { recursive: true });
  const configPath = join(codexDir, CODEX_CONFIG_FILE);
  await writeFile(join(codexDir, FIELDS_GIT_EXCLUDES_FILE), ".codex/\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  const existing = await readOptionalText(configPath);
  await writeFile(
    configPath,
    mergeConfig(
      existing,
      input.customProvider,
      input.assetMcps ?? [],
      input.excludedSecretEnv ?? [],
    ),
    "utf8",
  );
  return { configPath };
}

export async function assertFieldsRoomMessagesNotGloballyEnabled(
  workdir: string,
): Promise<void> {
  const configPath = join(codexHome(resolve(workdir)), CODEX_CONFIG_FILE);
  const source = await readOptionalText(configPath);
  let config: TomlTable;
  try {
    config = parseToml(source);
  } catch {
    throw new CodexIntegrationConfigurationError(
      "codex_config_invalid",
      "Member Codex configuration is invalid.",
    );
  }
  const plugins = recordValue(config.plugins);
  const plugin = recordValue(plugins?.["fields-core@fields"]);
  const mcpServers = recordValue(plugin?.mcp_servers);
  const roomMessages = recordValue(mcpServers?.fields_room_messages);
  if (roomMessages?.enabled === true) {
    throw new CodexIntegrationConfigurationError(
      "fields_room_messages_globally_enabled",
      "Fields Room Messages must remain disabled outside a Room Thread override.",
    );
  }
}

export async function codexIntegrationStatus(workdir: string): Promise<Record<string, unknown>> {
  const resolvedWorkdir = resolve(workdir);
  const configPath = join(codexHome(resolvedWorkdir), CODEX_CONFIG_FILE);
  const configText = await readOptionalText(configPath);
  return {
    mode: "plugin",
    runtime_embedded: true,
    config: {
      path: configPath,
      present: await pathExists(configPath),
      managed_block_present: hasManagedBlock(configText),
      direct_fields_mcp_server_present: configText.split(/\r?\n/u)
        .some((line) => isFieldsMcpSection(line.trim())),
      plugin_configuration_present: configText.includes(`plugins."fields-core@fields"`),
    },
  };
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

function mergeConfig(
  existing: string,
  customProvider?: CodexCustomProvider,
  assetMcps: CodexManagedAssetMcp[] = [],
  excludedSecretEnv: string[] = [],
): string {
  const withoutManagedBlock = removeManagedBlock(existing);
  const withoutFieldsMcp = removeFieldsMcpSections(withoutManagedBlock);
  const withoutFieldsPolicy = removeRootPolicyKeys(withoutFieldsMcp).trim();
  const managed = fieldsManagedBlock(customProvider, assetMcps, excludedSecretEnv);
  return withoutFieldsPolicy.length > 0 ? `${managed}\n\n${withoutFieldsPolicy}\n` : `${managed}\n`;
}

function removeManagedBlock(existing: string): string {
  for (const [begin, end] of [
    [FIELDS_CONFIG_BEGIN, FIELDS_CONFIG_END],
    [LEGACY_FIELDS_CONFIG_BEGIN, LEGACY_FIELDS_CONFIG_END],
  ]) {
    const beginIndex = existing.indexOf(begin);
    const endIndex = existing.indexOf(end);
    if (beginIndex >= 0 && endIndex >= beginIndex) {
      const before = existing.slice(0, beginIndex).trimEnd();
      const after = existing.slice(endIndex + end.length).trimStart();
      return `${before}\n\n${after}`;
    }
  }
  return existing;
}

function removeRootPolicyKeys(configText: string): string {
  const lines = configText.split(/\r?\n/);
  let inRoot = true;
  const retained: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inRoot = false;
    }
    if (inRoot && /^(approval_policy|default_permissions)\s*=/.test(trimmed)) {
      continue;
    }
    retained.push(line);
  }
  return retained.join("\n");
}

function codexPolicySource(): string {
  return `approval_policy = ${CODEX_APPROVAL_POLICY}\ndefault_permissions = ${tomlString(CODEX_DEFAULT_PERMISSIONS)}`;
}

function fieldsManagedBlock(
  customProvider?: CodexCustomProvider,
  assetMcps: CodexManagedAssetMcp[] = [],
  excludedSecretEnv: string[] = [],
): string {
  const excludedEnvironmentVariables = [
    ...(customProvider ? [customProvider.envKey] : []),
    ...excludedSecretEnv,
    ...assetMcps.flatMap((mcp) => (
      mcp.bearerTokenEnvVar ? [mcp.bearerTokenEnvVar] : []
    )),
  ].filter((name, index, names) => (
    /^[A-Z][A-Z0-9_]*$/u.test(name) && names.indexOf(name) === index
  ));
  const lines = [
    FIELDS_CONFIG_BEGIN,
    codexPolicySource(),
  ];
  if (customProvider) {
    lines.push(
      'model_provider = "fields_custom"',
      "",
      "[model_providers.fields_custom]",
      'name = "Custom API"',
      `base_url = ${tomlString(customProvider.baseUrl)}`,
      `env_key = ${tomlString(customProvider.envKey)}`,
      'wire_api = "responses"',
    );
  }
  if (excludedEnvironmentVariables.length > 0) {
    lines.push(
      "",
      "[shell_environment_policy]",
      `exclude = [${excludedEnvironmentVariables.map(tomlString).join(", ")}]`,
      "ignore_default_excludes = false",
    );
  }
  for (const mcp of assetMcps) {
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(mcp.name)
      || !mcp.url.startsWith("https://")
    ) {
      throw new CodexIntegrationConfigurationError(
        "member_asset_mcp_invalid",
        "Managed Member asset MCP configuration is invalid.",
      );
    }
    lines.push(
      "",
      `[mcp_servers.${tomlKey(mcp.name)}]`,
      `url = ${tomlString(mcp.url)}`,
      "enabled = true",
      "required = false",
    );
    if (mcp.bearerTokenEnvVar) {
      lines.push(`bearer_token_env_var = ${tomlString(mcp.bearerTokenEnvVar)}`);
    }
  }
  lines.push(FIELDS_CONFIG_END);
  return lines.join("\n");
}

function tomlKey(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function removeFieldsMcpSections(configText: string): string {
  const lines = configText.split(/\r?\n/);
  const retained: string[] = [];
  let skipping = false;
  let inRoot = true;
  for (const line of lines) {
    const trimmed = line.trim();
    if (isFieldsMcpSection(trimmed)) {
      skipping = true;
      inRoot = false;
      continue;
    }
    if (skipping && isTomlTableHeader(trimmed)) {
      skipping = false;
    }
    if (!skipping && inRoot && isRootMcpAssignmentStart(trimmed)) {
      const rewritten = rewriteRootMcpAssignment(line);
      if (rewritten !== null) retained.push(rewritten);
      continue;
    }
    if (!skipping && isTomlTableHeader(trimmed)) {
      inRoot = false;
    }
    if (!skipping) {
      retained.push(line);
    }
  }
  return retained.join("\n");
}

function isFieldsMcpSection(value: string): boolean {
  const header = value.replace(/\s+#.*$/u, "");
  const key = String.raw`(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))`;
  const match = new RegExp(
    String.raw`^\[\[?\s*${key}\s*\.\s*${key}(?:\s*\.[^\]]+)?\s*\]\]?$`,
    "u",
  ).exec(header);
  if (!match) return false;
  const root = match[1] ?? match[2] ?? match[3];
  const server = match[4] ?? match[5] ?? match[6];
  return root === "mcp_servers" && isManagedFieldsMcpServer(server);
}

function isTomlTableHeader(value: string): boolean {
  return /^\[\[?[^\]]+\]\]?(?:\s+#.*)?$/u.test(value);
}

function isRootMcpAssignmentStart(value: string): boolean {
  return /^(?:"mcp_servers"|'mcp_servers'|mcp_servers)(?:\s*\.|\s*=)/u.test(value);
}

function rewriteRootMcpAssignment(line: string): string | null {
  let parsed: TomlTable;
  try {
    parsed = parseToml(line);
  } catch {
    return line;
  }
  const mcpServers = recordValue(parsed.mcp_servers);
  if (!mcpServers) return line;
  const retained = Object.fromEntries(
    Object.entries(mcpServers).filter(([name]) => !isManagedFieldsMcpServer(name)),
  );
  if (Object.keys(retained).length === Object.keys(mcpServers).length) return line;
  if (Object.keys(retained).length === 0) return null;
  return stringifyToml({ mcp_servers: retained }).trimEnd();
}

function isManagedFieldsMcpServer(value: string | undefined): boolean {
  return value !== undefined && /^(?:fields|fields_embodiment|fields_search|fields_room_messages|fields_assets|fields_mail)$/u
    .test(value);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function tomlString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function hasManagedBlock(configText: string): boolean {
  return (
    (configText.includes(FIELDS_CONFIG_BEGIN) && configText.includes(FIELDS_CONFIG_END)) ||
    (configText.includes(LEGACY_FIELDS_CONFIG_BEGIN) && configText.includes(LEGACY_FIELDS_CONFIG_END))
  );
}

async function readOptionalText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}
