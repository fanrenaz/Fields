import { z } from "zod";

import {
  mailMailboxListResultSchema,
  mailAttachmentReadInputSchema,
  mailConnectionConfigurationSchema,
  mailMessageListInputSchema,
  mailMessageReadInputSchema,
  mailMessageSearchInputSchema,
  mailMessageUpdateInputSchema,
  mailMessageUpdateOperationSchema,
  mailSendInputSchema,
  mailSendRequestSchema,
  mailCapabilitiesSchema,
  mailboxSchema,
  mailFolderSchema,
} from "../public/mail.js";
import { companyRuntimeIdentitySchema } from "./company-runtime.js";

const opaqueIdSchema = z.string().trim().min(1).max(200);

export const runtimeMailboxAuthoritySchema = z.strictObject({
  company_id: opaqueIdSchema,
  requested_by_actor_id: opaqueIdSchema,
  mailbox_id: opaqueIdSchema,
  access: z.enum(["personal", "shared_grant", "company_owner"]),
});
export type RuntimeMailboxAuthority = z.infer<typeof runtimeMailboxAuthoritySchema>;

export const runtimeMailboxConnectInputSchema = z.strictObject({
  authority: runtimeMailboxAuthoritySchema,
  operation_id: opaqueIdSchema,
  expected_credential_version: z.number().int().nonnegative(),
  credential_version: z.number().int().positive(),
  configuration: mailConnectionConfigurationSchema,
}).refine(
  (input) => input.credential_version === input.expected_credential_version + 1,
  { message: "Mailbox credential versions must advance exactly once." },
);
export type RuntimeMailboxConnectInput = z.infer<typeof runtimeMailboxConnectInputSchema>;

export const runtimeMailboxConnectResultSchema = z.strictObject({
  ok: z.literal(true),
  connection_state: z.enum(["connected", "limited"]),
  capabilities: mailCapabilitiesSchema,
});
export type RuntimeMailboxConnectResult = z.infer<typeof runtimeMailboxConnectResultSchema>;

export const runtimeMailboxConnectionOperationInputSchema = z.strictObject({
  authority: runtimeMailboxAuthoritySchema,
  operation_id: opaqueIdSchema,
  credential_version: z.number().int().positive(),
});
export type RuntimeMailboxConnectionOperationInput = z.infer<
  typeof runtimeMailboxConnectionOperationInputSchema
>;

export const runtimeMailboxDisconnectInputSchema = z.strictObject({
  authority: runtimeMailboxAuthoritySchema,
  remove_index: z.boolean().default(true),
});
export type RuntimeMailboxDisconnectInput = z.infer<typeof runtimeMailboxDisconnectInputSchema>;

export const runtimeMailboxFoldersInputSchema = z.strictObject({
  authority: runtimeMailboxAuthoritySchema,
});

export const runtimeMailboxMessageListInputSchema = z.strictObject({
  authority: runtimeMailboxAuthoritySchema,
  request: mailMessageListInputSchema.omit({ mailbox_id: true }),
});

export const runtimeMailboxMessageSearchInputSchema = z.strictObject({
  authorities: z.array(runtimeMailboxAuthoritySchema).min(1).max(100),
  request: mailMessageSearchInputSchema.omit({ mailbox_ids: true }),
});

export const runtimeMailboxMessageReadInputSchema = z.strictObject({
  authority: runtimeMailboxAuthoritySchema,
  request: mailMessageReadInputSchema.omit({ mailbox_id: true }),
});

export const runtimeMailboxSendInputSchema = z.strictObject({
  authority: runtimeMailboxAuthoritySchema,
  request: mailSendRequestSchema,
});

export const mailMcpWorkspaceAttachmentSchema = z.strictObject({
  workspace_relative_path: z.string().trim().min(1).max(4_096),
  filename: z.string().trim().min(1).max(1_024).optional(),
  content_type: z.string().trim().min(1).max(255).optional(),
});

/** Model-facing send input: attachment bytes can only come from its workspace. */
export const mailMcpSendInputSchema = z.strictObject({
  mailbox_id: mailSendInputSchema.shape.mailbox_id,
  idempotency_key: mailSendInputSchema.shape.idempotency_key,
  recipients: mailSendInputSchema.shape.recipients,
  subject: mailSendInputSchema.shape.subject,
  text_body: mailSendInputSchema.shape.text_body,
  html_body: mailSendInputSchema.shape.html_body,
  in_reply_to: mailSendInputSchema.shape.in_reply_to,
  references: mailSendInputSchema.shape.references,
  attachments: z.array(mailMcpWorkspaceAttachmentSchema).max(100).default([]),
});
export type MailMcpSendInput = z.infer<typeof mailMcpSendInputSchema>;

export const runtimeMailboxWorkspaceSendInputSchema = z.strictObject({
  authority: runtimeMailboxAuthoritySchema,
  member_id: opaqueIdSchema,
  request: mailMcpSendInputSchema.omit({ mailbox_id: true }),
});

export const runtimeMailboxMessageUpdateInputSchema = z.strictObject({
  authority: runtimeMailboxAuthoritySchema,
  request: mailMessageUpdateOperationSchema,
  operation_id: opaqueIdSchema.optional(),
});

export const runtimeMailboxAttachmentReadInputSchema = z.strictObject({
  authority: runtimeMailboxAuthoritySchema,
  request: mailAttachmentReadInputSchema.omit({ mailbox_id: true }),
});

export const runtimeMailboxAttachmentSaveInputSchema = z.strictObject({
  authority: runtimeMailboxAuthoritySchema,
  request: mailAttachmentReadInputSchema.omit({ mailbox_id: true }),
  member_id: opaqueIdSchema,
  workspace_relative_path: z.string().trim().min(1).max(4_096),
  operation_id: opaqueIdSchema.optional(),
});

export const mailMcpUpdateInputSchema = mailMessageUpdateInputSchema;
export type MailMcpUpdateInput = z.infer<typeof mailMcpUpdateInputSchema>;

export const mailMcpSaveAttachmentInputSchema = mailAttachmentReadInputSchema.extend({
  workspace_relative_path: z.string().trim().min(1).max(4_096),
  idempotency_key: opaqueIdSchema,
});
export type MailMcpSaveAttachmentInput = z.infer<typeof mailMcpSaveAttachmentInputSchema>;

export const runtimeMailboxAttachmentSaveResultSchema = z.strictObject({
  mailbox_id: opaqueIdSchema,
  message_id: mailAttachmentReadInputSchema.shape.message_id,
  attachment_id: mailAttachmentReadInputSchema.shape.attachment_id,
  workspace_relative_path: z.string().max(4_096),
  size_bytes: z.number().int().nonnegative(),
});
export type RuntimeMailboxAttachmentSaveResult = z.infer<
  typeof runtimeMailboxAttachmentSaveResultSchema
>;

export const runtimeMailboxOperationAckSchema = z.strictObject({
  ok: z.literal(true),
});

export const runtimeMailboxAuditInputSchema = z.strictObject({
  identity: companyRuntimeIdentitySchema,
  member_id: opaqueIdSchema,
  operation_id: opaqueIdSchema,
  mailbox_id: opaqueIdSchema,
  operation: z.enum([
    "send",
    "mark_read",
    "mark_unread",
    "move",
    "trash",
    "save_attachment",
  ]),
  item_count: z.number().int().nonnegative(),
  size_bytes: z.number().int().nonnegative(),
  outcome: z.string().trim().min(1).max(80),
});
export type RuntimeMailboxAuditInput = z.infer<typeof runtimeMailboxAuditInputSchema>;

/**
 * Runtime callback used by the member-bound Mail MCP. Backend resolves the
 * current Member's mailbox ACL; the model never supplies an actor identity.
 */
export const runtimeMemberMailboxListInputSchema = z.strictObject({
  identity: companyRuntimeIdentitySchema,
  member_id: opaqueIdSchema,
});

export const runtimeMemberMailboxListResultSchema = mailMailboxListResultSchema;

/** MCP discovery projection: the fixed seven tools have no separate folder-list tool. */
export const mailMcpMailboxListResultSchema = z.strictObject({
  items: z.array(z.strictObject({
    mailbox: mailboxSchema,
    folders: z.array(mailFolderSchema),
    folders_partial: z.boolean(),
  })),
});
export type MailMcpMailboxListResult = z.infer<typeof mailMcpMailboxListResultSchema>;
