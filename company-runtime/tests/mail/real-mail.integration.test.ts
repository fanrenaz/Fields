import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  mailConnectionConfigurationSchema,
  type MailMessageSummary,
} from "@fields/contracts/public/mail";
import { z } from "zod";

import { CompanyMailService } from "../../src/application/mail/service.js";

const optIn = process.env.FIELDS_REAL_MAIL_INTEGRATION_TEST === "1";
const rawConfiguration = process.env.FIELDS_REAL_MAIL_CONFIGURATION_JSON?.trim() ?? "";
const rawUnknownConfiguration =
  process.env.FIELDS_REAL_MAIL_SMTP_UNKNOWN_CONFIGURATION_JSON?.trim() ?? "";
const faultControlUrl = process.env.FIELDS_REAL_MAIL_FAULT_CONTROL_URL?.trim() ?? "";
const faultControlTokenFile =
  process.env.FIELDS_REAL_MAIL_FAULT_CONTROL_TOKEN_FILE?.trim() ?? "";
const IMAP_DISCONNECT_SCENARIO = "imap_drop_next_authenticated_operation";
const SMTP_UNKNOWN_SCENARIO = "smtp_accept_data_then_drop_response";
const SMTP_UNKNOWN_SUBJECT_PREFIX = "Fields unknown ";
const faultControlResponseSchema = z.strictObject({
  version: z.literal(1),
  armed: z.literal(true),
  scenario: z.enum([
    IMAP_DISCONNECT_SCENARIO,
    SMTP_UNKNOWN_SCENARIO,
  ]),
});
if (optIn && !rawConfiguration) {
  throw new Error("FIELDS_REAL_MAIL_CONFIGURATION_JSON is required from conn-test");
}
if (optIn && (!faultControlUrl || !faultControlTokenFile)) {
  throw new Error(
    "FIELDS_REAL_MAIL_FAULT_CONTROL_URL and "
      + "FIELDS_REAL_MAIL_FAULT_CONTROL_TOKEN_FILE are required from conn-test",
  );
}
if (optIn) validateFaultControlUrl(faultControlUrl);
if (optIn && !rawUnknownConfiguration) {
  throw new Error(
    "FIELDS_REAL_MAIL_SMTP_UNKNOWN_CONFIGURATION_JSON is required from conn-test",
  );
}
const skipReason = !optIn
  ? "set FIELDS_REAL_MAIL_INTEGRATION_TEST=1 to run the conn-test IMAP/SMTP integration"
  : false;
const unknownSkipReason = !optIn
  ? "set FIELDS_REAL_MAIL_INTEGRATION_TEST=1 to run the conn-test SMTP fault integration"
  : false;

test("real mail covers receive, send, reply, attachment, flags, move, Trash, and reconnect", {
  skip: skipReason,
  timeout: 240_000,
}, async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-real-mail-"));
  const service = new CompanyMailService(workdir);
  const authority = {
    company_id: "company-real-mail",
    requested_by_actor_id: "member-real-mail",
    mailbox_id: "mailbox-real-mail",
    access: "personal" as const,
  };
  const configuration = mailConnectionConfigurationSchema.parse(JSON.parse(rawConfiguration));
  const subject = `Fields integration ${Date.now()}-${crypto.randomUUID()}`;
  try {
    const connected = await service.connect({
      authority,
      operation_id: "real-connect-1",
      expected_credential_version: 0,
      credential_version: 1,
      configuration,
    });
    assert.ok(connected.connection_state === "connected" || connected.connection_state === "limited");
    await service.finalizeConnection({
      authority,
      operation_id: "real-connect-1",
      credential_version: 1,
    });
    await armMailFault(IMAP_DISCONNECT_SCENARIO);
    assert.deepEqual(await service.refreshIndexesNow(), {
      refreshed_mailbox_ids: [],
      failed_mailbox_ids: [authority.mailbox_id],
    });
    assert.deepEqual(await service.refreshIndexesNow(), {
      refreshed_mailbox_ids: [authority.mailbox_id],
      failed_mailbox_ids: [],
    });

    const folders = await service.listFolders({ authority });
    const inbox = requiredFolder(folders.items, "inbox");
    const trash = requiredFolder(folders.items, "trash");
    const sent = requiredFolder(folders.items, "sent");
    const moveTarget = folders.items.find((folder) => (
      folder.selectable
      && !["inbox", "sent", "trash", "junk"].includes(folder.role)
    ));
    assert.ok(
      moveTarget,
      "conn-test mailbox must expose a selectable ordinary folder for move coverage",
    );

    const sentResult = await service.sendMessage({
      authority,
      request: {
        idempotency_key: "real-send-1",
        recipients: { to: [configuration.email_address], cc: [], bcc: [] },
        subject,
        text_body: "Real mail integration body",
        references: [],
        attachments: [{
          filename: "integration.txt",
          content_type: "text/plain",
          content_base64: Buffer.from("real attachment").toString("base64"),
        }],
      },
    });
    assert.equal(sentResult.outcome, "sent");

    const received = await pollMessage(service, authority, inbox.folder_id, subject);
    const full = await service.readMessage({
      authority,
      request: {
        folder_id: inbox.folder_id,
        message_id: received.message_id,
      },
    });
    assert.equal(full.text_body?.includes("Real mail integration body"), true);
    assert.equal(full.attachments.length, 1);
    const attachment = await service.readAttachment({
      authority,
      request: {
        folder_id: inbox.folder_id,
        message_id: received.message_id,
        attachment_id: full.attachments[0]!.attachment_id,
      },
    });
    assert.equal(Buffer.from(attachment.content_base64, "base64").toString(), "real attachment");

    await service.updateMessage({
      authority,
      operation_id: "real-unread-1",
      request: {
        folder_id: inbox.folder_id,
        message_id: received.message_id,
        operation: "mark_unread",
      },
    });
    const unread = await service.readMessage({
      authority,
      request: {
        folder_id: inbox.folder_id,
        message_id: received.message_id,
      },
    });
    assert.equal(
      unread.flags.some((flag) => flag.toLowerCase() === "\\seen"),
      false,
      "mark_unread must remove the remote \\Seen flag",
    );
    await service.updateMessage({
      authority,
      operation_id: "real-read-1",
      request: {
        folder_id: inbox.folder_id,
        message_id: received.message_id,
        operation: "mark_read",
      },
    });
    const read = await service.readMessage({
      authority,
      request: {
        folder_id: inbox.folder_id,
        message_id: received.message_id,
      },
    });
    assert.equal(
      read.flags.some((flag) => flag.toLowerCase() === "\\seen"),
      true,
      "mark_read must add the remote \\Seen flag",
    );

    const reply = await service.sendMessage({
      authority,
      request: {
        idempotency_key: "real-reply-1",
        recipients: { to: [configuration.email_address], cc: [], bcc: [] },
        subject: `Re: ${subject}`,
        text_body: "Real reply body",
        in_reply_to: full.internet_message_id ?? undefined,
        references: [
          ...full.references,
          ...(full.internet_message_id ? [full.internet_message_id] : []),
        ],
        attachments: [],
      },
    });
    assert.equal(reply.outcome, "sent");
    await pollMessage(service, authority, sent.folder_id, `Re: ${subject}`);

    await service.updateMessage({
      authority,
      operation_id: "real-move-1",
      request: {
        folder_id: inbox.folder_id,
        message_id: received.message_id,
        operation: "move",
        destination_folder_id: moveTarget.folder_id,
      },
    });
    const moved = await pollMessage(
      service,
      authority,
      moveTarget.folder_id,
      subject,
    );
    const movedFull = await service.readMessage({
      authority,
      request: {
        folder_id: moveTarget.folder_id,
        message_id: moved.message_id,
      },
    });
    assert.equal(movedFull.folder_id, moveTarget.folder_id);

    await service.updateMessage({
      authority,
      operation_id: "real-trash-1",
      request: {
        folder_id: moveTarget.folder_id,
        message_id: moved.message_id,
        operation: "trash",
      },
    });
    await pollMessage(service, authority, trash.folder_id, subject);

    await service.disconnect({ authority, remove_index: true });
    const reconnected = await service.connect({
      authority,
      operation_id: "real-connect-2",
      expected_credential_version: 1,
      credential_version: 2,
      configuration,
    });
    assert.ok(reconnected.connection_state === "connected" || reconnected.connection_state === "limited");
    const recoveredFolders = await service.listFolders({ authority });
    assert.ok(recoveredFolders.items.some((folder) => folder.role === "inbox"));
  } finally {
    await service.disconnect({ authority, remove_index: true }).catch(() => undefined);
    await rm(workdir, { recursive: true, force: true });
  }
});

test("real mail reports unknown when conn-test drops the SMTP result after acceptance", {
  skip: unknownSkipReason,
  timeout: 180_000,
}, async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-real-mail-unknown-"));
  const service = new CompanyMailService(workdir);
  const authority = {
    company_id: "company-real-mail",
    requested_by_actor_id: "member-real-mail",
    mailbox_id: "mailbox-real-mail-unknown",
    access: "personal" as const,
  };
  const configuration = mailConnectionConfigurationSchema.parse(
    JSON.parse(rawUnknownConfiguration),
  );
  assert.equal(
    configuration.preset,
    "custom",
    "conn-test SMTP unknown configuration must use the controlled custom endpoint",
  );
  try {
    await service.connect({
      authority,
      operation_id: "real-unknown-connect",
      expected_credential_version: 0,
      credential_version: 1,
      configuration,
    });
    await service.finalizeConnection({
      authority,
      operation_id: "real-unknown-connect",
      credential_version: 1,
    });
    await armMailFault(SMTP_UNKNOWN_SCENARIO, {
      kind: "subject_prefix",
      value: SMTP_UNKNOWN_SUBJECT_PREFIX,
    });
    const result = await service.sendMessage({
      authority,
      request: {
        idempotency_key: "real-unknown-send",
        recipients: { to: [configuration.email_address], cc: [], bcc: [] },
        subject: `${SMTP_UNKNOWN_SUBJECT_PREFIX}${Date.now()}`,
        text_body: "conn-test must accept DATA and then drop the result",
        references: [],
        attachments: [],
      },
    });
    assert.equal(result.outcome, "unknown");
  } finally {
    await service.disconnect({ authority, remove_index: true }).catch(() => undefined);
    await rm(workdir, { recursive: true, force: true });
  }
});

async function armMailFault(
  scenario: typeof IMAP_DISCONNECT_SCENARIO | typeof SMTP_UNKNOWN_SCENARIO,
  matcher?: {
    kind: "subject_prefix" | "body_contains";
    value: string;
  },
): Promise<void> {
  const token = (await readFile(faultControlTokenFile, "utf8")).trim();
  if (!token || /[\r\n]/u.test(token)) {
    throw new Error("conn-test Mail fault-control token file is empty or invalid");
  }
  const response = await fetch(faultControlUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      version: 1,
      scenario,
      ...(matcher ? { matcher } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`conn-test Mail fault control returned HTTP ${response.status}`);
  }
  faultControlResponseSchema.parse(await response.json());
}

function validateFaultControlUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("FIELDS_REAL_MAIL_FAULT_CONTROL_URL must be a valid URL");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol)
    || !parsed.hostname
    || parsed.username
    || parsed.password
    || parsed.hash
  ) {
    throw new Error("FIELDS_REAL_MAIL_FAULT_CONTROL_URL must be an HTTP(S) control URL");
  }
}

function requiredFolder(
  folders: Array<{ folder_id: string; role: string }>,
  role: string,
): { folder_id: string; role: string } {
  const folder = folders.find((item) => item.role === role);
  assert.ok(folder, `conn-test mailbox must expose ${role}`);
  return folder;
}

async function pollMessage(
  service: CompanyMailService,
  authority: {
    company_id: string;
    requested_by_actor_id: string;
    mailbox_id: string;
    access: "personal";
  },
  folderId: string,
  subject: string,
): Promise<MailMessageSummary> {
  const deadline = Date.now() + 60_000;
  do {
    const page = await service.listMessages({
      authority,
      request: { folder_id: folderId, limit: 100 },
    });
    const message = page.items.find((item) => item.subject === subject);
    if (message) return message;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  } while (Date.now() < deadline);
  throw new Error(`conn-test did not expose message ${subject}`);
}
