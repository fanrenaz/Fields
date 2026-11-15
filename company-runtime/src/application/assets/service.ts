import type {
  AssetCapabilityEntry,
  AssetContent,
  AssetFileEntry,
  AssetKind,
  AssetSource,
  AssetMcpToolDescriptor,
  AssetValidationIssue,
  AssetValidationSnapshot,
} from "@fields/contracts/public/asset";
import { assetMcpToolDescriptorSchema } from "@fields/contracts/public/asset";
import type {
  AssetStoredPackage,
  RuntimeAssetCredentialReplaceInput,
  RuntimeAssetCredentialOperationInput,
  RuntimeAssetGitImportInput,
  RuntimeAssetMcpStoreInput,
  RuntimeAssetMcpToolCallInput,
  RuntimeAssetMcpToolCallResult,
  RuntimeAssetMcpToolsListInput,
  RuntimeAssetMcpToolsListResult,
  RuntimeAssetValidateInput,
  RuntimeAssetValidateResult,
  RuntimeAssetWorkspaceZipInput,
  RuntimeAssetZipPackageInput,
} from "@fields/contracts/internal/asset";
import { runtimeAssetMcpToolCallResultSchema } from "@fields/contracts/internal/asset";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { constants as fsConstants } from "node:fs";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";
import { request as httpsRequest } from "node:https";
import { basename, dirname, join, posix, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import {
  InitializeResultSchema,
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js";
import * as unzipper from "unzipper";
import { zipSync, type Zippable } from "fflate";
import {
  emitLifecycleEvent,
  recordAssetMcpToolOperation,
} from "../../observability/events.js";

import { CodexAppServerClient } from "../adapter/codex-app-server-client.js";
import {
  memberWorkspaceLayout,
} from "../../infrastructure/filesystem/workspace.js";
import type {
  CompanyAssetObjectStore,
} from "../../infrastructure/object-storage/company-asset-object-store.js";

export const ASSET_ZIP_MAX_COMPRESSED_BYTES = 25 * 1024 * 1024;
export const ASSET_PACKAGE_MAX_EXPANDED_BYTES = 100 * 1024 * 1024;
export const ASSET_PACKAGE_MAX_FILES = 2_000;
export const ASSET_PACKAGE_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const DEFAULT_ASSET_QUOTA_BYTES = 5 * 1024 * 1024 * 1024;
export const ASSET_GIT_CLONE_MAX_BYTES = 125 * 1024 * 1024;
const CONTENT_PREVIEW_MAX_BYTES = 512_000;

export class AssetStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AssetStoreError";
  }
}

export function isRetryableAssetStoreError(code: string): boolean {
  return new Set([
    "asset_git_clone_failed",
    "asset_mcp_request_failed",
    "asset_mcp_timeout",
    "asset_mcp_unavailable",
    "asset_process_failed",
    "asset_process_timeout",
    "asset_quota_exceeded",
    "asset_thread_workspace_unavailable",
  ]).has(code);
}

export type CompanyAssetStoreOptions = {
  quotaBytes?: number;
  nowMs?: () => number;
  gitCommand?: string;
  gitCloneMaxBytes?: number;
  codexCommand?: string;
  threadWorkspaceResolver?: AssetThreadWorkspaceResolver;
  objectStore?: CompanyAssetObjectStore;
};

export type AssetThreadWorkspace =
  | {
    scope: "home";
    member_id: string;
    thread_id: string;
    root: string;
  }
  | {
    scope: "room";
    member_id: string;
    thread_id: string;
    room_id: string;
    root: string;
  };

export interface AssetThreadWorkspaceResolver {
  resolve(input: {
    member_id: string;
    thread_id: string;
  }): Promise<AssetThreadWorkspace>;
}

type RuntimeAssetZipPackageCall = Omit<
  RuntimeAssetZipPackageInput,
  "operation_id" | "request_fingerprint" | "package_sha256" | "package_size_bytes"
> & Partial<Pick<
  RuntimeAssetZipPackageInput,
  "operation_id" | "request_fingerprint"
>> & {
  package_base64: string;
};

type RuntimeAssetWorkspaceZipCall = Omit<
  RuntimeAssetWorkspaceZipInput,
  "operation_id" | "request_fingerprint"
> & Partial<Pick<
  RuntimeAssetWorkspaceZipInput,
  "operation_id" | "request_fingerprint"
>>;

type RuntimeAssetCredentialImmediateCall = Omit<
  RuntimeAssetCredentialReplaceInput,
  "target_revision" | "expected_operation_id"
> & Partial<Pick<
  RuntimeAssetCredentialReplaceInput,
  "target_revision" | "expected_operation_id"
>>;

export class CompanyAssetStore {
  private readonly root: string;
  private readonly blobs: string;
  private readonly draftRefs: string;
  private readonly versionRefs: string;
  private readonly draftCredentials: string;
  private readonly versionCredentials: string;
  private readonly credentialOperations: string;
  private readonly credentialStages: string;
  private readonly packageOperations: string;
  private readonly validationOperations: string;
  private readonly options: CompanyAssetStoreOptions;
  private readonly referenceOperations = new Map<string, Promise<void>>();
  private quotaOperation: Promise<void> = Promise.resolve();

  constructor(
    private readonly workdir: string,
    options: CompanyAssetStoreOptions = {},
  ) {
    this.root = join(workdir, "assets");
    this.blobs = join(this.root, "blobs");
    this.draftRefs = join(this.root, "refs", "drafts");
    this.versionRefs = join(this.root, "refs", "versions");
    this.draftCredentials = join(this.root, "credentials", "drafts");
    this.versionCredentials = join(this.root, "credentials", "versions");
    this.credentialOperations = join(this.root, "operations", "credentials");
    this.credentialStages = join(this.root, "credentials", "staged");
    this.packageOperations = join(this.root, "operations", "packages");
    this.validationOperations = join(this.root, "operations", "validations");
    this.options = options;
  }

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.blobs, { recursive: true, mode: 0o700 }),
      mkdir(this.draftRefs, { recursive: true, mode: 0o700 }),
      mkdir(this.versionRefs, { recursive: true, mode: 0o700 }),
      mkdir(this.draftCredentials, { recursive: true, mode: 0o700 }),
      mkdir(this.versionCredentials, { recursive: true, mode: 0o700 }),
      mkdir(this.credentialOperations, { recursive: true, mode: 0o700 }),
      mkdir(this.credentialStages, { recursive: true, mode: 0o700 }),
      mkdir(this.packageOperations, { recursive: true, mode: 0o700 }),
      mkdir(this.validationOperations, { recursive: true, mode: 0o700 }),
    ]);
  }

  async importZip(input: RuntimeAssetZipPackageCall): Promise<AssetStoredPackage> {
    const operationId = input.operation_id ?? `direct_zip_${sha256(input.draft_id).slice(0, 48)}`;
    const packageBytes = Buffer.from(input.package_base64, "base64");
    const packageSha256 = sha256(packageBytes);
    const requestFingerprint = input.request_fingerprint ?? packageSha256;
    return this.importZipStream({
      operation_id: operationId,
      request_fingerprint: requestFingerprint,
      draft_id: input.draft_id,
      expected_content_sha256: input.expected_content_sha256,
      kind: input.kind,
      file_name: input.file_name,
      package_sha256: packageSha256,
      package_size_bytes: packageBytes.byteLength,
    }, [packageBytes]);
  }

  async importZipStream(
    input: RuntimeAssetZipPackageInput,
    body: AsyncIterable<unknown> | Iterable<unknown>,
  ): Promise<AssetStoredPackage> {
    const temp = await this.tempDirectory("zip");
    const packagePath = join(temp, "package.zip");
    const extractedPath = join(temp, "contents");
    const handle = await open(packagePath, "wx", 0o600).catch(async (error) => {
      await rm(temp, { recursive: true, force: true });
      throw error;
    });
    const digest = createHash("sha256");
    let totalBytes = 0;
    try {
      for await (const value of body) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
        totalBytes += chunk.byteLength;
        if (totalBytes > ASSET_ZIP_MAX_COMPRESSED_BYTES) {
          throw new AssetStoreError(
            "asset_zip_size_invalid",
            "ZIP package exceeds the 25 MiB limit.",
          );
        }
        digest.update(chunk);
        await handle.write(chunk);
      }
      await handle.close();
      if (
        totalBytes === 0
        || totalBytes !== input.package_size_bytes
        || digest.digest("hex") !== input.package_sha256
      ) {
        throw new AssetStoreError(
          "asset_zip_digest_mismatch",
          "ZIP package size or SHA-256 does not match the declared upload.",
        );
      }
      const recovered = await this.recoverPackageOperation(
        input.operation_id,
        input.request_fingerprint,
        input.draft_id,
        input.expected_content_sha256,
      );
      if (recovered) return recovered;
      await this.beginPackageOperation(input.operation_id, input.request_fingerprint);
      await mkdir(extractedPath, { recursive: true, mode: 0o700 });
      await extractSafeZip(packagePath, extractedPath);
      return await this.storeDirectory(input.draft_id, input.kind, extractedPath, {
        type: "zip",
        file_name: input.file_name,
      }, input.expected_content_sha256, undefined, {
        operationId: input.operation_id,
        requestFingerprint: input.request_fingerprint,
      });
    } finally {
      await handle.close().catch(() => undefined);
      await rm(temp, { recursive: true, force: true });
    }
  }

  async importGit(input: RuntimeAssetGitImportInput): Promise<AssetStoredPackage> {
    const recovered = await this.recoverPackageOperation(
      input.operation_id,
      input.request_fingerprint,
      input.draft_id,
      input.expected_content_sha256,
    );
    if (recovered) return recovered;
    await this.beginPackageOperation(input.operation_id, input.request_fingerprint);
    const repositoryTarget = await publicHttpsTarget(input.repository_url);
    const repository = repositoryTarget.url;
    if (
      repository.username
      || repository.password
      || repository.search
      || repository.hash
    ) {
      throw new AssetStoreError(
        "asset_git_url_invalid",
        "Git imports require a public HTTPS repository URL without credentials, query, or fragment.",
      );
    }
    const checkout = await this.tempDirectory("git");
    const snapshot = await this.tempDirectory("git-snapshot");
    const gitHome = await this.tempDirectory("git-home");
    try {
      let cloned = false;
      let lastError: unknown = null;
      for (const address of repositoryTarget.addresses.slice(0, 8)) {
        await rm(checkout, { recursive: true, force: true });
        try {
          const pinnedAddress = isIP(repositoryTarget.hostname)
            ? []
            : [
              "-c",
              `http.curloptResolve=${curlResolve(
                repositoryTarget.hostname,
                repository.port || "443",
                address,
              )}`,
            ];
          await runProcess(this.options.gitCommand ?? "git", [
            "-c", "core.hooksPath=/dev/null",
            "-c", "protocol.file.allow=never",
            "-c", "credential.helper=",
            "-c", "credential.interactive=never",
            "-c", "http.followRedirects=false",
            ...pinnedAddress,
            "clone",
            "--depth=1",
            "--no-tags",
            "--no-recurse-submodules",
            "--",
            repository.toString(),
            checkout,
          ], {
            cwd: dirname(checkout),
            env: gitProcessEnvironment(gitHome),
            timeoutMs: 60_000,
            resourcePath: checkout,
            maxResourceBytes: Math.max(1, Math.min(
              this.options.gitCloneMaxBytes ?? ASSET_GIT_CLONE_MAX_BYTES,
              ASSET_GIT_CLONE_MAX_BYTES,
            )),
            maxFileBytes: Math.max(1, Math.min(
              this.options.gitCloneMaxBytes ?? ASSET_GIT_CLONE_MAX_BYTES,
              ASSET_GIT_CLONE_MAX_BYTES,
            )),
          });
          cloned = true;
          break;
        } catch (error) {
          lastError = error;
          if (
            error instanceof AssetStoreError
            && (
              error.code === "asset_process_resource_limit"
              || error.code === "asset_process_timeout"
            )
          ) {
            break;
          }
        }
      }
      if (!cloned) {
        throw lastError instanceof Error
          ? lastError
          : new AssetStoreError("asset_git_clone_failed", "Git clone failed.");
      }
      const commitSha = (await runProcess(this.options.gitCommand ?? "git", [
        "-C",
        checkout,
        "rev-parse",
        "HEAD",
      ], {
        cwd: checkout,
        env: gitProcessEnvironment(gitHome),
        timeoutMs: 10_000,
      })).trim();
      if (!/^[0-9a-f]{40}$/u.test(commitSha)) {
        throw new AssetStoreError("asset_git_sha_invalid", "Git did not return a fixed commit SHA.");
      }
      const sourceRoot = safeSubdirectory(checkout, input.subdirectory);
      await copyNormalizedTree(sourceRoot, snapshot, { rejectGitMetadata: true });
      return await this.storeDirectory(input.draft_id, input.kind, snapshot, {
        type: "git",
        repository_url: repository.toString(),
        commit_sha: commitSha,
        subdirectory: input.subdirectory,
      }, input.expected_content_sha256, undefined, {
        operationId: input.operation_id,
        requestFingerprint: input.request_fingerprint,
      });
    } finally {
      await Promise.all([
        rm(checkout, { recursive: true, force: true }),
        rm(snapshot, { recursive: true, force: true }),
        rm(gitHome, { recursive: true, force: true }),
      ]);
    }
  }

  async importWorkspaceZip(input: RuntimeAssetWorkspaceZipCall): Promise<AssetStoredPackage> {
    const operationId = input.operation_id
      ?? `direct_workspace_${sha256(input.draft_id).slice(0, 42)}`;
    const requestFingerprint = input.request_fingerprint ?? sha256(Buffer.from(JSON.stringify({
      draft_id: input.draft_id,
      expected_content_sha256: input.expected_content_sha256,
      kind: input.kind,
      member_id: input.member_id,
      thread_id: input.thread_id,
      workspace_relative_path: input.workspace_relative_path,
    })));
    const recovered = await this.recoverPackageOperation(
      operationId,
      requestFingerprint,
      input.draft_id,
      input.expected_content_sha256,
    );
    if (recovered) return recovered;
    const resolver = this.options.threadWorkspaceResolver;
    if (!resolver) {
      throw new AssetStoreError(
        "asset_thread_workspace_unavailable",
        "Current Thread workspace resolution is unavailable.",
      );
    }
    const workspace = await resolver.resolve({
      member_id: input.member_id,
      thread_id: input.thread_id,
    });
    assertResolvedThreadWorkspace(this.workdir, input, workspace);
    const workspaceRoot = resolve(workspace.root);
    const rootMetadata = await lstat(workspaceRoot).catch(() => null);
    if (!rootMetadata?.isDirectory() || rootMetadata.isSymbolicLink()) {
      throw new AssetStoreError(
        "asset_thread_workspace_invalid",
        "Current Thread workspace root is invalid.",
      );
    }
    const candidate = resolve(workspaceRoot, input.workspace_relative_path);
    if (!within(workspaceRoot, candidate) || !candidate.toLowerCase().endsWith(".zip")) {
      throw new AssetStoreError(
        "asset_workspace_path_forbidden",
        "Workspace ZIP must be a relative .zip file in the current Thread workspace.",
      );
    }
    const packageBytes = await readPinnedWorkspaceFile(workspaceRoot, candidate);
    return this.importZipStream({
      operation_id: operationId,
      request_fingerprint: requestFingerprint,
      draft_id: input.draft_id,
      expected_content_sha256: input.expected_content_sha256,
      kind: input.kind,
      file_name: basename(candidate),
      package_sha256: sha256(packageBytes),
      package_size_bytes: packageBytes.byteLength,
    }, [packageBytes]);
  }

  async storeMcp(input: RuntimeAssetMcpStoreInput): Promise<AssetStoredPackage> {
    const applyCredential = async (source: AssetSource): Promise<void> => {
      if (source.type !== "mcp") {
        throw new AssetStoreError(
          "asset_operation_invalid",
          "MCP package operation result is invalid.",
        );
      }
      if (input.bearer_token === undefined) return;
      await this.applyCredentialOperation(
        input.operation_id,
        input.request_fingerprint,
        this.draftCredentials,
        input.draft_id,
        source.endpoint_url,
        input.authentication,
        input.bearer_token,
      );
    };
    const recovered = await this.recoverPackageOperation(
      input.operation_id,
      input.request_fingerprint,
      input.draft_id,
      input.expected_content_sha256,
      (stored) => applyCredential(stored.source),
    );
    if (recovered) return recovered;
    await this.beginPackageOperation(input.operation_id, input.request_fingerprint);
    const endpoint = await publicHttpsUrl(input.endpoint_url);
    const temp = await this.tempDirectory("mcp");
    try {
      await writeFile(join(temp, "mcp.json"), `${JSON.stringify({
        endpoint_url: endpoint.toString(),
        authentication: input.authentication,
      }, null, 2)}\n`, { mode: 0o600 });
      const credentialConfigured = input.authentication === "bearer" && (
        input.bearer_token !== undefined && input.bearer_token !== null
          ? true
          : await this.credentialConfigured(
            this.draftCredentials,
            input.draft_id,
            endpoint.toString(),
            "bearer",
          )
      );
      const source: AssetSource = {
        type: "mcp",
        endpoint_url: endpoint.toString(),
        authentication: input.authentication,
        credential_configured: credentialConfigured,
      };
      return await this.storeDirectory(input.draft_id, "mcp", temp, source,
        input.expected_content_sha256, () => applyCredential(source), {
          operationId: input.operation_id,
          requestFingerprint: input.request_fingerprint,
        });
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }

  async validate(input: RuntimeAssetValidateInput): Promise<RuntimeAssetValidateResult> {
    await this.initialize();
    const operationPath = join(
      this.validationOperations,
      `${safeIdentifier(input.operation_id)}.json`,
    );
    return this.withReferenceLock(operationPath, async () => {
      const existing = await readJsonRecord(operationPath);
      if (existing) {
        if (existing.request_fingerprint !== input.request_fingerprint) {
          throw new AssetStoreError(
            "asset_operation_conflict",
            "Asset validation operation identity was reused with different input.",
          );
        }
        if (existing.status === "completed") {
          if (!isRuntimeAssetValidateResult(existing.result)) {
            throw new AssetStoreError(
              "asset_operation_invalid",
              "Asset validation operation result is invalid.",
            );
          }
          return existing.result;
        }
        if (existing.status !== "pending") {
          throw new AssetStoreError(
            "asset_operation_invalid",
            "Asset validation operation state is invalid.",
          );
        }
      } else {
        await atomicJson(operationPath, {
          request_fingerprint: safeDigest(input.request_fingerprint),
          status: "pending",
        });
      }
      const root = this.blobPath(input.content_sha256);
      await this.requireBlob(root);
      const issues: AssetValidationIssue[] = [];
      let capabilities: AssetCapabilityEntry[] = [];
      try {
        if (input.kind === "plugin") {
          capabilities = await this.validatePlugin(root);
        } else if (input.kind === "skill") {
          capabilities = await this.validateSkill(root);
        } else {
          capabilities = await this.validateMcp(input.draft_id, input.source);
        }
      } catch (error) {
        issues.push({
          code: error instanceof AssetStoreError ? error.code : "asset_validation_failed",
          severity: "error",
          path: null,
          message: error instanceof Error ? error.message : "Asset validation failed.",
        });
      }
      const snapshot: AssetValidationSnapshot = {
        status: issues.some((issue) => issue.severity === "error") ? "invalid" : "valid",
        validated_at_ms: this.options.nowMs?.() ?? Date.now(),
        validator: input.kind === "plugin"
          ? "codex-0.145.0-plugin"
          : input.kind === "skill"
            ? "codex-0.145.0-skills/list"
            : "mcp-streamable-http",
        issues,
        capabilities: {
          entries: capabilities,
          credential_configured: input.source.type === "mcp"
            ? await this.credentialConfigured(
              this.draftCredentials,
              input.draft_id,
              input.source.endpoint_url,
              input.source.authentication,
            )
            : false,
        },
      };
      const result: RuntimeAssetValidateResult = {
        validation: snapshot,
        capabilities: snapshot.capabilities,
      };
      await atomicJson(operationPath, {
        request_fingerprint: safeDigest(input.request_fingerprint),
        status: "completed",
        result,
      });
      return result;
    });
  }

  async contentRead(contentSha256: string, inputPath: string): Promise<AssetContent> {
    const root = this.blobPath(contentSha256);
    await this.requireBlob(root);
    const candidate = safeContentPath(root, inputPath);
    const metadata = await lstat(candidate);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new AssetStoreError("asset_content_not_found", "Asset content is not a regular file.");
    }
    const bytes = await readFile(candidate);
    const textual = safeTextContent(bytes, inputPath);
    return {
      path: posixPath(relative(root, candidate)),
      mime_type: contentType(inputPath, textual !== null),
      size_bytes: bytes.byteLength,
      sha256: sha256(bytes),
      text: textual,
      preview_truncated: textual !== null && bytes.byteLength > CONTENT_PREVIEW_MAX_BYTES,
    };
  }

  async versionContentRoot(
    _versionId: string,
    expectedContentSha256: string,
  ): Promise<string> {
    await this.initialize();
    const root = this.blobPath(expectedContentSha256);
    await this.requireBlob(root);
    return root;
  }

  async versionCredential(
    versionId: string,
    endpointUrl: string,
    authentication: "none" | "bearer",
  ): Promise<string | null> {
    await this.initialize();
    return this.readCredential(
      this.versionCredentials,
      versionId,
      endpointUrl,
      authentication,
    );
  }

  async listMcpTools(
    input: RuntimeAssetMcpToolsListInput,
  ): Promise<RuntimeAssetMcpToolsListResult> {
    const startedAt = Date.now();
    try {
      const { endpoint, token } = await this.versionMcpConnection(input.version_id);
      const budget = mcpRequestBudget();
      const session = await initializedMcpSession(endpoint, token, budget);
      const tools = normalizeMcpTools(await discoverMcpList(
        session,
        "tools/list",
        "tools",
        budget,
      ));
      recordAssetMcpToolOperation({
        actorId: input.actor_id,
        versionId: input.version_id,
        operation: "list",
        result: "succeeded",
        durationMs: Date.now() - startedAt,
        responseBytes: Buffer.byteLength(JSON.stringify(tools)),
      });
      return { tools };
    } catch (error) {
      recordAssetMcpToolOperation({
        actorId: input.actor_id,
        versionId: input.version_id,
        operation: "list",
        result: "failed",
        durationMs: Date.now() - startedAt,
        code: assetStoreErrorCode(error),
      });
      throw error;
    }
  }

  async callMcpTool(
    input: RuntimeAssetMcpToolCallInput,
  ): Promise<RuntimeAssetMcpToolCallResult> {
    assertSafeJson(input.arguments, 256 * 1024, "MCP tool arguments");
    const startedAt = Date.now();
    let callStarted = false;
    try {
      const { endpoint, token } = await this.versionMcpConnection(input.version_id);
      const budget = mcpRequestBudget();
      const session = await initializedMcpSession(endpoint, token, budget);
      const tools = normalizeMcpTools(await discoverMcpList(
        session,
        "tools/list",
        "tools",
        budget,
      ));
      if (!tools.some((tool) => tool.name === input.tool_name)) {
        throw new AssetStoreError("asset_mcp_tool_not_found", "MCP tool is not exposed by this asset version.");
      }
      callStarted = true;
      let rawResult: unknown;
      try {
        rawResult = await session.request("tools/call", {
          name: input.tool_name,
          arguments: input.arguments,
        });
      } catch (error) {
        if (error instanceof AssetStoreError && error.code === "asset_mcp_request_failed") {
          throw new AssetStoreError("asset_mcp_tool_rejected", "MCP rejected the tool call.");
        }
        throw new AssetStoreError(
          "asset_mcp_outcome_unknown",
          "MCP tool call outcome is unknown; the request was not retried.",
        );
      }
      const result = normalizeMcpToolCallResult(input.tool_name, rawResult);
      const responseBytes = Buffer.byteLength(JSON.stringify(result));
      if (responseBytes > 2 * 1024 * 1024) {
        throw new AssetStoreError("asset_mcp_response_too_large", "MCP tool result exceeded the safety limit.");
      }
      recordAssetMcpToolOperation({
        actorId: input.actor_id,
        versionId: input.version_id,
        operation: "call",
        toolName: input.tool_name,
        result: "succeeded",
        durationMs: Date.now() - startedAt,
        responseBytes,
      });
      return result;
    } catch (error) {
      const code = assetStoreErrorCode(error);
      recordAssetMcpToolOperation({
        actorId: input.actor_id,
        versionId: input.version_id,
        operation: "call",
        toolName: input.tool_name,
        result: callStarted && code === "asset_mcp_outcome_unknown" ? "unknown" : "failed",
        durationMs: Date.now() - startedAt,
        code,
      });
      throw error;
    }
  }

  private async versionMcpConnection(versionId: string): Promise<{
    endpoint: URL;
    token: string;
  }> {
    await this.initialize();
    const record = await this.readCredentialRecord(this.versionCredentials, versionId);
    if (!record) {
      throw new AssetStoreError("asset_mcp_credential_missing", "MCP asset credential is unavailable.");
    }
    return {
      endpoint: await publicHttpsUrl(record.endpoint_url),
      token: record.bearer_token,
    };
  }

  async compareAndSwapDraftReference(
    _draftId: string,
    _expectedContentSha256: string | null,
    nextContentSha256: string | null,
  ): Promise<void> {
    await this.initialize();
    if (nextContentSha256) await this.requireBlob(this.blobPath(nextContentSha256));
  }

  private async compareAndSwapDraftReferenceUnlocked(
    _draftId: string,
    _expectedContentSha256: string | null,
    nextContentSha256: string | null,
  ): Promise<void> {
    if (nextContentSha256) await this.requireBlob(this.blobPath(nextContentSha256));
  }

  async publishReference(
    draftId: string,
    versionId: string,
    expectedContentSha256: string,
  ): Promise<void> {
    await this.initialize();
    await this.withQuotaLock(async () => {
      await this.requireBlob(this.blobPath(expectedContentSha256));
      await this.copyCredential(
        this.draftCredentials,
        draftId,
        this.versionCredentials,
        versionId,
        1,
      );
    });
  }

  async releaseDraft(draftId: string): Promise<void> {
    await this.initialize();
    await this.withQuotaLock(async () => {
      const referencePath = this.referencePath(this.draftRefs, draftId);
      await unlink(referencePath).catch(ignoreMissing);
      await unlink(this.credentialPath(this.draftCredentials, draftId)).catch(ignoreMissing);
    });
  }

  async releaseVersion(versionId: string): Promise<void> {
    await this.initialize();
    await this.withQuotaLock(async () => {
      const referencePath = this.referencePath(this.versionRefs, versionId);
      await unlink(referencePath).catch(ignoreMissing);
      await unlink(this.credentialPath(this.versionCredentials, versionId)).catch(ignoreMissing);
    });
  }

  async replaceCredential(input: RuntimeAssetCredentialImmediateCall): Promise<void> {
    const root = input.reference.type === "draft"
      ? this.draftCredentials
      : this.versionCredentials;
    const id = input.reference.type === "draft"
      ? input.reference.draft_id
      : input.reference.version_id;
    await this.withQuotaLock(() => this.applyCredentialOperation(
      input.operation_id,
      input.request_fingerprint,
      root,
      id,
      input.endpoint_url,
      input.authentication,
      input.bearer_token,
    ));
  }

  async stageCredential(input: RuntimeAssetCredentialReplaceInput): Promise<void> {
    await this.initialize();
    const operationPath = this.credentialOperationPath(input.operation_id);
    await this.withReferenceLock(operationPath, async () => {
      const existing = await readJsonRecord(operationPath);
      if (existing) {
        this.assertCredentialOperationFingerprint(existing, input.request_fingerprint);
        if (
          existing.status === "staged"
          || existing.status === "completed"
          || existing.status === "superseded"
        ) return;
        throw new AssetStoreError(
          "asset_operation_invalid",
          "Asset credential operation state is invalid.",
        );
      }
      await atomicSecureJson(this.credentialStagePath(input.operation_id), {
        reference: input.reference,
        target_revision: input.target_revision,
        expected_operation_id: input.expected_operation_id,
        endpoint_url: input.endpoint_url,
        authentication: input.authentication,
        bearer_token: input.bearer_token,
      });
      await atomicJson(operationPath, {
        request_fingerprint: safeDigest(input.request_fingerprint),
        status: "staged",
        target: input.reference.type,
        target_id: input.reference.type === "draft"
          ? input.reference.draft_id
          : input.reference.version_id,
        target_revision: input.target_revision,
        expected_operation_id: input.expected_operation_id,
        endpoint_url: input.endpoint_url,
        authentication: input.authentication,
        credential_present: input.bearer_token !== null,
      });
    });
  }

  async commitCredential(input: RuntimeAssetCredentialOperationInput): Promise<{
    target: "draft" | "version";
    targetId: string;
    outcome: "completed" | "superseded";
  }> {
    await this.initialize();
    const operationPath = this.credentialOperationPath(input.operation_id);
    return this.withQuotaLock(() => this.withReferenceLock(operationPath, async () => {
      const existing = await readJsonRecord(operationPath);
      if (!existing) {
        throw new AssetStoreError(
          "asset_operation_invalid",
          "Asset credential operation was not staged.",
        );
      }
      this.assertCredentialOperationFingerprint(existing, input.request_fingerprint);
      if (existing.status === "completed" || existing.status === "superseded") {
        await unlink(this.credentialStagePath(input.operation_id)).catch(ignoreMissing);
        const target = existing.target;
        const targetId = existing.target_id;
        if (
          (target !== "draft" && target !== "version")
          || typeof targetId !== "string"
          || targetId.length === 0
        ) {
          throw new AssetStoreError(
            "asset_operation_invalid",
            "Asset credential operation target is invalid.",
          );
        }
        return {
          target,
          targetId,
          outcome: existing.status,
        };
      }
      if (existing.status !== "staged") {
        throw new AssetStoreError(
          "asset_operation_invalid",
          "Asset credential operation state is invalid.",
        );
      }
      const staged = await readJsonRecord(this.credentialStagePath(input.operation_id));
      const parsed = stagedCredentialValue(staged);
      if (!parsed) {
        throw new AssetStoreError(
          "asset_operation_invalid",
          "Asset staged credential is invalid.",
        );
      }
      const root = parsed.reference.type === "draft"
        ? this.draftCredentials
        : this.versionCredentials;
      const id = parsed.reference.type === "draft"
        ? parsed.reference.draft_id
        : parsed.reference.version_id;
      const statePath = this.credentialPath(root, id);
      const state = credentialTargetStateValue(await readJsonRecord(statePath));
      let outcome: "completed" | "superseded";
      if (state?.operation_id === input.operation_id) {
        // The target CAS committed before the operation receipt was finalized.
        outcome = "completed";
      } else if (parsed.target_revision > (state?.target_revision ?? 0)) {
        await atomicSecureJson(statePath, {
          endpoint_url: parsed.endpoint_url,
          authentication: parsed.authentication,
          bearer_token: parsed.bearer_token,
          operation_id: input.operation_id,
          target_revision: parsed.target_revision,
        });
        outcome = "completed";
      } else if ((state?.target_revision ?? 0) > parsed.target_revision) {
        // A later DB revision already committed; this stage is safely superseded.
        outcome = "superseded";
      } else {
        throw new AssetStoreError(
          "asset_operation_conflict",
          "A different credential operation already owns this target revision.",
        );
      }
      await atomicJson(operationPath, {
        ...existing,
        status: outcome,
      });
      await unlink(this.credentialStagePath(input.operation_id)).catch(ignoreMissing);
      return {
        target: parsed.reference.type,
        targetId: id,
        outcome,
      };
    }));
  }

  async abortCredential(input: RuntimeAssetCredentialOperationInput): Promise<void> {
    await this.initialize();
    const operationPath = this.credentialOperationPath(input.operation_id);
    await this.withReferenceLock(operationPath, async () => {
      const existing = await readJsonRecord(operationPath);
      if (!existing) {
        await unlink(this.credentialStagePath(input.operation_id)).catch(ignoreMissing);
        return;
      }
      this.assertCredentialOperationFingerprint(existing, input.request_fingerprint);
      if (existing.status === "completed" || existing.status === "superseded") {
        await unlink(this.credentialStagePath(input.operation_id)).catch(ignoreMissing);
        return;
      }
      await Promise.all([
        unlink(operationPath).catch(ignoreMissing),
        unlink(this.credentialStagePath(input.operation_id)).catch(ignoreMissing),
      ]);
    });
  }

  private assertCredentialOperationFingerprint(
    operation: Record<string, unknown>,
    requestFingerprint: string,
  ): void {
    if (operation.request_fingerprint !== requestFingerprint) {
      throw new AssetStoreError(
        "asset_operation_conflict",
        "Asset credential operation identity was reused with different input.",
      );
    }
  }

  private credentialOperationPath(operationId: string): string {
    return join(this.credentialOperations, `${safeIdentifier(operationId)}.json`);
  }

  private credentialStagePath(operationId: string): string {
    return join(this.credentialStages, `${safeIdentifier(operationId)}.json`);
  }

  private async validateSkill(root: string): Promise<AssetCapabilityEntry[]> {
    const validationRoot = await this.tempDirectory("skill-validation");
    const packageRoot = join(validationRoot, "package");
    const validatorHome = join(validationRoot, "validator-home");
    try {
      assertWithin(validationRoot, packageRoot);
      assertWithin(validationRoot, validatorHome);
      await copyNormalizedTree(root, packageRoot, { rejectGitMetadata: true });
      await mkdir(validatorHome, { recursive: true, mode: 0o700 });
      const skillFiles = (await walkTree(packageRoot)).filter((entry) => (
        entry.type === "file" && basename(entry.absolutePath) === "SKILL.md"
      ));
      if (skillFiles.length !== 1) {
        throw new AssetStoreError(
          "asset_skill_manifest_invalid",
          "A Skill package must contain exactly one SKILL.md.",
        );
      }
      const client = CodexAppServerClient.fromProcess(
        [this.options.codexCommand ?? "codex", "app-server"],
        { workdir: validationRoot, codexHomePath: validatorHome },
        { defaultTimeoutMs: 20_000 },
      );
      try {
        await initializeCodexValidator(client);
        const result = await client.request<{ data?: Array<{ skills?: unknown[]; errors?: unknown[] }> }>(
          "skills/list",
          { cwds: [packageRoot], forceReload: true },
        );
        const entries = result.data ?? [];
        const errors = entries.flatMap((entry) => entry.errors ?? []);
        const skills = entries.flatMap((entry) => entry.skills ?? []);
        const expectedSkillPath = await realpath(skillFiles[0]!.absolutePath);
        const expectedSkillName = skillName(await readFile(expectedSkillPath, "utf8"));
        const acceptedSkills = await Promise.all(skills.map(async (value) => {
          if (!isRecord(value)) return false;
          const reportedPath = stringValue(value.path);
          if (
            value.name !== expectedSkillName
            || value.scope !== "repo"
            || value.enabled !== true
            || !reportedPath
          ) {
            return false;
          }
          return await realpath(reportedPath).catch(() => null) === expectedSkillPath;
        }));
        if (errors.length > 0 || acceptedSkills.filter(Boolean).length !== 1) {
          throw new AssetStoreError(
            "asset_skill_codex_validation_failed",
            "Codex skills/list did not accept the imported Skill.",
          );
        }
        return [{
          kind: "skill",
          name: expectedSkillName,
        }];
      } finally {
        await client.close().catch(() => undefined);
      }
    } finally {
      await rm(validationRoot, { recursive: true, force: true });
    }
  }

  private async validatePlugin(root: string): Promise<AssetCapabilityEntry[]> {
    const manifestPath = join(root, ".codex-plugin", "plugin.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
    if (!isRecord(manifest)) {
      throw new AssetStoreError("asset_plugin_manifest_invalid", "Plugin manifest must be an object.");
    }
    const pluginName = stringValue(manifest.name);
    const pluginVersion = stringValue(manifest.version);
    if (
      !pluginName
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(pluginName)
      || pluginName.length > 128
      || !pluginVersion
      || !isFormalAssetVersion(pluginVersion)
    ) {
      throw new AssetStoreError(
        "asset_plugin_manifest_invalid",
        "Plugin manifest must declare a safe kebab-case name and version.",
      );
    }
    const validationRoot = await this.tempDirectory("plugin-validation");
    const marketplacePath = join(validationRoot, ".agents", "plugins", "marketplace.json");
    const pluginRoot = join(validationRoot, "package");
    try {
      assertWithin(validationRoot, marketplacePath);
      assertWithin(validationRoot, pluginRoot);
      await mkdir(dirname(marketplacePath), { recursive: true, mode: 0o700 });
      await mkdir(dirname(pluginRoot), { recursive: true, mode: 0o700 });
      await copyNormalizedTree(root, pluginRoot, { rejectGitMetadata: true });
      await writeFile(marketplacePath, `${JSON.stringify({
        name: "fields-asset-validation",
        interface: { displayName: "Fields Asset Validation" },
        plugins: [{
          name: pluginName,
          source: { source: "local", path: "./package" },
          policy: {
            installation: "AVAILABLE",
            authentication: "ON_INSTALL",
          },
          category: "Developer Tools",
        }],
      }, null, 2)}\n`, { mode: 0o600 });
      const client = CodexAppServerClient.fromProcess(
        [this.options.codexCommand ?? "codex", "app-server"],
        {
          workdir: validationRoot,
          codexHomePath: join(validationRoot, "validator-home"),
        },
        { defaultTimeoutMs: 20_000 },
      );
      try {
        await initializeCodexValidator(client);
        const response = await client.request<unknown>("plugin/read", {
          marketplacePath,
          remoteMarketplaceName: null,
          pluginName,
        });
        const detail = pluginDetail(response);
        if (
          detail.summary.name !== pluginName
          || detail.summary.localVersion !== pluginVersion
        ) {
          throw new AssetStoreError(
            "asset_plugin_codex_validation_failed",
            "Codex 0.145.0 reported drifted Plugin identity or version.",
          );
        }
        return pluginCapabilities(detail);
      } finally {
        await client.close().catch(() => undefined);
      }
    } finally {
      await rm(validationRoot, { recursive: true, force: true });
    }
  }

  private async validateMcp(
    draftId: string,
    source: AssetSource,
  ): Promise<AssetCapabilityEntry[]> {
    if (source.type !== "mcp") {
      throw new AssetStoreError("asset_mcp_source_invalid", "MCP validation requires an MCP source.");
    }
    const endpoint = await publicHttpsUrl(source.endpoint_url);
    const token = await this.readCredential(
      this.draftCredentials,
      draftId,
      endpoint.toString(),
      source.authentication,
    );
    const discoveryBudget = {
      bytes: 0,
      entries: 0,
      deadlineMs: Date.now() + 60_000,
    };
    const session = new PinnedMcpSession(endpoint, token, discoveryBudget);
    await session.initialize({
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "fields-asset-validator", version: "0.1.4" },
    });
    await session.notify("notifications/initialized");
    const tools = await discoverMcpList(
      session,
      "tools/list",
      "tools",
      discoveryBudget,
    );
    const resources = await discoverMcpList(
      session,
      "resources/list",
      "resources",
      discoveryBudget,
    );
    const prompts = await discoverMcpList(
      session,
      "prompts/list",
      "prompts",
      discoveryBudget,
    );
    return [
      ...tools.map((tool) => ({
        kind: "tool" as const,
        name: requiredRpcName(tool, "tool"),
      })),
      ...resources.map((resource) => ({
        kind: "resource" as const,
        name: optionalRpcName(resource) ?? requiredRpcUri(resource),
      })),
      ...prompts.map((prompt) => ({
        kind: "prompt" as const,
        name: requiredRpcName(prompt, "prompt"),
      })),
    ];
  }

  private async storeDirectory(
    draftId: string,
    kind: AssetKind,
    sourceRoot: string,
    source: AssetSource,
    expectedContentSha256: string | null,
    afterReference?: () => Promise<void>,
    packageOperation?: {
      operationId: string;
      requestFingerprint: string;
    },
  ): Promise<AssetStoredPackage> {
    await this.initialize();
    const normalized = await this.tempDirectory("normalized");
    try {
      await copyNormalizedTree(sourceRoot, normalized, { rejectGitMetadata: true });
      const files = await assetFileEntries(normalized);
      if (files.filter((entry) => entry.type === "file").length === 0) {
        throw new AssetStoreError("asset_package_empty", "Asset packages cannot be empty.");
      }
      const digest = canonicalTreeDigest(files);
      const archive = await deterministicAssetZip(normalized, files);
      if (this.options.objectStore) {
        await this.options.objectStore.putIfAbsent(digest, archive);
        emitLifecycleEvent("company_assets.object.persisted", {
          "fields.operation_id": draftId,
          "fields.file_count": files.length,
          "fields.byte_count": archive.byteLength,
        });
      }
      const inferred = await inferredMetadata(kind, normalized);
      const stored: AssetStoredPackage = {
        content_sha256: digest,
        source,
        inferred_name: inferred.name,
        inferred_slug: inferred.slug,
        inferred_version: inferred.version,
        files,
      };
      if (packageOperation) {
        await this.preparePackageOperation(
          packageOperation.operationId,
          packageOperation.requestFingerprint,
          stored,
        );
      }
      const blob = this.blobPath(digest);
      await this.withQuotaLock(async () => {
        let createdBlob = false;
        if (!await exists(blob)) {
          await this.assertQuota(files.reduce((sum, entry) => sum + (entry.size_bytes ?? 0), 0));
          const temporaryBlob = `${blob}.${randomUUID()}.tmp`;
          await rename(normalized, temporaryBlob);
          await sealAssetTree(temporaryBlob);
          try {
            await rename(temporaryBlob, blob);
            createdBlob = true;
          } catch (error) {
            if (!await exists(blob)) throw error;
            await removeAssetTree(temporaryBlob);
          }
        }
        await this.requireBlob(blob);
        try {
          if (packageOperation) {
            await this.writePackageOperation(
              packageOperation.operationId,
              packageOperation.requestFingerprint,
              "staged",
              stored,
            );
          }
          await this.compareAndSwapDraftReferenceUnlocked(
            draftId,
            expectedContentSha256,
            digest,
          );
          await afterReference?.();
          if (packageOperation) {
            await this.writePackageOperation(
              packageOperation.operationId,
              packageOperation.requestFingerprint,
              "completed",
              stored,
            );
          }
        } catch (error) {
          await this.compareAndSwapDraftReferenceUnlocked(
            draftId,
            digest,
            expectedContentSha256,
          ).catch(() => undefined);
          if (createdBlob) await this.collectBlob(digest);
          throw error;
        }
        if (expectedContentSha256 && expectedContentSha256 !== digest) {
          await this.collectBlob(expectedContentSha256);
        }
      });
      return stored;
    } finally {
      await removeAssetTree(normalized);
    }
  }

  private async assertQuota(additionalBytes: number): Promise<void> {
    const current = await directoryRegularFileBytes(this.blobs);
    const quota = this.options.quotaBytes ?? DEFAULT_ASSET_QUOTA_BYTES;
    if (current + additionalBytes > quota) {
      throw new AssetStoreError("asset_quota_exceeded", "Company asset storage quota exceeded.");
    }
  }

  private async collectBlob(contentSha256: string): Promise<void> {
    const references = [
      ...await referenceDigests(this.draftRefs),
      ...await referenceDigests(this.versionRefs),
    ];
    if (!references.includes(contentSha256)) {
      await removeAssetTree(this.blobPath(contentSha256));
    }
  }

  private async requireBlob(blob: string): Promise<void> {
    let metadata = await lstat(blob).catch(() => null);
    if (!metadata && this.options.objectStore) {
      await this.materializeBlobFromObjectStore(basename(blob), blob);
      emitLifecycleEvent("company_assets.cache.materialized", {
        "fields.operation_id": basename(blob),
      });
      metadata = await lstat(blob).catch(() => null);
    }
    if (!metadata?.isDirectory() || metadata.isSymbolicLink()) {
      throw new AssetStoreError("asset_content_not_found", "Asset content is unavailable.");
    }
    try {
      const digest = canonicalTreeDigest(await assetFileEntries(blob));
      if (digest !== basename(blob)) {
        throw new AssetStoreError(
          "asset_content_integrity_failed",
          "Asset content no longer matches its immutable digest.",
        );
      }
    } catch (error) {
      if (error instanceof AssetStoreError) throw error;
      throw new AssetStoreError(
        "asset_content_integrity_failed",
        "Asset content integrity could not be verified.",
      );
    }
  }

  private async materializeBlobFromObjectStore(digest: string, blob: string): Promise<void> {
    const temporary = await this.tempDirectory("cache");
    const archivePath = join(temporary, "package.zip");
    const extractedPath = join(temporary, "contents");
    try {
      const archive = await this.options.objectStore!.get(safeDigest(digest));
      if (archive.byteLength === 0 || archive.byteLength > ASSET_PACKAGE_MAX_EXPANDED_BYTES) {
        throw new AssetStoreError(
          "asset_content_integrity_failed",
          "Asset object package size is invalid.",
        );
      }
      await writeFile(archivePath, archive, { mode: 0o600, flag: "wx" });
      await mkdir(extractedPath, { recursive: true, mode: 0o700 });
      await extractSafeZip(archivePath, extractedPath);
      const actual = canonicalTreeDigest(await assetFileEntries(extractedPath));
      if (actual !== digest) {
        throw new AssetStoreError(
          "asset_content_integrity_failed",
          "Asset object package does not match its immutable digest.",
        );
      }
      await chmod(this.blobs, 0o700);
      try {
        await rename(extractedPath, blob);
      } catch (error) {
        if (!await exists(blob)) throw error;
      }
      await sealAssetTree(blob);
    } finally {
      await removeAssetTree(temporary);
    }
  }

  private async readReference(root: string, id: string): Promise<{ content_sha256: string }> {
    const parsed = JSON.parse(await readFile(this.referencePath(root, id), "utf8")) as unknown;
    if (
      typeof parsed !== "object"
      || parsed === null
      || Array.isArray(parsed)
      || !("content_sha256" in parsed)
      || typeof parsed.content_sha256 !== "string"
      || !/^[0-9a-f]{64}$/u.test(parsed.content_sha256)
    ) {
      throw new AssetStoreError("asset_reference_invalid", "Asset reference is invalid.");
    }
    return { content_sha256: parsed.content_sha256 };
  }

  private async readCredential(
    root: string,
    id: string,
    endpointUrl: string,
    authentication: "none" | "bearer",
  ): Promise<string | null> {
    if (authentication === "none") return null;
    const record = await this.readCredentialRecord(root, id);
    return record?.endpoint_url === endpointUrl ? record.bearer_token : null;
  }

  private async readCredentialRecord(
    root: string,
    id: string,
  ): Promise<{
    endpoint_url: string;
    bearer_token: string;
    operation_id?: string;
  } | null> {
    const text = await readFile(this.credentialPath(root, id), "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    if (text === null) return null;
    const value = JSON.parse(text) as unknown;
    const targetState = credentialTargetStateValue(value);
    if (targetState?.bearer_token === null) return null;
    if (
      !isRecord(value)
      || typeof value.endpoint_url !== "string"
      || typeof value.bearer_token !== "string"
      || value.bearer_token.length === 0
    ) {
      throw new AssetStoreError("asset_credential_invalid", "Asset credential is invalid.");
    }
    return {
      endpoint_url: value.endpoint_url,
      bearer_token: value.bearer_token,
      ...(typeof value.operation_id === "string"
        ? { operation_id: value.operation_id }
        : {}),
    };
  }

  private async applyCredentialOperation(
    operationId: string,
    requestFingerprint: string,
    root: string,
    id: string,
    endpointUrl: string,
    authentication: "none" | "bearer",
    bearerToken: string | null | undefined,
  ): Promise<void> {
    await this.initialize();
    const operationPath = join(
      this.credentialOperations,
      `${safeIdentifier(operationId)}.json`,
    );
    const existing = await readJsonRecord(operationPath);
    if (existing) {
      if (existing.request_fingerprint !== requestFingerprint) {
        throw new AssetStoreError(
          "asset_operation_conflict",
          "Asset credential operation identity was reused with different input.",
        );
      }
      if (existing.status === "completed") return;
      if (existing.status !== "pending") {
        throw new AssetStoreError(
          "asset_operation_invalid",
          "Asset credential operation state is invalid.",
        );
      }
    } else {
      await atomicJson(operationPath, {
        request_fingerprint: safeDigest(requestFingerprint),
        status: "pending",
        target: root === this.draftCredentials ? "draft" : "version",
        target_id: id,
        endpoint_url: endpointUrl,
        authentication,
        credential_present: bearerToken !== null && bearerToken !== undefined,
      });
    }
    const credential = await this.readCredentialRecord(root, id);
    if (
      authentication === "bearer"
      && bearerToken !== null
      && credential?.operation_id === operationId
    ) {
      await atomicJson(operationPath, {
        request_fingerprint: safeDigest(requestFingerprint),
        status: "completed",
        target: root === this.draftCredentials ? "draft" : "version",
        target_id: id,
        endpoint_url: endpointUrl,
        authentication,
        credential_present: true,
      });
      return;
    }
    await this.writeCredential(
      root,
      id,
      endpointUrl,
      authentication,
      bearerToken,
      operationId,
    );
    await atomicJson(operationPath, {
      request_fingerprint: safeDigest(requestFingerprint),
      status: "completed",
      target: root === this.draftCredentials ? "draft" : "version",
      target_id: id,
      endpoint_url: endpointUrl,
      authentication,
      credential_present: bearerToken !== null && bearerToken !== undefined,
    });
  }

  private async beginPackageOperation(
    operationId: string,
    requestFingerprint: string,
  ): Promise<void> {
    await this.initialize();
    const path = this.packageOperationPath(operationId);
    const existing = await readJsonRecord(path);
    if (existing) {
      if (existing.request_fingerprint !== requestFingerprint) {
        throw new AssetStoreError(
          "asset_operation_conflict",
          "Asset package operation identity was reused with different input.",
        );
      }
      return;
    }
    await atomicJson(path, {
      request_fingerprint: safeDigest(requestFingerprint),
      status: "pending",
    });
  }

  private async recoverPackageOperation(
    operationId: string,
    requestFingerprint: string,
    draftId: string,
    expectedContentSha256: string | null,
    afterReference?: (stored: AssetStoredPackage) => Promise<void>,
  ): Promise<AssetStoredPackage | null> {
    await this.initialize();
    const existing = await readJsonRecord(this.packageOperationPath(operationId));
    if (!existing) return null;
    if (existing.request_fingerprint !== requestFingerprint) {
      throw new AssetStoreError(
        "asset_operation_conflict",
        "Asset package operation identity was reused with different input.",
      );
    }
    if (existing.status === "pending" || existing.status === "prepared") return null;
    if (existing.status !== "staged" && existing.status !== "completed") {
      throw new AssetStoreError("asset_operation_invalid", "Asset package operation state is invalid.");
    }
    const stored = storedPackageValue(existing.result);
    if (!stored) {
      throw new AssetStoreError("asset_operation_invalid", "Asset package operation result is invalid.");
    }
    await this.withQuotaLock(async () => {
      await this.requireBlob(this.blobPath(stored.content_sha256));
      await this.compareAndSwapDraftReferenceUnlocked(
        draftId,
        expectedContentSha256,
        stored.content_sha256,
      );
      await afterReference?.(stored);
      await this.writePackageOperation(
        operationId,
        requestFingerprint,
        "completed",
        stored,
      );
    });
    return stored;
  }

  private async writePackageOperation(
    operationId: string,
    requestFingerprint: string,
    status: "staged" | "completed",
    result: AssetStoredPackage,
  ): Promise<void> {
    await atomicJson(this.packageOperationPath(operationId), {
      request_fingerprint: safeDigest(requestFingerprint),
      status,
      result,
    });
  }

  private async preparePackageOperation(
    operationId: string,
    requestFingerprint: string,
    result: AssetStoredPackage,
  ): Promise<void> {
    const path = this.packageOperationPath(operationId);
    const existing = await readJsonRecord(path);
    if (
      existing
      && existing.request_fingerprint === requestFingerprint
      && existing.status === "prepared"
    ) {
      if (JSON.stringify(existing.result) !== JSON.stringify(result)) {
        throw new AssetStoreError(
          "asset_operation_conflict",
          "Asset package source changed while resuming an idempotent import.",
        );
      }
      return;
    }
    if (!existing || existing.request_fingerprint !== requestFingerprint) {
      throw new AssetStoreError(
        "asset_operation_conflict",
        "Asset package operation identity is invalid.",
      );
    }
    if (existing.status !== "pending") {
      throw new AssetStoreError("asset_operation_invalid", "Asset package operation state is invalid.");
    }
    await atomicJson(path, {
      request_fingerprint: safeDigest(requestFingerprint),
      status: "prepared",
      result,
    });
  }

  private packageOperationPath(operationId: string): string {
    return join(this.packageOperations, `${safeIdentifier(operationId)}.json`);
  }

  private async credentialConfigured(
    root: string,
    id: string,
    endpointUrl: string,
    authentication: "none" | "bearer",
  ): Promise<boolean> {
    return (await this.readCredential(root, id, endpointUrl, authentication)) !== null;
  }

  private async writeCredential(
    root: string,
    id: string,
    endpointUrl: string,
    authentication: "none" | "bearer",
    bearerToken: string | null | undefined,
    operationId?: string,
  ): Promise<void> {
    await this.initialize();
    const path = this.credentialPath(root, id);
    if (authentication === "none" || bearerToken === null) {
      await unlink(path).catch(ignoreMissing);
      return;
    }
    if (bearerToken === undefined) {
      if (!await this.credentialConfigured(root, id, endpointUrl, authentication)) {
        await unlink(path).catch(ignoreMissing);
      }
      return;
    }
    await atomicSecureJson(path, {
      endpoint_url: endpointUrl,
      bearer_token: bearerToken,
      ...(operationId ? { operation_id: operationId } : {}),
    });
  }

  private async copyCredential(
    sourceRoot: string,
    sourceId: string,
    destinationRoot: string,
    destinationId: string,
    targetRevision?: number,
  ): Promise<void> {
    const source = await readJsonRecord(this.credentialPath(sourceRoot, sourceId));
    const destination = this.credentialPath(destinationRoot, destinationId);
    const targetState = credentialTargetStateValue(source);
    if (targetState) {
      await atomicSecureJson(destination, {
        ...targetState,
        target_revision: targetRevision ?? targetState.target_revision,
      });
      return;
    }
    const record = await this.readCredentialRecord(sourceRoot, sourceId);
    if (!record) {
      await unlink(destination).catch(ignoreMissing);
      return;
    }
    await atomicSecureJson(destination, record);
  }

  private credentialPath(root: string, id: string): string {
    return join(root, `${safeIdentifier(id)}.json`);
  }

  private async withReferenceLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.referenceOperations.get(path) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    this.referenceOperations.set(path, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.referenceOperations.get(path) === current) {
        this.referenceOperations.delete(path);
      }
    }
  }

  private async withQuotaLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.quotaOperation;
    let release!: () => void;
    this.quotaOperation = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private blobPath(digest: string): string {
    return join(this.blobs, safeDigest(digest));
  }

  private referencePath(root: string, id: string): string {
    return join(root, `${safeIdentifier(id)}.json`);
  }

  private tempDirectory(label: string): Promise<string> {
    return mkdtemp(join(tmpdir(), `fields-assets-${label}-`));
  }
}

async function deterministicAssetZip(
  root: string,
  entries: readonly AssetFileEntry[],
): Promise<Uint8Array> {
  const contents: Zippable = {};
  for (const entry of [...entries].sort((left, right) => left.path.localeCompare(right.path))) {
    const path = entry.type === "directory" ? `${entry.path}/` : entry.path;
    contents[path] = entry.type === "directory"
      ? new Uint8Array()
      : await readFile(join(root, ...entry.path.split("/")));
  }
  return zipSync(contents, {
    level: 9,
    mtime: new Date("1980-01-01T00:00:00.000Z"),
  });
}

async function extractSafeZip(packagePath: string, target: string): Promise<void> {
  await preflightZipCentralDirectory(packagePath);
  const archive = await unzipper.Open.file(packagePath);
  let totalBytes = 0;
  let entryCount = 0;
  const paths = new Set<string>();
  for (const entry of archive.files) {
    entryCount += 1;
    if (entryCount > ASSET_PACKAGE_MAX_FILES) {
      throw new AssetStoreError("asset_zip_expansion_limit", "ZIP expansion limits were exceeded.");
    }
    const entryPath = safeArchivePath(entry.path);
    if (paths.has(entryPath)) {
      throw new AssetStoreError("asset_zip_duplicate_path", "ZIP contains duplicate normalized paths.");
    }
    paths.add(entryPath);
    const kind = zipEntryKind(entry);
    if (kind === "directory") {
      await mkdir(join(target, ...entryPath.split("/")), { recursive: true, mode: 0o700 });
      continue;
    }
    const claimedSize = Number(entry.uncompressedSize);
    if (
      !Number.isSafeInteger(claimedSize)
      || claimedSize < 0
      || claimedSize > ASSET_PACKAGE_MAX_FILE_BYTES
    ) {
      throw new AssetStoreError("asset_zip_file_size_invalid", "ZIP contains an oversized file.");
    }
    const outputPath = join(target, ...entryPath.split("/"));
    const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
    await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
    const handle = await open(temporaryPath, "wx", 0o600);
    let fileBytes = 0;
    try {
      for await (const chunk of entry.stream()) {
        const contents = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        fileBytes += contents.byteLength;
        totalBytes += contents.byteLength;
        if (
          fileBytes > ASSET_PACKAGE_MAX_FILE_BYTES
          || totalBytes > ASSET_PACKAGE_MAX_EXPANDED_BYTES
        ) {
          throw new AssetStoreError(
            "asset_zip_expansion_limit",
            "ZIP expansion limits were exceeded.",
          );
        }
        await handle.write(contents);
      }
      if (fileBytes !== claimedSize) {
        throw new AssetStoreError(
          "asset_zip_file_size_invalid",
          "ZIP entry size does not match its header.",
        );
      }
      await handle.sync();
      await handle.close();
      await rename(temporaryPath, outputPath);
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlink(temporaryPath).catch(ignoreMissing);
      throw error;
    }
  }
}

async function preflightZipCentralDirectory(packagePath: string): Promise<void> {
  const archive = await readFile(packagePath);
  const minimumEocdSize = 22;
  const maximumCommentSize = 0xffff;
  const firstCandidate = Math.max(0, archive.byteLength - minimumEocdSize - maximumCommentSize);
  let eocdOffset = -1;
  for (let offset = archive.byteLength - minimumEocdSize; offset >= firstCandidate; offset -= 1) {
    if (archive.readUInt32LE(offset) !== 0x06054b50) continue;
    const commentLength = archive.readUInt16LE(offset + 20);
    if (offset + minimumEocdSize + commentLength === archive.byteLength) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new AssetStoreError("asset_zip_invalid", "ZIP end-of-central-directory is invalid.");
  }
  const diskNumber = archive.readUInt16LE(eocdOffset + 4);
  const centralDirectoryDisk = archive.readUInt16LE(eocdOffset + 6);
  const recordsOnDisk = archive.readUInt16LE(eocdOffset + 8);
  const totalRecords = archive.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = archive.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = archive.readUInt32LE(eocdOffset + 16);
  if (
    diskNumber !== 0
    || centralDirectoryDisk !== 0
    || recordsOnDisk !== totalRecords
    || totalRecords === 0xffff
    || centralDirectorySize === 0xffffffff
    || centralDirectoryOffset === 0xffffffff
    || centralDirectoryOffset + centralDirectorySize !== eocdOffset
  ) {
    throw new AssetStoreError(
      "asset_zip_invalid",
      "ZIP64, multi-disk, or inconsistent central directories are not accepted.",
    );
  }
  if (totalRecords > ASSET_PACKAGE_MAX_FILES) {
    throw new AssetStoreError("asset_zip_expansion_limit", "ZIP expansion limits were exceeded.");
  }
  let cursor = centralDirectoryOffset;
  let counted = 0;
  while (cursor < eocdOffset) {
    if (
      cursor + 46 > eocdOffset
      || archive.readUInt32LE(cursor) !== 0x02014b50
    ) {
      throw new AssetStoreError("asset_zip_invalid", "ZIP central directory is malformed.");
    }
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const fileNameLength = archive.readUInt16LE(cursor + 28);
    const extraFieldLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const diskStart = archive.readUInt16LE(cursor + 34);
    const localHeaderOffset = archive.readUInt32LE(cursor + 42);
    if (
      compressedSize === 0xffffffff
      || uncompressedSize === 0xffffffff
      || diskStart === 0xffff
      || diskStart !== 0
      || localHeaderOffset === 0xffffffff
    ) {
      throw new AssetStoreError("asset_zip_invalid", "ZIP64 or multi-disk entries are not accepted.");
    }
    cursor += 46 + fileNameLength + extraFieldLength + commentLength;
    counted += 1;
    if (cursor > eocdOffset || counted > ASSET_PACKAGE_MAX_FILES) {
      throw new AssetStoreError("asset_zip_expansion_limit", "ZIP expansion limits were exceeded.");
    }
  }
  if (cursor !== eocdOffset || counted !== totalRecords) {
    throw new AssetStoreError("asset_zip_invalid", "ZIP central-directory counts are inconsistent.");
  }
}

function zipEntryKind(entry: unzipper.File): "file" | "directory" {
  const mode = Number(entry.externalFileAttributes ?? 0) >>> 16;
  const unixKind = mode & 0o170000;
  if (unixKind === 0o120000) {
    throw new AssetStoreError("asset_zip_symlink_forbidden", "ZIP symbolic links are forbidden.");
  }
  if (unixKind !== 0 && unixKind !== 0o100000 && unixKind !== 0o040000) {
    throw new AssetStoreError("asset_zip_special_file_forbidden", "ZIP special files are forbidden.");
  }
  return entry.type === "Directory" || unixKind === 0o040000 ? "directory" : "file";
}

function safeArchivePath(input: string): string {
  const rawComponents = input.split("/");
  if (
    input.length === 0
    || input.includes("\\")
    || input.startsWith("/")
    || /^[A-Za-z]:/u.test(input)
    || rawComponents.includes("..")
  ) {
    throw new AssetStoreError("asset_zip_path_invalid", "ZIP contains an absolute or invalid path.");
  }
  const normalized = posix.normalize(input).replace(/\/$/u, "");
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new AssetStoreError("asset_zip_slip", "ZIP path escapes the package root.");
  }
  return normalized;
}

async function copyNormalizedTree(
  source: string,
  destination: string,
  options: { rejectGitMetadata: boolean },
): Promise<void> {
  const sourceMetadata = await lstat(source).catch(() => null);
  if (!sourceMetadata?.isDirectory() || sourceMetadata.isSymbolicLink()) {
    throw new AssetStoreError("asset_package_root_invalid", "Asset package root must be a directory.");
  }
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const entries = await walkTree(source, {
    skipGitMetadata: options.rejectGitMetadata,
    maxEntries: ASSET_PACKAGE_MAX_FILES,
    maxBytes: ASSET_PACKAGE_MAX_EXPANDED_BYTES,
  });
  for (const entry of entries) {
    if (entry.metadata.isSymbolicLink()) {
      throw new AssetStoreError("asset_package_symlink_forbidden", "Asset symbolic links are forbidden.");
    }
    const output = join(destination, ...entry.relativePath.split("/"));
    if (entry.type === "directory") {
      await mkdir(output, { recursive: true, mode: 0o700 });
      continue;
    }
    if (!entry.metadata.isFile()) {
      throw new AssetStoreError("asset_package_special_file_forbidden", "Asset special files are forbidden.");
    }
    const fileBytes = Number(entry.metadata.size);
    if (!Number.isSafeInteger(fileBytes) || fileBytes < 0) {
      throw new AssetStoreError("asset_package_limit_exceeded", "Asset package size is invalid.");
    }
    if (
      fileBytes > ASSET_PACKAGE_MAX_FILE_BYTES
    ) {
      throw new AssetStoreError("asset_package_limit_exceeded", "Asset package limits were exceeded.");
    }
    await mkdir(dirname(output), { recursive: true, mode: 0o700 });
    await cp(entry.absolutePath, output, {
      force: false,
      errorOnExist: true,
      preserveTimestamps: false,
    });
    await chmod(output, 0o600);
  }
}

type WalkEntry = {
  absolutePath: string;
  relativePath: string;
  type: "file" | "directory";
  metadata: Awaited<ReturnType<typeof lstat>>;
};

async function walkTree(
  root: string,
  options: {
    skipGitMetadata?: boolean;
    maxEntries?: number;
    maxBytes?: number;
  } = {},
): Promise<WalkEntry[]> {
  const output: WalkEntry[] = [];
  let totalBytes = 0;
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (options.skipGitMetadata && entry.name === ".git") continue;
      const absolutePath = join(directory, entry.name);
      const metadata = await lstat(absolutePath);
      const relativePath = posixPath(relative(root, absolutePath));
      output.push({
        absolutePath,
        relativePath,
        type: entry.isDirectory() ? "directory" : "file",
        metadata,
      });
      if (output.length > (options.maxEntries ?? Number.POSITIVE_INFINITY)) {
        throw new AssetStoreError("asset_package_limit_exceeded", "Asset package entry limit was exceeded.");
      }
      if (!entry.isDirectory()) {
        totalBytes += metadata.size;
        if (totalBytes > (options.maxBytes ?? Number.POSITIVE_INFINITY)) {
          throw new AssetStoreError("asset_package_limit_exceeded", "Asset package size limit was exceeded.");
        }
      }
      if (entry.isDirectory()) {
        await visit(absolutePath);
      }
    }
  }
  await visit(root);
  return output.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function assetFileEntries(root: string): Promise<AssetFileEntry[]> {
  const output: AssetFileEntry[] = [];
  for (const entry of await walkTree(root)) {
    if (
      entry.metadata.isSymbolicLink()
      || (entry.type === "directory" && !entry.metadata.isDirectory())
      || (entry.type === "file" && !entry.metadata.isFile())
    ) {
      throw new AssetStoreError(
        "asset_content_integrity_failed",
        "Asset content contains an invalid filesystem entry.",
      );
    }
    if (entry.type === "directory") {
      output.push({
        path: entry.relativePath,
        type: "directory",
        size_bytes: null,
        sha256: null,
      });
    } else {
      const bytes = await readFile(entry.absolutePath);
      output.push({
        path: entry.relativePath,
        type: "file",
        size_bytes: bytes.byteLength,
        sha256: sha256(bytes),
      });
    }
  }
  return output;
}

async function sealAssetTree(root: string): Promise<void> {
  const entries = await walkTree(root);
  for (const entry of entries) {
    if (entry.type === "file") {
      await chmod(entry.absolutePath, 0o400);
    }
  }
  for (const entry of [...entries].reverse()) {
    if (entry.type === "directory") {
      await chmod(entry.absolutePath, 0o500);
    }
  }
  await chmod(root, 0o500);
}

async function removeAssetTree(root: string): Promise<void> {
  const metadata = await lstat(root).catch(() => null);
  if (!metadata) return;
  if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
    const entries = await walkTree(root).catch(() => []);
    for (const entry of entries) {
      if (entry.type === "directory" && !entry.metadata.isSymbolicLink()) {
        await chmod(entry.absolutePath, 0o700).catch(() => undefined);
      }
    }
    await chmod(root, 0o700).catch(() => undefined);
  }
  await rm(root, { recursive: true, force: true });
}

function canonicalTreeDigest(files: AssetFileEntry[]): string {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.type);
    hash.update("\0");
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.sha256 ?? "");
    hash.update("\0");
    hash.update(String(file.size_bytes ?? ""));
    hash.update("\n");
  }
  return hash.digest("hex");
}

async function inferredMetadata(
  kind: AssetKind,
  root: string,
): Promise<{ name: string | null; slug: string | null; version: string | null }> {
  if (kind === "plugin") {
    const manifestPath = join(root, ".codex-plugin", "plugin.json");
    const value = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
    if (!isRecord(value)) {
      throw new AssetStoreError("asset_plugin_manifest_invalid", "Plugin manifest must be an object.");
    }
    const rawName = typeof value.name === "string"
      ? value.name
      : typeof value.id === "string"
        ? value.id
        : null;
    const name = stringValue(rawName);
    const rawId = typeof value.id === "string" ? value.id : null;
    const version = stringValue(value.version);
    if (
      !name
      || rawName !== name
      || !version
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)
      || name.length > 128
      || rawId !== null && (
        rawId !== rawId.trim()
        || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(rawId)
        || rawId.length > 128
      )
      || !isFormalAssetVersion(version)
      || name === "fields-core"
    ) {
      throw new AssetStoreError(
        "asset_plugin_manifest_invalid",
        "Plugin manifest must declare a safe name and formal semantic version.",
      );
    }
    const slug = rawId ?? name;
    if (slug === "fields-core") {
      throw new AssetStoreError(
        "asset_reserved_identity",
        "The fields-core identity is reserved.",
      );
    }
    return { name, slug, version };
  }
  if (kind === "skill") {
    const skill = (await walkTree(root)).find((entry) => (
      entry.type === "file" && basename(entry.absolutePath) === "SKILL.md"
    ));
    if (!skill) {
      throw new AssetStoreError("asset_skill_manifest_invalid", "Skill package requires SKILL.md.");
    }
    const name = skillName(await readFile(skill.absolutePath, "utf8"));
    const slug = slugify(name);
    if (name.trim().toLowerCase() === "fields-core" || slug === "fields-core") {
      throw new AssetStoreError(
        "asset_reserved_identity",
        "The fields-core identity is reserved.",
      );
    }
    return { name, slug, version: null };
  }
  return { name: null, slug: null, version: null };
}

async function publicHttpsUrl(input: string): Promise<URL> {
  return (await publicHttpsTarget(input)).url;
}

async function publicHttpsTarget(input: string): Promise<{
  url: URL;
  addresses: string[];
  hostname: string;
}> {
  const url = new URL(input);
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || !url.hostname
    || url.search
    || url.hash
  ) {
    throw new AssetStoreError("asset_public_https_required", "Only public HTTPS endpoints are allowed.");
  }
  const hostname = normalizedUrlHostname(url.hostname);
  const resolvedAddresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (
    resolvedAddresses.length === 0
    || resolvedAddresses.some(({ address }) => !isPublicAddress(address))
  ) {
    throw new AssetStoreError(
      "asset_private_network_forbidden",
      "Loopback, link-local, and private network addresses are forbidden.",
    );
  }
  return {
    url,
    hostname,
    addresses: [...new Set(resolvedAddresses.map(({ address }) => address))],
  };
}

function normalizedUrlHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    return isPublicIpv4(address);
  }
  const normalized = address.toLowerCase().split("%")[0]!;
  const mapped = mappedIpv4(normalized);
  if (mapped !== null) return isPublicIpv4(mapped);
  const hextets = ipv6Hextets(normalized);
  if (!hextets) return false;
  const [first, second, third] = hextets;
  if ((first! & 0xe000) !== 0x2000) return false;
  return !(
    first === 0x2002
    || first === 0x2001 && second === 0x0000
    || first === 0x2001 && second === 0x0002 && third === 0x0000
    || first === 0x2001 && second! >= 0x0010 && second! <= 0x001f
    || first === 0x2001 && second! >= 0x0020 && second! <= 0x002f
    || first === 0x2001 && second === 0x0db8
    || first === 0x3fff && (second! & 0xf000) === 0
  );
}

function ipv6Hextets(address: string): number[] | null {
  const pieces = address.split("::");
  if (pieces.length > 2) return null;
  const left = pieces[0] ? pieces[0].split(":") : [];
  const right = pieces[1] ? pieces[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((pieces.length === 1 && missing !== 0) || missing < 0) return null;
  const values = [
    ...left,
    ...Array.from({ length: missing }, () => "0"),
    ...right,
  ].map((value) => Number.parseInt(value || "0", 16));
  return values.length === 8 && values.every((value) => (
    Number.isInteger(value) && value >= 0 && value <= 0xffff
  )) ? values : null;
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  const [a, b, c] = octets;
  return !(
    a === 0
    || a === 10
    || a === 127
    || a === 169 && b === 254
    || a === 172 && b! >= 16 && b! <= 31
    || a === 192 && b === 0 && (c === 0 || c === 2)
    || a === 192 && b === 168
    || a === 192 && b === 88 && c === 99
    || a === 198 && (b === 18 || b === 19)
    || a === 198 && b === 51 && c === 100
    || a === 203 && b === 0 && c === 113
    || a === 100 && b! >= 64 && b! <= 127
    || a! >= 224
  );
}

function mappedIpv4(address: string): string | null {
  if (!address.startsWith("::ffff:")) return null;
  const suffix = address.slice("::ffff:".length);
  if (isIP(suffix) === 4) return suffix;
  const groups = suffix.split(":");
  if (groups.length !== 2 || groups.some((group) => !/^[0-9a-f]{1,4}$/u.test(group))) {
    return null;
  }
  const high = Number.parseInt(groups[0]!, 16);
  const low = Number.parseInt(groups[1]!, 16);
  return [
    high >>> 8,
    high & 0xff,
    low >>> 8,
    low & 0xff,
  ].join(".");
}

function curlResolve(hostname: string, port: string, address: string): string {
  return `${hostname}:${port}:${isIP(address) === 6 ? `[${address}]` : address}`;
}

function safeSubdirectory(root: string, subdirectory: string | null): string {
  if (!subdirectory) return root;
  if (subdirectory.includes("\\") || subdirectory.startsWith("/")) {
    throw new AssetStoreError("asset_git_subdirectory_invalid", "Git subdirectory is invalid.");
  }
  const candidate = resolve(root, subdirectory);
  if (!within(root, candidate) || relative(root, candidate).split(sep).includes(".git")) {
    throw new AssetStoreError("asset_git_subdirectory_invalid", "Git subdirectory escapes the repository.");
  }
  return candidate;
}

function safeContentPath(root: string, input: string): string {
  if (input.includes("\\") || input.startsWith("/")) {
    throw new AssetStoreError("asset_content_path_invalid", "Asset content path is invalid.");
  }
  const candidate = resolve(root, input);
  if (!within(root, candidate)) {
    throw new AssetStoreError("asset_content_path_invalid", "Asset content path escapes the package.");
  }
  return candidate;
}

function within(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep));
}

function assertWithin(root: string, candidate: string): void {
  if (resolve(root) === resolve(candidate) || !within(root, candidate)) {
    throw new AssetStoreError(
      "asset_validation_path_invalid",
      "Asset validation destination escapes its isolated root.",
    );
  }
}

function assertResolvedThreadWorkspace(
  workdir: string,
  input: Pick<
    RuntimeAssetWorkspaceZipInput,
    "member_id" | "thread_id"
  >,
  workspace: AssetThreadWorkspace,
): void {
  if (
    workspace.member_id !== input.member_id
    || workspace.thread_id !== input.thread_id
  ) {
    throw new AssetStoreError(
      "asset_thread_workspace_conflict",
      "Resolved Thread workspace identity conflicts with the current Member or Thread.",
    );
  }
  const expected = memberWorkspaceLayout(workdir, input.member_id).workspace;
  if (resolve(workspace.root) !== resolve(expected)) {
    throw new AssetStoreError(
      "asset_thread_workspace_conflict",
      "Resolved Thread workspace root does not match its authoritative mapping.",
    );
  }
}

async function readPinnedWorkspaceFile(workspaceRoot: string, candidate: string): Promise<Buffer> {
  const canonicalRoot = await realpath(workspaceRoot);
  if (canonicalRoot !== resolve(workspaceRoot)) {
    throw new AssetStoreError(
      "asset_thread_workspace_invalid",
      "Current Thread workspace root must not be a symbolic link.",
    );
  }
  const relativePath = relative(workspaceRoot, candidate);
  let current = workspaceRoot;
  for (const component of relativePath.split(sep)) {
    current = join(current, component);
    const metadata = await lstat(current).catch(() => null);
    if (!metadata || metadata.isSymbolicLink()) {
      throw new AssetStoreError(
        "asset_workspace_path_invalid",
        "Workspace ZIP path must not contain symbolic links.",
      );
    }
  }
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(candidate, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch {
    throw new AssetStoreError(
      "asset_workspace_path_invalid",
      "Workspace ZIP could not be opened without following symbolic links.",
    );
  }
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      throw new AssetStoreError("asset_workspace_path_invalid", "Workspace ZIP must be a regular file.");
    }
    const openedPath = await realpath(`/proc/self/fd/${handle.fd}`).catch(() => null);
    if (!openedPath || !within(canonicalRoot, openedPath)) {
      throw new AssetStoreError(
        "asset_workspace_path_forbidden",
        "Opened Workspace ZIP escaped the current Thread workspace.",
      );
    }
    const size = Number(metadata.size);
    if (!Number.isSafeInteger(size) || size <= 0 || size > ASSET_ZIP_MAX_COMPRESSED_BYTES) {
      throw new AssetStoreError("asset_zip_size_invalid", "ZIP package exceeds the 25 MiB limit.");
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

function safeIdentifier(value: string): string {
  if (!/^[A-Za-z0-9_.:-]{1,200}$/u.test(value)) {
    throw new AssetStoreError("asset_identifier_invalid", "Asset identifier is invalid.");
  }
  return value;
}

function safeDigest(value: string): string {
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    throw new AssetStoreError("asset_digest_invalid", "Asset digest is invalid.");
  }
  return value;
}

function isFormalAssetVersion(value: string): boolean {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(value)
    && value.split(".").every((part) => Number.isSafeInteger(Number(part)));
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { flag: "wx", mode: 0o600 });
  await rename(temporary, path);
}

async function atomicSecureJson(path: string, value: unknown): Promise<void> {
  await atomicJson(path, value);
  await chmod(path, 0o600);
}

async function readJsonRecord(path: string): Promise<Record<string, unknown> | null> {
  const text = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (text === null) return null;
  const value = JSON.parse(text) as unknown;
  if (!isRecord(value)) {
    throw new AssetStoreError("asset_operation_invalid", "Asset operation state is invalid.");
  }
  return value;
}

async function referenceDigests(root: string): Promise<string[]> {
  const output: string[] = [];
  for (const file of await readdir(root).catch(() => [])) {
    try {
      const value = JSON.parse(await readFile(join(root, file), "utf8")) as {
        content_sha256?: unknown;
      };
      if (typeof value.content_sha256 === "string") output.push(value.content_sha256);
    } catch {
      // Invalid reference files are ignored by garbage collection and remain for inspection.
    }
  }
  return output;
}

async function directoryRegularFileBytes(root: string): Promise<number> {
  const metadata = await lstat(root).catch(() => null);
  if (!metadata) return 0;
  if (metadata.isFile()) return metadata.size;
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) return 0;
  let total = 0;
  for (const entry of await readdir(root)) {
    total += await directoryRegularFileBytes(join(root, entry));
  }
  return total;
}

async function runProcess(
  command: string,
  args: string[],
  input: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    resourcePath?: string;
    maxResourceBytes?: number;
    maxFileBytes?: number;
  },
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const processCommand = input.maxFileBytes ? "/bin/sh" : command;
    const processArgs = input.maxFileBytes
      ? [
        "-c",
        'ulimit -f "$1" || exit 125; shift; exec "$@"',
        "asset-file-limit",
        String(Math.max(1, Math.floor(input.maxFileBytes / 512))),
        command,
        ...args,
      ]
      : args;
    const child = spawn(processCommand, processArgs, {
      cwd: input.cwd,
      env: input.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderrBytes = 0;
    let timedOut = false;
    let resourceExceeded = false;
    let resourceCheckRunning = false;
    const terminate = (): void => {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
          return;
        } catch {
          // Fall back to the direct child if its process group no longer exists.
        }
      }
      child.kill("SIGKILL");
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, input.timeoutMs);
    timeout.unref();
    const resourceMonitor = input.resourcePath && input.maxResourceBytes
      ? setInterval(() => {
        if (resourceCheckRunning || resourceExceeded) return;
        resourceCheckRunning = true;
        void directoryRegularFileBytes(input.resourcePath!).then((bytes) => {
          if (bytes > input.maxResourceBytes!) {
            resourceExceeded = true;
            terminate();
          }
        }).finally(() => {
          resourceCheckRunning = false;
        });
      }, 5)
      : null;
    resourceMonitor?.unref();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < 16_384) stdout += chunk;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      if (resourceMonitor) clearInterval(resourceMonitor);
      reject(error);
    });
    child.once("close", (code, signal) => {
      void (async () => {
        clearTimeout(timeout);
        if (resourceMonitor) clearInterval(resourceMonitor);
        if (
          !resourceExceeded
          && input.resourcePath
          && input.maxResourceBytes
          && await directoryRegularFileBytes(input.resourcePath) > input.maxResourceBytes
        ) {
          resourceExceeded = true;
        }
        if (
          !resourceExceeded
          && input.maxFileBytes
          && (
            signal === "SIGXFSZ"
            || code !== 0
            && input.resourcePath
            && await directoryRegularFileBytes(input.resourcePath) >= input.maxFileBytes
          )
        ) {
          resourceExceeded = true;
        }
        if (resourceExceeded) terminate();
        if (code === 0 && !resourceExceeded) {
          resolvePromise(stdout);
        } else {
          reject(new AssetStoreError(
            resourceExceeded
              ? "asset_process_resource_limit"
              : timedOut
                ? "asset_process_timeout"
                : "asset_process_failed",
            resourceExceeded
              ? `${command} exceeded its isolated filesystem limit.`
              : timedOut
                ? `${command} exceeded its isolated execution timeout.`
                : `${command} failed with exit code ${String(code)} (${stderrBytes} diagnostic bytes suppressed).`,
          ));
        }
      })().catch(reject);
    });
  });
}

function gitProcessEnvironment(isolatedHome: string): NodeJS.ProcessEnv {
  const names = [
    "PATH", "LANG", "LC_ALL", "TZ", "SSL_CERT_FILE", "SSL_CERT_DIR",
  ];
  return {
    ...Object.fromEntries(
      names.flatMap((name) => process.env[name] ? [[name, process.env[name]!]] : []),
    ),
    HOME: isolatedHome,
    XDG_CONFIG_HOME: join(isolatedHome, "xdg"),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
    SSH_ASKPASS: "",
  };
}

async function initializeCodexValidator(client: CodexAppServerClient): Promise<void> {
  await client.request("initialize", {
    clientInfo: {
      name: "fields-asset-validator",
      title: "Fields Asset Validator",
      version: "0.1.4",
    },
    capabilities: {
      experimentalApi: true,
      requestAttestation: false,
      optOutNotificationMethods: [],
    },
  });
  await client.sendNotification({ method: "initialized" });
}

type CodexPluginDetail = {
  summary: { name: string; localVersion: string | null };
  skills: unknown[];
  hooks: unknown[];
  apps: unknown[];
  appTemplates: unknown[];
  mcpServers: unknown[];
  scheduledTasks: unknown[];
};

function pluginDetail(value: unknown): CodexPluginDetail {
  const response = recordValue(value, "Plugin response");
  const plugin = recordValue(response.plugin, "Plugin detail");
  const summary = recordValue(plugin.summary, "Plugin summary");
  if (
    typeof summary.name !== "string"
    || !(typeof summary.localVersion === "string" || summary.localVersion === null)
  ) {
    throw new AssetStoreError(
      "asset_plugin_codex_validation_failed",
      "Codex 0.145.0 returned an invalid Plugin identity.",
    );
  }
  return {
    summary: {
      name: summary.name,
      localVersion: summary.localVersion,
    },
    skills: arrayValue(plugin.skills),
    hooks: arrayValue(plugin.hooks),
    apps: arrayValue(plugin.apps),
    appTemplates: arrayValue(plugin.appTemplates),
    mcpServers: arrayValue(plugin.mcpServers),
    scheduledTasks: arrayValue(plugin.scheduledTasks),
  };
}

function pluginCapabilities(detail: CodexPluginDetail): AssetCapabilityEntry[] {
  return [
    ...namedCapabilities(detail.skills, "skill"),
    ...namedCapabilities(detail.hooks, "hook"),
    ...namedCapabilities(detail.apps, "app"),
    ...namedCapabilities(detail.appTemplates, "task_template"),
    ...namedCapabilities(detail.scheduledTasks, "task_template"),
    ...detail.mcpServers.flatMap((value) => (
      typeof value === "string" && value.length > 0
        ? [{ kind: "mcp" as const, name: value }]
        : []
    )),
  ];
}

function namedCapabilities(
  values: unknown[],
  kind: AssetCapabilityEntry["kind"],
): AssetCapabilityEntry[] {
  return values.flatMap((value) => {
    if (!isRecord(value)) return [];
    const name = stringValue(value.name)
      ?? stringValue(value.id)
      ?? stringValue(value.title);
    return name ? [{ kind, name }] : [];
  });
}

type PinnedMcpResponse = {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
};

type PinnedMcpPost = (
  endpoint: URL,
  body: Buffer,
  extraHeaders: Record<string, string>,
  timeoutMs: number,
  maxResponseBytes: number,
) => Promise<PinnedMcpResponse>;

function mcpRequestBudget(): { bytes: number; entries: number; deadlineMs: number } {
  return { bytes: 0, entries: 0, deadlineMs: Date.now() + 60_000 };
}

async function initializedMcpSession(
  endpoint: URL,
  token: string,
  budget: { bytes: number; entries: number; deadlineMs: number },
): Promise<PinnedMcpSession> {
  const session = new PinnedMcpSession(endpoint, token, budget);
  await session.initialize({
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "fields-human-api", version: "0.1.0" },
  });
  await session.notify("notifications/initialized");
  return session;
}

export function normalizeMcpTools(values: Record<string, unknown>[]): AssetMcpToolDescriptor[] {
  const names = new Set<string>();
  return values.map((value) => {
    const name = requiredRpcName(value, "tool");
    if (names.has(name)) {
      throw new AssetStoreError("asset_mcp_response_invalid", "MCP returned duplicate tool names.");
    }
    names.add(name);
    const inputSchema = value.inputSchema;
    if (!isRecord(inputSchema)) {
      throw new AssetStoreError("asset_mcp_response_invalid", "MCP tool input schema is invalid.");
    }
    assertSafeJson(inputSchema, 256 * 1024, "MCP tool input schema");
    const annotations = isRecord(value.annotations) ? value.annotations : null;
    return assetMcpToolDescriptorSchema.parse({
      name,
      title: boundedOptionalString(value.title, 256, "MCP tool title"),
      description: boundedOptionalString(value.description, 8_000, "MCP tool description"),
      input_schema: inputSchema,
      annotations: annotations ? definedEntries({
        title: boundedOptionalString(annotations.title, 256, "MCP tool annotation title") ?? undefined,
        read_only_hint: optionalBoolean(annotations.readOnlyHint),
        destructive_hint: optionalBoolean(annotations.destructiveHint),
        idempotent_hint: optionalBoolean(annotations.idempotentHint),
        open_world_hint: optionalBoolean(annotations.openWorldHint),
      }) : null,
    });
  });
}

export function normalizeMcpToolCallResult(
  toolName: string,
  value: unknown,
): RuntimeAssetMcpToolCallResult {
  const record = recordValue(value, "MCP tool result");
  const content = record.content;
  if (!Array.isArray(content) || content.length > 256) {
    throw new AssetStoreError("asset_mcp_response_invalid", "MCP tool result content is invalid.");
  }
  const text = content.map((item) => {
    if (!isRecord(item) || item.type !== "text" || typeof item.text !== "string") {
      throw new AssetStoreError(
        "asset_mcp_response_unsupported",
        "MCP tool result contains unsupported non-text content.",
      );
    }
    if (Buffer.byteLength(item.text) > 2 * 1024 * 1024) {
      throw new AssetStoreError("asset_mcp_response_too_large", "MCP tool result exceeded the safety limit.");
    }
    return item.text;
  });
  const structuredContent = record.structuredContent ?? null;
  if (structuredContent !== null) {
    assertSafeJson(structuredContent, 2 * 1024 * 1024, "MCP structured tool result");
  }
  return runtimeAssetMcpToolCallResultSchema.parse({
    tool_name: toolName,
    is_error: record.isError === true,
    text,
    structured_content: structuredContent,
  });
}

function boundedOptionalString(value: unknown, maxLength: number, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new AssetStoreError("asset_mcp_response_invalid", `${label} is invalid.`);
  }
  return value;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function definedEntries<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

function assertSafeJson(value: unknown, maxBytes: number, label: string): void {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new AssetStoreError("asset_mcp_json_invalid", `${label} is not valid JSON.`);
  }
  if (encoded === undefined || Buffer.byteLength(encoded) > maxBytes) {
    throw new AssetStoreError("asset_mcp_json_invalid", `${label} exceeded the safety limit.`);
  }
  const visit = (current: unknown, depth: number): void => {
    if (depth > 64) {
      throw new AssetStoreError("asset_mcp_json_invalid", `${label} exceeded the nesting limit.`);
    }
    if (Array.isArray(current)) {
      for (const item of current) visit(item, depth + 1);
    } else if (isRecord(current)) {
      for (const item of Object.values(current)) visit(item, depth + 1);
    }
  };
  visit(value, 0);
}

function assetStoreErrorCode(error: unknown): string {
  return error instanceof AssetStoreError ? error.code : "asset_mcp_internal_error";
}

export class PinnedMcpSession {
  private sessionId: string | null = null;
  private protocolVersion: string | null = null;
  private nextId = 1;

  constructor(
    private readonly endpoint: URL,
    private readonly bearerToken: string | null,
    private readonly budget: {
      bytes: number;
      entries: number;
      deadlineMs: number;
    },
    private readonly post: PinnedMcpPost = pinnedHttpsPost,
  ) {}

  async initialize(params: Record<string, unknown>): Promise<void> {
    if (this.protocolVersion !== null) {
      throw new AssetStoreError(
        "asset_mcp_response_invalid",
        "MCP session was initialized more than once.",
      );
    }
    const result = await this.request("initialize", params);
    const parsed = InitializeResultSchema.safeParse(result);
    if (
      !parsed.success
      || !SUPPORTED_PROTOCOL_VERSIONS.includes(parsed.data.protocolVersion)
    ) {
      throw new AssetStoreError(
        "asset_mcp_response_invalid",
        "MCP returned an invalid or unsupported initialize result.",
      );
    }
    this.protocolVersion = parsed.data.protocolVersion;
  }

  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (method !== "initialize" && this.protocolVersion === null) {
      throw new AssetStoreError(
        "asset_mcp_response_invalid",
        "MCP request was attempted before initialization.",
      );
    }
    const id = this.nextId;
    this.nextId += 1;
    const response = await this.send({ jsonrpc: "2.0", id, method, params }, true);
    if (!isRecord(response) || response.id !== id) {
      throw new AssetStoreError("asset_mcp_response_invalid", "MCP returned an invalid response id.");
    }
    if (response.error !== undefined) {
      throw new AssetStoreError("asset_mcp_request_failed", "MCP discovery request failed.");
    }
    return response.result;
  }

  async notify(method: string): Promise<void> {
    if (this.protocolVersion === null) {
      throw new AssetStoreError(
        "asset_mcp_response_invalid",
        "MCP notification was attempted before initialization.",
      );
    }
    await this.send({ jsonrpc: "2.0", method }, false);
  }

  private async send(
    payload: Record<string, unknown>,
    expectsResponse: boolean,
  ): Promise<unknown> {
    const remainingMs = this.budget.deadlineMs - Date.now();
    if (remainingMs <= 0) {
      throw new AssetStoreError(
        "asset_mcp_discovery_limit",
        "MCP discovery exceeded its overall deadline.",
      );
    }
    const remainingBytes = 8 * 1024 * 1024 - this.budget.bytes;
    if (remainingBytes <= 0) {
      throw new AssetStoreError(
        "asset_mcp_discovery_limit",
        "MCP discovery exceeded aggregate response limits.",
      );
    }
    const body = Buffer.from(JSON.stringify(payload));
    const responseLimit = Math.min(2 * 1024 * 1024, remainingBytes);
    let response: PinnedMcpResponse;
    try {
      response = await this.post(this.endpoint, body, {
        ...(this.bearerToken ? { Authorization: `Bearer ${this.bearerToken}` } : {}),
        ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
        ...(this.protocolVersion
          ? { "Mcp-Protocol-Version": this.protocolVersion }
          : {}),
      }, Math.min(15_000, remainingMs), responseLimit);
    } catch (error) {
      if (
        responseLimit < 2 * 1024 * 1024
        && error instanceof AssetStoreError
        && error.code === "asset_mcp_response_too_large"
      ) {
        throw new AssetStoreError(
          "asset_mcp_discovery_limit",
          "MCP discovery exceeded aggregate response limits.",
        );
      }
      throw error;
    }
    this.budget.bytes += response.body.byteLength;
    if (this.budget.bytes > 8 * 1024 * 1024) {
      throw new AssetStoreError(
        "asset_mcp_discovery_limit",
        "MCP discovery exceeded aggregate response limits.",
      );
    }
    assertNoSecretReflection(response.body.toString("utf8"), this.bearerToken);
    if (response.statusCode >= 300 && response.statusCode < 400) {
      throw new AssetStoreError(
        "asset_mcp_redirect_forbidden",
        "MCP redirects are rejected to prevent network-boundary changes.",
      );
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new AssetStoreError("asset_mcp_unavailable", "MCP endpoint rejected discovery.");
    }
    const sessionId = response.headers["mcp-session-id"];
    if (typeof sessionId === "string" && sessionId.length > 0 && sessionId.length <= 512) {
      this.sessionId = sessionId;
    }
    if (!expectsResponse) return null;
    const parsed = parseMcpResponse(response.body, response.headers["content-type"]);
    assertNoSecretReflection(parsed, this.bearerToken);
    return parsed;
  }
}

async function pinnedHttpsPost(
  endpoint: URL,
  body: Buffer,
  extraHeaders: Record<string, string>,
  timeoutMs: number,
  maxResponseBytes: number,
): Promise<{
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}> {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    let deadline: ReturnType<typeof setTimeout> | null = null;
    const resolveOnce = (value: PinnedMcpResponse): void => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      resolvePromise(value);
    };
    const rejectOnce = (error: Error): void => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      reject(error);
    };
    const lookupFunction: LookupFunction = (hostname, _options, callback) => {
      void lookup(hostname, { all: true, verbatim: true }).then((addresses) => {
        const publicAddresses = addresses.filter(({ address }) => isPublicAddress(address));
        if (publicAddresses.length !== addresses.length || publicAddresses.length === 0) {
          callback(new AssetStoreError(
            "asset_private_network_forbidden",
            "MCP DNS resolved to a forbidden network address.",
          ), "", 0);
          return;
        }
        const selected = publicAddresses[0]!;
        callback(null, selected.address, selected.family);
      }, (error: Error) => callback(error, "", 0));
    };
    const request = httpsRequest(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "content-length": String(body.byteLength),
        ...extraHeaders,
      },
      lookup: lookupFunction,
    }, (response) => {
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        total += chunk.byteLength;
        if (total > maxResponseBytes) {
          request.destroy(new AssetStoreError(
            "asset_mcp_response_too_large",
            "MCP discovery response exceeded the safety limit.",
          ));
          return;
        }
        chunks.push(chunk);
      });
      response.once("error", rejectOnce);
      response.once("end", () => resolveOnce({
        statusCode: response.statusCode ?? 500,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    deadline = setTimeout(() => request.destroy(new AssetStoreError(
      "asset_mcp_timeout",
      "MCP discovery exceeded its wall-clock timeout.",
    )), timeoutMs);
    deadline.unref();
    request.once("error", rejectOnce);
    request.end(body);
  });
}

function parseMcpResponse(
  body: Buffer,
  contentTypeHeader: string | string[] | undefined,
): unknown {
  const contentType = Array.isArray(contentTypeHeader)
    ? contentTypeHeader[0] ?? ""
    : contentTypeHeader ?? "";
  const text = body.toString("utf8");
  try {
    if (contentType.toLowerCase().includes("text/event-stream")) {
      const data = text.split(/\r?\n/u)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
        .find((line) => line.length > 0);
      if (!data) throw new Error("missing SSE data");
      return JSON.parse(data) as unknown;
    }
    return JSON.parse(text) as unknown;
  } catch {
    throw new AssetStoreError("asset_mcp_response_invalid", "MCP returned malformed JSON-RPC.");
  }
}

function rpcList(value: unknown, field: string): Record<string, unknown>[] {
  const record = recordValue(value, "MCP discovery result");
  const list = record[field];
  if (!Array.isArray(list) || !list.every(isRecord)) {
    throw new AssetStoreError("asset_mcp_response_invalid", `MCP ${field} result is invalid.`);
  }
  return list;
}

export async function discoverMcpList(
  session: PinnedMcpSession,
  method: "tools/list" | "resources/list" | "prompts/list",
  field: "tools" | "resources" | "prompts",
  budget: { bytes: number; entries: number; deadlineMs: number },
): Promise<Record<string, unknown>[]> {
  const output: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < 100; page += 1) {
    if (Date.now() >= budget.deadlineMs) {
      throw new AssetStoreError(
        "asset_mcp_discovery_limit",
        "MCP discovery exceeded its overall deadline.",
      );
    }
    const result = await session.request(method, cursor ? { cursor } : {});
    const pageEntries = rpcList(result, field);
    budget.entries += pageEntries.length;
    if (budget.entries > 10_000) {
      throw new AssetStoreError(
        "asset_mcp_discovery_limit",
        "MCP discovery exceeded aggregate capability limits.",
      );
    }
    output.push(...pageEntries);
    const record = recordValue(result, "MCP discovery result");
    const nextCursor = stringValue(record.nextCursor);
    if (!nextCursor) return output;
    if (seen.has(nextCursor)) {
      throw new AssetStoreError(
        "asset_mcp_response_invalid",
        "MCP discovery returned a repeated pagination cursor.",
      );
    }
    seen.add(nextCursor);
    cursor = nextCursor;
  }
  throw new AssetStoreError(
    "asset_mcp_response_invalid",
    "MCP discovery exceeded the pagination safety limit.",
  );
}

function assertNoSecretReflection(value: unknown, bearerToken: string | null): void {
  if (!bearerToken) return;
  const variants = new Set([
    bearerToken,
    encodeURIComponent(bearerToken),
    Buffer.from(bearerToken).toString("base64"),
    Buffer.from(bearerToken).toString("base64url"),
  ]);
  const visit = (current: unknown): boolean => {
    if (typeof current === "string") {
      return [...variants].some((variant) => variant.length > 0 && current.includes(variant));
    }
    if (Array.isArray(current)) return current.some(visit);
    return isRecord(current) && Object.values(current).some(visit);
  };
  if (visit(value)) {
    throw new AssetStoreError(
      "asset_mcp_secret_reflection",
      "MCP discovery reflected credential material and was rejected.",
    );
  }
}

function requiredRpcName(value: Record<string, unknown>, kind: string): string {
  const name = optionalRpcName(value);
  if (!name) {
    throw new AssetStoreError("asset_mcp_response_invalid", `MCP ${kind} has no name.`);
  }
  return safeCapabilityName(name);
}

function optionalRpcName(value: Record<string, unknown>): string | null {
  const name = stringValue(value.name);
  return name ? safeCapabilityName(name) : null;
}

function requiredRpcUri(value: Record<string, unknown>): string {
  const uri = stringValue(value.uri);
  if (!uri) {
    throw new AssetStoreError("asset_mcp_response_invalid", "MCP resource has no URI.");
  }
  return safeCapabilityName(uri);
}

function safeCapabilityName(value: string): string {
  if (value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new AssetStoreError(
      "asset_mcp_response_invalid",
      "MCP capability identity is invalid.",
    );
  }
  return value;
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new AssetStoreError("asset_validation_response_invalid", `${label} is invalid.`);
  }
  return value;
}

function storedPackageValue(value: unknown): AssetStoredPackage | null {
  if (
    !isRecord(value)
    || typeof value.content_sha256 !== "string"
    || !/^[0-9a-f]{64}$/u.test(value.content_sha256)
    || !isRecord(value.source)
    || !["zip", "git", "mcp"].includes(String(value.source.type))
    || !Array.isArray(value.files)
    || !value.files.every((file) => (
      isRecord(file)
      && typeof file.path === "string"
      && (file.type === "file" || file.type === "directory")
      && (file.size_bytes === null || typeof file.size_bytes === "number")
      && (file.sha256 === null || typeof file.sha256 === "string")
    ))
  ) {
    return null;
  }
  for (const field of ["inferred_name", "inferred_slug", "inferred_version"] as const) {
    if (!(value[field] === null || typeof value[field] === "string")) return null;
  }
  return value as AssetStoredPackage;
}

function stagedCredentialValue(value: unknown): {
  reference:
    | { type: "draft"; draft_id: string }
    | { type: "version"; version_id: string };
  target_revision: number;
  expected_operation_id: string | null;
  endpoint_url: string;
  authentication: "none" | "bearer";
  bearer_token: string | null;
} | null {
  if (
    !isRecord(value)
    || !isRecord(value.reference)
    || !Number.isSafeInteger(value.target_revision)
    || Number(value.target_revision) <= 0
    || !(value.expected_operation_id === null || typeof value.expected_operation_id === "string")
    || typeof value.endpoint_url !== "string"
    || !["none", "bearer"].includes(String(value.authentication))
    || !(value.bearer_token === null || typeof value.bearer_token === "string")
  ) {
    return null;
  }
  const reference = value.reference;
  if (
    reference.type === "draft"
    && typeof reference.draft_id === "string"
  ) {
    return {
      reference: { type: "draft", draft_id: reference.draft_id },
      target_revision: Number(value.target_revision),
      expected_operation_id: value.expected_operation_id as string | null,
      endpoint_url: value.endpoint_url,
      authentication: value.authentication as "none" | "bearer",
      bearer_token: value.bearer_token,
    };
  }
  if (
    reference.type === "version"
    && typeof reference.version_id === "string"
  ) {
    return {
      reference: { type: "version", version_id: reference.version_id },
      target_revision: Number(value.target_revision),
      expected_operation_id: value.expected_operation_id as string | null,
      endpoint_url: value.endpoint_url,
      authentication: value.authentication as "none" | "bearer",
      bearer_token: value.bearer_token,
    };
  }
  return null;
}

function credentialTargetStateValue(value: unknown): {
  operation_id: string;
  target_revision: number;
  endpoint_url: string;
  authentication: "none" | "bearer";
  bearer_token: string | null;
} | null {
  if (
    !isRecord(value)
    || typeof value.operation_id !== "string"
    || value.operation_id.length === 0
    || !Number.isSafeInteger(value.target_revision)
    || Number(value.target_revision) <= 0
    || typeof value.endpoint_url !== "string"
    || !["none", "bearer"].includes(String(value.authentication))
    || !(value.bearer_token === null || typeof value.bearer_token === "string")
  ) {
    return null;
  }
  return {
    operation_id: value.operation_id,
    target_revision: Number(value.target_revision),
    endpoint_url: value.endpoint_url,
    authentication: value.authentication as "none" | "bearer",
    bearer_token: value.bearer_token,
  };
}

function isRuntimeAssetValidateResult(
  value: unknown,
): value is RuntimeAssetValidateResult {
  if (
    !isRecord(value)
    || !isRecord(value.validation)
    || !isCapabilitySnapshot(value.capabilities)
    || !isCapabilitySnapshot(value.validation.capabilities)
    || JSON.stringify(value.validation.capabilities) !== JSON.stringify(value.capabilities)
  ) {
    return false;
  }
  const validation = value.validation;
  return (
    ["pending", "valid", "invalid"].includes(String(validation.status))
    && (
      validation.validated_at_ms === null
      || Number.isSafeInteger(validation.validated_at_ms)
      && Number(validation.validated_at_ms) >= 0
    )
    && (
      validation.validator === null
      || typeof validation.validator === "string"
      && validation.validator.length >= 1
      && validation.validator.length <= 128
    )
    && Array.isArray(validation.issues)
    && validation.issues.length <= 2_000
    && validation.issues.every((issue) => (
      isRecord(issue)
      && typeof issue.code === "string"
      && issue.code.length >= 1
      && issue.code.length <= 128
      && (issue.severity === "error" || issue.severity === "warning")
      && (issue.path === null || typeof issue.path === "string" && issue.path.length <= 1_024)
      && typeof issue.message === "string"
      && issue.message.length >= 1
      && issue.message.length <= 2_000
    ))
  );
}

function isCapabilitySnapshot(value: unknown): boolean {
  const capabilityKinds = new Set([
    "skill",
    "mcp",
    "app",
    "hook",
    "task_template",
    "tool",
    "resource",
    "prompt",
  ]);
  return (
    isRecord(value)
    && typeof value.credential_configured === "boolean"
    && Array.isArray(value.entries)
    && value.entries.length <= 10_000
    && value.entries.every((entry) => (
      isRecord(entry)
      && capabilityKinds.has(String(entry.kind))
      && typeof entry.name === "string"
      && entry.name.length >= 1
      && entry.name.length <= 256
    ))
  );
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function safeTextContent(bytes: Buffer, inputPath: string): string | null {
  if (bytes.includes(0)) return null;
  const extension = posix.extname(inputPath).toLowerCase();
  if (![
    "", ".md", ".txt", ".json", ".jsonc", ".toml", ".yaml", ".yml", ".js", ".mjs",
    ".cjs", ".ts", ".tsx", ".jsx", ".css", ".html", ".xml", ".sh", ".py", ".rs", ".go",
  ].includes(extension)) return null;
  return bytes.subarray(0, CONTENT_PREVIEW_MAX_BYTES).toString("utf8");
}

function contentType(path: string, textual: boolean): string {
  if (!textual) return "application/octet-stream";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".md")) return "text/markdown";
  return "text/plain";
}

function skillName(contents: string): string {
  const frontmatter = /^---\s*\n([\s\S]*?)\n---/u.exec(contents)?.[1] ?? "";
  const frontmatterName = /^name:\s*(.+)$/imu.exec(frontmatter)?.[1]?.trim();
  const heading = /^#\s+(.+)$/mu.exec(contents)?.[1]?.trim();
  const name = frontmatterName || heading;
  if (!name) {
    throw new AssetStoreError("asset_skill_manifest_invalid", "SKILL.md must declare a name.");
  }
  return name.replace(/^["']|["']$/gu, "");
}

function slugify(value: string): string {
  const slug = value.toLowerCase().trim()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (!slug) {
    throw new AssetStoreError("asset_slug_invalid", "Asset name cannot produce a safe slug.");
  }
  return slug;
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function posixPath(value: string): string {
  return value.split(sep).join("/");
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function exists(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => null)) !== null;
}

function ignoreMissing(error: NodeJS.ErrnoException): void {
  if (error.code !== "ENOENT") throw error;
}
