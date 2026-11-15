import type {
  CompanyFile,
  CompanyFileActorSummary,
  CompanyFileDeleteResult,
  CompanyFileDownloadInput,
  CompanyFileDownloadResult,
  CompanyFileFolder,
  CompanyFileFolderCreateInput,
  CompanyFileFolderDeleteResult,
  CompanyFileFolderMutationInput,
  CompanyFileListInput,
  CompanyFileListResult,
  CompanyFileMutationInput,
  CompanyFileShare,
  CompanyFileShareCreateInput,
  CompanyFileShareListInput,
  CompanyFileShareListResult,
  CompanyFileShareResolveInput,
  CompanyFileShareResolveResult,
  CompanyFileShareRevokeInput,
  CompanyFileShareRevokeResult,
  CompanyFileUploadBeginInput,
  CompanyFileUploadFinalizeInput,
  CompanyFileUploadReservation,
} from "@fields/contracts/public/company-file";
import type {
  AgentRoomCompanyFileInput,
  AgentRoomCompanyFileSnapshot,
  AgentRoomPromptMessage,
} from "@fields/contracts/internal/agent-room";
import type { RoomReferenceTarget } from "@fields/contracts/public/room";

export type CompanyFileUrlAudience = "browser" | "runtime";

export interface CompanyFileApplication {
  list(companyId: string, input: CompanyFileListInput): Promise<CompanyFileListResult>;
  createFolder(
    companyId: string,
    actorId: string,
    input: CompanyFileFolderCreateInput,
  ): Promise<CompanyFileFolder>;
  updateFolder(
    companyId: string,
    actorId: string,
    input: CompanyFileFolderMutationInput,
  ): Promise<CompanyFileFolder>;
  deleteFolder(
    companyId: string,
    actorId: string,
    input: CompanyFileFolderMutationInput,
  ): Promise<CompanyFileFolderDeleteResult>;
  beginUpload(
    companyId: string,
    actorId: string,
    input: CompanyFileUploadBeginInput,
    audience?: CompanyFileUrlAudience,
  ): Promise<CompanyFileUploadReservation>;
  finalizeUpload(
    companyId: string,
    actorId: string,
    input: CompanyFileUploadFinalizeInput,
  ): Promise<CompanyFile>;
  updateFile(
    companyId: string,
    actorId: string,
    input: CompanyFileMutationInput,
  ): Promise<CompanyFile>;
  deleteFile(
    companyId: string,
    actorId: string,
    input: CompanyFileMutationInput,
  ): Promise<CompanyFileDeleteResult>;
  download(
    companyId: string,
    input: CompanyFileDownloadInput,
    audience?: CompanyFileUrlAudience,
  ): Promise<CompanyFileDownloadResult>;
  createShare(
    companyId: string,
    actorId: string,
    input: CompanyFileShareCreateInput,
  ): Promise<CompanyFileShare>;
  listShares(
    companyId: string,
    actorId: string,
    input: CompanyFileShareListInput,
  ): Promise<CompanyFileShareListResult>;
  revokeShare(
    companyId: string,
    actorId: string,
    input: CompanyFileShareRevokeInput,
  ): Promise<CompanyFileShareRevokeResult>;
  resolveShare(input: CompanyFileShareResolveInput): Promise<CompanyFileShareResolveResult>;
  validateMessageReferences(
    companyId: string,
    roomId: string,
    references: readonly RoomReferenceTarget[],
    imageAttachments?: readonly import("@fields/contracts/public/room").RoomMessageImageAttachment[],
  ): Promise<void>;
  snapshotMessageInputs(
    companyId: string,
    roomId: string,
    messages: readonly AgentRoomPromptMessage[],
  ): Promise<AgentRoomCompanyFileSnapshot[]>;
  refreshSnapshotDownloads(
    companyId: string,
    inputs: readonly AgentRoomCompanyFileSnapshot[],
  ): Promise<AgentRoomCompanyFileInput[]>;
}

export interface CompanyFileActorSummaryQuery {
  list(companyId: string, actorIds: readonly string[]): Promise<readonly CompanyFileActorSummary[]>;
}

export interface CompanyFileObjectStore {
  objectKey(companyId: string, sha256: string): string;
  head(key: string): Promise<{ sizeBytes: number; sha256: string } | null>;
  presignPut(input: {
    audience: CompanyFileUrlAudience;
    key: string;
    contentType: string;
    sha256: string;
    expiresInSeconds: number;
  }): Promise<string>;
  presignGet(input: {
    audience: CompanyFileUrlAudience;
    key: string;
    downloadName: string;
    contentType: string;
    expiresInSeconds: number;
    disposition?: "attachment" | "inline";
  }): Promise<string>;
  delete(key: string): Promise<void>;
}
