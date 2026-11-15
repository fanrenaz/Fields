import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  mailAttachmentReadInputSchema,
  mailConnectionConfigurationSchema,
  mailFolderListResultSchema,
  mailMessageListInputSchema,
  mailMessagePageSchema,
  mailMessageReadInputSchema,
  mailMessageSchema,
  mailMessageSearchInputSchema,
  mailMessageUpdateRequestSchema,
  mailSendRequestSchema,
  mailboxSchema,
} from "../dist/public/mail.js";
import {
  mailMcpMailboxListResultSchema,
  mailMcpSaveAttachmentInputSchema,
  mailMcpSendInputSchema,
  mailMcpUpdateInputSchema,
  runtimeMailboxConnectInputSchema,
  runtimeMailboxConnectResultSchema,
} from "../dist/internal/mail.js";

const configuration = {
  preset: "google",
  email_address: "agent@example.test",
  username: "agent@example.test",
  application_password: "secret-app-password",
  display_name: "Agent",
};

const mailbox = {
  mailbox_id: "mailbox-one",
  kind: "personal",
  target_actor_id: "agent-one",
  display_name: "Agent",
  email_address: "agent@example.test",
  connection_state: "connected",
  capabilities: {
    folders: true,
    search: true,
    flags: true,
    move: true,
    trash: true,
    append_sent: true,
  },
  last_checked_at_ms: 1,
  last_error_code: null,
  access: "personal",
};

const folder = {
  folder_id: "folder-one",
  mailbox_id: "mailbox-one",
  name: "Inbox",
  path: "INBOX",
  role: "inbox",
  selectable: true,
  total_count: 1,
  unread_count: 0,
  uid_validity: "7",
};

test("mail credentials exist only on strict request inputs", () => {
  assert.equal(mailConnectionConfigurationSchema.parse(configuration).application_password,
    "secret-app-password");
  assert.equal(mailboxSchema.safeParse({ ...mailbox, application_password: "leak" }).success, false);
  assert.equal(runtimeMailboxConnectResultSchema.safeParse({
    ok: true,
    connection_state: "connected",
    capabilities: mailbox.capabilities,
    configuration,
  }).success, false);
  assert.equal(runtimeMailboxConnectInputSchema.safeParse({
    authority: {
      company_id: "company-one",
      requested_by_actor_id: "agent-one",
      mailbox_id: "mailbox-one",
      access: "personal",
    },
    operation_id: "connect-one",
    expected_credential_version: 0,
    credential_version: 1,
    configuration,
  }).success, true);
});

test("the fixed seven Mail MCP operations have strict provider-neutral schemas", () => {
  assert.deepEqual(mailMcpMailboxListResultSchema.parse({
    items: [{ mailbox, folders: [folder], folders_partial: false }],
  }).items[0].folders[0], folder);
  assert.equal(mailMessageListInputSchema.safeParse({
    mailbox_id: "mailbox-one",
    folder_id: "folder-one",
    limit: 50,
  }).success, true);
  assert.equal(mailMessageSearchInputSchema.safeParse({
    search_term: "invoice",
    limit: 50,
    include_remote_history: true,
  }).success, true);
  assert.equal(mailMessageReadInputSchema.safeParse({
    mailbox_id: "mailbox-one",
    folder_id: "folder-one",
    message_id: "message-one",
  }).success, true);
  assert.equal(mailMcpSendInputSchema.safeParse({
    mailbox_id: "mailbox-one",
    idempotency_key: "send-one",
    recipients: { to: ["recipient@example.test"], cc: [], bcc: [] },
    subject: "Subject",
    references: [],
    attachments: [],
  }).success, true);
  assert.equal(mailMcpUpdateInputSchema.safeParse({
    mailbox_id: "mailbox-one",
    folder_id: "folder-one",
    message_id: "message-one",
    operation: "trash",
    idempotency_key: "trash-one",
  }).success, true);
  assert.equal(mailMcpSaveAttachmentInputSchema.safeParse({
    mailbox_id: "mailbox-one",
    folder_id: "folder-one",
    message_id: "message-one",
    attachment_id: "attachment-one",
    workspace_relative_path: "downloads/attachment.bin",
    idempotency_key: "save-one",
  }).success, true);
});

test("message and folder outputs expose threading metadata without bodies in pages", () => {
  assert.equal(mailFolderListResultSchema.safeParse({ items: [folder] }).success, true);
  const summary = {
    message_id: "message-one",
    mailbox_id: "mailbox-one",
    folder_id: "folder-one",
    internet_message_id: "<message-one@example.test>",
    thread_id: "thread-one",
    subject: "Subject",
    from: [{ name: null, address: "sender@example.test" }],
    to: [{ name: null, address: "agent@example.test" }],
    cc: [],
    sent_at_ms: 1,
    received_at_ms: 2,
    flags: [],
    size_bytes: 10,
    attachments: [],
    indexed_at_ms: 3,
  };
  assert.equal(mailMessagePageSchema.safeParse({
    items: [{ ...summary, text_body: "must not appear" }],
    next_cursor: null,
    coverage: {
      indexed_from_ms: 1,
      includes_remote_results: true,
      partial: false,
      failed_mailbox_ids: [],
    },
  }).success, false);
  assert.equal(mailMessageSchema.safeParse({
    ...summary,
    in_reply_to: "<parent@example.test>",
    references: ["<root@example.test>", "<parent@example.test>"],
    text_body: "body",
    html_body: null,
    remote_images_blocked: false,
  }).success, true);
  assert.equal(mailAttachmentReadInputSchema.safeParse({
    mailbox_id: "mailbox-one",
    folder_id: "folder-one",
    message_id: "message-one",
    attachment_id: "attachment-one",
  }).success, true);
});

test("Mail mutation contracts enforce recipient and move boundaries", () => {
  const send = {
    idempotency_key: "send-one",
    recipients: { to: [], cc: [], bcc: [] },
    subject: "Subject",
    references: [],
    attachments: [],
  };
  assert.equal(mailSendRequestSchema.safeParse({
    ...send,
    recipients: {
      to: addresses(34, "to"),
      cc: addresses(33, "cc"),
      bcc: addresses(33, "bcc"),
    },
  }).success, true);
  assert.equal(mailSendRequestSchema.safeParse(send).success, false);
  assert.equal(mailSendRequestSchema.safeParse({
    ...send,
    recipients: { to: addresses(101, "recipient"), cc: [], bcc: [] },
  }).success, false);

  const update = {
    folder_id: "folder-one",
    message_id: "message-one",
    idempotency_key: "update-one",
  };
  assert.equal(mailMessageUpdateRequestSchema.safeParse({
    ...update,
    operation: "move",
    destination_folder_id: "folder-two",
  }).success, true);
  assert.equal(mailMessageUpdateRequestSchema.safeParse({
    ...update,
    operation: "move",
  }).success, false);
  assert.equal(mailMessageUpdateRequestSchema.safeParse({
    ...update,
    operation: "trash",
    destination_folder_id: "folder-two",
  }).success, false);
});

test("reversibly encoded folder, message, and cursor IDs preserve maximum paths", () => {
  const folderId = `mail_folder_${"a".repeat(16_384)}`;
  const messageId = `mail_message_${"b".repeat(21_892)}`;
  const cursor = `mail_cursor_${"c".repeat(21_892)}`;
  assert.equal(mailFolderListResultSchema.safeParse({
    items: [{
      ...folder,
      folder_id: folderId,
      path: "界".repeat(4_096),
    }],
  }).success, true);
  assert.equal(mailMessageReadInputSchema.safeParse({
    mailbox_id: "mailbox-one",
    folder_id: folderId,
    message_id: messageId,
  }).success, true);
  assert.equal(mailMessageListInputSchema.safeParse({
    mailbox_id: "mailbox-one",
    folder_id: folderId,
    cursor,
    limit: 50,
  }).success, true);
  assert.equal(mailMessageReadInputSchema.safeParse({
    mailbox_id: "mailbox-one",
    folder_id: `mail_folder_${"a".repeat(16_500)}`,
    message_id: messageId,
  }).success, false);
  assert.equal(mailMessageListInputSchema.safeParse({
    mailbox_id: "mailbox-one",
    folder_id: folderId,
    cursor: `mail_cursor_${"c".repeat(22_100)}`,
    limit: 50,
  }).success, false);
});

test("mail public and internal package subpaths are exported", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(manifest.exports["./public/mail"]);
  assert.ok(manifest.exports["./internal/mail"]);
  assert.ok(manifest.exports["./internal/router/backend-runtime"]);
  assert.ok(manifest.exports["./internal/router/company-runtime"]);
});

function addresses(count, prefix) {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index}@example.test`);
}
