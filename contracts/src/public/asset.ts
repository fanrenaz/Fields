import { z } from "zod";

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const ASSET_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const assetGitRepositoryUrlSchema = z.string().max(2_048).url()
  .startsWith("https://")
  .refine((value) => {
    const url = new URL(value);
    return (
      !url.username
      && !url.password
      && Boolean(url.hostname)
      && !url.search
      && !url.hash
    );
  }, "Git repository URLs must use public HTTPS without credentials, query parameters, or fragments.");
const mcpEndpointSchema = z.string().max(2_048).url().startsWith("https://").refine((value) => {
  const url = new URL(value);
  return !url.username && !url.password && !url.search && !url.hash;
}, "MCP endpoints cannot contain credentials, query parameters, or fragments.");

export const assetNameSchema = z.string().trim().min(1).max(255);

export const assetSlugSchema = z.string().max(255).regex(ASSET_SLUG_PATTERN);

export const assetKindSchema = z.enum(["plugin", "skill", "mcp"]);
export type AssetKind = z.infer<typeof assetKindSchema>;

export const assetLifecycleSchema = z.enum(["draft", "published", "archived"]);
export type AssetLifecycle = z.infer<typeof assetLifecycleSchema>;

export const assetVersionSchema = z.string().trim().max(128).regex(
  SEMVER_PATTERN,
  "Asset version must be a valid MAJOR.MINOR.PATCH SemVer.",
).refine(
  (value) => value.split(".").every((part) => Number.isSafeInteger(Number(part))),
  "Asset version components must be safe integers.",
);

export const assetValidationStatusSchema = z.enum([
  "pending",
  "valid",
  "invalid",
]);
export type AssetValidationStatus = z.infer<typeof assetValidationStatusSchema>;

export const assetValidationIssueSchema = z.strictObject({
  code: z.string().min(1).max(128),
  severity: z.enum(["error", "warning"]),
  path: z.string().max(1_024).nullable(),
  message: z.string().min(1).max(2_000),
});
export type AssetValidationIssue = z.infer<typeof assetValidationIssueSchema>;

export const assetCapabilityEntrySchema = z.strictObject({
  kind: z.enum([
    "skill",
    "mcp",
    "app",
    "hook",
    "task_template",
    "tool",
    "resource",
    "prompt",
  ]),
  name: z.string().min(1).max(256),
});
export type AssetCapabilityEntry = z.infer<typeof assetCapabilityEntrySchema>;

export const assetCapabilitySnapshotSchema = z.strictObject({
  entries: z.array(assetCapabilityEntrySchema).max(10_000),
  credential_configured: z.boolean(),
});
export type AssetCapabilitySnapshot = z.infer<typeof assetCapabilitySnapshotSchema>;

export const assetValidationSnapshotSchema = z.strictObject({
  status: assetValidationStatusSchema,
  validated_at_ms: z.number().int().nonnegative().nullable(),
  validator: z.string().min(1).max(128).nullable(),
  issues: z.array(assetValidationIssueSchema).max(2_000),
  capabilities: assetCapabilitySnapshotSchema,
});
export type AssetValidationSnapshot = z.infer<typeof assetValidationSnapshotSchema>;

export const assetSourceSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("zip"),
    file_name: z.string().min(1).max(512),
  }),
  z.strictObject({
    type: z.literal("git"),
    repository_url: assetGitRepositoryUrlSchema,
    commit_sha: z.string().regex(/^[0-9a-f]{40}$/u),
    subdirectory: z.string().max(1_024).nullable(),
  }),
  z.strictObject({
    type: z.literal("mcp"),
    endpoint_url: mcpEndpointSchema,
    authentication: z.enum(["none", "bearer"]),
    credential_configured: z.boolean(),
  }),
]);
export type AssetSource = z.infer<typeof assetSourceSchema>;

export const assetFileEntrySchema = z.strictObject({
  path: z.string().min(1).max(2_048),
  type: z.enum(["file", "directory"]),
  size_bytes: z.number().int().nonnegative().nullable(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u).nullable(),
});
export type AssetFileEntry = z.infer<typeof assetFileEntrySchema>;

export const assetContentSchema = z.strictObject({
  path: z.string().min(1).max(2_048),
  mime_type: z.string().min(1).max(256),
  size_bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  text: z.string().max(512_000).nullable(),
  preview_truncated: z.boolean(),
});
export type AssetContent = z.infer<typeof assetContentSchema>;

export const assetVersionRecordSchema = z.strictObject({
  version_id: z.string().min(1),
  revision: z.number().int().positive(),
  version: assetVersionSchema,
  source: assetSourceSchema,
  content_sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  files: z.array(assetFileEntrySchema).max(10_000),
  validation: assetValidationSnapshotSchema,
  published_by_actor_id: z.string().min(1),
  published_at_ms: z.number().int().nonnegative(),
});
export type AssetVersionRecord = z.infer<typeof assetVersionRecordSchema>;

export const assetDraftSchema = z.strictObject({
  draft_id: z.string().min(1),
  asset_id: z.string().min(1),
  kind: assetKindSchema,
  name: assetNameSchema,
  slug: assetSlugSchema,
  description: z.string().max(4_000),
  version: assetVersionSchema.nullable(),
  revision: z.number().int().positive(),
  source: assetSourceSchema.nullable(),
  content_sha256: z.string().regex(/^[0-9a-f]{64}$/u).nullable(),
  files: z.array(assetFileEntrySchema).max(10_000),
  validation: assetValidationSnapshotSchema,
  created_by_actor_id: z.string().min(1),
  updated_by_actor_id: z.string().min(1),
  created_at_ms: z.number().int().nonnegative(),
  updated_at_ms: z.number().int().nonnegative(),
});
export type AssetDraft = z.infer<typeof assetDraftSchema>;

export const assetSummarySchema = z.strictObject({
  asset_id: z.string().min(1),
  kind: assetKindSchema,
  name: assetNameSchema,
  slug: assetSlugSchema,
  description: z.string().max(4_000),
  lifecycle: assetLifecycleSchema,
  revision: z.number().int().positive(),
  current_version: assetVersionSchema.nullable(),
  draft_count: z.number().int().nonnegative(),
  validation_status: assetValidationStatusSchema,
  updated_at_ms: z.number().int().nonnegative(),
});
export type AssetSummary = z.infer<typeof assetSummarySchema>;

export const assetDetailSchema = z.strictObject({
  summary: assetSummarySchema,
  current: assetVersionRecordSchema.nullable(),
  drafts: z.array(assetDraftSchema),
  versions: z.array(assetVersionRecordSchema),
  files: z.array(assetFileEntrySchema).max(10_000),
});
export type AssetDetail = z.infer<typeof assetDetailSchema>;

export const assetListInputSchema = z.strictObject({
  kind: assetKindSchema.optional(),
  lifecycle: assetLifecycleSchema.optional(),
  search_term: z.string().trim().max(200).optional(),
  cursor: z.string().min(1).nullable().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
export type AssetListInput = z.infer<typeof assetListInputSchema>;

export const assetListResultSchema = z.strictObject({
  items: z.array(assetSummarySchema),
  page: z.strictObject({ next_cursor: z.string().min(1).nullable() }),
});
export type AssetListResult = z.infer<typeof assetListResultSchema>;

export const assetReadInputSchema = z.strictObject({
  asset_id: z.string().min(1),
});
export type AssetReadInput = z.infer<typeof assetReadInputSchema>;

export const assetContentReadInputSchema = z.strictObject({
  asset_id: z.string().min(1),
  draft_id: z.string().min(1).optional(),
  version: assetVersionSchema.optional(),
  path: z.string().min(1).max(2_048),
}).refine(
  (input) => Number(input.draft_id !== undefined) + Number(input.version !== undefined) === 1,
  { message: "Exactly one of draft_id or version is required." },
);
export type AssetContentReadInput = z.infer<typeof assetContentReadInputSchema>;

export const assetDraftBeginZipInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("plugin"),
    name: assetNameSchema,
    slug: assetSlugSchema,
    version: z.null().optional(),
    description: z.string().max(4_000).optional(),
    file_name: z.string().min(1).max(512),
    idempotency_key: z.string().min(1).max(200),
  }),
  z.strictObject({
    kind: z.literal("skill"),
    name: assetNameSchema,
    slug: assetSlugSchema,
    version: assetVersionSchema,
    description: z.string().max(4_000).optional(),
    file_name: z.string().min(1).max(512),
    idempotency_key: z.string().min(1).max(200),
  }),
]);
export type AssetDraftBeginZipInput = z.infer<typeof assetDraftBeginZipInputSchema>;

export const assetDraftImportGitInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("plugin"),
    repository_url: assetGitRepositoryUrlSchema,
    subdirectory: z.string().max(1_024).nullable().optional(),
    name: assetNameSchema.optional(),
    slug: assetSlugSchema.optional(),
    version: z.null().optional(),
    description: z.string().max(4_000).optional(),
    idempotency_key: z.string().min(1).max(200),
  }),
  z.strictObject({
    kind: z.literal("skill"),
    repository_url: assetGitRepositoryUrlSchema,
    subdirectory: z.string().max(1_024).nullable().optional(),
    name: assetNameSchema.optional(),
    slug: assetSlugSchema.optional(),
    version: assetVersionSchema,
    description: z.string().max(4_000).optional(),
    idempotency_key: z.string().min(1).max(200),
  }),
]);
export type AssetDraftImportGitInput = z.infer<typeof assetDraftImportGitInputSchema>;

export const assetDraftCreateMcpInputSchema = z.strictObject({
  name: assetNameSchema,
  slug: assetSlugSchema,
  version: assetVersionSchema,
  description: z.string().max(4_000).optional(),
  endpoint_url: mcpEndpointSchema,
  authentication: z.enum(["none", "bearer"]),
  bearer_token: z.string().min(1).max(16_384).optional(),
  idempotency_key: z.string().min(1).max(200),
}).superRefine((input, context) => {
  if (input.authentication === "bearer" && !input.bearer_token) {
    context.addIssue({
      code: "custom",
      path: ["bearer_token"],
      message: "Bearer authentication requires a token.",
    });
  }
  if (input.authentication === "none" && input.bearer_token !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["bearer_token"],
      message: "A token is not accepted when authentication is none.",
    });
  }
});
export type AssetDraftCreateMcpInput = z.infer<typeof assetDraftCreateMcpInputSchema>;

export const assetDraftUpdateInputSchema = z.strictObject({
  draft_id: z.string().min(1),
  expected_revision: z.number().int().positive(),
  name: assetNameSchema.optional(),
  slug: assetSlugSchema.optional(),
  description: z.string().max(4_000).optional(),
  version: assetVersionSchema.optional(),
  endpoint_url: mcpEndpointSchema.optional(),
  authentication: z.enum(["none", "bearer"]).optional(),
  idempotency_key: z.string().min(1).max(200),
}).refine((input) => (
  input.name !== undefined
  || input.slug !== undefined
  || input.description !== undefined
  || input.version !== undefined
  || input.endpoint_url !== undefined
  || input.authentication !== undefined
), { message: "At least one draft field must be updated." });
export type AssetDraftUpdateInput = z.infer<typeof assetDraftUpdateInputSchema>;

export const assetDraftRevisionInputSchema = z.strictObject({
  draft_id: z.string().min(1),
  expected_revision: z.number().int().positive(),
  idempotency_key: z.string().min(1).max(200),
});
export type AssetDraftRevisionInput = z.infer<typeof assetDraftRevisionInputSchema>;

export const assetDraftMutationResultSchema = z.strictObject({
  draft: assetDraftSchema,
});
export type AssetDraftMutationResult = z.infer<typeof assetDraftMutationResultSchema>;

export const assetDraftDeleteResultSchema = z.strictObject({
  deleted: z.literal(true),
  draft_id: z.string().min(1),
});
export type AssetDraftDeleteResult = z.infer<typeof assetDraftDeleteResultSchema>;

export const assetPublishResultSchema = z.strictObject({
  asset: assetDetailSchema,
  published_version: assetVersionRecordSchema,
});
export type AssetPublishResult = z.infer<typeof assetPublishResultSchema>;

export const assetArchiveInputSchema = z.strictObject({
  asset_id: z.string().min(1),
  expected_revision: z.number().int().positive(),
  idempotency_key: z.string().min(1).max(200),
});
export type AssetArchiveInput = z.infer<typeof assetArchiveInputSchema>;

export const assetMutationResultSchema = z.strictObject({
  asset: assetDetailSchema,
});
export type AssetMutationResult = z.infer<typeof assetMutationResultSchema>;

export const assetMcpCredentialReplaceInputSchema = z.strictObject({
  asset_id: z.string().min(1),
  target: z.discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("draft"),
      draft_id: z.string().min(1),
      expected_revision: z.number().int().positive(),
    }),
    z.strictObject({
      type: z.literal("version"),
      version_id: z.string().min(1),
      expected_revision: z.number().int().positive(),
    }),
  ]),
  bearer_token: z.string().min(1).max(16_384).nullable(),
  idempotency_key: z.string().min(1).max(200),
});
export type AssetMcpCredentialReplaceInput = z.infer<typeof assetMcpCredentialReplaceInputSchema>;

const assetMcpJsonObjectSchema = z.record(z.string(), z.json());

export const assetMcpToolAnnotationsSchema = z.strictObject({
  title: z.string().max(256).optional(),
  read_only_hint: z.boolean().optional(),
  destructive_hint: z.boolean().optional(),
  idempotent_hint: z.boolean().optional(),
  open_world_hint: z.boolean().optional(),
});
export type AssetMcpToolAnnotations = z.infer<typeof assetMcpToolAnnotationsSchema>;

export const assetMcpToolDescriptorSchema = z.strictObject({
  name: z.string().min(1).max(256),
  title: z.string().max(256).nullable(),
  description: z.string().max(8_000).nullable(),
  input_schema: assetMcpJsonObjectSchema,
  annotations: assetMcpToolAnnotationsSchema.nullable(),
});
export type AssetMcpToolDescriptor = z.infer<typeof assetMcpToolDescriptorSchema>;

export const assetMcpToolsListInputSchema = z.strictObject({
  asset_id: z.string().min(1),
});
export type AssetMcpToolsListInput = z.infer<typeof assetMcpToolsListInputSchema>;

export const assetMcpToolsListResultSchema = z.strictObject({
  asset_id: z.string().min(1),
  version_id: z.string().min(1),
  tools: z.array(assetMcpToolDescriptorSchema).max(10_000),
});
export type AssetMcpToolsListResult = z.infer<typeof assetMcpToolsListResultSchema>;

export const assetMcpToolCallInputSchema = z.strictObject({
  asset_id: z.string().min(1),
  expected_version_id: z.string().min(1),
  tool_name: z.string().min(1).max(256),
  arguments: assetMcpJsonObjectSchema,
});
export type AssetMcpToolCallInput = z.infer<typeof assetMcpToolCallInputSchema>;

export const assetMcpToolCallResultSchema = z.strictObject({
  asset_id: z.string().min(1),
  version_id: z.string().min(1),
  tool_name: z.string().min(1).max(256),
  is_error: z.boolean(),
  text: z.array(z.string().max(2 * 1024 * 1024)).max(256),
  structured_content: z.json().nullable(),
});
export type AssetMcpToolCallResult = z.infer<typeof assetMcpToolCallResultSchema>;

export const assetPackageUploadResultSchema = z.strictObject({
  draft: assetDraftSchema,
});
export type AssetPackageUploadResult = z.infer<typeof assetPackageUploadResultSchema>;

export const memberAssetOperationStatusSchema = z.enum([
  "pending",
  "applying",
  "applied",
  "failed",
]);
export type MemberAssetOperationStatus = z.infer<typeof memberAssetOperationStatusSchema>;

export const memberAssetHealthSchema = z.enum(["ready", "degraded"]);
export type MemberAssetHealth = z.infer<typeof memberAssetHealthSchema>;

export const memberAssetInstallationBaseSchema = z.strictObject({
  asset_id: z.string().min(1),
  version_id: z.string().min(1),
  kind: assetKindSchema,
  name: assetNameSchema,
  slug: assetSlugSchema,
  version: assetVersionSchema,
  health: memberAssetHealthSchema,
  issue_code: z.string().min(1).max(128).nullable(),
});

export const memberAssetInstallationSchema = memberAssetInstallationBaseSchema.refine(
  (installation) => (
    (installation.health === "ready" && installation.issue_code === null)
    || (installation.health === "degraded" && installation.issue_code !== null)
  ),
  { message: "Asset health and issue code must agree." },
);
export type MemberAssetInstallation = z.infer<typeof memberAssetInstallationSchema>;

export const memberAssetOperationSchema = z.strictObject({
  operation_id: z.string().min(1),
  status: memberAssetOperationStatusSchema,
  requested_revision: z.number().int().positive(),
  error_code: z.string().min(1).max(128).nullable(),
  retryable: z.boolean().nullable(),
  created_at_ms: z.number().int().nonnegative(),
  updated_at_ms: z.number().int().nonnegative(),
  completed_at_ms: z.number().int().nonnegative().nullable(),
}).refine(
  (operation) => (
    (
      (operation.status === "pending" || operation.status === "applying")
      && operation.error_code === null
      && operation.retryable === null
      && operation.completed_at_ms === null
    )
    || (
      operation.status === "applied"
      && operation.error_code === null
      && operation.retryable === null
      && operation.completed_at_ms !== null
    )
    || (
      operation.status === "failed"
      && operation.error_code !== null
      && operation.retryable !== null
      && operation.completed_at_ms !== null
    )
  ),
  { message: "Asset operation status and result fields must agree." },
);
export type MemberAssetOperation = z.infer<typeof memberAssetOperationSchema>;

export const memberAssetProfileSchema = z.strictObject({
  member_id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  installations: z.array(memberAssetInstallationSchema).max(256),
  operation: memberAssetOperationSchema.nullable(),
});
export type MemberAssetProfile = z.infer<typeof memberAssetProfileSchema>;

export const memberAssetTargetSchema = z.strictObject({
  asset_id: z.string().min(1),
  version_id: z.string().min(1),
});
export type MemberAssetTarget = z.infer<typeof memberAssetTargetSchema>;

export const memberAssetCurrentInputSchema = z.strictObject({
  member_id: z.string().min(1),
});
export type MemberAssetCurrentInput = z.infer<typeof memberAssetCurrentInputSchema>;

export const memberAssetOptionsInputSchema = z.strictObject({
  member_id: z.string().min(1),
  kind: assetKindSchema.optional(),
  search_term: z.string().trim().max(200).optional(),
});
export type MemberAssetOptionsInput = z.infer<typeof memberAssetOptionsInputSchema>;

export const memberAssetOptionSchema = memberAssetInstallationBaseSchema.omit({
  health: true,
  issue_code: true,
});
export type MemberAssetOption = z.infer<typeof memberAssetOptionSchema>;

export const memberAssetOptionsResultSchema = z.strictObject({
  member_id: z.string().min(1),
  items: z.array(memberAssetOptionSchema).max(1_000),
});
export type MemberAssetOptionsResult = z.infer<typeof memberAssetOptionsResultSchema>;

const memberAssetApplyBaseSchema = z.strictObject({
  member_id: z.string().min(1),
  expected_revision: z.number().int().nonnegative(),
  installations: z.array(memberAssetTargetSchema).max(256),
  idempotency_key: z.string().min(1).max(200),
});

function validateMemberAssetTargets(
  input: { installations: MemberAssetTarget[] },
  context: z.RefinementCtx,
): void {
  const assetIds = new Set<string>();
  const versionIds = new Set<string>();
  for (const [index, installation] of input.installations.entries()) {
    if (assetIds.has(installation.asset_id)) {
      context.addIssue({
        code: "custom",
        path: ["installations", index, "asset_id"],
        message: "An asset can have only one installed version.",
      });
    }
    if (versionIds.has(installation.version_id)) {
      context.addIssue({
        code: "custom",
        path: ["installations", index, "version_id"],
        message: "An asset version can be installed only once.",
      });
    }
    assetIds.add(installation.asset_id);
    versionIds.add(installation.version_id);
  }
}

export const memberAssetApplyInputSchema = memberAssetApplyBaseSchema.superRefine(
  validateMemberAssetTargets,
);
export type MemberAssetApplyInput = z.infer<typeof memberAssetApplyInputSchema>;

export const memberAssetOperationInputSchema = z.strictObject({
  member_id: z.string().min(1),
  operation_id: z.string().min(1),
});
export type MemberAssetOperationInput = z.infer<typeof memberAssetOperationInputSchema>;

export const selfMemberAssetApplyInputSchema = memberAssetApplyBaseSchema
  .omit({ member_id: true })
  .superRefine(validateMemberAssetTargets);
export type SelfMemberAssetApplyInput = z.infer<typeof selfMemberAssetApplyInputSchema>;
