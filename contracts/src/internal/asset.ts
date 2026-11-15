import { z } from "zod";

import {
  assetCapabilitySnapshotSchema,
  assetContentSchema,
  assetDraftBeginZipInputSchema,
  assetDraftCreateMcpInputSchema,
  assetDraftDeleteResultSchema,
  assetDraftImportGitInputSchema,
  assetDraftMutationResultSchema,
  assetDraftRevisionInputSchema,
  assetDraftUpdateInputSchema,
  assetFileEntrySchema,
  assetGitRepositoryUrlSchema,
  assetKindSchema,
  assetListInputSchema,
  assetListResultSchema,
  assetNameSchema,
  assetMcpCredentialReplaceInputSchema,
  assetMcpToolCallResultSchema,
  assetMcpToolDescriptorSchema,
  assetMutationResultSchema,
  assetPublishResultSchema,
  assetReadInputSchema,
  assetSlugSchema,
  assetDetailSchema,
  assetSourceSchema,
  assetValidationSnapshotSchema,
  assetVersionSchema,
  memberAssetInstallationBaseSchema,
  memberAssetInstallationSchema,
  memberAssetOperationSchema,
  memberAssetOptionsInputSchema,
  memberAssetOptionsResultSchema,
  memberAssetProfileSchema,
  selfMemberAssetApplyInputSchema,
} from "../public/asset.js";
import { companyRuntimeIdentitySchema } from "./company-runtime.js";

const runtimeMcpEndpointSchema = z.string().max(2_048).url().startsWith("https://").refine((value) => {
  const url = new URL(value);
  return !url.username && !url.password && !url.search && !url.hash;
}, "MCP endpoints cannot contain credentials, query parameters, or fragments.");

export const assetStoredPackageSchema = z.strictObject({
  content_sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  source: assetSourceSchema,
  inferred_name: assetNameSchema.nullable(),
  inferred_slug: assetSlugSchema.nullable(),
  inferred_version: assetVersionSchema.nullable(),
  files: z.array(assetFileEntrySchema).max(10_000),
});
export type AssetStoredPackage = z.infer<typeof assetStoredPackageSchema>;

export const runtimeAssetZipPackageInputSchema = z.strictObject({
  operation_id: z.string().min(1).max(200),
  request_fingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
  draft_id: z.string().min(1),
  expected_content_sha256: z.string().regex(/^[0-9a-f]{64}$/u).nullable(),
  kind: z.enum(["plugin", "skill"]),
  file_name: z.string().min(1).max(512),
  package_sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  package_size_bytes: z.number().int().min(1).max(25 * 1024 * 1024),
});
export type RuntimeAssetZipPackageInput = z.infer<typeof runtimeAssetZipPackageInputSchema>;

export const runtimeAssetGitImportInputSchema = z.strictObject({
  operation_id: z.string().min(1).max(200),
  request_fingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
  draft_id: z.string().min(1),
  expected_content_sha256: z.string().regex(/^[0-9a-f]{64}$/u).nullable(),
  kind: z.enum(["plugin", "skill"]),
  repository_url: assetGitRepositoryUrlSchema,
  subdirectory: z.string().max(1_024).nullable(),
});
export type RuntimeAssetGitImportInput = z.infer<typeof runtimeAssetGitImportInputSchema>;

export const runtimeAssetWorkspaceZipInputSchema = z.strictObject({
  operation_id: z.string().min(1).max(200),
  request_fingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
  draft_id: z.string().min(1),
  expected_content_sha256: z.string().regex(/^[0-9a-f]{64}$/u).nullable(),
  kind: z.enum(["plugin", "skill"]),
  member_id: z.string().min(1),
  thread_id: z.string().min(1),
  workspace_relative_path: z.string().min(1).max(2_048),
});
export type RuntimeAssetWorkspaceZipInput = z.infer<typeof runtimeAssetWorkspaceZipInputSchema>;

export const runtimeAssetMcpStoreInputSchema = z.strictObject({
  operation_id: z.string().min(1).max(200),
  request_fingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
  draft_id: z.string().min(1),
  expected_content_sha256: z.string().regex(/^[0-9a-f]{64}$/u).nullable(),
  endpoint_url: runtimeMcpEndpointSchema,
  authentication: z.enum(["none", "bearer"]),
  bearer_token: z.string().min(1).max(16_384).nullable().optional(),
});
export type RuntimeAssetMcpStoreInput = z.infer<typeof runtimeAssetMcpStoreInputSchema>;

export const runtimeAssetValidateInputSchema = z.strictObject({
  operation_id: z.string().min(1).max(200),
  request_fingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
  draft_id: z.string().min(1),
  asset_id: z.string().min(1),
  kind: assetKindSchema,
  content_sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  source: assetSourceSchema,
});
export type RuntimeAssetValidateInput = z.infer<typeof runtimeAssetValidateInputSchema>;

export const runtimeAssetValidateResultSchema = z.strictObject({
  validation: assetValidationSnapshotSchema,
  capabilities: assetCapabilitySnapshotSchema,
});
export type RuntimeAssetValidateResult = z.infer<typeof runtimeAssetValidateResultSchema>;

export const runtimeAssetReferenceInputSchema = z.strictObject({
  draft_id: z.string().min(1),
});
export type RuntimeAssetReferenceInput = z.infer<typeof runtimeAssetReferenceInputSchema>;

export const runtimeAssetPublishReferenceInputSchema = z.strictObject({
  draft_id: z.string().min(1),
  version_id: z.string().min(1),
  expected_content_sha256: z.string().regex(/^[0-9a-f]{64}$/u),
});
export type RuntimeAssetPublishReferenceInput = z.infer<typeof runtimeAssetPublishReferenceInputSchema>;

export const runtimeAssetContentReadInputSchema = z.strictObject({
  content_sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  path: z.string().min(1).max(2_048),
});
export type RuntimeAssetContentReadInput = z.infer<typeof runtimeAssetContentReadInputSchema>;

export const runtimeAssetDraftReferenceCasInputSchema = z.strictObject({
  draft_id: z.string().min(1),
  expected_content_sha256: z.string().regex(/^[0-9a-f]{64}$/u).nullable(),
  next_content_sha256: z.string().regex(/^[0-9a-f]{64}$/u).nullable(),
});
export type RuntimeAssetDraftReferenceCasInput = z.infer<
  typeof runtimeAssetDraftReferenceCasInputSchema
>;

export const runtimeAssetVersionReferenceInputSchema = z.strictObject({
  version_id: z.string().min(1),
});
export type RuntimeAssetVersionReferenceInput = z.infer<
  typeof runtimeAssetVersionReferenceInputSchema
>;

export const runtimeAssetCredentialReferenceSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("draft"), draft_id: z.string().min(1) }),
  z.strictObject({ type: z.literal("version"), version_id: z.string().min(1) }),
]);

export const runtimeAssetCredentialReplaceInputSchema = z.strictObject({
  operation_id: z.string().min(1).max(200),
  request_fingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
  target_revision: z.number().int().positive(),
  expected_operation_id: z.string().min(1).max(128).nullable(),
  reference: runtimeAssetCredentialReferenceSchema,
  endpoint_url: runtimeMcpEndpointSchema,
  authentication: z.enum(["none", "bearer"]),
  bearer_token: z.string().min(1).max(16_384).nullable(),
}).superRefine((input, context) => {
  if (input.authentication === "none" && input.bearer_token !== null) {
    context.addIssue({
      code: "custom",
      path: ["bearer_token"],
      message: "Authentication none cannot carry a credential.",
    });
  }
});
export type RuntimeAssetCredentialReplaceInput = z.infer<typeof runtimeAssetCredentialReplaceInputSchema>;

export const runtimeAssetCredentialOperationInputSchema = z.strictObject({
  operation_id: z.string().min(1).max(200),
  request_fingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
});
export type RuntimeAssetCredentialOperationInput = z.infer<
  typeof runtimeAssetCredentialOperationInputSchema
>;

export const runtimeAssetMcpToolsListInputSchema = z.strictObject({
  version_id: z.string().min(1),
  actor_id: z.string().min(1).max(128),
});
export type RuntimeAssetMcpToolsListInput = z.infer<typeof runtimeAssetMcpToolsListInputSchema>;

export const runtimeAssetMcpToolsListResultSchema = z.strictObject({
  tools: z.array(assetMcpToolDescriptorSchema).max(10_000),
});
export type RuntimeAssetMcpToolsListResult = z.infer<typeof runtimeAssetMcpToolsListResultSchema>;

export const runtimeAssetMcpToolCallInputSchema = z.strictObject({
  version_id: z.string().min(1),
  actor_id: z.string().min(1).max(128),
  tool_name: z.string().min(1).max(256),
  arguments: z.record(z.string(), z.json()),
});
export type RuntimeAssetMcpToolCallInput = z.infer<typeof runtimeAssetMcpToolCallInputSchema>;

export const runtimeAssetMcpToolCallResultSchema = assetMcpToolCallResultSchema.omit({
  asset_id: true,
  version_id: true,
});
export type RuntimeAssetMcpToolCallResult = z.infer<typeof runtimeAssetMcpToolCallResultSchema>;

export const runtimeAssetMutationAckSchema = z.strictObject({ ok: z.literal(true) });
export type RuntimeAssetMutationAck = z.infer<typeof runtimeAssetMutationAckSchema>;

export const runtimeMemberAssetInstallationSchema = memberAssetInstallationBaseSchema.omit({
  health: true,
  issue_code: true,
}).extend({
  content_sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  source: assetSourceSchema,
  capabilities: assetCapabilitySnapshotSchema,
});
export type RuntimeMemberAssetInstallation = z.infer<
  typeof runtimeMemberAssetInstallationSchema
>;

export const runtimeMemberAssetApplyInputSchema = z.strictObject({
  member_id: z.string().min(1),
  operation_id: z.string().min(1),
  requested_revision: z.number().int().positive(),
  installations: z.array(runtimeMemberAssetInstallationSchema).max(256),
});
export type RuntimeMemberAssetApplyInput = z.infer<typeof runtimeMemberAssetApplyInputSchema>;

export const runtimeMemberAssetApplyResultSchema = z.strictObject({
  accepted: z.literal(true),
  operation: memberAssetOperationSchema,
});
export type RuntimeMemberAssetApplyResult = z.infer<typeof runtimeMemberAssetApplyResultSchema>;

export const runtimeMemberAssetProfileInputSchema = z.strictObject({
  member_id: z.string().min(1),
});
export type RuntimeMemberAssetProfileInput = z.infer<typeof runtimeMemberAssetProfileInputSchema>;

export const runtimeMemberAssetProfileResultSchema = memberAssetProfileSchema;
export type RuntimeMemberAssetProfileResult = z.infer<
  typeof runtimeMemberAssetProfileResultSchema
>;

export const runtimeMemberAssetOperationCompletedInputSchema = z.strictObject({
  identity: companyRuntimeIdentitySchema,
  member_id: z.string().min(1),
  operation_id: z.string().min(1),
  requested_revision: z.number().int().positive(),
  status: z.enum(["applied", "failed"]),
  installations: z.array(memberAssetInstallationSchema).max(256),
  error_code: z.string().min(1).max(128).nullable(),
  retryable: z.boolean(),
  completed_at_ms: z.number().int().nonnegative(),
}).refine(
  (input) => (
    (input.status === "applied" && input.error_code === null)
    || (
      input.status === "failed"
      && input.installations.length === 0
      && input.error_code !== null
    )
  ),
  { message: "Member asset completion status and result fields must agree." },
);
export type RuntimeMemberAssetOperationCompletedInput = z.infer<
  typeof runtimeMemberAssetOperationCompletedInputSchema
>;

function agentEnvelope<T extends z.ZodType>(input: T) {
  return z.strictObject({
    identity: companyRuntimeIdentitySchema,
    member_id: z.string().min(1),
    input,
  });
}

export const runtimeAgentAssetListInputSchema = agentEnvelope(assetListInputSchema);
export const runtimeAgentAssetReadInputSchema = agentEnvelope(assetReadInputSchema);
export const runtimeAgentAssetContentReadInputSchema = agentEnvelope(z.strictObject({
  asset_id: z.string().min(1),
  draft_id: z.string().min(1).optional(),
  version: assetVersionSchema.optional(),
  path: z.string().min(1).max(2_048),
}).refine(
  (input) => Number(input.draft_id !== undefined) + Number(input.version !== undefined) === 1,
  { message: "Exactly one of draft_id or version is required." },
));
export const runtimeAgentAssetBeginZipInputSchema = agentEnvelope(assetDraftBeginZipInputSchema);
export const runtimeAgentAssetImportGitInputSchema = agentEnvelope(assetDraftImportGitInputSchema);
export const runtimeAgentAssetImportWorkspaceZipInputSchema = agentEnvelope(
  z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("plugin"),
      name: assetNameSchema,
      slug: assetSlugSchema,
      version: z.null().optional(),
      description: z.string().max(4_000).optional(),
      thread_id: z.string().min(1),
      workspace_relative_path: z.string().min(1).max(2_048),
      idempotency_key: z.string().min(1).max(200),
    }),
    z.strictObject({
      kind: z.literal("skill"),
      name: assetNameSchema,
      slug: assetSlugSchema,
      version: assetVersionSchema,
      description: z.string().max(4_000).optional(),
      thread_id: z.string().min(1),
      workspace_relative_path: z.string().min(1).max(2_048),
      idempotency_key: z.string().min(1).max(200),
    }),
  ]),
);
export const runtimeAgentAssetCreateMcpInputSchema = agentEnvelope(assetDraftCreateMcpInputSchema);
export const runtimeAgentAssetUpdateInputSchema = agentEnvelope(assetDraftUpdateInputSchema);
export const runtimeAgentAssetRevisionInputSchema = agentEnvelope(assetDraftRevisionInputSchema);
export const runtimeAgentAssetArchiveInputSchema = agentEnvelope(z.strictObject({
  asset_id: z.string().min(1),
  expected_revision: z.number().int().positive(),
  idempotency_key: z.string().min(1).max(200),
}));
export const runtimeAgentAssetCredentialReplaceInputSchema = agentEnvelope(
  assetMcpCredentialReplaceInputSchema,
);
export const runtimeAgentMemberAssetCurrentInputSchema = agentEnvelope(z.strictObject({}));
export const runtimeAgentMemberAssetOptionsInputSchema = agentEnvelope(
  memberAssetOptionsInputSchema.omit({ member_id: true }),
);
export const runtimeAgentMemberAssetApplyInputSchema = agentEnvelope(
  selfMemberAssetApplyInputSchema,
);

export {
  assetContentSchema as runtimeAgentAssetContentResultSchema,
  assetDetailSchema as runtimeAgentAssetDetailResultSchema,
  assetDraftDeleteResultSchema as runtimeAgentAssetDraftDeleteResultSchema,
  assetDraftMutationResultSchema as runtimeAgentAssetDraftMutationResultSchema,
  assetListResultSchema as runtimeAgentAssetListResultSchema,
  assetMutationResultSchema as runtimeAgentAssetMutationResultSchema,
  assetPublishResultSchema as runtimeAgentAssetPublishResultSchema,
  memberAssetOptionsResultSchema as runtimeAgentMemberAssetOptionsResultSchema,
  memberAssetProfileSchema as runtimeAgentMemberAssetProfileResultSchema,
};
