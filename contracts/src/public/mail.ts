import { z } from "zod";

const opaqueIdSchema = z.string().trim().min(1).max(200);
// Runtime folder IDs reversibly encode the contract's 4,096-character IMAP
// path, and message IDs/cursors then encode that folder ID once more. Keep
// ordinary product identifiers narrow while allowing every valid folder path
// to round-trip through the provider-neutral contract.
const mailFolderIdSchema = z.string().trim().min(1).max(16_500);
const mailMessageIdSchema = z.string().trim().min(1).max(22_100);
const mailMessageCursorSchema = z.string().max(22_100);
const emailAddressSchema = z.string().trim().email().max(320);
const optionalDisplayNameSchema = z.string().trim().min(1).max(200).nullable();
const pageLimitSchema = z.number().int().min(1).max(200).default(50);

export const mailProviderPresetSchema = z.enum([
  "google",
  "microsoft",
  "aliyun",
  "tencent",
  "netease",
  "qq",
  "custom",
]);
export type MailProviderPreset = z.infer<typeof mailProviderPresetSchema>;

export const mailTlsModeSchema = z.enum(["implicit_tls", "starttls"]);
export type MailTlsMode = z.infer<typeof mailTlsModeSchema>;

export const mailServerEndpointSchema = z.strictObject({
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65_535),
  tls_mode: mailTlsModeSchema,
});
export type MailServerEndpoint = z.infer<typeof mailServerEndpointSchema>;

/**
 * The only browser-safe contract that may contain an application password.
 * It is request-only: no result schema references this type.
 */
export const mailConnectionConfigurationSchema = z.strictObject({
  preset: mailProviderPresetSchema,
  email_address: emailAddressSchema,
  username: z.string().min(1).max(1_024),
  application_password: z.string().min(1).max(4_096),
  display_name: optionalDisplayNameSchema.default(null),
  imap: mailServerEndpointSchema.optional(),
  smtp: mailServerEndpointSchema.optional(),
}).superRefine((value, context) => {
  if (value.preset === "custom" && (!value.imap || !value.smtp)) {
    context.addIssue({
      code: "custom",
      message: "Custom mail connections require both IMAP and SMTP endpoints.",
    });
  }
  if (value.preset !== "custom" && (value.imap || value.smtp)) {
    context.addIssue({
      code: "custom",
      message: "Provider presets do not accept custom server endpoints.",
    });
  }
});
export type MailConnectionConfiguration = z.infer<typeof mailConnectionConfigurationSchema>;

export const mailCapabilitiesSchema = z.strictObject({
  folders: z.boolean(),
  search: z.boolean(),
  flags: z.boolean(),
  move: z.boolean(),
  trash: z.boolean(),
  append_sent: z.boolean(),
});
export type MailCapabilities = z.infer<typeof mailCapabilitiesSchema>;

export const mailboxSchema = z.strictObject({
  mailbox_id: opaqueIdSchema,
  kind: z.enum(["personal", "shared"]),
  target_actor_id: opaqueIdSchema.nullable(),
  display_name: optionalDisplayNameSchema,
  email_address: emailAddressSchema.nullable(),
  connection_state: z.enum([
    "unconnected",
    "validating",
    "connected",
    "limited",
    "error",
  ]),
  capabilities: mailCapabilitiesSchema,
  last_checked_at_ms: z.number().int().nonnegative().nullable(),
  last_error_code: z.string().trim().min(1).max(120).nullable(),
  access: z.enum(["personal", "shared_grant", "company_owner"]),
});
export type Mailbox = z.infer<typeof mailboxSchema>;

export const mailMailboxListResultSchema = z.strictObject({
  items: z.array(mailboxSchema),
});
export type MailMailboxListResult = z.infer<typeof mailMailboxListResultSchema>;

export const mailMailboxReadInputSchema = z.strictObject({
  mailbox_id: opaqueIdSchema,
});
export type MailMailboxReadInput = z.infer<typeof mailMailboxReadInputSchema>;

export const mailPersonalConnectInputSchema = z.strictObject({
  target_actor_id: opaqueIdSchema.optional(),
  configuration: mailConnectionConfigurationSchema,
  idempotency_key: opaqueIdSchema,
});
export type MailPersonalConnectInput = z.infer<typeof mailPersonalConnectInputSchema>;

export const mailSharedConnectInputSchema = z.strictObject({
  mailbox_id: opaqueIdSchema.optional(),
  name: z.string().trim().min(1).max(200),
  configuration: mailConnectionConfigurationSchema,
  idempotency_key: opaqueIdSchema,
});
export type MailSharedConnectInput = z.infer<typeof mailSharedConnectInputSchema>;

export const mailMailboxMutationResultSchema = z.strictObject({
  mailbox: mailboxSchema,
});
export type MailMailboxMutationResult = z.infer<typeof mailMailboxMutationResultSchema>;

export const mailMailboxDisconnectResultSchema = z.strictObject({
  mailbox_id: opaqueIdSchema,
  connection_state: z.literal("unconnected"),
});
export type MailMailboxDisconnectResult = z.infer<typeof mailMailboxDisconnectResultSchema>;

export const mailSharedMailboxDeleteResultSchema = z.strictObject({
  mailbox_id: opaqueIdSchema,
  deleted: z.literal(true),
});
export type MailSharedMailboxDeleteResult = z.infer<typeof mailSharedMailboxDeleteResultSchema>;

export const mailSharedGrantSchema = z.strictObject({
  mailbox_id: opaqueIdSchema,
  actor_id: opaqueIdSchema,
  granted_at_ms: z.number().int().nonnegative(),
  granted_by_actor_id: opaqueIdSchema,
});
export type MailSharedGrant = z.infer<typeof mailSharedGrantSchema>;

export const mailSharedGrantListInputSchema = z.strictObject({
  mailbox_id: opaqueIdSchema,
});
export const mailSharedGrantListResultSchema = z.strictObject({
  items: z.array(mailSharedGrantSchema),
});
export const mailSharedGrantSetInputSchema = z.strictObject({
  mailbox_id: opaqueIdSchema,
  actor_id: opaqueIdSchema,
});
export const mailSharedGrantMutationResultSchema = z.strictObject({
  mailbox_id: opaqueIdSchema,
  actor_id: opaqueIdSchema,
  granted: z.boolean(),
});

export const mailFolderSchema = z.strictObject({
  folder_id: mailFolderIdSchema,
  mailbox_id: opaqueIdSchema,
  name: z.string().max(1_024),
  path: z.string().max(4_096),
  role: z.enum(["inbox", "sent", "drafts", "trash", "junk", "archive", "other"]),
  selectable: z.boolean(),
  total_count: z.number().int().nonnegative().nullable(),
  unread_count: z.number().int().nonnegative().nullable(),
  uid_validity: z.string().nullable(),
});
export type MailFolder = z.infer<typeof mailFolderSchema>;

export const mailFolderListInputSchema = z.strictObject({
  mailbox_id: opaqueIdSchema,
});
export const mailFolderListResultSchema = z.strictObject({
  items: z.array(mailFolderSchema),
});
export type MailFolderListResult = z.infer<typeof mailFolderListResultSchema>;

export const mailParticipantSchema = z.strictObject({
  name: z.string().max(500).nullable(),
  address: emailAddressSchema,
});
export type MailParticipant = z.infer<typeof mailParticipantSchema>;

export const mailAttachmentSchema = z.strictObject({
  attachment_id: opaqueIdSchema,
  filename: z.string().max(1_024).nullable(),
  content_type: z.string().trim().min(1).max(255),
  size_bytes: z.number().int().nonnegative(),
  content_id: z.string().max(1_024).nullable(),
  disposition: z.enum(["attachment", "inline"]).nullable(),
});
export type MailAttachment = z.infer<typeof mailAttachmentSchema>;

export const mailMessageSummarySchema = z.strictObject({
  message_id: mailMessageIdSchema,
  mailbox_id: opaqueIdSchema,
  folder_id: mailFolderIdSchema,
  internet_message_id: z.string().max(2_048).nullable(),
  thread_id: opaqueIdSchema,
  subject: z.string().max(4_096),
  from: z.array(mailParticipantSchema),
  to: z.array(mailParticipantSchema),
  cc: z.array(mailParticipantSchema),
  sent_at_ms: z.number().int().nonnegative().nullable(),
  received_at_ms: z.number().int().nonnegative().nullable(),
  flags: z.array(z.string().max(255)),
  size_bytes: z.number().int().nonnegative(),
  attachments: z.array(mailAttachmentSchema),
  indexed_at_ms: z.number().int().nonnegative(),
});
export type MailMessageSummary = z.infer<typeof mailMessageSummarySchema>;

export const mailMessageSchema = mailMessageSummarySchema.extend({
  in_reply_to: z.string().max(2_048).nullable(),
  references: z.array(z.string().max(2_048)).max(100),
  text_body: z.string().max(10_000_000).nullable(),
  html_body: z.string().max(10_000_000).nullable(),
  remote_images_blocked: z.boolean(),
});
export type MailMessage = z.infer<typeof mailMessageSchema>;

export const mailMessagePageSchema = z.strictObject({
  items: z.array(mailMessageSummarySchema),
  next_cursor: mailMessageCursorSchema.nullable(),
  coverage: z.strictObject({
    indexed_from_ms: z.number().int().nonnegative().nullable(),
    includes_remote_results: z.boolean(),
    partial: z.boolean(),
    failed_mailbox_ids: z.array(opaqueIdSchema),
  }),
});
export type MailMessagePage = z.infer<typeof mailMessagePageSchema>;

export const mailMessageListInputSchema = z.strictObject({
  mailbox_id: opaqueIdSchema,
  folder_id: mailFolderIdSchema,
  cursor: mailMessageCursorSchema.optional(),
  limit: pageLimitSchema,
});
export type MailMessageListInput = z.infer<typeof mailMessageListInputSchema>;

export const mailMessageSearchInputSchema = z.strictObject({
  mailbox_ids: z.array(opaqueIdSchema).max(100).optional(),
  search_term: z.string().trim().min(1).max(500),
  limit: pageLimitSchema,
  include_remote_history: z.boolean().default(true),
});
export type MailMessageSearchInput = z.infer<typeof mailMessageSearchInputSchema>;

export const mailMessageReadInputSchema = z.strictObject({
  mailbox_id: opaqueIdSchema,
  folder_id: mailFolderIdSchema,
  message_id: mailMessageIdSchema,
});
export type MailMessageReadInput = z.infer<typeof mailMessageReadInputSchema>;

export const mailRecipientSetSchema = z.strictObject({
  to: z.array(emailAddressSchema).max(100),
  cc: z.array(emailAddressSchema).max(100).default([]),
  bcc: z.array(emailAddressSchema).max(100).default([]),
}).superRefine((value, context) => {
  const count = value.to.length + value.cc.length + value.bcc.length;
  if (count < 1 || count > 100) {
    context.addIssue({
      code: "custom",
      message: "A message requires from 1 to 100 total recipients.",
    });
  }
});

export const mailSendAttachmentSchema = z.strictObject({
  filename: z.string().trim().min(1).max(1_024),
  content_type: z.string().trim().min(1).max(255),
  content_base64: z.string()
    .max(36_000_000)
    .refine(
      isCanonicalBase64,
      "Attachment content must be canonical Base64.",
    ),
});

export const mailSendRequestSchema = z.strictObject({
  idempotency_key: opaqueIdSchema,
  recipients: mailRecipientSetSchema,
  subject: z.string().max(4_096),
  text_body: z.string().max(10_000_000).optional(),
  html_body: z.string().max(10_000_000).optional(),
  in_reply_to: z.string().max(2_048).optional(),
  references: z.array(z.string().max(2_048)).max(100).default([]),
  attachments: z.array(mailSendAttachmentSchema).max(100).default([]),
}).superRefine((value, context) => {
  const total = value.attachments.reduce((sum, item) => {
    const padding = item.content_base64.endsWith("==")
      ? 2
      : item.content_base64.endsWith("=")
        ? 1
        : 0;
    return sum + Math.max(0, Math.floor(item.content_base64.length * 3 / 4) - padding);
  }, 0);
  if (total > 25 * 1024 * 1024) {
    context.addIssue({ code: "custom", message: "Total attachments exceed 25 MiB." });
  }
});
export const mailSendInputSchema = mailSendRequestSchema.safeExtend({
  mailbox_id: opaqueIdSchema,
});
export type MailSendInput = z.infer<typeof mailSendInputSchema>;

export const mailSendResultSchema = z.strictObject({
  mailbox_id: opaqueIdSchema,
  idempotency_key: opaqueIdSchema,
  outcome: z.enum(["sent", "sent_copy_failed", "unknown"]),
  internet_message_id: z.string().max(2_048).nullable(),
  sent_copy_error_code: z.string().max(120).nullable(),
});
export type MailSendResult = z.infer<typeof mailSendResultSchema>;

export const mailMessageUpdateOperationSchema = z.strictObject({
  folder_id: mailFolderIdSchema,
  message_id: mailMessageIdSchema,
  operation: z.enum(["mark_read", "mark_unread", "move", "trash"]),
  destination_folder_id: mailFolderIdSchema.optional(),
}).superRefine((value, context) => {
  if (value.operation === "move" && !value.destination_folder_id) {
    context.addIssue({ code: "custom", message: "Move requires a destination folder." });
  }
  if (value.operation !== "move" && value.destination_folder_id) {
    context.addIssue({ code: "custom", message: "Only move accepts a destination folder." });
  }
});
export const mailMessageUpdateRequestSchema = mailMessageUpdateOperationSchema.safeExtend({
  idempotency_key: opaqueIdSchema,
});
export const mailMessageUpdateInputSchema = mailMessageUpdateRequestSchema.safeExtend({
  mailbox_id: opaqueIdSchema,
});
export type MailMessageUpdateInput = z.infer<typeof mailMessageUpdateInputSchema>;

export const mailMessageUpdateResultSchema = z.strictObject({
  mailbox_id: opaqueIdSchema,
  message_id: mailMessageIdSchema,
  operation: mailMessageUpdateInputSchema.shape.operation,
  applied: z.literal(true),
});
export type MailMessageUpdateResult = z.infer<typeof mailMessageUpdateResultSchema>;

export const mailAttachmentReadInputSchema = z.strictObject({
  mailbox_id: opaqueIdSchema,
  folder_id: mailFolderIdSchema,
  message_id: mailMessageIdSchema,
  attachment_id: opaqueIdSchema,
});
export type MailAttachmentReadInput = z.infer<typeof mailAttachmentReadInputSchema>;

export const mailAttachmentReadResultSchema = z.strictObject({
  filename: z.string().max(1_024).nullable(),
  content_type: z.string().max(255),
  size_bytes: z.number().int().nonnegative(),
  content_base64: z.string().max(36_000_000),
});
export type MailAttachmentReadResult = z.infer<typeof mailAttachmentReadResultSchema>;

function isCanonicalBase64(value: string): boolean {
  if (value.length % 4 !== 0) return false;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const dataLength = value.length - padding;
  for (let index = 0; index < dataLength; index += 1) {
    if (base64Value(value.charCodeAt(index)) < 0) return false;
  }
  for (let index = dataLength; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 61) return false;
  }
  if (padding === 2) {
    return dataLength % 4 === 2
      && (base64Value(value.charCodeAt(dataLength - 1)) & 0b1111) === 0;
  }
  if (padding === 1) {
    return dataLength % 4 === 3
      && (base64Value(value.charCodeAt(dataLength - 1)) & 0b11) === 0;
  }
  return dataLength % 4 === 0;
}

function base64Value(code: number): number {
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 97 + 26;
  if (code >= 48 && code <= 57) return code - 48 + 52;
  if (code === 43) return 62;
  if (code === 47) return 63;
  return -1;
}
