import type {
  AssetArchiveInput,
  AssetContent,
  AssetContentReadInput,
  AssetDetail,
  AssetDraft,
  AssetDraftBeginZipInput,
  AssetDraftCreateMcpInput,
  AssetDraftImportGitInput,
  AssetDraftRevisionInput,
  AssetDraftUpdateInput,
  AssetListInput,
  AssetListResult,
  AssetMcpCredentialReplaceInput,
  AssetMcpToolCallInput,
  AssetMcpToolCallResult,
  AssetMcpToolsListInput,
  AssetMcpToolsListResult,
  AssetValidationSnapshot,
  AssetVersionRecord,
  MemberAssetOperation,
  MemberAssetOptionsResult,
  MemberAssetProfile,
  MemberAssetTarget,
} from "@fields/contracts/public/asset";
import type {
  AssetStoredPackage,
  RuntimeAssetContentReadInput,
  RuntimeAssetCredentialOperationInput,
  RuntimeAssetCredentialReplaceInput,
  RuntimeAssetDraftReferenceCasInput,
  RuntimeAssetGitImportInput,
  RuntimeAssetMcpStoreInput,
  RuntimeAssetMcpToolCallInput,
  RuntimeAssetMcpToolCallResult,
  RuntimeAssetMcpToolsListInput,
  RuntimeAssetMcpToolsListResult,
  RuntimeAssetPublishReferenceInput,
  RuntimeAssetReferenceInput,
  RuntimeAssetValidateInput,
  RuntimeAssetVersionReferenceInput,
  RuntimeAssetWorkspaceZipInput,
  RuntimeAssetZipPackageInput,
  RuntimeMemberAssetApplyInput,
  RuntimeMemberAssetApplyResult,
  RuntimeMemberAssetOperationCompletedInput,
} from "@fields/contracts/internal/asset";

export const ASSET_NOT_FOUND_CODE = "ASSET_NOT_FOUND";
export const ASSET_DRAFT_NOT_FOUND_CODE = "ASSET_DRAFT_NOT_FOUND";
export const ASSET_REVISION_CONFLICT_CODE = "ASSET_REVISION_CONFLICT";
export const ASSET_VERSION_CONFLICT_CODE = "ASSET_VERSION_CONFLICT";
export const ASSET_ARCHIVED_CODE = "ASSET_ARCHIVED";
export const ASSET_VALIDATION_REQUIRED_CODE = "ASSET_VALIDATION_REQUIRED";
export const ASSET_IDEMPOTENCY_CONFLICT_CODE = "ASSET_IDEMPOTENCY_CONFLICT";
export const ASSET_IDENTITY_RESERVED_CODE = "ASSET_IDENTITY_RESERVED";
export const ASSET_MCP_REQUIRED_CODE = "ASSET_MCP_REQUIRED";
export const ASSET_MCP_VERSION_INVALID_CODE = "ASSET_MCP_VERSION_INVALID";
export const ASSET_MCP_CREDENTIAL_REQUIRED_CODE = "ASSET_MCP_CREDENTIAL_REQUIRED";

export interface CompanyAssetRuntimeGateway {
  assetImportZip(
    companyId: string,
    input: RuntimeAssetZipPackageInput,
    body: AsyncIterable<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<AssetStoredPackage>;
  assetImportGit(
    companyId: string,
    input: RuntimeAssetGitImportInput,
  ): Promise<AssetStoredPackage>;
  assetImportWorkspaceZip(
    companyId: string,
    input: RuntimeAssetWorkspaceZipInput,
  ): Promise<AssetStoredPackage>;
  assetStoreMcp(
    companyId: string,
    input: RuntimeAssetMcpStoreInput,
  ): Promise<AssetStoredPackage>;
  assetValidate(companyId: string, input: RuntimeAssetValidateInput): Promise<{
    validation: AssetValidationSnapshot;
  }>;
  assetReleaseDraft(
    companyId: string,
    input: RuntimeAssetReferenceInput,
  ): Promise<unknown>;
  assetDraftReferenceCas(
    companyId: string,
    input: RuntimeAssetDraftReferenceCasInput,
  ): Promise<unknown>;
  assetPublishReference(
    companyId: string,
    input: RuntimeAssetPublishReferenceInput,
  ): Promise<unknown>;
  assetReleaseVersion(
    companyId: string,
    input: RuntimeAssetVersionReferenceInput,
  ): Promise<unknown>;
  assetContentRead(
    companyId: string,
    input: RuntimeAssetContentReadInput,
  ): Promise<AssetContent>;
  assetCredentialStage(
    companyId: string,
    input: RuntimeAssetCredentialReplaceInput,
  ): Promise<unknown>;
  assetCredentialCommit(
    companyId: string,
    input: RuntimeAssetCredentialOperationInput,
  ): Promise<unknown>;
  assetCredentialAbort(
    companyId: string,
    input: RuntimeAssetCredentialOperationInput,
  ): Promise<unknown>;
  assetMcpToolsList(
    companyId: string,
    input: RuntimeAssetMcpToolsListInput,
  ): Promise<RuntimeAssetMcpToolsListResult>;
  assetMcpToolCall(
    companyId: string,
    input: RuntimeAssetMcpToolCallInput,
  ): Promise<RuntimeAssetMcpToolCallResult>;
}

export interface MemberAssetRuntimeGateway {
  memberAssetsApply(
    companyId: string,
    input: RuntimeMemberAssetApplyInput,
  ): Promise<RuntimeMemberAssetApplyResult>;
}

export interface MemberAssetApplication {
  current(
    companyId: string,
    requestedByActorId: string,
    memberId: string,
    authority?: "human" | "self_agent",
  ): Promise<MemberAssetProfile>;
  options(
    companyId: string,
    requestedByActorId: string,
    memberId: string,
    input: { kind?: "plugin" | "skill" | "mcp"; search_term?: string },
    authority?: "human" | "self_agent",
  ): Promise<MemberAssetOptionsResult>;
  apply(input: {
    companyId: string;
    requestedByActorId: string;
    memberId: string;
    expectedRevision: number;
    installations: MemberAssetTarget[];
    idempotencyKey: string;
    authority: "human" | "self_agent";
  }): Promise<MemberAssetProfile>;
  operation(
    companyId: string,
    requestedByActorId: string,
    memberId: string,
    operationId: string,
  ): Promise<MemberAssetOperation>;
  complete(input: RuntimeMemberAssetOperationCompletedInput): Promise<void>;
}

type AssetWorkspaceZipBaseInput = {
  name: string;
  slug: string;
  description?: string;
  thread_id: string;
  workspace_relative_path: string;
  idempotency_key: string;
};

export type AssetWorkspaceZipInput =
  | AssetWorkspaceZipBaseInput & {
    kind: "plugin";
    version?: null;
  }
  | AssetWorkspaceZipBaseInput & {
    kind: "skill";
    version: string;
  };

export interface CompanyAssetApplication {
  list(
    companyId: string,
    actorId: string,
    input: AssetListInput,
  ): Promise<AssetListResult>;
  read(
    companyId: string,
    actorId: string,
    assetId: string,
  ): Promise<AssetDetail>;
  contentRead(
    companyId: string,
    actorId: string,
    input: AssetContentReadInput,
  ): Promise<AssetContent>;
  beginZip(
    companyId: string,
    actorId: string,
    input: AssetDraftBeginZipInput,
  ): Promise<{ draft: AssetDraft }>;
  uploadPackage(
    companyId: string,
    actorId: string,
    input: {
      draft_id: string;
      expected_revision: number;
      idempotency_key: string;
      package_sha256: string;
      package_size_bytes: number;
      package_body: AsyncIterable<Uint8Array>;
      signal?: AbortSignal;
    },
  ): Promise<{ draft: AssetDraft }>;
  importGit(
    companyId: string,
    actorId: string,
    input: AssetDraftImportGitInput,
  ): Promise<{ draft: AssetDraft }>;
  importWorkspaceZip(
    companyId: string,
    actorId: string,
    input: AssetWorkspaceZipInput,
  ): Promise<{ draft: AssetDraft }>;
  createMcp(
    companyId: string,
    actorId: string,
    input: AssetDraftCreateMcpInput,
  ): Promise<{ draft: AssetDraft }>;
  updateDraft(
    companyId: string,
    actorId: string,
    input: AssetDraftUpdateInput,
  ): Promise<{ draft: AssetDraft }>;
  validateDraft(
    companyId: string,
    actorId: string,
    input: AssetDraftRevisionInput,
  ): Promise<{ draft: AssetDraft }>;
  deleteDraft(
    companyId: string,
    actorId: string,
    input: AssetDraftRevisionInput,
  ): Promise<{ deleted: true; draft_id: string }>;
  publish(
    companyId: string,
    actorId: string,
    input: AssetDraftRevisionInput,
  ): Promise<{
    asset: AssetDetail;
    published_version: AssetVersionRecord;
  }>;
  archive(
    companyId: string,
    actorId: string,
    input: AssetArchiveInput,
  ): Promise<{ asset: AssetDetail }>;
  restore(
    companyId: string,
    actorId: string,
    input: AssetArchiveInput,
  ): Promise<{ asset: AssetDetail }>;
  replaceCredential(
    companyId: string,
    actorId: string,
    input: AssetMcpCredentialReplaceInput,
  ): Promise<{ asset: AssetDetail }>;
  listMcpTools(
    companyId: string,
    actorId: string,
    input: AssetMcpToolsListInput,
  ): Promise<AssetMcpToolsListResult>;
  callMcpTool(
    companyId: string,
    actorId: string,
    input: AssetMcpToolCallInput,
  ): Promise<AssetMcpToolCallResult>;
  searchPublished(
    companyId: string,
    query: string,
    limit: number,
    cursor?: string | null,
  ): Promise<AssetListResult>;
}
