import {
  companyFileDeleteResultSchema,
  companyFileDownloadResultSchema,
  companyFileFolderDeleteResultSchema,
  companyFileFolderSchema,
  companyFileListResultSchema,
  companyFileSchema,
  companyFileShareListResultSchema,
  companyFileShareResolveResultSchema,
  companyFileShareRevokeResultSchema,
  companyFileShareSchema,
  companyFileUploadReservationSchema,
  type CompanyFile,
  type CompanyFileFolderCreateInput,
  type CompanyFileFolderMutationInput,
  type CompanyFileListInput,
  type CompanyFileMutationInput,
  type CompanyFileShareCreateInput,
  type CompanyFileShareListInput,
  type CompanyFileShareResolveInput,
  type CompanyFileShareRevokeInput,
  type CompanyFileUploadBeginInput,
  type CompanyFileUploadFinalizeInput,
} from "@fields/contracts/public/company-file";
import type {
  AgentRoomCompanyFileInput,
  AgentRoomCompanyFileSnapshot,
  AgentRoomPromptMessage,
} from "@fields/contracts/internal/agent-room";
import { and, asc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import type {
  CompanyFileApplication,
  CompanyFileActorSummaryQuery,
  CompanyFileObjectStore,
} from "../../../../../application/company/ports/company-files.js";
import { ApplicationError } from "../../../../../application/platform/errors.js";
import type { BackendDatabase } from "../../database-service.js";
import {
  companyFileBlobs,
  companyFileFolders,
  companyFileMutationReceipts,
  companyFileShares,
  companyFiles,
  companyFileUploads,
  companyFileVersions,
} from "../../schema/company/file.js";
import { emitObservabilityLog } from "../../../../../observability/events.js";
import type { RoomReferenceTarget } from "@fields/contracts/public/room";

export const COMPANY_FILE_NOT_FOUND_CODE = "COMPANY_FILE_NOT_FOUND";
export const COMPANY_FILE_REVISION_CONFLICT_CODE = "COMPANY_FILE_REVISION_CONFLICT";
export const COMPANY_FILE_IDEMPOTENCY_CONFLICT_CODE = "COMPANY_FILE_IDEMPOTENCY_CONFLICT";
export const COMPANY_FILE_OBJECT_INVALID_CODE = "COMPANY_FILE_OBJECT_INVALID";
export const COMPANY_FILE_FOLDER_INVALID_CODE = "COMPANY_FILE_FOLDER_INVALID";
export const COMPANY_FILE_SHARE_INVALID_CODE = "COMPANY_FILE_SHARE_INVALID";

const UPLOAD_TTL_MS = 10 * 60 * 1_000;
const DOWNLOAD_TTL_MS = 5 * 60 * 1_000;

export class PostgresCompanyFileApplication implements CompanyFileApplication {
  constructor(
    private readonly db: BackendDatabase,
    private readonly objects: CompanyFileObjectStore,
    private readonly nowMs: () => number = Date.now,
    private readonly newId: () => string = randomUUID,
    private readonly shareSecret: string = "fields-development-company-file-share-secret",
    private readonly actorSummaryQuery: CompanyFileActorSummaryQuery = {
      list: async () => [],
    },
  ) {}

  async list(companyId: string, input: CompanyFileListInput) {
    const search = input.search_term?.trim();
    const folderCondition = input.recursive
      ? undefined
      : input.folder_id === null
        ? isNull(companyFileFolders.parentFolderId)
        : eq(companyFileFolders.parentFolderId, input.folder_id);
    const fileCondition = input.recursive
      ? undefined
      : input.folder_id === null
        ? isNull(companyFiles.folderId)
        : eq(companyFiles.folderId, input.folder_id);
    const [folders, files] = await Promise.all([
      this.db.select().from(companyFileFolders).where(and(
        eq(companyFileFolders.companyId, companyId),
        search ? ilike(companyFileFolders.name, `%${escapeLike(search)}%`) : folderCondition,
      )).orderBy(asc(companyFileFolders.name)),
      this.db.select({
        file: companyFiles,
        version: companyFileVersions,
      }).from(companyFiles).innerJoin(
        companyFileVersions,
        and(
          eq(companyFileVersions.companyId, companyFiles.companyId),
          eq(companyFileVersions.id, companyFiles.currentVersionId),
        ),
      ).where(and(
        eq(companyFiles.companyId, companyId),
        search ? ilike(companyFiles.name, `%${escapeLike(search)}%`) : fileCondition,
      )).orderBy(asc(companyFiles.name)),
    ]);
    const actorIds = new Set([
      ...folders.map((folder) => folder.createdByActorId),
      ...files.map(({ version }) => version.createdByActorId),
    ]);
    const actorMap = await this.actorSummaries(companyId, [...actorIds]);
    return companyFileListResultSchema.parse({
      folders: folders.map((folder) => projectFolder(folder, requireActor(actorMap, folder.createdByActorId))),
      files: files.map(({ file, version }) => projectFile(
        file,
        version,
        requireActor(actorMap, version.createdByActorId),
      )),
    });
  }

  async createFolder(companyId: string, actorId: string, input: CompanyFileFolderCreateInput) {
    const fingerprint = hashJson({ operation: "folder.create", input });
    return this.withReceipt(companyId, actorId, input.idempotency_key, "folder.create", fingerprint, async () => {
      await this.requireFolder(companyId, input.parent_folder_id);
      const now = this.nowMs();
      const [created] = await this.db.insert(companyFileFolders).values({
        id: `folder_${this.newId()}`,
        companyId,
        parentFolderId: input.parent_folder_id,
        name: input.name,
        revision: 1,
        createdByActorId: actorId,
        createdAtMs: now,
        updatedAtMs: now,
      }).returning();
      return companyFileFolderSchema.parse(projectFolder(
        created!,
        await this.actorSummary(companyId, created!.createdByActorId),
      ));
    }, companyFileFolderSchema);
  }

  async updateFolder(companyId: string, actorId: string, input: CompanyFileFolderMutationInput) {
    const fingerprint = hashJson({ operation: "folder.update", input });
    return this.withReceipt(companyId, actorId, input.idempotency_key, "folder.update", fingerprint, async () => {
      if (input.parent_folder_id === input.folder_id) {
        throw new ApplicationError(COMPANY_FILE_FOLDER_INVALID_CODE, false);
      }
      if (input.parent_folder_id !== undefined) {
        await this.requireFolder(companyId, input.parent_folder_id);
        await this.requireNoFolderCycle(companyId, input.folder_id, input.parent_folder_id);
      }
      const values: Record<string, unknown> = {
        revision: sql`${companyFileFolders.revision} + 1`,
        updatedAtMs: this.nowMs(),
      };
      if (input.name !== undefined) values.name = input.name;
      if (input.parent_folder_id !== undefined) values.parentFolderId = input.parent_folder_id;
      const [updated] = await this.db.update(companyFileFolders).set(values).where(and(
        eq(companyFileFolders.companyId, companyId),
        eq(companyFileFolders.id, input.folder_id),
        eq(companyFileFolders.revision, input.expected_revision),
      )).returning();
      if (!updated) throw new ApplicationError(COMPANY_FILE_REVISION_CONFLICT_CODE, false);
      return companyFileFolderSchema.parse(projectFolder(
        updated,
        await this.actorSummary(companyId, updated.createdByActorId),
      ));
    }, companyFileFolderSchema);
  }

  async deleteFolder(companyId: string, actorId: string, input: CompanyFileFolderMutationInput) {
    const fingerprint = hashJson({ operation: "folder.delete", input });
    return this.withReceipt(companyId, actorId, input.idempotency_key, "folder.delete", fingerprint, async () => {
      const [childFolders, childFiles] = await Promise.all([
        this.db.select({ id: companyFileFolders.id }).from(companyFileFolders).where(and(
          eq(companyFileFolders.companyId, companyId),
          eq(companyFileFolders.parentFolderId, input.folder_id),
        )).limit(1),
        this.db.select({ id: companyFiles.id }).from(companyFiles).where(and(
          eq(companyFiles.companyId, companyId),
          eq(companyFiles.folderId, input.folder_id),
        )).limit(1),
      ]);
      if (childFolders[0] || childFiles[0]) {
        throw new ApplicationError(COMPANY_FILE_FOLDER_INVALID_CODE, false);
      }
      const [deleted] = await this.db.delete(companyFileFolders).where(and(
        eq(companyFileFolders.companyId, companyId),
        eq(companyFileFolders.id, input.folder_id),
        eq(companyFileFolders.revision, input.expected_revision),
      )).returning({ id: companyFileFolders.id });
      if (!deleted) throw new ApplicationError(COMPANY_FILE_REVISION_CONFLICT_CODE, false);
      return companyFileFolderDeleteResultSchema.parse({
        deleted: true,
        folder_id: deleted.id,
      });
    }, companyFileFolderDeleteResultSchema);
  }

  async beginUpload(
    companyId: string,
    actorId: string,
    input: CompanyFileUploadBeginInput,
    audience: "browser" | "runtime" = "browser",
  ) {
    if ((input.file_id === undefined) !== (input.expected_revision === undefined)) {
      throw new ApplicationError(COMPANY_FILE_REVISION_CONFLICT_CODE, false);
    }
    await this.requireFolder(companyId, input.folder_id);
    if (input.file_id) await this.requireFileRevision(companyId, input.file_id, input.expected_revision!);
    const existing = await this.db.select().from(companyFileUploads).where(and(
      eq(companyFileUploads.companyId, companyId),
      eq(companyFileUploads.requestedByActorId, actorId),
      eq(companyFileUploads.idempotencyKey, input.idempotency_key),
    )).limit(1);
    if (existing[0]) {
      if (!sameUpload(existing[0], input)) {
        throw new ApplicationError(COMPANY_FILE_IDEMPOTENCY_CONFLICT_CODE, false);
      }
      return this.uploadReservation(companyId, existing[0], audience);
    }
    const now = this.nowMs();
    const objectKey = this.objects.objectKey(companyId, input.sha256);
    const [upload] = await this.db.insert(companyFileUploads).values({
      id: `upload_${this.newId()}`,
      companyId,
      requestedByActorId: actorId,
      idempotencyKey: input.idempotency_key,
      fileId: input.file_id ?? null,
      expectedRevision: input.expected_revision ?? null,
      folderId: input.folder_id,
      name: input.name,
      mimeType: input.mime_type,
      sizeBytes: input.size_bytes,
      sha256: input.sha256,
      objectKey,
      status: "pending",
      expiresAtMs: now + UPLOAD_TTL_MS,
      createdAtMs: now,
    }).returning();
    emitObservabilityLog("company_files.upload.reserved", {
      "fields.company_id": companyId,
      "fields.actor_id": actorId,
      "fields.operation_id": upload!.id,
      "fields.byte_count": input.size_bytes,
    });
    return this.uploadReservation(companyId, upload!, audience);
  }

  async finalizeUpload(companyId: string, actorId: string, input: CompanyFileUploadFinalizeInput) {
    const upload = await this.requireUpload(companyId, actorId, input.upload_id);
    if (upload.idempotencyKey !== input.idempotency_key) {
      throw new ApplicationError(COMPANY_FILE_IDEMPOTENCY_CONFLICT_CODE, false);
    }
    if (upload.status === "completed" && upload.resultFileId) {
      return this.readFile(companyId, upload.resultFileId);
    }
    if (upload.expiresAtMs < this.nowMs()) {
      throw new ApplicationError(COMPANY_FILE_OBJECT_INVALID_CODE, true);
    }
    const object = await this.objects.head(upload.objectKey);
    if (!object || object.sizeBytes !== upload.sizeBytes || object.sha256 !== upload.sha256) {
      throw new ApplicationError(COMPANY_FILE_OBJECT_INVALID_CODE, true);
    }
    const result = await this.db.transaction(async (transaction) => {
      const [locked] = await transaction.select().from(companyFileUploads).where(and(
        eq(companyFileUploads.companyId, companyId),
        eq(companyFileUploads.id, upload.id),
      )).for("update");
      if (!locked) throw new ApplicationError(COMPANY_FILE_NOT_FOUND_CODE, false);
      if (locked.status === "completed" && locked.resultFileId) {
        return locked.resultFileId;
      }
      const now = this.nowMs();
      await transaction.insert(companyFileBlobs).values({
        companyId,
        sha256: upload.sha256,
        sizeBytes: upload.sizeBytes,
        objectKey: upload.objectKey,
        createdAtMs: now,
      }).onConflictDoNothing();
      if (upload.fileId) {
        const [current] = await transaction.select().from(companyFiles).where(and(
          eq(companyFiles.companyId, companyId),
          eq(companyFiles.id, upload.fileId),
        )).for("update");
        if (!current || current.revision !== upload.expectedRevision) {
          throw new ApplicationError(COMPANY_FILE_REVISION_CONFLICT_CODE, false);
        }
        const [{ nextVersion }] = await transaction.select({
          nextVersion: sql<number>`coalesce(max(${companyFileVersions.versionNumber}), 0) + 1`,
        }).from(companyFileVersions).where(eq(companyFileVersions.fileId, current.id));
        const versionId = `file_version_${this.newId()}`;
        await transaction.insert(companyFileVersions).values({
          id: versionId,
          companyId,
          fileId: current.id,
          versionNumber: Number(nextVersion),
          blobSha256: upload.sha256,
          sizeBytes: upload.sizeBytes,
          mimeType: upload.mimeType,
          originalName: upload.name,
          createdByActorId: actorId,
          createdAtMs: now,
        });
        await transaction.update(companyFiles).set({
          currentVersionId: versionId,
          revision: current.revision + 1,
          updatedAtMs: now,
        }).where(eq(companyFiles.id, current.id));
        await transaction.update(companyFileUploads).set({
          status: "completed",
          resultFileId: current.id,
          completedAtMs: now,
        }).where(eq(companyFileUploads.id, upload.id));
        return current.id;
      }
      const fileId = `file_${this.newId()}`;
      const versionId = `file_version_${this.newId()}`;
      await transaction.insert(companyFiles).values({
        id: fileId,
        companyId,
        folderId: upload.folderId,
        name: upload.name,
        revision: 1,
        currentVersionId: versionId,
        createdByActorId: actorId,
        createdAtMs: now,
        updatedAtMs: now,
      });
      await transaction.insert(companyFileVersions).values({
        id: versionId,
        companyId,
        fileId,
        versionNumber: 1,
        blobSha256: upload.sha256,
        sizeBytes: upload.sizeBytes,
        mimeType: upload.mimeType,
        originalName: upload.name,
        createdByActorId: actorId,
        createdAtMs: now,
      });
      await transaction.update(companyFileUploads).set({
        status: "completed",
        resultFileId: fileId,
        completedAtMs: now,
      }).where(eq(companyFileUploads.id, upload.id));
      return fileId;
    });
    const file = await this.readFile(companyId, result);
    emitObservabilityLog("company_files.upload.finalized", {
      "fields.company_id": companyId,
      "fields.actor_id": actorId,
      "fields.operation_id": upload.id,
      "fields.byte_count": upload.sizeBytes,
    });
    return file;
  }

  async updateFile(companyId: string, actorId: string, input: CompanyFileMutationInput) {
    const fingerprint = hashJson({ operation: "file.update", input });
    return this.withReceipt(companyId, actorId, input.idempotency_key, "file.update", fingerprint, async () => {
      if (input.folder_id !== undefined) await this.requireFolder(companyId, input.folder_id);
      const values: Record<string, unknown> = {
        revision: sql`${companyFiles.revision} + 1`,
        updatedAtMs: this.nowMs(),
      };
      if (input.folder_id !== undefined) values.folderId = input.folder_id;
      if (input.name !== undefined) values.name = input.name;
      const [updated] = await this.db.update(companyFiles).set(values).where(and(
        eq(companyFiles.companyId, companyId),
        eq(companyFiles.id, input.file_id),
        eq(companyFiles.revision, input.expected_revision),
      )).returning();
      if (!updated) throw new ApplicationError(COMPANY_FILE_REVISION_CONFLICT_CODE, false);
      return this.readFile(companyId, updated.id);
    }, companyFileSchema);
  }

  async deleteFile(companyId: string, actorId: string, input: CompanyFileMutationInput) {
    const fingerprint = hashJson({ operation: "file.delete", input });
    return this.withReceipt(companyId, actorId, input.idempotency_key, "file.delete", fingerprint, async () => {
      const [deleted] = await this.db.delete(companyFiles).where(and(
        eq(companyFiles.companyId, companyId),
        eq(companyFiles.id, input.file_id),
        eq(companyFiles.revision, input.expected_revision),
      )).returning({ id: companyFiles.id });
      if (!deleted) throw new ApplicationError(COMPANY_FILE_REVISION_CONFLICT_CODE, false);
      return companyFileDeleteResultSchema.parse({ deleted: true, file_id: deleted.id });
    }, companyFileDeleteResultSchema);
  }

  async download(companyId: string, input: {
    file_id: string;
    version_id?: string;
    disposition?: "attachment" | "inline";
  }, audience: "browser" | "runtime" = "browser") {
    const file = await this.readFile(companyId, input.file_id);
    const [version] = input.version_id
      ? await this.db.select().from(companyFileVersions).where(and(
        eq(companyFileVersions.companyId, companyId),
        eq(companyFileVersions.fileId, input.file_id),
        eq(companyFileVersions.id, input.version_id),
      )).limit(1)
      : await this.db.select().from(companyFileVersions).where(and(
        eq(companyFileVersions.companyId, companyId),
        eq(companyFileVersions.id, file.current_version.version_id),
      )).limit(1);
    if (!version) throw new ApplicationError(COMPANY_FILE_NOT_FOUND_CODE, false);
    const [blob] = await this.db.select().from(companyFileBlobs).where(and(
      eq(companyFileBlobs.companyId, companyId),
      eq(companyFileBlobs.sha256, version.blobSha256),
    )).limit(1);
    if (!blob) throw new ApplicationError(COMPANY_FILE_OBJECT_INVALID_CODE, true);
    const downloadUrl = await this.objects.presignGet({
      audience,
      key: blob.objectKey,
      contentType: version.mimeType,
      downloadName: file.name,
      expiresInSeconds: DOWNLOAD_TTL_MS / 1_000,
      disposition: input.disposition,
    });
    return companyFileDownloadResultSchema.parse({
      file,
      version: projectVersion(
        version,
        await this.actorSummary(companyId, version.createdByActorId),
      ),
      download_url: downloadUrl,
      expires_at_ms: this.nowMs() + DOWNLOAD_TTL_MS,
    });
  }

  async createShare(companyId: string, actorId: string, input: CompanyFileShareCreateInput) {
    await this.readFile(companyId, input.file_id);
    const now = this.nowMs();
    if (input.expires_at_ms !== null && input.expires_at_ms <= now) {
      throw new ApplicationError(COMPANY_FILE_SHARE_INVALID_CODE, false);
    }
    const [created] = await this.db.insert(companyFileShares).values({
      id: `file_share_${this.newId()}`,
      companyId,
      fileId: input.file_id,
      createdByActorId: actorId,
      createdAtMs: now,
      expiresAtMs: input.expires_at_ms,
    }).returning();
    if (!created) throw new ApplicationError(COMPANY_FILE_SHARE_INVALID_CODE, false);
    emitObservabilityLog("company_files.share.created", {
      "fields.company_id": companyId,
      "fields.actor_id": actorId,
      "fields.share_id": created.id,
    });
    return companyFileShareSchema.parse(this.projectShare(created));
  }

  async listShares(companyId: string, actorId: string, input: CompanyFileShareListInput) {
    await this.readFile(companyId, input.file_id);
    const rows = await this.db.select().from(companyFileShares).where(and(
      eq(companyFileShares.companyId, companyId),
      eq(companyFileShares.fileId, input.file_id),
      eq(companyFileShares.createdByActorId, actorId),
    )).orderBy(asc(companyFileShares.createdAtMs));
    return companyFileShareListResultSchema.parse({
      items: rows.map((row) => this.projectShare(row)),
    });
  }

  async revokeShare(companyId: string, actorId: string, input: CompanyFileShareRevokeInput) {
    const now = this.nowMs();
    const [revoked] = await this.db.update(companyFileShares).set({
      revokedAtMs: now,
    }).where(and(
      eq(companyFileShares.companyId, companyId),
      eq(companyFileShares.id, input.share_id),
      eq(companyFileShares.createdByActorId, actorId),
      isNull(companyFileShares.revokedAtMs),
    )).returning({ id: companyFileShares.id });
    if (!revoked) throw new ApplicationError(COMPANY_FILE_SHARE_INVALID_CODE, false);
    emitObservabilityLog("company_files.share.revoked", {
      "fields.company_id": companyId,
      "fields.actor_id": actorId,
      "fields.share_id": revoked.id,
    });
    return companyFileShareRevokeResultSchema.parse({
      revoked: true,
      share_id: revoked.id,
      revoked_at_ms: now,
    });
  }

  async resolveShare(input: CompanyFileShareResolveInput) {
    const shareId = this.verifyShareToken(input.share_token);
    const [row] = await this.db.select({
      share: companyFileShares,
      file: companyFiles,
      version: companyFileVersions,
      blob: companyFileBlobs,
    }).from(companyFileShares)
      .innerJoin(companyFiles, and(
        eq(companyFiles.companyId, companyFileShares.companyId),
        eq(companyFiles.id, companyFileShares.fileId),
      ))
      .innerJoin(companyFileVersions, and(
        eq(companyFileVersions.companyId, companyFiles.companyId),
        eq(companyFileVersions.id, companyFiles.currentVersionId),
      ))
      .innerJoin(companyFileBlobs, and(
        eq(companyFileBlobs.companyId, companyFileVersions.companyId),
        eq(companyFileBlobs.sha256, companyFileVersions.blobSha256),
      ))
      .where(eq(companyFileShares.id, shareId))
      .limit(1);
    const now = this.nowMs();
    if (
      !row
      || row.share.revokedAtMs !== null
      || (row.share.expiresAtMs !== null && row.share.expiresAtMs <= now)
    ) {
      emitObservabilityLog("company_files.share.resolve_rejected", {
        code: COMPANY_FILE_SHARE_INVALID_CODE,
        retryable: false,
        "fields.share_id": shareId,
      });
      throw new ApplicationError(COMPANY_FILE_SHARE_INVALID_CODE, false);
    }
    const expiresAt = now + DOWNLOAD_TTL_MS;
    const [previewUrl, downloadUrl] = await Promise.all([
      this.objects.presignGet({
        audience: "browser",
        key: row.blob.objectKey,
        contentType: row.version.mimeType,
        downloadName: row.file.name,
        expiresInSeconds: DOWNLOAD_TTL_MS / 1_000,
        disposition: "inline",
      }),
      this.objects.presignGet({
        audience: "browser",
        key: row.blob.objectKey,
        contentType: row.version.mimeType,
        downloadName: row.file.name,
        expiresInSeconds: DOWNLOAD_TTL_MS / 1_000,
        disposition: "attachment",
      }),
    ]);
    emitObservabilityLog("company_files.share.resolved", {
      "fields.share_id": row.share.id,
    });
    return companyFileShareResolveResultSchema.parse({
      share_id: row.share.id,
      name: row.file.name,
      mime_type: row.version.mimeType,
      size_bytes: row.version.sizeBytes,
      updated_at_ms: row.file.updatedAtMs,
      preview_url: previewUrl,
      download_url: downloadUrl,
      content_expires_at_ms: expiresAt,
      share_expires_at_ms: row.share.expiresAtMs,
    });
  }

  async snapshotMessageInputs(
    companyId: string,
    roomId: string,
    messages: readonly AgentRoomPromptMessage[],
  ): Promise<AgentRoomCompanyFileSnapshot[]> {
    const requested = new Map<string, {
      fileId: string;
      versionId: string;
      messageIds: string[];
      asImage: boolean;
    }>();
    for (const message of messages) {
      for (const reference of message.references) {
        if (reference.type !== "file") continue;
        if (reference.room_id !== roomId) {
          throw new ApplicationError(COMPANY_FILE_OBJECT_INVALID_CODE, false);
        }
        const key = `${reference.id}\0${reference.version_id}`;
        const asImage = (message.image_attachments ?? []).some((attachment) => (
          attachment.file_id === reference.id && attachment.version_id === reference.version_id
        ));
        const current = requested.get(key);
        if (current) {
          if (!current.messageIds.includes(message.message_id)) current.messageIds.push(message.message_id);
          current.asImage ||= asImage;
        } else {
          requested.set(key, {
            fileId: reference.id,
            versionId: reference.version_id,
            messageIds: [message.message_id],
            asImage,
          });
        }
      }
    }
    if (requested.size === 0) return [];
    const rows = await this.db.select({
      file: companyFiles,
      version: companyFileVersions,
      blob: companyFileBlobs,
    }).from(companyFileVersions).innerJoin(
      companyFiles,
      and(
        eq(companyFiles.companyId, companyFileVersions.companyId),
        eq(companyFiles.id, companyFileVersions.fileId),
      ),
    ).innerJoin(
      companyFileBlobs,
      and(
        eq(companyFileBlobs.companyId, companyFileVersions.companyId),
        eq(companyFileBlobs.sha256, companyFileVersions.blobSha256),
      ),
    ).where(and(
      eq(companyFileVersions.companyId, companyId),
      inArray(companyFileVersions.id, [...requested.values()].map((item) => item.versionId)),
    ));
    const resolved = new Map(rows.map((row) => [`${row.file.id}\0${row.version.id}`, row]));
    const inputs = [...requested.entries()].map(([key, item]) => {
      const row = resolved.get(key);
      if (!row) throw new ApplicationError(COMPANY_FILE_NOT_FOUND_CODE, false);
      return {
        file_id: item.fileId,
        version_id: item.versionId,
        message_ids: item.messageIds,
        name: row.file.name,
        mime_type: row.version.mimeType,
        size_bytes: row.version.sizeBytes,
        sha256: row.version.blobSha256,
        as_image: item.asImage,
      };
    });
    emitObservabilityLog("company_files.message_inputs.snapshotted", {
      "fields.company_id": companyId,
      "fields.room_id": roomId,
      "fields.file_count": inputs.length,
      "fields.byte_count": inputs.reduce((sum, input) => sum + input.size_bytes, 0),
    });
    return inputs;
  }

  async validateMessageReferences(
    companyId: string,
    roomId: string,
    references: readonly RoomReferenceTarget[],
    imageAttachments: readonly import("@fields/contracts/public/room").RoomMessageImageAttachment[] = [],
  ): Promise<void> {
    const files = references.filter((reference) => reference.type === "file");
    if (files.length === 0) {
      if (imageAttachments.length > 0) {
        throw new ApplicationError(COMPANY_FILE_OBJECT_INVALID_CODE, false);
      }
      return;
    }
    if (files.some((reference) => reference.room_id !== roomId)) {
      throw new ApplicationError(COMPANY_FILE_OBJECT_INVALID_CODE, false);
    }
    const rows = await this.db.select({
      fileId: companyFileVersions.fileId,
      versionId: companyFileVersions.id,
      name: companyFiles.name,
      mimeType: companyFileVersions.mimeType,
      sizeBytes: companyFileVersions.sizeBytes,
    }).from(companyFileVersions).innerJoin(
      companyFiles,
      and(
        eq(companyFiles.companyId, companyFileVersions.companyId),
        eq(companyFiles.id, companyFileVersions.fileId),
      ),
    ).where(and(
      eq(companyFileVersions.companyId, companyId),
      inArray(companyFileVersions.id, files.map((reference) => reference.version_id)),
    ));
    const available = new Map(rows.map((row) => [`${row.fileId}\0${row.versionId}`, row]));
    if (files.some((reference) => !available.has(`${reference.id}\0${reference.version_id}`))) {
      throw new ApplicationError(COMPANY_FILE_NOT_FOUND_CODE, false);
    }
    const referenced = new Set(files.map((reference) => `${reference.id}\0${reference.version_id}`));
    if (imageAttachments.some((attachment) => {
      const key = `${attachment.file_id}\0${attachment.version_id}`;
      const row = available.get(key);
      return attachment.storage !== "company_file_version"
        || !referenced.has(key)
        || row === undefined
        || attachment.name !== row.name
        || attachment.mime_type !== row.mimeType
        || attachment.size_bytes !== row.sizeBytes;
    })) {
      throw new ApplicationError(COMPANY_FILE_OBJECT_INVALID_CODE, false);
    }
  }

  async refreshSnapshotDownloads(
    companyId: string,
    inputs: readonly AgentRoomCompanyFileSnapshot[],
  ): Promise<AgentRoomCompanyFileInput[]> {
    if (inputs.length === 0) return [];
    const rows = await this.db.select({
      version: companyFileVersions,
      blob: companyFileBlobs,
    }).from(companyFileVersions).innerJoin(
      companyFileBlobs,
      and(
        eq(companyFileBlobs.companyId, companyFileVersions.companyId),
        eq(companyFileBlobs.sha256, companyFileVersions.blobSha256),
      ),
    ).where(and(
      eq(companyFileVersions.companyId, companyId),
      inArray(companyFileVersions.id, inputs.map((input) => input.version_id)),
    ));
    const versions = new Map(rows.map((row) => [row.version.id, row]));
    const expiresAt = this.nowMs() + DOWNLOAD_TTL_MS;
    return Promise.all(inputs.map(async (input) => {
      const row = versions.get(input.version_id);
      if (
        !row
        || row.version.fileId !== input.file_id
        || row.version.blobSha256 !== input.sha256
        || row.version.sizeBytes !== input.size_bytes
        || row.version.mimeType !== input.mime_type
      ) {
        throw new ApplicationError(COMPANY_FILE_OBJECT_INVALID_CODE, false);
      }
      return {
        ...input,
        download_url: await this.objects.presignGet({
          audience: "runtime",
          key: row.blob.objectKey,
          contentType: input.mime_type,
          downloadName: input.name,
          expiresInSeconds: DOWNLOAD_TTL_MS / 1_000,
        }),
        download_expires_at_ms: expiresAt,
      };
    }));
  }

  private async uploadReservation(
    companyId: string,
    upload: typeof companyFileUploads.$inferSelect,
    audience: "browser" | "runtime",
  ) {
    const [blob] = await this.db.select().from(companyFileBlobs).where(and(
      eq(companyFileBlobs.companyId, companyId),
      eq(companyFileBlobs.sha256, upload.sha256),
      eq(companyFileBlobs.sizeBytes, upload.sizeBytes),
    )).limit(1);
    const uploadRequired = !blob;
    const url = uploadRequired ? await this.objects.presignPut({
      audience,
      key: upload.objectKey,
      contentType: upload.mimeType,
      sha256: upload.sha256,
      expiresInSeconds: Math.max(1, Math.floor((upload.expiresAtMs - this.nowMs()) / 1_000)),
    }) : null;
    return companyFileUploadReservationSchema.parse({
      upload_id: upload.id,
      upload_required: uploadRequired,
      upload_url: url,
      upload_headers: uploadRequired
        ? { "content-type": upload.mimeType, "x-amz-meta-sha256": upload.sha256 }
        : {},
      expires_at_ms: uploadRequired ? upload.expiresAtMs : null,
    });
  }

  private async readFile(companyId: string, fileId: string): Promise<CompanyFile> {
    const [row] = await this.db.select({
      file: companyFiles,
      version: companyFileVersions,
    }).from(companyFiles).innerJoin(
      companyFileVersions,
      and(
        eq(companyFileVersions.companyId, companyFiles.companyId),
        eq(companyFileVersions.id, companyFiles.currentVersionId),
      ),
    ).where(and(
      eq(companyFiles.companyId, companyId),
      eq(companyFiles.id, fileId),
    )).limit(1);
    if (!row) throw new ApplicationError(COMPANY_FILE_NOT_FOUND_CODE, false);
    return companyFileSchema.parse(projectFile(
      row.file,
      row.version,
      await this.actorSummary(companyId, row.version.createdByActorId),
    ));
  }

  private async actorSummary(companyId: string, actorId: string) {
    const summaries = await this.actorSummaries(companyId, [actorId]);
    return requireActor(summaries, actorId);
  }

  private async actorSummaries(companyId: string, actorIds: string[]) {
    if (actorIds.length === 0) return new Map<string, ActorSummary>();
    const rows = await this.actorSummaryQuery.list(companyId, actorIds);
    return new Map(rows.map((row) => [row.actor_id, row]));
  }

  private projectShare(row: typeof companyFileShares.$inferSelect) {
    return {
      share_id: row.id,
      file_id: row.fileId,
      share_token: createCompanyFileShareToken(row.id, this.shareSecret),
      created_at_ms: row.createdAtMs,
      expires_at_ms: row.expiresAtMs,
      revoked_at_ms: row.revokedAtMs,
    };
  }

  private verifyShareToken(token: string): string {
    const shareId = verifyCompanyFileShareToken(token, this.shareSecret);
    if (!shareId) {
      throw new ApplicationError(COMPANY_FILE_SHARE_INVALID_CODE, false);
    }
    return shareId;
  }

  private async requireFolder(companyId: string, folderId: string | null): Promise<void> {
    if (folderId === null) return;
    const [folder] = await this.db.select({ id: companyFileFolders.id }).from(companyFileFolders)
      .where(and(
        eq(companyFileFolders.companyId, companyId),
        eq(companyFileFolders.id, folderId),
      )).limit(1);
    if (!folder) throw new ApplicationError(COMPANY_FILE_FOLDER_INVALID_CODE, false);
  }

  private async requireNoFolderCycle(
    companyId: string,
    folderId: string,
    parentFolderId: string | null,
  ): Promise<void> {
    let current = parentFolderId;
    const visited = new Set<string>();
    while (current !== null) {
      if (current === folderId || visited.has(current)) {
        throw new ApplicationError(COMPANY_FILE_FOLDER_INVALID_CODE, false);
      }
      visited.add(current);
      const [folder] = await this.db.select({ parent: companyFileFolders.parentFolderId })
        .from(companyFileFolders).where(and(
          eq(companyFileFolders.companyId, companyId),
          eq(companyFileFolders.id, current),
        )).limit(1);
      if (!folder) throw new ApplicationError(COMPANY_FILE_FOLDER_INVALID_CODE, false);
      current = folder.parent;
    }
  }

  private async requireFileRevision(companyId: string, fileId: string, revision: number) {
    const [file] = await this.db.select({ revision: companyFiles.revision }).from(companyFiles)
      .where(and(eq(companyFiles.companyId, companyId), eq(companyFiles.id, fileId))).limit(1);
    if (!file || file.revision !== revision) {
      throw new ApplicationError(COMPANY_FILE_REVISION_CONFLICT_CODE, false);
    }
  }

  private async requireUpload(companyId: string, actorId: string, uploadId: string) {
    const [upload] = await this.db.select().from(companyFileUploads).where(and(
      eq(companyFileUploads.companyId, companyId),
      eq(companyFileUploads.requestedByActorId, actorId),
      eq(companyFileUploads.id, uploadId),
    )).limit(1);
    if (!upload) throw new ApplicationError(COMPANY_FILE_NOT_FOUND_CODE, false);
    return upload;
  }

  private async withReceipt<T>(
    companyId: string,
    actorId: string,
    idempotencyKey: string,
    operation: string,
    fingerprint: string,
    execute: () => Promise<T>,
    schema: { parse(value: unknown): T },
  ): Promise<T> {
    const [existing] = await this.db.select().from(companyFileMutationReceipts).where(and(
      eq(companyFileMutationReceipts.companyId, companyId),
      eq(companyFileMutationReceipts.actorId, actorId),
      eq(companyFileMutationReceipts.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existing) {
      if (existing.operation !== operation || existing.fingerprint !== fingerprint) {
        throw new ApplicationError(COMPANY_FILE_IDEMPOTENCY_CONFLICT_CODE, false);
      }
      return schema.parse(existing.result);
    }
    const result = await execute();
    await this.db.insert(companyFileMutationReceipts).values({
      companyId,
      actorId,
      idempotencyKey,
      operation,
      fingerprint,
      result,
      createdAtMs: this.nowMs(),
    }).onConflictDoNothing();
    return result;
  }
}

type ActorSummary = {
  actor_id: string;
  display_name: string;
  actor_type: string;
};

function requireActor(actorMap: Map<string, ActorSummary>, actorId: string): ActorSummary {
  const actor = actorMap.get(actorId);
  if (!actor) throw new ApplicationError(COMPANY_FILE_NOT_FOUND_CODE, false);
  return actor;
}

function projectFolder(
  row: typeof companyFileFolders.$inferSelect,
  actor: ActorSummary,
) {
  return {
    folder_id: row.id,
    parent_folder_id: row.parentFolderId,
    name: row.name,
    revision: row.revision,
    created_by: actor,
    created_at_ms: row.createdAtMs,
    updated_at_ms: row.updatedAtMs,
  };
}

function projectVersion(
  row: typeof companyFileVersions.$inferSelect,
  actor: ActorSummary,
) {
  return {
    version_id: row.id,
    file_id: row.fileId,
    version_number: row.versionNumber,
    blob_sha256: row.blobSha256,
    size_bytes: row.sizeBytes,
    mime_type: row.mimeType,
    original_name: row.originalName,
    created_by_actor_id: row.createdByActorId,
    created_by: actor,
    created_at_ms: row.createdAtMs,
  };
}

function projectFile(
  file: typeof companyFiles.$inferSelect,
  version: typeof companyFileVersions.$inferSelect,
  actor: ActorSummary,
) {
  return {
    file_id: file.id,
    folder_id: file.folderId,
    name: file.name,
    revision: file.revision,
    current_version: projectVersion(version, actor),
    created_at_ms: file.createdAtMs,
    updated_at_ms: file.updatedAtMs,
  };
}

function sameUpload(
  row: typeof companyFileUploads.$inferSelect,
  input: CompanyFileUploadBeginInput,
): boolean {
  return row.fileId === (input.file_id ?? null)
    && row.expectedRevision === (input.expected_revision ?? null)
    && row.folderId === input.folder_id
    && row.name === input.name
    && row.mimeType === input.mime_type
    && row.sizeBytes === input.size_bytes
    && row.sha256 === input.sha256;
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function escapeLike(value: string): string {
  return value.replaceAll(/[\\%_]/gu, (match) => `\\${match}`);
}

export function createCompanyFileShareToken(shareId: string, secret: string): string {
  const signature = createHmac("sha256", secret)
    .update(`fields-company-file-share:v1:${shareId}`)
    .digest("base64url");
  return `${shareId}.${signature}`;
}

export function verifyCompanyFileShareToken(token: string, secret: string): string | null {
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const shareId = token.slice(0, separator);
  const actual = Buffer.from(token.slice(separator + 1));
  const expectedToken = createCompanyFileShareToken(shareId, secret);
  const expected = Buffer.from(expectedToken.slice(expectedToken.lastIndexOf(".") + 1));
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return shareId;
}
