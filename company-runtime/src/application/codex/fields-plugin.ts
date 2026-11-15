import { randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { recordPluginOperation } from "../../observability/events.js";

export const FIELDS_PLUGIN_MARKETPLACE_NAME = "fields";
export const FIELDS_CORE_PLUGIN_NAME = "fields-core";
export const FIELDS_CORE_PLUGIN_ID = "fields-core@fields";
export const FIELDS_CORE_MCP_SERVER_NAMES = [
  "fields_embodiment",
  "fields_search",
  "fields_room_messages",
  "fields_assets",
  "fields_mail",
] as const;
export const FIELDS_PLUGIN_MARKETPLACE_DIRECTORY = "fields-plugin-marketplace";
const RUNTIME_URL_PLACEHOLDER = "{{FIELDS_COMPANY_RUNTIME_URL}}";
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

export type FieldsPluginMarketplace = {
  root: string;
  releasePath: string;
  marketplacePath: string;
  pluginRoot: string;
  pluginId: typeof FIELDS_CORE_PLUGIN_ID;
  pluginName: typeof FIELDS_CORE_PLUGIN_NAME;
  version: string;
  mcpServerNames: readonly [...typeof FIELDS_CORE_MCP_SERVER_NAMES];
};

export class FieldsPluginMaterializationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FieldsPluginMaterializationError";
    this.code = code;
  }
}

export async function materializeFieldsPluginMarketplace(
  companyWorkdir: string,
  input: {
    runtimeUrl: string;
    templatePath?: string;
    nowMs?: () => number;
  },
): Promise<FieldsPluginMarketplace> {
  const startedAt = input.nowMs?.() ?? Date.now();
  let version: string | null = null;
  try {
    const runtimeUrl = normalizedRuntimeUrl(input.runtimeUrl);
    const templatePath = resolve(input.templatePath ?? defaultFieldsPluginTemplatePath());
    const template = await readAndValidateTemplate(templatePath);
    version = template.version;
    const root = join(resolve(companyWorkdir), ".runtime", FIELDS_PLUGIN_MARKETPLACE_DIRECTORY);
    const releases = join(root, "releases");
    await mkdir(releases, { recursive: true, mode: 0o700 });
    const releaseName = `${template.version}-${randomUUID()}`;
    const releasePath = join(releases, releaseName);
    await cp(templatePath, releasePath, {
      recursive: true,
      dereference: false,
      errorOnExist: true,
      force: false,
    });
    const renderedMcpPath = join(releasePath, "plugins", FIELDS_CORE_PLUGIN_NAME, ".mcp.json");
    const renderedMcp = template.mcpSource.replaceAll(RUNTIME_URL_PLACEHOLDER, runtimeUrl);
    if (renderedMcp.includes(RUNTIME_URL_PLACEHOLDER)) {
      throw new FieldsPluginMaterializationError(
        "fields_plugin_template_invalid",
        "Fields Core Plugin runtime URL placeholder was not fully rendered.",
      );
    }
    await writeFile(renderedMcpPath, renderedMcp, { encoding: "utf8", mode: 0o600 });
    const currentLink = join(root, "current");
    const pendingLink = join(root, `.current-${randomUUID()}.tmp`);
    await symlink(relative(root, releasePath), pendingLink, "dir");
    await rename(pendingLink, currentLink);
    await removeInactiveReleases(releases, releaseName);
    const result = marketplaceResult(root, currentLink, releasePath, template.version);
    await verifyMaterializedFieldsPluginMarketplace(result, { runtimeUrl });
    recordPluginOperation({
      operation: "materialize",
      result: "succeeded",
      durationMs: (input.nowMs?.() ?? Date.now()) - startedAt,
      version: template.version,
    });
    return result;
  } catch (error) {
    recordPluginOperation({
      operation: "materialize",
      result: "failed",
      durationMs: (input.nowMs?.() ?? Date.now()) - startedAt,
      version,
      code: errorCode(error, "fields_plugin_materialization_failed"),
    });
    throw error;
  }
}

export function defaultFieldsPluginTemplatePath(): string {
  return fileURLToPath(new URL("../../../fields-plugin-template/", import.meta.url));
}

async function readAndValidateTemplate(
  templatePath: string,
): Promise<{ version: string; mcpSource: string }> {
  const documents = await readPluginPackageDocuments(templatePath);
  const version = validatePluginPackageDocuments(documents, RUNTIME_URL_PLACEHOLDER);
  return { version, mcpSource: documents.mcpSource };
}

export async function verifyMaterializedFieldsPluginMarketplace(
  marketplace: FieldsPluginMarketplace,
  input: { runtimeUrl: string },
): Promise<void> {
  const root = resolve(marketplace.root);
  const currentRoot = join(root, "current");
  const expectedMarketplacePath = join(currentRoot, ".agents", "plugins", "marketplace.json");
  const expectedPluginRoot = join(currentRoot, "plugins", FIELDS_CORE_PLUGIN_NAME);
  if (
    resolve(marketplace.marketplacePath) !== expectedMarketplacePath
    || resolve(marketplace.pluginRoot) !== expectedPluginRoot
    || marketplace.pluginId !== FIELDS_CORE_PLUGIN_ID
    || marketplace.pluginName !== FIELDS_CORE_PLUGIN_NAME
    || !sameStringSet(marketplace.mcpServerNames, FIELDS_CORE_MCP_SERVER_NAMES)
  ) {
    throw new FieldsPluginMaterializationError(
      "fields_plugin_marketplace_invalid",
      "Fields Plugin marketplace paths or identity are outside the managed layout.",
    );
  }
  const [currentTarget, releaseTarget] = await Promise.all([
    realpath(currentRoot),
    realpath(marketplace.releasePath),
  ]);
  if (
    currentTarget !== releaseTarget
    || relative(join(root, "releases"), currentTarget).startsWith("..")
  ) {
    throw new FieldsPluginMaterializationError(
      "fields_plugin_marketplace_invalid",
      "Fields Plugin current release is outside the managed release storage.",
    );
  }
  await assertFieldsPluginMarketplacePathSafe(marketplace.marketplacePath);
  const documents = await readPluginPackageDocuments(currentRoot);
  const version = validatePluginPackageDocuments(
    documents,
    normalizedRuntimeUrl(input.runtimeUrl),
  );
  if (version !== marketplace.version) {
    throw new FieldsPluginMaterializationError(
      "fields_plugin_health_invalid",
      "Fields Core Plugin materialized version does not match the selected release.",
    );
  }
}

type PluginPackageDocuments = {
  manifest: Record<string, unknown>;
  marketplace: Record<string, unknown>;
  mcp: Record<string, unknown>;
  mcpSource: string;
};

async function readPluginPackageDocuments(root: string): Promise<PluginPackageDocuments> {
  const pluginRoot = join(root, "plugins", FIELDS_CORE_PLUGIN_NAME);
  const manifestRoot = join(pluginRoot, ".codex-plugin");
  const manifestPath = join(manifestRoot, "plugin.json");
  const marketplaceRoot = join(root, ".agents", "plugins");
  const marketplacePath = join(marketplaceRoot, "marketplace.json");
  const mcpPath = join(pluginRoot, ".mcp.json");
  const [pluginEntries, manifestEntries, marketplaceEntries] = await Promise.all([
    readdir(pluginRoot, { withFileTypes: true }),
    readdir(manifestRoot, { withFileTypes: true }),
    readdir(marketplaceRoot, { withFileTypes: true }),
  ]);
  if (
    !sameStringSet(pluginEntries.map((entry) => entry.name), [".codex-plugin", ".mcp.json"])
    || pluginEntries.some((entry) => entry.isSymbolicLink())
    || !sameStringSet(manifestEntries.map((entry) => entry.name), ["plugin.json"])
    || manifestEntries.some((entry) => !entry.isFile() || entry.isSymbolicLink())
    || !sameStringSet(marketplaceEntries.map((entry) => entry.name), ["marketplace.json"])
    || marketplaceEntries.some((entry) => !entry.isFile() || entry.isSymbolicLink())
  ) {
    throw new FieldsPluginMaterializationError(
      "fields_plugin_template_invalid",
      "Fields Core Plugin package contains unsupported capabilities or filesystem entries.",
    );
  }
  const [manifestSource, marketplaceSource, mcpSource] = await Promise.all([
    readFile(manifestPath, "utf8"),
    readFile(marketplacePath, "utf8"),
    readFile(mcpPath, "utf8"),
  ]);
  return {
    manifest: jsonObject(manifestSource, "Fields Core Plugin manifest"),
    marketplace: jsonObject(marketplaceSource, "Fields Plugin marketplace"),
    mcp: jsonObject(mcpSource, "Fields Core MCP declaration"),
    mcpSource,
  };
}

function validatePluginPackageDocuments(
  documents: PluginPackageDocuments,
  runtimeUrl: string,
): string {
  const { manifest, marketplace, mcp } = documents;
  const unsupportedCapabilities = [
    "skills",
    "hooks",
    "apps",
    "appTemplates",
    "scheduledTasks",
  ];
  if (
    manifest.name !== FIELDS_CORE_PLUGIN_NAME
    || typeof manifest.version !== "string"
    || !SEMVER_PATTERN.test(manifest.version)
    || manifest.mcpServers !== "./.mcp.json"
    || unsupportedCapabilities.some((name) => name in manifest)
  ) {
    throw new FieldsPluginMaterializationError(
      "fields_plugin_template_invalid",
      "Fields Core Plugin manifest identity, version, or MCP declaration is invalid.",
    );
  }
  if (marketplace.name !== FIELDS_PLUGIN_MARKETPLACE_NAME) {
    throw new FieldsPluginMaterializationError(
      "fields_plugin_template_invalid",
      "Fields Plugin marketplace name is invalid.",
    );
  }
  const marketplacePlugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
  if (
    marketplacePlugins.length !== 1
    || !marketplacePlugins.some((entry) => (
      isRecord(entry)
      && entry.name === FIELDS_CORE_PLUGIN_NAME
      && isRecord(entry.source)
      && entry.source.source === "local"
      && entry.source.path === `./plugins/${FIELDS_CORE_PLUGIN_NAME}`
    ))
  ) {
    throw new FieldsPluginMaterializationError(
      "fields_plugin_template_invalid",
      "Fields Plugin marketplace does not contain the canonical Fields Core entry.",
    );
  }
  const servers = isRecord(mcp.mcpServers) ? mcp.mcpServers : {};
  if (!sameStringSet(Object.keys(servers), FIELDS_CORE_MCP_SERVER_NAMES)) {
    throw new FieldsPluginMaterializationError(
      "fields_plugin_template_invalid",
      "Fields Core Plugin must declare exactly the five approved MCP servers.",
    );
  }
  const expectedPaths: Record<typeof FIELDS_CORE_MCP_SERVER_NAMES[number], string> = {
    fields_embodiment: "/mcp/embodiment",
    fields_search: "/mcp/search",
    fields_room_messages: "/mcp/room-messages",
    fields_assets: "/mcp/assets",
    fields_mail: "/mcp/mail",
  };
  for (const name of FIELDS_CORE_MCP_SERVER_NAMES) {
    const server = servers[name];
    const allowedKeys = name === "fields_room_messages"
      ? ["type", "url", "env_http_headers", "enabled"]
      : name === "fields_mail"
        ? ["type", "url", "env_http_headers", "bearer_token_env_var"]
        : ["type", "url", "env_http_headers"];
    if (
      !isRecord(server)
      || !sameStringSet(Object.keys(server), allowedKeys)
      || server.type !== "http"
      || server.url !== `${runtimeUrl}${expectedPaths[name]}`
      || !isRecord(server.env_http_headers)
      || !sameStringSet(Object.keys(server.env_http_headers), ["X-Fields-Member-Id"])
      || server.env_http_headers["X-Fields-Member-Id"] !== "FIELDS_MCP_MEMBER_ID"
      || (
        name === "fields_mail"
        && server.bearer_token_env_var !== "FIELDS_MAIL_MCP_TOKEN"
      )
      || "http_headers" in server
    ) {
      throw new FieldsPluginMaterializationError(
        "fields_plugin_template_invalid",
        `Fields Core MCP declaration ${name} is invalid.`,
      );
    }
  }
  if (
    !isRecord(servers.fields_room_messages)
    || servers.fields_room_messages.enabled !== false
  ) {
    throw new FieldsPluginMaterializationError(
      "fields_plugin_template_invalid",
      "Fields Room Messages MCP must be disabled by default.",
    );
  }
  for (const name of ["fields_embodiment", "fields_search", "fields_assets", "fields_mail"]) {
    const server = servers[name];
    if (isRecord(server) && server.enabled === false) {
      throw new FieldsPluginMaterializationError(
        "fields_plugin_template_invalid",
        `${name} must be enabled by default.`,
      );
    }
  }
  if (containsForbiddenIdentityOrCredential(manifest) || containsForbiddenIdentityOrCredential(marketplace)) {
    throw new FieldsPluginMaterializationError(
      "fields_plugin_template_contains_identity",
      "Fields Core Plugin template must not contain credentials or scoped identity values.",
    );
  }
  return manifest.version;
}

function normalizedRuntimeUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new FieldsPluginMaterializationError(
      "fields_plugin_runtime_url_invalid",
      "Company Runtime URL is invalid.",
    );
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:")
    || url.username.length > 0
    || url.password.length > 0
    || url.search.length > 0
    || url.hash.length > 0
  ) {
    throw new FieldsPluginMaterializationError(
      "fields_plugin_runtime_url_invalid",
      "Company Runtime URL must be HTTP(S) without credentials, query, or fragment.",
    );
  }
  return url.toString().replace(/\/+$/u, "");
}

function marketplaceResult(
  root: string,
  currentLink: string,
  releasePath: string,
  version: string,
): FieldsPluginMarketplace {
  return {
    root,
    releasePath,
    marketplacePath: join(currentLink, ".agents", "plugins", "marketplace.json"),
    pluginRoot: join(currentLink, "plugins", FIELDS_CORE_PLUGIN_NAME),
    pluginId: FIELDS_CORE_PLUGIN_ID,
    pluginName: FIELDS_CORE_PLUGIN_NAME,
    version,
    mcpServerNames: FIELDS_CORE_MCP_SERVER_NAMES,
  };
}

async function removeInactiveReleases(releasesPath: string, activeName: string): Promise<void> {
  for (const entry of await readdir(releasesPath, { withFileTypes: true })) {
    if (entry.name === activeName) continue;
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new FieldsPluginMaterializationError(
        "fields_plugin_release_invalid",
        "Fields Plugin release storage contains an unexpected entry.",
      );
    }
    await rm(join(releasesPath, entry.name), { recursive: true, force: true });
  }
}

function jsonObject(source: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    throw new FieldsPluginMaterializationError(
      "fields_plugin_template_invalid",
      `${label} is not valid JSON.`,
    );
  }
  if (!isRecord(value)) {
    throw new FieldsPluginMaterializationError(
      "fields_plugin_template_invalid",
      `${label} must be a JSON object.`,
    );
  }
  return value;
}

function sameStringSet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length
    && expected.every((value) => actual.includes(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsForbiddenIdentityOrCredential(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsForbiddenIdentityOrCredential);
  }
  if (!isRecord(value)) {
    return typeof value === "string" && /\bbearer\s+\S+/iu.test(value);
  }
  return Object.entries(value).some(([key, entry]) => (
    /^(?:authorization|token|access[_-]?token|room[_-]?id|member[_-]?id|http_headers)$/iu
      .test(key)
    || containsForbiddenIdentityOrCredential(entry)
  ));
}

function errorCode(error: unknown, fallback: string): string {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : fallback;
}

export async function assertFieldsPluginMarketplacePathSafe(
  marketplacePath: string,
): Promise<void> {
  const metadata = await lstat(marketplacePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new FieldsPluginMaterializationError(
      "fields_plugin_marketplace_invalid",
      "Fields Plugin marketplace must resolve to a regular file.",
    );
  }
  const parent = dirname(marketplacePath);
  if (!parent.endsWith(join(".agents", "plugins"))) {
    throw new FieldsPluginMaterializationError(
      "fields_plugin_marketplace_invalid",
      "Fields Plugin marketplace is outside the managed marketplace layout.",
    );
  }
}
