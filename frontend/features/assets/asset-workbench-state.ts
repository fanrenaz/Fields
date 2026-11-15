export type AssetListItem = {
  asset_id: string;
};

export type AssetImportMode = "zip" | "git" | "mcp";

export const GITHUB_MCP_PRESET = {
  name: "GitHub",
  slug: "github",
  version: "1.0.0",
  endpointUrl: "https://api.githubcopilot.com/mcp/",
} as const;

export function githubFineGrainedPatUrl(): string {
  const url = new URL("https://github.com/settings/personal-access-tokens/new");
  url.search = new URLSearchParams({
    name: "Fields GitHub MCP",
    description: "Company GitHub access for Fields agents and API users",
    expires_in: "90",
    contents: "write",
    issues: "write",
    pull_requests: "write",
    metadata: "read",
  }).toString();
  return url.toString();
}

export function isOfficialGitHubMcpSource(source: {
  type: string;
  endpoint_url?: string;
  authentication?: string;
} | null | undefined): boolean {
  return source?.type === "mcp"
    && source.endpoint_url === GITHUB_MCP_PRESET.endpointUrl
    && source.authentication === "bearer";
}

export type AssetValidationIssueMessageKey =
  | "assets.validationIssues.discoveryLimit"
  | "assets.validationIssues.endpointInvalid"
  | "assets.validationIssues.endpointUnavailable"
  | "assets.validationIssues.generic"
  | "assets.validationIssues.mcpResponseInvalid"
  | "assets.validationIssues.pluginManifestInvalid"
  | "assets.validationIssues.pluginRejected"
  | "assets.validationIssues.secretReflection"
  | "assets.validationIssues.skillManifestInvalid"
  | "assets.validationIssues.skillRejected";

export function assetValidationIssueMessageKey(
  code: string,
): AssetValidationIssueMessageKey {
  switch (code) {
    case "asset_plugin_manifest_invalid":
      return "assets.validationIssues.pluginManifestInvalid";
    case "asset_plugin_codex_validation_failed":
      return "assets.validationIssues.pluginRejected";
    case "asset_skill_manifest_invalid":
      return "assets.validationIssues.skillManifestInvalid";
    case "asset_skill_codex_validation_failed":
      return "assets.validationIssues.skillRejected";
    case "asset_mcp_source_invalid":
    case "asset_public_https_required":
    case "asset_private_network_forbidden":
      return "assets.validationIssues.endpointInvalid";
    case "asset_mcp_request_failed":
    case "asset_mcp_redirect_forbidden":
    case "asset_mcp_timeout":
    case "asset_mcp_unavailable":
      return "assets.validationIssues.endpointUnavailable";
    case "asset_mcp_discovery_limit":
    case "asset_mcp_response_too_large":
      return "assets.validationIssues.discoveryLimit";
    case "asset_mcp_secret_reflection":
      return "assets.validationIssues.secretReflection";
    case "asset_mcp_response_invalid":
      return "assets.validationIssues.mcpResponseInvalid";
    case "asset_validation_response_invalid":
      return "assets.validationIssues.generic";
    default:
      return "assets.validationIssues.generic";
  }
}

export type AssetMutationAttempt = {
  fingerprint: string;
  idempotencyKey: string;
};

export function assetMutationFingerprint(
  operation: string,
  semantics: Record<string, unknown>,
): string {
  return `${operation}:${stableMutationValue(semantics)}`;
}

export function reuseOrCreateAssetMutationAttempt(
  current: AssetMutationAttempt | null,
  fingerprint: string,
  createIdempotencyKey: () => string,
): AssetMutationAttempt {
  if (current?.fingerprint === fingerprint) return current;
  return {
    fingerprint,
    idempotencyKey: createIdempotencyKey(),
  };
}

export function allowedAssetImportModes(
  presetKind: "plugin" | "skill" | "mcp" | null,
): AssetImportMode[] {
  if (presetKind === "mcp") return ["mcp"];
  if (presetKind === "plugin" || presetKind === "skill") return ["zip", "git"];
  return ["zip", "git", "mcp"];
}

export function assetLifecycleIsReadOnly(
  lifecycle: "draft" | "published" | "archived",
): boolean {
  return lifecycle === "archived";
}

export function draftDeletionRemovesAsset({
  hasCurrentVersion,
  draftCount,
}: {
  hasCurrentVersion: boolean;
  draftCount: number;
}): boolean {
  return !hasCurrentVersion && draftCount === 1;
}

export function appendUniqueAssetItems<T extends AssetListItem>(
  current: readonly T[],
  incoming: readonly T[],
): T[] {
  const knownIds = new Set(current.map((item) => item.asset_id));
  return [
    ...current,
    ...incoming.filter((item) => {
      if (knownIds.has(item.asset_id)) return false;
      knownIds.add(item.asset_id);
      return true;
    }),
  ];
}

export function reconcileAssetSelection<T extends AssetListItem>({
  currentId,
  initialTargetId,
  initialTargetScopeActive,
  items,
}: {
  currentId: string | null;
  initialTargetId: string | null;
  initialTargetScopeActive: boolean;
  items: readonly T[];
}): string | null {
  if (currentId && items.some((item) => item.asset_id === currentId)) return currentId;
  if (
    currentId
    && currentId === initialTargetId
    && initialTargetScopeActive
  ) {
    return currentId;
  }
  return items[0]?.asset_id ?? null;
}

export type DraftListItem = {
  draft_id: string;
};

export function resolveDraftSelection<T extends DraftListItem>(
  drafts: readonly T[],
  selectedDraftId: string | null,
): T | null {
  return drafts.find((draft) => draft.draft_id === selectedDraftId)
    ?? drafts[0]
    ?? null;
}

export type VersionListItem = {
  version_id: string;
};

export function resolveVersionSelection<T extends VersionListItem>(
  versions: readonly T[],
  currentVersionId: string | null,
  selectedVersionId: string | null,
): T | null {
  return versions.find((version) => version.version_id === selectedVersionId)
    ?? versions.find((version) => version.version_id === currentVersionId)
    ?? versions[0]
    ?? null;
}

export type ZipAttemptFingerprintInput = {
  kind: "plugin" | "skill";
  name: string;
  slug: string;
  version: string | null;
  description: string;
  file: {
    name: string;
    size: number;
    lastModified: number;
  };
};

export function zipAttemptFingerprint(input: ZipAttemptFingerprintInput): string {
  return JSON.stringify(input);
}

export type ZipUploadAttempt<TDraft> = {
  fingerprint: string;
  beginIdempotencyKey: string;
  uploadIdempotencyKey: string;
  begunDraft: TDraft | null;
};

export function reuseOrCreateZipUploadAttempt<TDraft>(
  current: ZipUploadAttempt<TDraft> | null,
  fingerprint: string,
  createIdempotencyKey: () => string,
): ZipUploadAttempt<TDraft> {
  if (current?.fingerprint === fingerprint) return current;
  return {
    fingerprint,
    beginIdempotencyKey: createIdempotencyKey(),
    uploadIdempotencyKey: createIdempotencyKey(),
    begunDraft: null,
  };
}

export type AssetPreviewState<TContent> =
  | { status: "idle"; requestId: number }
  | { status: "loading"; requestId: number; path: string }
  | { status: "ready"; requestId: number; content: TContent }
  | { status: "error"; requestId: number; path: string };

export function beginAssetPreview<TContent>(
  requestId: number,
  path: string,
): AssetPreviewState<TContent> {
  return { status: "loading", requestId, path };
}

export function settleAssetPreview<TContent>(
  current: AssetPreviewState<TContent>,
  requestId: number,
  result: { ok: true; content: TContent } | { ok: false; path: string },
): AssetPreviewState<TContent> {
  if (current.requestId !== requestId) return current;
  return result.ok
    ? { status: "ready", requestId, content: result.content }
    : { status: "error", requestId, path: result.path };
}

export function formatAssetBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
}

function stableMutationValue(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "undefined";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableMutationValue).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableMutationValue(entry)}`)
    .join(",")}}`;
}
