import { z } from "zod";
import { companyActorTypeSchema } from "./company.js";

const idSchema = z.string().trim().min(1).max(128);
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const nameSchema = z.string().trim().min(1).max(255);
const mimeTypeSchema = z.string().trim().min(1).max(255);
const idempotencyKeySchema = z.string().trim().min(1).max(200);

export const COMPANY_FILE_MAX_BYTES = 25 * 1024 * 1024;

export const companyFileActorSummarySchema = z.strictObject({
  actor_id: idSchema,
  display_name: z.string().trim().min(1).max(255),
  actor_type: companyActorTypeSchema,
});
export type CompanyFileActorSummary = z.infer<typeof companyFileActorSummarySchema>;

export const companyFileFolderSchema = z.strictObject({
  folder_id: idSchema,
  parent_folder_id: idSchema.nullable(),
  name: nameSchema,
  revision: z.number().int().positive(),
  created_by: companyFileActorSummarySchema,
  created_at_ms: z.number().int().nonnegative(),
  updated_at_ms: z.number().int().nonnegative(),
});
export type CompanyFileFolder = z.infer<typeof companyFileFolderSchema>;

export const companyFileVersionSchema = z.strictObject({
  version_id: idSchema,
  file_id: idSchema,
  version_number: z.number().int().positive(),
  blob_sha256: sha256Schema,
  size_bytes: z.number().int().nonnegative().max(COMPANY_FILE_MAX_BYTES),
  mime_type: mimeTypeSchema,
  original_name: nameSchema,
  created_by_actor_id: idSchema,
  created_by: companyFileActorSummarySchema,
  created_at_ms: z.number().int().nonnegative(),
});
export type CompanyFileVersion = z.infer<typeof companyFileVersionSchema>;

export const companyFileSchema = z.strictObject({
  file_id: idSchema,
  folder_id: idSchema.nullable(),
  name: nameSchema,
  revision: z.number().int().positive(),
  current_version: companyFileVersionSchema,
  created_at_ms: z.number().int().nonnegative(),
  updated_at_ms: z.number().int().nonnegative(),
});
export type CompanyFile = z.infer<typeof companyFileSchema>;

export const companyFileListInputSchema = z.strictObject({
  folder_id: idSchema.nullable().default(null),
  recursive: z.boolean().default(false),
  search_term: z.string().trim().max(255).optional(),
});
export type CompanyFileListInput = z.infer<typeof companyFileListInputSchema>;

export const companyFileListResultSchema = z.strictObject({
  folders: z.array(companyFileFolderSchema),
  files: z.array(companyFileSchema),
});
export type CompanyFileListResult = z.infer<typeof companyFileListResultSchema>;

export const companyFileFolderCreateInputSchema = z.strictObject({
  parent_folder_id: idSchema.nullable().default(null),
  name: nameSchema,
  idempotency_key: idempotencyKeySchema,
});
export type CompanyFileFolderCreateInput = z.infer<typeof companyFileFolderCreateInputSchema>;

export const companyFileFolderMutationInputSchema = z.strictObject({
  folder_id: idSchema,
  expected_revision: z.number().int().positive(),
  parent_folder_id: idSchema.nullable().optional(),
  name: nameSchema.optional(),
  idempotency_key: idempotencyKeySchema,
});
export type CompanyFileFolderMutationInput = z.infer<typeof companyFileFolderMutationInputSchema>;

export const companyFileFolderDeleteResultSchema = z.strictObject({
  deleted: z.literal(true),
  folder_id: idSchema,
});
export type CompanyFileFolderDeleteResult = z.infer<typeof companyFileFolderDeleteResultSchema>;

export const companyFileUploadBeginInputSchema = z.strictObject({
  file_id: idSchema.optional(),
  expected_revision: z.number().int().positive().optional(),
  folder_id: idSchema.nullable().default(null),
  name: nameSchema,
  mime_type: mimeTypeSchema,
  size_bytes: z.number().int().positive().max(COMPANY_FILE_MAX_BYTES),
  sha256: sha256Schema,
  idempotency_key: idempotencyKeySchema,
});
export type CompanyFileUploadBeginInput = z.infer<typeof companyFileUploadBeginInputSchema>;

export const companyFileUploadReservationSchema = z.strictObject({
  upload_id: idSchema,
  upload_required: z.boolean(),
  upload_url: z.string().url().nullable(),
  upload_headers: z.record(z.string(), z.string()),
  expires_at_ms: z.number().int().nonnegative().nullable(),
});
export type CompanyFileUploadReservation = z.infer<typeof companyFileUploadReservationSchema>;

export const companyFileUploadFinalizeInputSchema = z.strictObject({
  upload_id: idSchema,
  idempotency_key: idempotencyKeySchema,
});
export type CompanyFileUploadFinalizeInput = z.infer<typeof companyFileUploadFinalizeInputSchema>;

export const companyFileMutationInputSchema = z.strictObject({
  file_id: idSchema,
  expected_revision: z.number().int().positive(),
  folder_id: idSchema.nullable().optional(),
  name: nameSchema.optional(),
  idempotency_key: idempotencyKeySchema,
});
export type CompanyFileMutationInput = z.infer<typeof companyFileMutationInputSchema>;

export const companyFileDeleteResultSchema = z.strictObject({
  deleted: z.literal(true),
  file_id: idSchema,
});
export type CompanyFileDeleteResult = z.infer<typeof companyFileDeleteResultSchema>;

export const companyFileDownloadInputSchema = z.strictObject({
  file_id: idSchema,
  version_id: idSchema.optional(),
  disposition: z.enum(["attachment", "inline"]).default("attachment"),
});
export type CompanyFileDownloadInput = z.infer<typeof companyFileDownloadInputSchema>;

export const companyFileDownloadResultSchema = z.strictObject({
  file: companyFileSchema,
  version: companyFileVersionSchema,
  download_url: z.string().url(),
  expires_at_ms: z.number().int().nonnegative(),
});
export type CompanyFileDownloadResult = z.infer<typeof companyFileDownloadResultSchema>;

export const companyFileShareSchema = z.strictObject({
  share_id: idSchema,
  file_id: idSchema,
  share_token: z.string().trim().min(1).max(512),
  created_at_ms: z.number().int().nonnegative(),
  expires_at_ms: z.number().int().nonnegative().nullable(),
  revoked_at_ms: z.number().int().nonnegative().nullable(),
});
export type CompanyFileShare = z.infer<typeof companyFileShareSchema>;

export const companyFileShareCreateInputSchema = z.strictObject({
  file_id: idSchema,
  expires_at_ms: z.number().int().nonnegative().nullable(),
});
export type CompanyFileShareCreateInput = z.infer<typeof companyFileShareCreateInputSchema>;

export const companyFileShareListInputSchema = z.strictObject({
  file_id: idSchema,
});
export type CompanyFileShareListInput = z.infer<typeof companyFileShareListInputSchema>;

export const companyFileShareListResultSchema = z.strictObject({
  items: z.array(companyFileShareSchema),
});
export type CompanyFileShareListResult = z.infer<typeof companyFileShareListResultSchema>;

export const companyFileShareRevokeInputSchema = z.strictObject({
  share_id: idSchema,
});
export type CompanyFileShareRevokeInput = z.infer<typeof companyFileShareRevokeInputSchema>;

export const companyFileShareRevokeResultSchema = z.strictObject({
  revoked: z.literal(true),
  share_id: idSchema,
  revoked_at_ms: z.number().int().nonnegative(),
});
export type CompanyFileShareRevokeResult = z.infer<typeof companyFileShareRevokeResultSchema>;

export const companyFileShareResolveInputSchema = z.strictObject({
  share_token: z.string().trim().min(1).max(512),
});
export type CompanyFileShareResolveInput = z.infer<typeof companyFileShareResolveInputSchema>;

export const companyFileShareResolveResultSchema = z.strictObject({
  share_id: idSchema,
  name: nameSchema,
  mime_type: mimeTypeSchema,
  size_bytes: z.number().int().nonnegative().max(COMPANY_FILE_MAX_BYTES),
  updated_at_ms: z.number().int().nonnegative(),
  preview_url: z.string().url(),
  download_url: z.string().url(),
  content_expires_at_ms: z.number().int().nonnegative(),
  share_expires_at_ms: z.number().int().nonnegative().nullable(),
});
export type CompanyFileShareResolveResult = z.infer<typeof companyFileShareResolveResultSchema>;
