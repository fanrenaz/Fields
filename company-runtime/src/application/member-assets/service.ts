import type {
  MemberAssetInstallation,
  MemberAssetOperation,
} from "@fields/contracts/public/asset";
import type {
  RuntimeMemberAssetApplyInput,
  RuntimeMemberAssetApplyResult,
  RuntimeMemberAssetInstallation,
} from "@fields/contracts/internal/asset";
import { runtimeMemberAssetInstallationSchema } from "@fields/contracts/internal/asset";
import { z } from "zod";
import {
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { CodexAppServerClient } from "../adapter/codex-app-server-client.js";
import { CompanyAssetStore } from "../assets/service.js";
import type { CodexManagedAssetMcp } from "../codex/codex.js";
import type { MemberRuntimeManager } from "../member-runtime/manager.js";
import { memberWorkspaceLayout } from "../../infrastructure/filesystem/workspace.js";
import { recordMemberAssetOperation } from "../../observability/events.js";

const MEMBER_ASSET_PROFILE_FILE = "member-assets.json";

export type ResolvedMemberAssets = {
  installations: RuntimeMemberAssetInstallation[];
  marketplaceName: string;
  marketplacePath: string | null;
  plugins: Array<{ name: string; version: string }>;
  skillRoots: string[];
  skillNames: string[];
  mcps: CodexManagedAssetMcp[];
  requiredReadyMcpNames: Set<string>;
  secretEnv: NodeJS.ProcessEnv;
};

export type MemberAssetCompletion = {
  memberId: string;
  operationId: string;
  requestedRevision: number;
  status: "applied" | "failed";
  installations: MemberAssetInstallation[];
  errorCode: string | null;
  retryable: boolean;
  completedAtMs: number;
};

export class MemberAssetService {
  private readonly pending = new Map<string, RuntimeMemberAssetInstallation[]>();
  private readonly requiredReadyMcpVersions = new Map<string, Set<string>>();
  private readonly operations = new Map<string, Promise<void>>();

  constructor(
    private readonly workdir: string,
    private readonly runtime: MemberRuntimeManager,
    private readonly store: CompanyAssetStore,
    private readonly complete: (input: MemberAssetCompletion) => Promise<void>,
    private readonly nowMs: () => number = Date.now,
  ) {}

  async apply(input: RuntimeMemberAssetApplyInput): Promise<RuntimeMemberAssetApplyResult> {
    const existing = this.operations.get(input.operation_id);
    if (!existing) {
      const operation = this.applyAfterCurrentTurn(input).finally(() => {
        this.operations.delete(input.operation_id);
      });
      this.operations.set(input.operation_id, operation);
      void operation.catch(() => undefined);
    }
    const now = this.nowMs();
    const operation: MemberAssetOperation = {
      operation_id: input.operation_id,
      status: "applying",
      requested_revision: input.requested_revision,
      error_code: null,
      retryable: null,
      created_at_ms: now,
      updated_at_ms: now,
      completed_at_ms: null,
    };
    return { accepted: true, operation };
  }

  async resolve(memberId: string): Promise<ResolvedMemberAssets> {
    const installations = this.pending.get(memberId) ?? await this.readProfile(memberId);
    return materializeMemberAssets(
      this.workdir,
      memberId,
      installations,
      this.store,
      this.requiredReadyMcpVersions.get(memberId) ?? new Set(),
    );
  }

  async refreshCredential(versionId: string): Promise<void> {
    await Promise.all(this.runtime.runningMemberIds().map(async (memberId) => {
      const profile = this.pending.get(memberId) ?? await this.readProfile(memberId);
      if (!profile.some((installation) => installation.version_id === versionId)) return;
      await this.runtime.restartMemberAppServer(memberId);
    }));
  }

  async activate(socketPath: string, assets: ResolvedMemberAssets): Promise<Map<string, string>> {
    const issues = new Map<string, string>();
    const client = CodexAppServerClient.fromUnixSocket(socketPath, { defaultTimeoutMs: 30_000 });
    try {
      await client.request("initialize", {
        clientInfo: {
          name: "fields-member-assets",
          title: "Fields Member Assets",
          version: "1.0.0",
        },
        capabilities: null,
      });
      await client.notify({ method: "initialized" });
      const desiredPlugins = new Map(
        assets.plugins.map((plugin) => [plugin.name, plugin.version]),
      );
      const installed = await client.request<{
        marketplaces?: Array<{
          name?: unknown;
          plugins?: Array<{
            id?: unknown;
            name?: unknown;
            localVersion?: unknown;
            installed?: unknown;
          }>;
        }>;
      }>("plugin/installed", {
        cwds: [],
        installSuggestionPluginNames: [],
      });
      for (const marketplace of installed.marketplaces ?? []) {
        if (marketplace.name !== assets.marketplaceName) continue;
        for (const plugin of marketplace.plugins ?? []) {
          if (
            plugin.installed === true
            && typeof plugin.id === "string"
            && typeof plugin.name === "string"
            && (
              !desiredPlugins.has(plugin.name)
              || desiredPlugins.get(plugin.name) !== plugin.localVersion
            )
          ) {
            await client.request("plugin/uninstall", { pluginId: plugin.id });
          }
        }
      }
      if (assets.marketplacePath) {
        for (const plugin of assets.plugins) {
          await client.request("plugin/install", {
            marketplacePath: assets.marketplacePath,
            remoteMarketplaceName: null,
            pluginName: plugin.name,
          });
          const response = await client.request<Record<string, unknown>>("plugin/read", {
            marketplacePath: assets.marketplacePath,
            remoteMarketplaceName: null,
            pluginName: plugin.name,
          });
          const summary = record(record(response.plugin)?.summary);
          if (
            summary?.name !== plugin.name
            || summary.localVersion !== plugin.version
            || summary.installed !== true
            || summary.enabled !== true
          ) {
            throw new MemberAssetRuntimeError(
              "member_asset_plugin_activation_invalid",
              "Codex reported a drifted installed Plugin.",
              false,
            );
          }
        }
      }
      await client.request("skills/extraRoots/set", { extraRoots: assets.skillRoots });
      const skillResult = await client.request<{ data?: Array<{ skills?: unknown[] }> }>(
        "skills/list",
        { cwds: assets.skillRoots, forceReload: true },
      );
      const loadedNames = new Set(
        (skillResult.data ?? []).flatMap((entry) => entry.skills ?? [])
          .flatMap((skill) => {
            const value = record(skill);
            return typeof value?.name === "string" && value.enabled === true
              ? [value.name]
              : [];
          }),
      );
      if (assets.skillNames.some((name) => !loadedNames.has(name))) {
        throw new MemberAssetRuntimeError(
          "member_asset_skill_activation_invalid",
          "Codex did not load every selected Skill.",
          false,
        );
      }
      if (assets.mcps.length > 0) {
        try {
          const status = await client.request<{
            data?: Array<{ name?: unknown; serverInfo?: unknown }>;
          }>(
            "mcpServerStatus/list",
            { cursor: null, limit: 200 },
          );
          const ready = new Set(
            (status.data ?? []).flatMap((item) => (
              typeof item.name === "string" && record(item.serverInfo)
                ? [item.name]
                : []
            )),
          );
          for (const mcp of assets.mcps) {
            if (ready.has(mcp.name)) continue;
            if (assets.requiredReadyMcpNames.has(mcp.name)) {
              throw new MemberAssetRuntimeError(
                "member_asset_mcp_initial_validation_failed",
                "A newly installed MCP could not initialize.",
                true,
              );
            }
            issues.set(mcp.name, "member_asset_mcp_unavailable");
          }
        } catch {
          if (assets.requiredReadyMcpNames.size > 0) {
            throw new MemberAssetRuntimeError(
              "member_asset_mcp_initial_validation_failed",
              "A newly installed MCP could not initialize.",
              true,
            );
          }
          for (const mcp of assets.mcps) {
            issues.set(mcp.name, "member_asset_mcp_unavailable");
          }
        }
      }
      return issues;
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  private async applyAfterCurrentTurn(input: RuntimeMemberAssetApplyInput): Promise<void> {
    const previous = await this.readProfile(input.member_id);
    const previousVersions = new Set(previous.map((installation) => installation.version_id));
    this.requiredReadyMcpVersions.set(
      input.member_id,
      new Set(input.installations.flatMap((installation) => (
        installation.kind === "mcp" && !previousVersions.has(installation.version_id)
          ? [installation.version_id]
          : []
      ))),
    );
    this.pending.set(input.member_id, input.installations);
    try {
      const issues = await this.runtime.restartMemberAppServer(input.member_id);
      await this.writeProfile(input.member_id, input.installations);
      this.pending.delete(input.member_id);
      this.requiredReadyMcpVersions.delete(input.member_id);
      await this.complete({
        memberId: input.member_id,
        operationId: input.operation_id,
        requestedRevision: input.requested_revision,
        status: "applied",
        installations: input.installations.map((installation) => ({
          asset_id: installation.asset_id,
          version_id: installation.version_id,
          kind: installation.kind,
          name: installation.name,
          slug: installation.slug,
          version: installation.version,
          health: issues.has(installation.slug) ? "degraded" : "ready",
          issue_code: issues.get(installation.slug) ?? null,
        })),
        errorCode: null,
        retryable: false,
        completedAtMs: this.nowMs(),
      });
      recordMemberAssetOperation({
        memberId: input.member_id,
        operationId: input.operation_id,
        result: "succeeded",
      });
    } catch (error) {
      this.pending.set(input.member_id, previous);
      try {
        await this.runtime.restartMemberAppServer(input.member_id);
      } finally {
        this.pending.delete(input.member_id);
        this.requiredReadyMcpVersions.delete(input.member_id);
      }
      await this.complete({
        memberId: input.member_id,
        operationId: input.operation_id,
        requestedRevision: input.requested_revision,
        status: "failed",
        installations: [],
        errorCode: runtimeErrorCode(error),
        retryable: runtimeRetryable(error),
        completedAtMs: this.nowMs(),
      });
      recordMemberAssetOperation({
        memberId: input.member_id,
        operationId: input.operation_id,
        result: "failed",
        code: runtimeErrorCode(error),
      });
    }
  }

  private async readProfile(memberId: string): Promise<RuntimeMemberAssetInstallation[]> {
    const path = profilePath(this.workdir, memberId);
    const source = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (source === null) return [];
    const parsed = JSON.parse(source) as { version?: unknown; installations?: unknown };
    if (parsed.version !== 1 || !Array.isArray(parsed.installations)) {
      throw new MemberAssetRuntimeError(
        "member_asset_profile_invalid",
        "Member asset profile is invalid.",
        false,
      );
    }
    return z.array(runtimeMemberAssetInstallationSchema).max(256).parse(parsed.installations);
  }

  private async writeProfile(
    memberId: string,
    installations: RuntimeMemberAssetInstallation[],
  ): Promise<void> {
    const path = profilePath(this.workdir, memberId);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify({
      version: 1,
      installations,
    }, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, path);
  }
}

export class MemberAssetRuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "MemberAssetRuntimeError";
  }
}

async function materializeMemberAssets(
  workdir: string,
  memberId: string,
  installations: RuntimeMemberAssetInstallation[],
  store: CompanyAssetStore,
  requiredReadyMcpVersions: ReadonlySet<string>,
): Promise<ResolvedMemberAssets> {
  const releaseRoot = join(
    resolve(workdir),
    ".runtime",
    "member-assets",
    memberId,
    "current",
  );
  const marketplaceName = `fields-company-assets-${memberId}`;
  await rm(releaseRoot, { recursive: true, force: true });
  const marketplacePath = join(releaseRoot, ".agents", "plugins", "marketplace.json");
  const plugins: Array<{ name: string; version: string }> = [];
  const skillRoots: string[] = [];
  const skillNames: string[] = [];
  const mcps: CodexManagedAssetMcp[] = [];
  const requiredReadyMcpNames = new Set<string>();
  const secretEnv: NodeJS.ProcessEnv = {};

  for (const installation of installations) {
    const contentRoot = await store.versionContentRoot(
      installation.version_id,
      installation.content_sha256,
    );
    if (installation.kind === "plugin") {
      const manifest = record(JSON.parse(
        await readFile(join(contentRoot, ".codex-plugin", "plugin.json"), "utf8"),
      ));
      if (
        typeof manifest?.name !== "string"
        || typeof manifest.version !== "string"
      ) {
        throw new MemberAssetRuntimeError(
          "member_asset_plugin_manifest_invalid",
          "Installed Plugin manifest is invalid.",
          false,
        );
      }
      const link = join(releaseRoot, "plugins", installation.slug);
      await mkdir(dirname(link), { recursive: true, mode: 0o700 });
      await symlink(relative(dirname(link), contentRoot), link, "dir");
      plugins.push({ name: manifest.name, version: manifest.version });
    } else if (installation.kind === "skill") {
      skillRoots.push(contentRoot);
      const declared = installation.capabilities.entries.find((entry) => entry.kind === "skill");
      if (declared) skillNames.push(declared.name);
    } else if (installation.source.type === "mcp") {
      const envName = `FIELDS_ASSET_MCP_${installation.version_id
        .replaceAll(/[^A-Za-z0-9]/gu, "_")
        .toUpperCase()}_TOKEN`;
      const token = await store.versionCredential(
        installation.version_id,
        installation.source.endpoint_url,
        installation.source.authentication,
      );
      if (installation.source.authentication === "bearer" && !token) {
        throw new MemberAssetRuntimeError(
          "member_asset_mcp_credential_missing",
          "Installed MCP credential is unavailable.",
          false,
        );
      }
      if (token) secretEnv[envName] = token;
      mcps.push({
        name: installation.slug,
        url: installation.source.endpoint_url,
        ...(token ? { bearerTokenEnvVar: envName } : {}),
      });
      if (requiredReadyMcpVersions.has(installation.version_id)) {
        requiredReadyMcpNames.add(installation.slug);
      }
    }
  }
  if (plugins.length > 0) {
    await mkdir(dirname(marketplacePath), { recursive: true, mode: 0o700 });
    await writeFile(marketplacePath, `${JSON.stringify({
      name: marketplaceName,
      interface: { displayName: "Company Assets" },
      plugins: plugins.map((plugin, index) => ({
        name: plugin.name,
        source: {
          source: "local",
          path: `./plugins/${installations.filter((item) => item.kind === "plugin")[index]!.slug}`,
        },
        policy: {
          installation: "AVAILABLE",
          authentication: "ON_INSTALL",
        },
        category: "Developer Tools",
      })),
    }, null, 2)}\n`, { mode: 0o600 });
  }
  return {
    installations,
    marketplaceName,
    marketplacePath: plugins.length > 0 ? marketplacePath : null,
    plugins,
    skillRoots,
    skillNames,
    mcps,
    requiredReadyMcpNames,
    secretEnv,
  };
}

function profilePath(workdir: string, memberId: string): string {
  return join(memberWorkspaceLayout(workdir, memberId).memberRoot, MEMBER_ASSET_PROFILE_FILE);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function runtimeErrorCode(error: unknown): string {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : "member_asset_apply_failed";
}

function runtimeRetryable(error: unknown): boolean {
  return error instanceof MemberAssetRuntimeError ? error.retryable : true;
}
