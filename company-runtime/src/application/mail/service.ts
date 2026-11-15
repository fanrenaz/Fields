import {
  mailAttachmentReadResultSchema,
  mailConnectionConfigurationSchema,
  mailFolderListResultSchema,
  mailMessagePageSchema,
  mailParticipantSchema,
  mailMessageSchema,
  mailMessageSummarySchema,
  mailMessageUpdateResultSchema,
  mailSendResultSchema,
  type MailAttachment,
  type MailAttachmentReadResult,
  type MailCapabilities,
  type MailFolder,
  type MailMessage,
  type MailMessagePage,
  type MailMessageSummary,
  type MailParticipant,
  type MailSendResult,
} from "@fields/contracts/public/mail";
import {
  runtimeMailboxAttachmentReadInputSchema,
  runtimeMailboxAttachmentSaveInputSchema,
  runtimeMailboxAttachmentSaveResultSchema,
  runtimeMailboxConnectionOperationInputSchema,
  runtimeMailboxConnectInputSchema,
  runtimeMailboxConnectResultSchema,
  runtimeMailboxDisconnectInputSchema,
  runtimeMailboxFoldersInputSchema,
  runtimeMailboxMessageListInputSchema,
  runtimeMailboxMessageReadInputSchema,
  runtimeMailboxMessageSearchInputSchema,
  runtimeMailboxMessageUpdateInputSchema,
  runtimeMailboxSendInputSchema,
  runtimeMailboxWorkspaceSendInputSchema,
  type RuntimeMailboxAttachmentSaveResult,
  type RuntimeMailboxAuthority,
  type RuntimeMailboxConnectInput,
  type RuntimeMailboxConnectResult,
} from "@fields/contracts/internal/mail";
import Database from "better-sqlite3";
import { ImapFlow, type FetchMessageObject, type ListResponse, type MessageAddressObject, type MessageStructureObject } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import {
  chmodSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { connect as netConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";

import { memberWorkspaceLayout, safePathComponent } from "../../infrastructure/filesystem/workspace.js";
import { recordMailIndexRefresh } from "../../observability/events.js";
import {
  isForbiddenAddress,
  pinnedLookup,
  resolveMailConnection,
  type ResolvedMailConnection,
  type ResolvedMailEndpoint,
} from "./connection-policy.js";
import { mailThreadId, normalizeMessageId, sanitizeMailHtml } from "./html.js";

const MAILBOXES_DIRECTORY = "mailboxes";
const CREDENTIALS_DIRECTORY = "credentials";
const INDEXES_DIRECTORY = "indexes";
const INDEX_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;
const INDEX_REFRESH_INTERVAL_MS = 5 * 60 * 1_000;
const MAX_INCREMENTAL_REFRESH_UIDS = 500;
const MAX_MAIL_BODY_CHARACTERS = 10_000_000;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_SYNC_UIDS_PER_FETCH = 500;
const SEND_RECEIPT_STALE_MS = 5 * 60 * 1_000;
const ADDRESS_PROBE_INTERVAL_MS = 1_000;
const ADDRESS_PROBE_ATTEMPTS = 30;

type StoredCredential = {
  credential_version: number;
  operation_id: string | null;
  connection_result: RuntimeMailboxConnectResult | null;
  configuration: ReturnType<typeof mailConnectionConfigurationSchema.parse>;
};

type ConnectionRollback = {
  operation_id: string;
  credential_version: number;
  previous: StoredCredential | null;
  result: RuntimeMailboxConnectResult;
};

type AddressProbeReceipt = {
  operation_id: string;
  credential_version: number;
  configuration_fingerprint: string;
  message_id: string;
  status: "pending" | "smtp_accepted" | "unknown" | "verified" | "rejected";
};

type IndexedMessageRow = {
  summary_json: string;
};

export type MailIndexRefreshResult = {
  refreshed_mailbox_ids: string[];
  failed_mailbox_ids: string[];
};

export type CompanyMailServiceOptions = {
  resolveConnection?: typeof resolveMailConnection;
  setInterval?: (callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>;
  clearInterval?: (handle: ReturnType<typeof setInterval>) => void;
  indexRefreshIntervalMs?: number;
  sleep?: (intervalMs: number) => Promise<void>;
  addressProbeAttempts?: number;
};

export class MailServiceError extends Error {
  constructor(
    readonly code: string,
    readonly retryable = false,
  ) {
    super(code);
    this.name = "MailServiceError";
  }
}

export function mailEndpointTransportPolicy(endpoint: ResolvedMailEndpoint) {
  const address = endpoint.addresses[0];
  if (!address || isForbiddenAddress(address.address)) {
    throw new MailServiceError("MAIL_CONNECTION_SSRF_BLOCKED", false);
  }
  return {
    servername: endpoint.host,
    connectAddress: address.address,
    family: address.family,
    lookup: pinnedLookup(endpoint),
    tls: {
      minVersion: "TLSv1.2" as const,
      rejectUnauthorized: true as const,
      servername: endpoint.host,
    },
  };
}

export class CompanyMailService {
  private readonly credentialLocks = new Map<string, Promise<void>>();
  private readonly resolveConnection: typeof resolveMailConnection;
  private readonly options: CompanyMailServiceOptions;
  private indexRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private indexRefreshFlight: Promise<MailIndexRefreshResult> | null = null;
  private closing = false;

  constructor(
    private readonly workdir: string,
    private readonly nowMs: () => number = Date.now,
    options: CompanyMailServiceOptions = {},
  ) {
    this.options = options;
    this.resolveConnection = options.resolveConnection ?? resolveMailConnection;
  }

  startBackgroundIndexing(): void {
    if (this.closing || this.indexRefreshTimer !== null) return;
    const schedule = this.options.setInterval ?? setInterval;
    this.indexRefreshTimer = schedule(() => {
      void this.refreshIndexesNow().catch(() => undefined);
    }, this.options.indexRefreshIntervalMs ?? INDEX_REFRESH_INTERVAL_MS);
    if (
      typeof this.indexRefreshTimer === "object"
      && this.indexRefreshTimer !== null
      && "unref" in this.indexRefreshTimer
      && typeof this.indexRefreshTimer.unref === "function"
    ) {
      this.indexRefreshTimer.unref();
    }
    void this.refreshIndexesNow().catch(() => undefined);
  }

  async refreshIndexesNow(): Promise<MailIndexRefreshResult> {
    if (this.closing) {
      return { refreshed_mailbox_ids: [], failed_mailbox_ids: [] };
    }
    if (this.indexRefreshFlight) return this.indexRefreshFlight;
    const startedAtMs = this.nowMs();
    const flight = this.refreshConnectedMailboxIndexes().then(
      (result) => {
        recordMailIndexRefresh({
          refreshedMailboxIds: result.refreshed_mailbox_ids,
          failedMailboxIds: result.failed_mailbox_ids,
          durationMs: this.nowMs() - startedAtMs,
        });
        return result;
      },
      (error: unknown) => {
        recordMailIndexRefresh({
          refreshedMailboxIds: [],
          failedMailboxIds: [],
          durationMs: this.nowMs() - startedAtMs,
          cycleFailed: true,
        });
        throw error;
      },
    );
    this.indexRefreshFlight = flight;
    try {
      return await flight;
    } finally {
      if (this.indexRefreshFlight === flight) this.indexRefreshFlight = null;
    }
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    if (this.indexRefreshTimer !== null) {
      (this.options.clearInterval ?? clearInterval)(this.indexRefreshTimer);
      this.indexRefreshTimer = null;
    }
    if (this.indexRefreshFlight) await this.indexRefreshFlight.catch(() => undefined);
  }

  async connect(rawInput: unknown): Promise<RuntimeMailboxConnectResult> {
    const input = runtimeMailboxConnectInputSchema.parse(rawInput);
    return this.withCredentialLock(
      input.authority.mailbox_id,
      () => this.connectLocked(input),
    );
  }

  private async connectLocked(
    input: RuntimeMailboxConnectInput,
  ): Promise<RuntimeMailboxConnectResult> {
    const beforeVerification = await this.readCredentialOrNull(input.authority.mailbox_id);
    if (
      beforeVerification?.credential_version === input.credential_version
      && beforeVerification.operation_id === input.operation_id
      && beforeVerification.connection_result
    ) {
      if (!sameConnectionConfiguration(
        beforeVerification.configuration,
        input.configuration,
      )) {
        throw new MailServiceError("MAILBOX_IDEMPOTENCY_CONFLICT", false);
      }
      return beforeVerification.connection_result;
    }
    if (
      beforeVerification
      && beforeVerification.credential_version !== input.expected_credential_version
    ) {
      throw new MailServiceError("MAIL_CREDENTIAL_VERSION_CONFLICT", true);
    }
    const resolved = await this.resolveConnection(input.configuration);
    const imap = this.imapClient(resolved);
    const smtp = this.smtpTransport(resolved);
    try {
      // Generic SMTP verification proves transport/account authentication. It
      // cannot prove arbitrary From ownership without sending a message, so
      // every send fixes both the From header and envelope sender to the
      // configured address and surfaces any provider rejection.
      await Promise.all([imap.connect(), smtp.verify()]);
      const folders = await imap.list({
        statusQuery: {
          messages: true,
          unseen: true,
          uidValidity: true,
        },
      });
      if (!folders.some((folder) => folder.path.toUpperCase() === "INBOX")) {
        throw new MailServiceError("MAIL_INBOX_UNAVAILABLE", false);
      }
      await this.verifyMailboxAddressOwnership(input, imap, smtp, folders);
      const capabilities = mailCapabilities(imap, folders);
      await this.syncRecentIndex(input.authority.mailbox_id, imap, folders);
      const result = runtimeMailboxConnectResultSchema.parse({
        ok: true,
        connection_state: Object.values(capabilities).every(Boolean)
          ? "connected"
          : "limited",
        capabilities,
      });
      const previous = await this.readCredentialOrNull(input.authority.mailbox_id);
      if (previous && previous.credential_version !== input.expected_credential_version) {
        throw new MailServiceError("MAIL_CREDENTIAL_VERSION_CONFLICT", true);
      }
      await this.persistConnectionRollback(input.authority.mailbox_id, {
        operation_id: input.operation_id,
        credential_version: input.credential_version,
        previous,
        result,
      });
      await this.persistCredential(input.authority.mailbox_id, {
        credential_version: input.credential_version,
        operation_id: input.operation_id,
        connection_result: result,
        configuration: input.configuration,
      });
      return result;
    } finally {
      smtp.close();
      if (imap.usable) {
        await imap.logout().catch(() => imap.close());
      } else {
        imap.close();
      }
    }
  }

  async finalizeConnection(rawInput: unknown): Promise<{ ok: true }> {
    const input = runtimeMailboxConnectionOperationInputSchema.parse(rawInput);
    return this.withCredentialLock(input.authority.mailbox_id, async () => {
      const current = await this.readCredentialOrNull(input.authority.mailbox_id);
      if (
        current
        && current.credential_version === input.credential_version
        && current.operation_id === input.operation_id
      ) {
        await Promise.all([
          rm(this.connectionRollbackPath(input.authority.mailbox_id), { force: true }),
          rm(this.addressProbePath(input.authority.mailbox_id), { force: true }),
        ]);
      }
      return { ok: true };
    });
  }

  async rollbackConnection(rawInput: unknown): Promise<{ ok: true }> {
    const input = runtimeMailboxConnectionOperationInputSchema.parse(rawInput);
    return this.withCredentialLock(input.authority.mailbox_id, async () => {
      const rollback = await this.readConnectionRollback(input.authority.mailbox_id);
      if (
        !rollback
        || rollback.operation_id !== input.operation_id
        || rollback.credential_version !== input.credential_version
      ) {
        return { ok: true };
      }
      const current = await this.readCredentialOrNull(input.authority.mailbox_id);
      if (
        current?.credential_version === input.credential_version
        && current.operation_id === input.operation_id
      ) {
        if (rollback.previous) {
          await this.persistCredential(input.authority.mailbox_id, rollback.previous);
        } else {
          await rm(this.credentialPath(input.authority.mailbox_id), { force: true });
        }
      }
      await rm(this.connectionRollbackPath(input.authority.mailbox_id), { force: true });
      return { ok: true };
    });
  }

  async disconnect(rawInput: unknown): Promise<{ ok: true }> {
    const input = runtimeMailboxDisconnectInputSchema.parse(rawInput);
    return this.withCredentialLock(input.authority.mailbox_id, async () => {
      await this.removeMailboxData(input.authority.mailbox_id, input.remove_index);
      return { ok: true };
    });
  }

  async listFolders(rawInput: unknown) {
    const input = runtimeMailboxFoldersInputSchema.parse(rawInput);
    return this.withImap(input.authority, async (client) => {
      const folders = await client.list({
        statusQuery: {
          messages: true,
          unseen: true,
          uidValidity: true,
        },
      });
      const result = {
        items: folders.map((folder) => projectFolder(
          input.authority.mailbox_id,
          folder,
        )),
      };
      this.writeFolderIndex(input.authority.mailbox_id, result.items);
      return mailFolderListResultSchema.parse(result);
    });
  }

  async listMessages(rawInput: unknown): Promise<MailMessagePage> {
    const input = runtimeMailboxMessageListInputSchema.parse(rawInput);
    const path = decodeFolderId(input.request.folder_id);
    return this.withImap(input.authority, async (client) => {
      const lock = await client.getMailboxLock(path);
      try {
        const uidValidity = selectedUidValidity(client);
        this.resetFolderOnUidValidityChange(
          input.authority.mailbox_id,
          input.request.folder_id,
          path,
          uidValidity,
        );
        const since = new Date(this.nowMs() - INDEX_WINDOW_MS);
        const searched = await client.search({ since }, { uid: true });
        const decodedCursor = input.request.cursor
          ? decodeMessageCursor(input.request.cursor)
          : null;
        if (decodedCursor && decodedCursor.folderId !== input.request.folder_id) {
          throw new MailServiceError("MAIL_CURSOR_INVALID", false);
        }
        if (decodedCursor && decodedCursor.uidValidity !== uidValidity) {
          throw new MailServiceError("MAIL_UIDVALIDITY_CHANGED", false);
        }
        const cursor = decodedCursor?.uid ?? Number.POSITIVE_INFINITY;
        const uids = (searched || [])
          .filter((uid) => uid < cursor)
          .sort((left, right) => right - left)
          .slice(0, input.request.limit);
        const items = await this.fetchAndIndex(
          input.authority.mailbox_id,
          input.request.folder_id,
          path,
          uidValidity,
          client,
          uids,
        );
        const oldest = uids.at(-1) ?? null;
        return mailMessagePageSchema.parse({
          items,
          next_cursor: searched && searched.some((uid) => oldest !== null && uid < oldest)
            ? encodeMessageCursor(input.request.folder_id, uidValidity, oldest!)
            : null,
          coverage: {
            indexed_from_ms: this.readIndexedFromMs(input.authority.mailbox_id),
            includes_remote_results: true,
            partial: false,
            failed_mailbox_ids: [],
          },
        });
      } finally {
        lock.release();
      }
    });
  }

  async searchMessages(rawInput: unknown): Promise<MailMessagePage> {
    const input = runtimeMailboxMessageSearchInputSchema.parse(rawInput);
    const indexed = this.searchIndexed(input.authorities, input.request.search_term);
    const seen = new Set(indexed.map(messageIdentity));
    const items = [...indexed];
    const failedMailboxIds: string[] = [];
    let includesRemoteResults = false;
    if (input.request.include_remote_history && items.length < input.request.limit) {
      for (const authority of input.authorities) {
        try {
          const remote = await this.searchRemoteMailbox(
            authority,
            input.request.search_term,
            input.request.limit - items.length,
          );
          includesRemoteResults = true;
          for (const item of remote) {
            const identity = messageIdentity(item);
            if (!seen.has(identity)) {
              seen.add(identity);
              items.push(item);
            }
          }
        } catch {
          failedMailboxIds.push(authority.mailbox_id);
        }
        if (items.length >= input.request.limit) break;
      }
    }
    items.sort((left, right) => (
      (right.received_at_ms ?? right.sent_at_ms ?? 0)
      - (left.received_at_ms ?? left.sent_at_ms ?? 0)
    ));
    return mailMessagePageSchema.parse({
      items: items.slice(0, input.request.limit),
      next_cursor: null,
      coverage: {
        indexed_from_ms: this.readCombinedIndexedFromMs(input.authorities),
        includes_remote_results: includesRemoteResults,
        partial: failedMailboxIds.length > 0,
        failed_mailbox_ids: failedMailboxIds,
      },
    });
  }

  async readMessage(rawInput: unknown): Promise<MailMessage> {
    const input = runtimeMailboxMessageReadInputSchema.parse(rawInput);
    const path = decodeFolderId(input.request.folder_id);
    const message = decodeMessageId(input.request.message_id);
    if (message.folderId !== input.request.folder_id) {
      throw new MailServiceError("MAIL_MESSAGE_ID_INVALID", false);
    }
    return this.withImap(input.authority, async (client) => {
      const lock = await client.getMailboxLock(path);
      try {
        if (selectedUidValidity(client) !== message.uidValidity) {
          throw new MailServiceError("MAIL_UIDVALIDITY_CHANGED", false);
        }
        const fetched = await client.fetchOne(message.uid, {
          source: true,
          envelope: true,
          flags: true,
          internalDate: true,
          size: true,
          bodyStructure: true,
          headers: ["message-id", "in-reply-to", "references"],
        }, { uid: true });
        if (!fetched || !fetched.source) {
          throw new MailServiceError("MAIL_MESSAGE_NOT_FOUND", false);
        }
        const parsed = await simpleParser(fetched.source, {
          skipHtmlToText: true,
          skipTextToHtml: true,
        });
        const textBody = mailBodyWithinContract(parsed.text ?? null);
        const parsedHtml = typeof parsed.html === "string"
          ? mailBodyWithinContract(parsed.html)
          : null;
        const summary = await this.projectAndIndexMessage(
          input.authority.mailbox_id,
          input.request.folder_id,
          path,
          message.uidValidity,
          fetched,
          parsed,
        );
        const sanitized = parsedHtml
          ? sanitizeMailHtml(parsedHtml)
          : { html: null, remoteImagesBlocked: false };
        return mailMessageSchema.parse({
          ...summary,
          in_reply_to: normalizeMessageId(parsed.inReplyTo),
          references: referenceList(parsed.references),
          text_body: textBody,
          html_body: mailBodyWithinContract(sanitized.html),
          remote_images_blocked: sanitized.remoteImagesBlocked,
        });
      } finally {
        lock.release();
      }
    });
  }

  async sendMessage(rawInput: unknown): Promise<MailSendResult> {
    const input = runtimeMailboxSendInputSchema.parse(rawInput);
    const credential = await this.readCredential(input.authority.mailbox_id);
    const db = this.openIndex(input.authority.mailbox_id);
    try {
      const fingerprint = createHmac(
        "sha256",
        await this.readOrCreateFingerprintKey(input.authority.mailbox_id),
      ).update(JSON.stringify(input.request)).digest("hex");
      const existing = db.prepare(`
        select fingerprint, result_json, created_at_ms
        from send_receipts
        where idempotency_key = ?
      `).get(input.request.idempotency_key) as {
        fingerprint: string;
        result_json: string | null;
        created_at_ms: number;
      } | undefined;
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw new MailServiceError("MAIL_SEND_IDEMPOTENCY_CONFLICT", false);
        }
        if (!existing.result_json) {
          if (this.nowMs() - existing.created_at_ms >= SEND_RECEIPT_STALE_MS) {
            // The process may have stopped after SMTP accepted the message.
            // Persist an unknown terminal outcome and never resend automatically.
            const unknown = mailSendResultSchema.parse({
              mailbox_id: input.authority.mailbox_id,
              idempotency_key: input.request.idempotency_key,
              outcome: "unknown",
              internet_message_id: null,
              sent_copy_error_code: null,
            });
            this.completeSendReceipt(db, input.request.idempotency_key, unknown);
            return unknown;
          }
          throw new MailServiceError("MAIL_SEND_IN_PROGRESS", true);
        }
        return mailSendResultSchema.parse(JSON.parse(existing.result_json));
      }
      const won = db.prepare(`
        insert into send_receipts (idempotency_key, fingerprint, result_json, created_at_ms)
        values (?, ?, null, ?)
        on conflict do nothing
      `).run(input.request.idempotency_key, fingerprint, this.nowMs()).changes === 1;
      if (!won) throw new MailServiceError("MAIL_SEND_IN_PROGRESS", true);
      let smtpAccepted = false;
      try {
        const compiled = new MailComposer({
          from: {
            address: credential.configuration.email_address,
            name: credential.configuration.display_name ?? "",
          },
          to: input.request.recipients.to,
          cc: input.request.recipients.cc,
          bcc: input.request.recipients.bcc,
          subject: input.request.subject,
          text: input.request.text_body,
          html: input.request.html_body,
          inReplyTo: input.request.in_reply_to,
          references: input.request.references,
          attachments: input.request.attachments.map((attachment) => ({
            filename: attachment.filename,
            contentType: attachment.content_type,
            content: Buffer.from(attachment.content_base64, "base64"),
          })),
          disableFileAccess: true,
          disableUrlAccess: true,
        }).compile();
        const raw = await compiled.build();
        if (raw.byteLength > 40 * 1024 * 1024) {
          throw new MailServiceError("MAIL_ATTACHMENT_TOO_LARGE", false);
        }
        const resolved = await this.resolveConnection(credential.configuration);
        const smtp = this.smtpTransport(resolved);
        let smtpMessageId: string | null = compiled.getHeader("message-id") || null;
        try {
          const sent = await smtp.sendMail({
            envelope: {
              from: credential.configuration.email_address,
              to: [
                ...input.request.recipients.to,
                ...input.request.recipients.cc,
                ...input.request.recipients.bcc,
              ],
            },
            raw,
            disableFileAccess: true,
            disableUrlAccess: true,
          });
          smtpMessageId = sent.messageId ?? smtpMessageId;
          smtpAccepted = true;
        } catch (error) {
          if (!smtpOutcomeUnknown(error)) throw error;
          smtpAccepted = true;
          const result = mailSendResultSchema.parse({
            mailbox_id: input.authority.mailbox_id,
            idempotency_key: input.request.idempotency_key,
            outcome: "unknown",
            internet_message_id: smtpMessageId,
            sent_copy_error_code: null,
          });
          this.completeSendReceipt(db, input.request.idempotency_key, result);
          return result;
        } finally {
          smtp.close();
        }
        let outcome: MailSendResult["outcome"] = "sent";
        let sentCopyErrorCode: string | null = null;
        try {
          await this.withImap(input.authority, async (client) => {
            const folders = await client.list();
            const sentFolder = folders.find((folder) => (
              folder.specialUse?.toLowerCase() === "\\sent"
              || /(^|[/.])sent(?: mail| items)?$/iu.test(folder.path)
            ));
            if (!sentFolder) throw new MailServiceError("MAIL_SENT_FOLDER_UNAVAILABLE", false);
            const appended = await client.append(sentFolder.path, raw, ["\\Seen"], new Date());
            if (!appended) throw new MailServiceError("MAIL_SENT_APPEND_FAILED", true);
          });
        } catch (error) {
          outcome = "sent_copy_failed";
          sentCopyErrorCode = safeMailErrorCode(error);
        }
        const result = mailSendResultSchema.parse({
          mailbox_id: input.authority.mailbox_id,
          idempotency_key: input.request.idempotency_key,
          outcome,
          internet_message_id: smtpMessageId,
          sent_copy_error_code: sentCopyErrorCode,
        });
        this.completeSendReceipt(db, input.request.idempotency_key, result);
        return result;
      } catch (error) {
        if (smtpAccepted) {
          const unknown = mailSendResultSchema.parse({
            mailbox_id: input.authority.mailbox_id,
            idempotency_key: input.request.idempotency_key,
            outcome: "unknown",
            internet_message_id: null,
            sent_copy_error_code: null,
          });
          try {
            this.completeSendReceipt(db, input.request.idempotency_key, unknown);
            return unknown;
          } catch {
            // Leave the pending receipt in place. A retry becomes terminal
            // unknown after the stale window and can never resend.
          }
        } else {
          db.prepare("delete from send_receipts where idempotency_key = ? and result_json is null")
            .run(input.request.idempotency_key);
        }
        throw error;
      }
    } finally {
      db.close();
    }
  }

  async sendWorkspaceMessage(rawInput: unknown): Promise<MailSendResult> {
    return (await this.sendWorkspaceMessageWithMetrics(rawInput)).result;
  }

  async sendWorkspaceMessageWithMetrics(rawInput: unknown): Promise<{
    result: MailSendResult;
    attachmentSizeBytes: number;
  }> {
    const input = runtimeMailboxWorkspaceSendInputSchema.parse(rawInput);
    if (input.member_id !== input.authority.requested_by_actor_id) {
      throw new MailServiceError("MAIL_ATTACHMENT_WORKSPACE_ACCESS_DENIED", false);
    }
    const { attachments, ...message } = input.request;
    let remainingBytes = MAX_ATTACHMENT_BYTES;
    const encodedAttachments = [];
    for (const attachment of attachments) {
      const content = await readWorkspaceRegularFile(
        memberWorkspaceLayout(this.workdir, input.member_id).workspace,
        attachment.workspace_relative_path,
        remainingBytes,
      );
      remainingBytes -= content.byteLength;
      encodedAttachments.push({
        filename: attachment.filename ?? basename(attachment.workspace_relative_path),
        content_type: attachment.content_type ?? "application/octet-stream",
        content_base64: content.toString("base64"),
      });
    }
    const result = await this.sendMessage({
      authority: input.authority,
      request: {
        ...message,
        attachments: encodedAttachments,
      },
    });
    return {
      result,
      attachmentSizeBytes: MAX_ATTACHMENT_BYTES - remainingBytes,
    };
  }

  async updateMessage(rawInput: unknown) {
    const input = runtimeMailboxMessageUpdateInputSchema.parse(rawInput);
    const path = decodeFolderId(input.request.folder_id);
    const message = decodeMessageId(input.request.message_id);
    if (message.folderId !== input.request.folder_id) {
      throw new MailServiceError("MAIL_MESSAGE_ID_INVALID", false);
    }
    const run = () => this.withImap(input.authority, async (client) => {
      const lock = await client.getMailboxLock(path);
      try {
        if (selectedUidValidity(client) !== message.uidValidity) {
          throw new MailServiceError("MAIL_UIDVALIDITY_CHANGED", false);
        }
        if (input.request.operation === "mark_read") {
          await client.messageFlagsAdd(message.uid, ["\\Seen"], { uid: true });
        } else if (input.request.operation === "mark_unread") {
          await client.messageFlagsRemove(message.uid, ["\\Seen"], { uid: true });
        } else {
          if (!client.capabilities.has("MOVE")) {
            throw new MailServiceError(
              input.request.operation === "trash"
                ? "MAIL_TRASH_UNAVAILABLE"
                : "MAIL_MOVE_UNSUPPORTED",
              false,
            );
          }
          let destination: string;
          if (input.request.operation === "move") {
            destination = decodeFolderId(input.request.destination_folder_id!);
          } else {
            const folders = await client.list();
            const trash = folders.find((folder) => (
              folder.specialUse?.toLowerCase() === "\\trash"
              || /(^|[/.])trash$/iu.test(folder.path)
            ));
            if (!trash) throw new MailServiceError("MAIL_TRASH_UNAVAILABLE", false);
            destination = trash.path;
          }
          const moved = await client.messageMove(message.uid, destination, { uid: true });
          if (!moved) throw new MailServiceError("MAIL_MOVE_UNSUPPORTED", false);
        }
        this.updateIndexedMessageAfterOperation(
          input.authority.mailbox_id,
          input.request,
        );
        return mailMessageUpdateResultSchema.parse({
          mailbox_id: input.authority.mailbox_id,
          message_id: input.request.message_id,
          operation: input.request.operation,
          applied: true,
        });
      } finally {
        lock.release();
      }
    });
    return input.operation_id
      ? this.runOperationOnce(
        input.authority.mailbox_id,
        input.operation_id,
        input.request,
        (value) => mailMessageUpdateResultSchema.parse(value),
        run,
      )
      : run();
  }

  async readAttachment(rawInput: unknown): Promise<MailAttachmentReadResult> {
    const input = runtimeMailboxAttachmentReadInputSchema.parse(rawInput);
    return this.downloadAttachment(
      input.authority,
      input.request.folder_id,
      input.request.message_id,
      input.request.attachment_id,
    );
  }

  async saveAttachment(rawInput: unknown): Promise<RuntimeMailboxAttachmentSaveResult> {
    const input = runtimeMailboxAttachmentSaveInputSchema.parse(rawInput);
    if (input.member_id !== input.authority.requested_by_actor_id) {
      throw new MailServiceError("MAIL_ATTACHMENT_WORKSPACE_ACCESS_DENIED", false);
    }
    const run = async () => {
      const attachment = await this.downloadAttachment(
        input.authority,
        input.request.folder_id,
        input.request.message_id,
        input.request.attachment_id,
      );
      const body = Buffer.from(attachment.content_base64, "base64");
      await writeWorkspaceAttachment(
        memberWorkspaceLayout(this.workdir, input.member_id).workspace,
        input.workspace_relative_path,
        body,
      );
      return runtimeMailboxAttachmentSaveResultSchema.parse({
        mailbox_id: input.authority.mailbox_id,
        message_id: input.request.message_id,
        attachment_id: input.request.attachment_id,
        workspace_relative_path: input.workspace_relative_path,
        size_bytes: body.byteLength,
      });
    };
    return input.operation_id
      ? this.runOperationOnce(
        input.authority.mailbox_id,
        input.operation_id,
        { request: input.request, workspace_relative_path: input.workspace_relative_path },
        (value) => runtimeMailboxAttachmentSaveResultSchema.parse(value),
        run,
      )
      : run();
  }

  async cleanupMember(companyId: string, memberId: string): Promise<void> {
    const mailboxId = `mailbox_personal_${createHash("sha256")
      .update(`${companyId}\0${memberId}`)
      .digest("hex")
      .slice(0, 32)}`;
    await this.withCredentialLock(
      mailboxId,
      () => this.removeMailboxData(mailboxId, true),
    );
  }

  private async refreshConnectedMailboxIndexes(): Promise<MailIndexRefreshResult> {
    const refreshedMailboxIds: string[] = [];
    const failedMailboxIds: string[] = [];
    const mailboxIds = await this.connectedMailboxIds();
    for (const mailboxId of mailboxIds) {
      if (this.closing) break;
      try {
        await this.withCredentialLock(mailboxId, async () => {
          const credential = await this.readCredential(mailboxId);
          const resolved = await this.resolveConnection(credential.configuration);
          const client = this.imapClient(resolved);
          try {
            await client.connect();
            const folders = await client.list({
              statusQuery: {
                messages: true,
                unseen: true,
                uidValidity: true,
              },
            });
            await this.syncRecentIndex(mailboxId, client, folders);
          } finally {
            if (client.usable) {
              await client.logout().catch(() => client.close());
            } else {
              client.close();
            }
          }
        });
        refreshedMailboxIds.push(mailboxId);
      } catch {
        // One unavailable mailbox must not prevent another connected mailbox
        // from advancing. The next interval opens a fresh IMAP connection.
        failedMailboxIds.push(mailboxId);
      }
    }
    return {
      refreshed_mailbox_ids: refreshedMailboxIds,
      failed_mailbox_ids: failedMailboxIds,
    };
  }

  private async connectedMailboxIds(): Promise<string[]> {
    const directory = resolve(
      this.workdir,
      MAILBOXES_DIRECTORY,
      CREDENTIALS_DIRECTORY,
    );
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const mailboxIds: string[] = [];
    for (const entry of entries) {
      if (
        !entry.isFile()
        || !entry.name.endsWith(".json")
        || entry.name.endsWith(".connection-rollback.json")
        || entry.name.endsWith(".address-probe.json")
      ) {
        continue;
      }
      const mailboxId = entry.name.slice(0, -".json".length);
      try {
        safePathComponent(mailboxId, "mailbox_id");
        mailboxIds.push(mailboxId);
      } catch {
        // Invalid filenames cannot have been produced by credentialPath and
        // are not treated as connected mailbox identities.
      }
    }
    mailboxIds.sort();
    return mailboxIds;
  }

  private async verifyMailboxAddressOwnership(
    input: RuntimeMailboxConnectInput,
    client: ImapFlow,
    smtp: ReturnType<CompanyMailService["smtpTransport"]>,
    folders: ListResponse[],
  ): Promise<void> {
    const mailboxId = input.authority.mailbox_id;
    const configurationFingerprint = createHash("sha256")
      .update(JSON.stringify(input.configuration))
      .digest("hex");
    const expectedMessageId = ownershipProbeMessageId(
      input.operation_id,
      input.configuration.email_address,
    );
    let receipt = await this.readAddressProbeReceipt(mailboxId);
    let sendProbe = false;
    if (
      receipt
      && receipt.operation_id === input.operation_id
      && (
        receipt.credential_version !== input.credential_version
        || receipt.configuration_fingerprint !== configurationFingerprint
      )
    ) {
      throw new MailServiceError("MAILBOX_IDEMPOTENCY_CONFLICT", false);
    }
    if (
      receipt
      && receipt.operation_id === input.operation_id
      && receipt.message_id !== expectedMessageId
    ) {
      throw new MailServiceError("MAIL_ADDRESS_PROBE_RECEIPT_INVALID", false);
    }
    if (
      receipt
      && receipt.operation_id !== input.operation_id
      && ["pending", "smtp_accepted", "unknown"].includes(receipt.status)
    ) {
      // A distinct operation cannot prove that an earlier DATA transaction was
      // rejected. Preserve the durable uncertain outcome until an explicit
      // disconnect clears it; never turn a retry into a second probe message.
      throw new MailServiceError("MAIL_ADDRESS_PROBE_UNKNOWN", false);
    }
    if (!receipt || receipt.operation_id !== input.operation_id) {
      receipt = {
        operation_id: input.operation_id,
        credential_version: input.credential_version,
        configuration_fingerprint: configurationFingerprint,
        message_id: expectedMessageId,
        status: "pending",
      };
      await this.persistAddressProbeReceipt(mailboxId, receipt);
      sendProbe = true;
    } else if (receipt.status === "verified") {
      return;
    } else if (receipt.status === "rejected") {
      throw new MailServiceError("MAIL_ADDRESS_PROBE_REJECTED", false);
    }

    if (sendProbe) {
      try {
        const info = await smtp.sendMail({
          envelope: {
            from: input.configuration.email_address,
            to: [input.configuration.email_address],
          },
          from: input.configuration.email_address,
          to: input.configuration.email_address,
          subject: "Fields mailbox ownership verification",
          text: "Fields sent this one-time message to verify this mailbox connection.",
          messageId: receipt.message_id,
          disableFileAccess: true,
          disableUrlAccess: true,
        });
        const accepted = Array.isArray(info.accepted)
          && info.accepted.some((address) => (
            String(address).trim().toLowerCase()
            === input.configuration.email_address.toLowerCase()
          ));
        if (!accepted || (Array.isArray(info.rejected) && info.rejected.length > 0)) {
          receipt = { ...receipt, status: "rejected" };
          await this.persistAddressProbeReceipt(mailboxId, receipt);
          throw new MailServiceError("MAIL_ADDRESS_PROBE_REJECTED", false);
        }
        receipt = { ...receipt, status: "smtp_accepted" };
        await this.persistAddressProbeReceipt(mailboxId, receipt);
      } catch (error) {
        if (
          error instanceof MailServiceError
          && error.code === "MAIL_ADDRESS_PROBE_REJECTED"
        ) {
          throw error;
        }
        receipt = {
          ...receipt,
          status: smtpOutcomeUnknown(error) ? "unknown" : "rejected",
        };
        await this.persistAddressProbeReceipt(mailboxId, receipt);
        if (receipt.status === "rejected") {
          throw new MailServiceError("MAIL_ADDRESS_PROBE_REJECTED", false);
        }
      }
    }

    let matches: Array<{ folder: ListResponse; uid: number }>;
    try {
      matches = await this.awaitOwnershipProbeReadback(
        client,
        folders,
        receipt.message_id,
      );
    } catch {
      receipt = { ...receipt, status: "unknown" };
      await this.persistAddressProbeReceipt(mailboxId, receipt);
      throw new MailServiceError("MAIL_ADDRESS_PROBE_UNKNOWN", false);
    }
    if (matches.length === 0) {
      receipt = { ...receipt, status: "unknown" };
      await this.persistAddressProbeReceipt(mailboxId, receipt);
      throw new MailServiceError("MAIL_ADDRESS_PROBE_UNKNOWN", false);
    }
    receipt = { ...receipt, status: "verified" };
    await this.persistAddressProbeReceipt(mailboxId, receipt);
    await this.trashOwnershipProbeBestEffort(client, folders, matches);
  }

  private async awaitOwnershipProbeReadback(
    client: ImapFlow,
    folders: ListResponse[],
    messageId: string,
  ): Promise<Array<{ folder: ListResponse; uid: number }>> {
    const attempts = this.options.addressProbeAttempts ?? ADDRESS_PROBE_ATTEMPTS;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const matches = await this.findOwnershipProbe(client, folders, messageId);
      if (matches.length > 0) return matches;
      if (attempt + 1 < attempts) {
        await (this.options.sleep ?? sleep)(ADDRESS_PROBE_INTERVAL_MS);
      }
    }
    return [];
  }

  private async findOwnershipProbe(
    client: ImapFlow,
    folders: ListResponse[],
    messageId: string,
  ): Promise<Array<{ folder: ListResponse; uid: number }>> {
    const matches: Array<{ folder: ListResponse; uid: number }> = [];
    for (const folder of folders.filter(selectableFolder)) {
      const lock = await client.getMailboxLock(folder.path);
      try {
        const searched = await client.search({
          header: { "message-id": messageId },
        }, { uid: true });
        for (const uid of searched || []) {
          const fetched = await client.fetchOne(uid, {
            headers: ["message-id"],
          }, { uid: true });
          if (!fetched) continue;
          const parsed = await parseHeaderBuffer(fetched.headers);
          if (normalizeMessageId(parsed.messageId) === normalizeMessageId(messageId)) {
            matches.push({ folder, uid });
          }
        }
      } finally {
        lock.release();
      }
    }
    return matches;
  }

  private async trashOwnershipProbeBestEffort(
    client: ImapFlow,
    folders: ListResponse[],
    matches: Array<{ folder: ListResponse; uid: number }>,
  ): Promise<void> {
    if (!client.capabilities.has("MOVE")) return;
    const trash = folders.find((folder) => (
      folder.specialUse?.toLowerCase() === "\\trash"
      || /(^|[/.])trash$/iu.test(folder.path)
    ));
    if (!trash) return;
    for (const match of matches) {
      if (match.folder.path === trash.path) continue;
      try {
        const lock = await client.getMailboxLock(match.folder.path);
        try {
          await client.messageMove(match.uid, trash.path, { uid: true });
        } finally {
          lock.release();
        }
      } catch {
        // SMTP acceptance plus exact IMAP Message-ID readback is authoritative.
        // Probe cleanup must not invalidate a verified connection.
      }
    }
  }

  private async downloadAttachment(
    authority: RuntimeMailboxAuthority,
    folderId: string,
    messageId: string,
    attachmentId: string,
  ): Promise<MailAttachmentReadResult> {
    const path = decodeFolderId(folderId);
    const message = decodeMessageId(messageId);
    if (message.folderId !== folderId) {
      throw new MailServiceError("MAIL_MESSAGE_ID_INVALID", false);
    }
    const part = decodeAttachmentId(attachmentId);
    return this.withImap(authority, async (client) => {
      const lock = await client.getMailboxLock(path);
      try {
        if (selectedUidValidity(client) !== message.uidValidity) {
          throw new MailServiceError("MAIL_UIDVALIDITY_CHANGED", false);
        }
        const download = await client.download(message.uid, part, {
          uid: true,
          maxBytes: MAX_ATTACHMENT_BYTES + 1,
        });
        const content = await streamBuffer(download.content, MAX_ATTACHMENT_BYTES);
        const filename = download.meta.filename?.trim();
        const contentType = download.meta.contentType?.trim();
        return mailAttachmentReadResultSchema.parse({
          filename: filename ? boundedText(filename, 1_024) : null,
          content_type: contentType
            ? boundedText(contentType, 255)
            : "application/octet-stream",
          size_bytes: content.byteLength,
          content_base64: content.toString("base64"),
        });
      } finally {
        lock.release();
      }
    });
  }

  private async searchRemoteMailbox(
    authority: RuntimeMailboxAuthority,
    term: string,
    limit: number,
  ): Promise<MailMessageSummary[]> {
    if (limit < 1) return [];
    return this.withImap(authority, async (client) => {
      const folders = (await client.list()).filter(selectableFolder);
      const items: MailMessageSummary[] = [];
      for (const folder of folders) {
        const lock = await client.getMailboxLock(folder.path);
        try {
          const uidValidity = selectedUidValidity(client);
          this.resetFolderOnUidValidityChange(
            authority.mailbox_id,
            encodeFolderId(folder.path),
            folder.path,
            uidValidity,
          );
          const searched = await client.search({
            or: [
              { subject: term },
              { from: term },
              { to: term },
              { cc: term },
              { text: term },
            ],
          }, { uid: true });
          const uids = (searched || [])
            .sort((left, right) => right - left)
            .slice(0, limit - items.length);
          items.push(...await this.fetchAndIndex(
            authority.mailbox_id,
            encodeFolderId(folder.path),
            folder.path,
            uidValidity,
            client,
            uids,
          ));
        } finally {
          lock.release();
        }
        if (items.length >= limit) break;
      }
      return items;
    });
  }

  private async syncRecentIndex(
    mailboxId: string,
    client: ImapFlow,
    folders: ListResponse[],
  ): Promise<void> {
    const since = new Date(this.nowMs() - INDEX_WINDOW_MS);
    for (const folder of folders.filter(selectableFolder)) {
      const lock = await client.getMailboxLock(folder.path);
      try {
        const uidValidity = selectedUidValidity(client);
        const folderId = encodeFolderId(folder.path);
        this.resetFolderOnUidValidityChange(mailboxId, folderId, folder.path, uidValidity);
        const searched = await client.search({ since }, { uid: true });
        const remoteUids = [...new Set(searched || [])]
          .filter((uid) => Number.isSafeInteger(uid) && uid > 0)
          .sort((left, right) => left - right);
        const indexedUids = this.indexedFolderUids(mailboxId, folderId, uidValidity);
        const remoteUidSet = new Set(remoteUids);
        const indexedUidSet = new Set(indexedUids);
        this.removeMissingFolderUids(
          mailboxId,
          folderId,
          uidValidity,
          indexedUids.filter((uid) => !remoteUidSet.has(uid)),
        );
        const newUids = remoteUids.filter((uid) => !indexedUidSet.has(uid));
        const recentUids = remoteUids.slice(-MAX_INCREMENTAL_REFRESH_UIDS);
        const uids = [...new Set([...newUids, ...recentUids])]
          .sort((left, right) => left - right);
        for (let index = 0; index < uids.length; index += MAX_SYNC_UIDS_PER_FETCH) {
          await this.fetchAndIndex(
            mailboxId,
            folderId,
            folder.path,
            uidValidity,
            client,
            uids.slice(index, index + MAX_SYNC_UIDS_PER_FETCH),
          );
        }
      } finally {
        lock.release();
      }
    }
    this.writeFolderIndex(
      mailboxId,
      folders.map((folder) => projectFolder(mailboxId, folder)),
    );
    const db = this.openIndex(mailboxId);
    try {
      db.prepare("insert or replace into metadata (key, value) values ('indexed_from_ms', ?)")
        .run(String(this.nowMs() - INDEX_WINDOW_MS));
      this.pruneIndex(db);
    } finally {
      db.close();
    }
  }

  private async fetchAndIndex(
    mailboxId: string,
    folderId: string,
    folderPath: string,
    uidValidity: string,
    client: ImapFlow,
    uids: number[],
  ): Promise<MailMessageSummary[]> {
    if (uids.length === 0) return [];
    const items: MailMessageSummary[] = [];
    for await (const fetched of client.fetch(uids, {
      envelope: true,
      flags: true,
      internalDate: true,
      size: true,
      bodyStructure: true,
      headers: ["message-id", "in-reply-to", "references"],
    }, { uid: true })) {
      items.push(await this.projectAndIndexMessage(
        mailboxId,
        folderId,
        folderPath,
        uidValidity,
        fetched,
      ));
    }
    const order = new Map(uids.map((uid, index) => [uid, index]));
    items.sort((left, right) => (
      (order.get(decodeMessageId(left.message_id).uid) ?? 0)
      - (order.get(decodeMessageId(right.message_id).uid) ?? 0)
    ));
    return items;
  }

  private async projectAndIndexMessage(
    mailboxId: string,
    folderId: string,
    folderPath: string,
    uidValidity: string,
    fetched: FetchMessageObject,
    parsedInput?: ParsedMail,
  ): Promise<MailMessageSummary> {
    const parsed = parsedInput ?? await parseHeaderBuffer(fetched.headers);
    const messageId = normalizeMessageId(parsed.messageId ?? fetched.envelope?.messageId);
    const inReplyTo = normalizeMessageId(parsed.inReplyTo ?? fetched.envelope?.inReplyTo);
    const references = referenceList(parsed.references);
    const db = this.openIndex(mailboxId);
    try {
      const parentIds = [...references, ...(inReplyTo ? [inReplyTo] : [])];
      let parentThreadId: string | null = null;
      if (parentIds.length > 0) {
        const placeholders = parentIds.map(() => "?").join(", ");
        const parent = db.prepare(`
          select thread_id
          from messages
          where internet_message_id in (${placeholders})
          order by indexed_at_ms asc
          limit 1
        `).get(...parentIds) as { thread_id: string } | undefined;
        parentThreadId = parent?.thread_id ?? null;
      }
      const threadId = mailThreadId({
        messageId,
        inReplyTo,
        references,
        resolvedParentThreadId: parentThreadId,
        surrogateId: `${mailboxId}:${folderId}:${uidValidity}:${fetched.uid}`,
      });
      const attachments = attachmentMetadata(fetched.bodyStructure);
      const sentAt = parsed.date?.getTime() ?? fetched.envelope?.date?.getTime() ?? null;
      const receivedAt = dateMs(fetched.internalDate);
      const summary = mailMessageSummarySchema.parse({
        message_id: encodeMessageId(folderId, uidValidity, fetched.uid),
        mailbox_id: mailboxId,
        folder_id: folderId,
        internet_message_id: messageId,
        thread_id: threadId,
        subject: boundedText(parsed.subject ?? fetched.envelope?.subject ?? "", 4_096),
        from: participants(parsed.from?.value ?? fetched.envelope?.from),
        to: participants(addressValues(parsed.to) ?? fetched.envelope?.to),
        cc: participants(addressValues(parsed.cc) ?? fetched.envelope?.cc),
        sent_at_ms: sentAt,
        received_at_ms: receivedAt,
        flags: [...(fetched.flags ?? [])].map((flag) => boundedText(flag, 255)),
        size_bytes: nonnegativeInteger(fetched.size),
        attachments,
        indexed_at_ms: this.nowMs(),
      });
      db.prepare(`
        insert into messages (
          folder_id, folder_path, uid_validity, uid, message_id,
          internet_message_id, in_reply_to, references_json, thread_id,
          subject, sender_text, recipient_text, sent_at_ms, received_at_ms,
          summary_json, indexed_at_ms
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(folder_id, uid_validity, uid) do update set
          message_id = excluded.message_id,
          internet_message_id = excluded.internet_message_id,
          in_reply_to = excluded.in_reply_to,
          references_json = excluded.references_json,
          thread_id = excluded.thread_id,
          subject = excluded.subject,
          sender_text = excluded.sender_text,
          recipient_text = excluded.recipient_text,
          sent_at_ms = excluded.sent_at_ms,
          received_at_ms = excluded.received_at_ms,
          summary_json = excluded.summary_json,
          indexed_at_ms = excluded.indexed_at_ms
      `).run(
        folderId,
        folderPath,
        uidValidity,
        fetched.uid,
        summary.message_id,
        messageId,
        inReplyTo,
        JSON.stringify(references),
        threadId,
        summary.subject,
        summary.from.map((entry) => `${entry.name ?? ""} ${entry.address}`).join(" "),
        [...summary.to, ...summary.cc].map((entry) => `${entry.name ?? ""} ${entry.address}`).join(" "),
        sentAt,
        receivedAt,
        JSON.stringify(summary),
        summary.indexed_at_ms,
      );
      return summary;
    } finally {
      db.close();
    }
  }

  private searchIndexed(
    authorities: RuntimeMailboxAuthority[],
    term: string,
  ): MailMessageSummary[] {
    const pattern = `%${term.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    const items: MailMessageSummary[] = [];
    for (const authority of authorities) {
      const path = this.indexPath(authority.mailbox_id);
      if (!existsSync(path)) continue;
      let db: Database.Database;
      try {
        db = new Database(path, { readonly: true, fileMustExist: true });
      } catch {
        continue;
      }
      try {
        const rows = db.prepare(`
          select summary_json
          from messages
          where subject like ? escape '\\'
             or sender_text like ? escape '\\'
             or recipient_text like ? escape '\\'
             or strftime('%Y-%m-%dT%H:%M:%fZ', sent_at_ms / 1000.0, 'unixepoch') like ? escape '\\'
             or strftime('%Y-%m-%dT%H:%M:%fZ', received_at_ms / 1000.0, 'unixepoch') like ? escape '\\'
          order by coalesce(received_at_ms, sent_at_ms, 0) desc
          limit 200
        `).all(pattern, pattern, pattern, pattern, pattern) as IndexedMessageRow[];
        items.push(...rows.map((row) => mailMessageSummarySchema.parse(JSON.parse(row.summary_json))));
      } finally {
        db.close();
      }
    }
    return items;
  }

  private readCombinedIndexedFromMs(
    authorities: RuntimeMailboxAuthority[],
  ): number | null {
    const indexedFromValues = authorities.map((authority) => (
      this.readIndexedFromMs(authority.mailbox_id)
    ));
    if (
      indexedFromValues.length === 0
      || indexedFromValues.some((value) => value === null)
    ) {
      return null;
    }
    return Math.max(...indexedFromValues as number[]);
  }

  private readIndexedFromMs(mailboxId: string): number | null {
    const path = this.indexPath(mailboxId);
    if (!existsSync(path)) return null;
    let db: Database.Database;
    try {
      db = new Database(path, { readonly: true, fileMustExist: true });
    } catch {
      return null;
    }
    try {
      const row = db.prepare(`
        select value from metadata where key = 'indexed_from_ms'
      `).get() as { value: string } | undefined;
      if (!row) return null;
      const value = Number(row.value);
      return Number.isSafeInteger(value) && value >= 0 ? value : null;
    } finally {
      db.close();
    }
  }

  private updateIndexedMessageAfterOperation(
    mailboxId: string,
    request: {
      folder_id: string;
      message_id: string;
      operation: "mark_read" | "mark_unread" | "move" | "trash";
    },
  ): void {
    const path = this.indexPath(mailboxId);
    if (!existsSync(path)) return;
    let db: Database.Database;
    try {
      db = new Database(path, { fileMustExist: true });
    } catch {
      return;
    }
    try {
      const message = decodeMessageId(request.message_id);
      if (request.operation === "move" || request.operation === "trash") {
        db.prepare(`
          delete from messages
          where folder_id = ? and uid_validity = ? and uid = ?
        `).run(request.folder_id, message.uidValidity, message.uid);
        return;
      }
      const row = db.prepare(`
        select summary_json
        from messages
        where folder_id = ? and uid_validity = ? and uid = ?
      `).get(request.folder_id, message.uidValidity, message.uid) as
        | IndexedMessageRow
        | undefined;
      if (!row) return;
      const summary = mailMessageSummarySchema.parse(JSON.parse(row.summary_json));
      const flags = summary.flags.filter((flag) => flag.toLowerCase() !== "\\seen");
      const updated = {
        ...summary,
        flags: request.operation === "mark_read" ? [...flags, "\\Seen"] : flags,
        indexed_at_ms: this.nowMs(),
      };
      db.prepare(`
        update messages
        set summary_json = ?, indexed_at_ms = ?
        where folder_id = ? and uid_validity = ? and uid = ?
      `).run(
        JSON.stringify(updated),
        updated.indexed_at_ms,
        request.folder_id,
        message.uidValidity,
        message.uid,
      );
    } catch {
      // The external mailbox remains authoritative. A later list/search sync
      // repairs a missing or corrupt local projection without changing the
      // already-applied remote operation.
    } finally {
      db.close();
    }
  }

  private writeFolderIndex(mailboxId: string, folders: MailFolder[]): void {
    const db = this.openIndex(mailboxId);
    try {
      const insert = db.prepare(`
        insert into folders (
          folder_id, path, name, role, selectable, total_count, unread_count, uid_validity
        ) values (?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(folder_id) do update set
          path = excluded.path,
          name = excluded.name,
          role = excluded.role,
          selectable = excluded.selectable,
          total_count = excluded.total_count,
          unread_count = excluded.unread_count,
          uid_validity = excluded.uid_validity
      `);
      const transaction = db.transaction((items: MailFolder[]) => {
        for (const folder of items) {
          insert.run(
            folder.folder_id,
            folder.path,
            folder.name,
            folder.role,
            folder.selectable ? 1 : 0,
            folder.total_count,
            folder.unread_count,
            folder.uid_validity,
          );
        }
      });
      transaction(folders);
    } finally {
      db.close();
    }
  }

  private resetFolderOnUidValidityChange(
    mailboxId: string,
    folderId: string,
    path: string,
    uidValidity: string,
  ): void {
    const db = this.openIndex(mailboxId);
    try {
      const row = db.prepare("select uid_validity from folders where folder_id = ?")
        .get(folderId) as { uid_validity: string | null } | undefined;
      const transaction = db.transaction(() => {
        if (row?.uid_validity && row.uid_validity !== uidValidity) {
          db.prepare("delete from messages where folder_id = ?").run(folderId);
        }
        db.prepare(`
          insert into folders (
            folder_id, path, name, role, selectable, total_count, unread_count, uid_validity
          ) values (?, ?, ?, 'other', 1, null, null, ?)
          on conflict(folder_id) do update set
            path = excluded.path,
            uid_validity = excluded.uid_validity
        `).run(folderId, path, path, uidValidity);
      });
      transaction();
    } finally {
      db.close();
    }
  }

  private indexedFolderUids(
    mailboxId: string,
    folderId: string,
    uidValidity: string,
  ): number[] {
    const db = this.openIndex(mailboxId);
    try {
      return (db.prepare(`
        select uid
        from messages
        where folder_id = ? and uid_validity = ?
        order by uid
      `).all(folderId, uidValidity) as Array<{ uid: number }>).map((row) => row.uid);
    } finally {
      db.close();
    }
  }

  private removeMissingFolderUids(
    mailboxId: string,
    folderId: string,
    uidValidity: string,
    uids: number[],
  ): void {
    if (uids.length === 0) return;
    const db = this.openIndex(mailboxId);
    try {
      const remove = db.prepare(`
        delete from messages
        where folder_id = ? and uid_validity = ? and uid = ?
      `);
      db.transaction((missingUids: number[]) => {
        for (const uid of missingUids) remove.run(folderId, uidValidity, uid);
      })(uids);
    } finally {
      db.close();
    }
  }

  private completeSendReceipt(
    db: Database.Database,
    idempotencyKey: string,
    result: MailSendResult,
  ): void {
    db.prepare("update send_receipts set result_json = ? where idempotency_key = ?")
      .run(JSON.stringify(result), idempotencyKey);
  }

  private async runOperationOnce<T>(
    mailboxId: string,
    operationId: string,
    fingerprintInput: unknown,
    parseResult: (value: unknown) => T,
    run: () => Promise<T>,
  ): Promise<T> {
    const db = this.openIndex(mailboxId);
    try {
      const fingerprint = createHmac(
        "sha256",
        await this.readOrCreateFingerprintKey(mailboxId),
      ).update(JSON.stringify(fingerprintInput)).digest("hex");
      const existing = db.prepare(`
        select fingerprint, result_json
        from operation_receipts
        where operation_id = ?
      `).get(operationId) as { fingerprint: string; result_json: string | null } | undefined;
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw new MailServiceError("MAIL_OPERATION_IDEMPOTENCY_CONFLICT", false);
        }
        if (!existing.result_json) {
          throw new MailServiceError("MAIL_OPERATION_OUTCOME_UNKNOWN", false);
        }
        return parseResult(JSON.parse(existing.result_json));
      }
      db.prepare(`
        insert into operation_receipts (operation_id, fingerprint, result_json, created_at_ms)
        values (?, ?, null, ?)
      `).run(operationId, fingerprint, this.nowMs());
      const result = await run();
      db.prepare("update operation_receipts set result_json = ? where operation_id = ?")
        .run(JSON.stringify(result), operationId);
      return result;
    } finally {
      db.close();
    }
  }

  private async withImap<T>(
    authority: RuntimeMailboxAuthority,
    run: (client: ImapFlow) => Promise<T>,
  ): Promise<T> {
    const credential = await this.readCredential(authority.mailbox_id);
    const resolved = await this.resolveConnection(credential.configuration);
    const client = this.imapClient(resolved);
    try {
      await client.connect();
      return await run(client);
    } finally {
      if (client.usable) {
        await client.logout().catch(() => client.close());
      } else {
        client.close();
      }
    }
  }

  private imapClient(resolved: ResolvedMailConnection): ImapFlow {
    const policy = mailEndpointTransportPolicy(resolved.imap);
    return new ImapFlow({
      host: policy.servername,
      port: resolved.imap.port,
      secure: resolved.imap.tls_mode === "implicit_tls",
      doSTARTTLS: resolved.imap.tls_mode === "starttls",
      auth: {
        user: resolved.configuration.username,
        pass: resolved.configuration.application_password,
      },
      tls: {
        ...policy.tls,
        lookup: policy.lookup,
      },
      logger: false,
      disableAutoIdle: true,
      connectionTimeout: 20_000,
      greetingTimeout: 20_000,
      socketTimeout: 60_000,
      maxLineLength: 16 * 1024 * 1024,
      maxLiteralSize: 40 * 1024 * 1024,
    });
  }

  private smtpTransport(resolved: ResolvedMailConnection) {
    const policy = mailEndpointTransportPolicy(resolved.smtp);
    return nodemailer.createTransport({
      host: policy.servername,
      port: resolved.smtp.port,
      secure: resolved.smtp.tls_mode === "implicit_tls",
      requireTLS: resolved.smtp.tls_mode === "starttls",
      ignoreTLS: false,
      auth: {
        user: resolved.configuration.username,
        pass: resolved.configuration.application_password,
      },
      tls: {
        ...policy.tls,
        lookup: policy.lookup,
      },
      connectionTimeout: 20_000,
      greetingTimeout: 20_000,
      socketTimeout: 60_000,
      disableFileAccess: true,
      disableUrlAccess: true,
      getSocket: (_options, callback) => {
        let settled = false;
        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          callback(error, {});
        };
        if (resolved.smtp.tls_mode === "implicit_tls") {
          const socket = tlsConnect({
            host: policy.connectAddress,
            port: resolved.smtp.port,
            ...policy.tls,
          }, () => {
            if (settled) return;
            settled = true;
            socket.off("error", fail);
            callback(null, { connection: socket, secured: true });
          });
          socket.once("error", fail);
          return;
        }
        const socket = netConnect({
          host: policy.connectAddress,
          port: resolved.smtp.port,
          family: policy.family,
        }, () => {
          if (settled) return;
          settled = true;
          socket.off("error", fail);
          callback(null, { connection: socket });
        });
        socket.once("error", fail);
      },
    } satisfies SMTPTransport.Options);
  }

  private async withCredentialLock<T>(
    mailboxId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.credentialLocks.get(mailboxId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolveLock) => {
      release = resolveLock;
    });
    const tail = previous.then(() => current);
    this.credentialLocks.set(mailboxId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.credentialLocks.get(mailboxId) === tail) {
        this.credentialLocks.delete(mailboxId);
      }
    }
  }

  private async persistCredential(mailboxId: string, credential: StoredCredential): Promise<void> {
    const path = this.credentialPath(mailboxId);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await chmod(dirname(path), 0o700);
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(credential)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, path);
      await chmod(path, 0o600);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private async persistConnectionRollback(
    mailboxId: string,
    rollback: ConnectionRollback,
  ): Promise<void> {
    const path = this.connectionRollbackPath(mailboxId);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await chmod(dirname(path), 0o700);
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(rollback)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, path);
      await chmod(path, 0o600);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private async persistAddressProbeReceipt(
    mailboxId: string,
    receipt: AddressProbeReceipt,
  ): Promise<void> {
    const path = this.addressProbePath(mailboxId);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await chmod(dirname(path), 0o700);
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(receipt)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, path);
      await chmod(path, 0o600);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private async readAddressProbeReceipt(
    mailboxId: string,
  ): Promise<AddressProbeReceipt | null> {
    let source: string;
    try {
      source = await readFile(this.addressProbePath(mailboxId), "utf8");
    } catch (error) {
      if (
        error instanceof Error
        && "code" in error
        && error.code === "ENOENT"
      ) {
        return null;
      }
      throw new MailServiceError("MAIL_ADDRESS_PROBE_RECEIPT_INVALID", false);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(source);
    } catch {
      throw new MailServiceError("MAIL_ADDRESS_PROBE_RECEIPT_INVALID", false);
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new MailServiceError("MAIL_ADDRESS_PROBE_RECEIPT_INVALID", false);
    }
    const record = raw as Record<string, unknown>;
    if (
      typeof record.operation_id !== "string"
      || record.operation_id.length < 1
      || record.operation_id.length > 200
      || !Number.isSafeInteger(record.credential_version)
      || Number(record.credential_version) < 1
      || typeof record.configuration_fingerprint !== "string"
      || !/^[\da-f]{64}$/u.test(record.configuration_fingerprint)
      || typeof record.message_id !== "string"
      || record.message_id.length < 3
      || record.message_id.length > 2_048
      || !["pending", "smtp_accepted", "unknown", "verified", "rejected"]
        .includes(String(record.status))
    ) {
      throw new MailServiceError("MAIL_ADDRESS_PROBE_RECEIPT_INVALID", false);
    }
    return {
      operation_id: record.operation_id,
      credential_version: Number(record.credential_version),
      configuration_fingerprint: record.configuration_fingerprint,
      message_id: record.message_id,
      status: record.status as AddressProbeReceipt["status"],
    };
  }

  private async readCredential(mailboxId: string): Promise<StoredCredential> {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(this.credentialPath(mailboxId), "utf8"));
    } catch {
      throw new MailServiceError("MAILBOX_NOT_CONNECTED", false);
    }
    return parseStoredCredential(raw);
  }

  private async readCredentialOrNull(mailboxId: string): Promise<StoredCredential | null> {
    try {
      return await this.readCredential(mailboxId);
    } catch (error) {
      if (error instanceof MailServiceError && error.code === "MAILBOX_NOT_CONNECTED") {
        return null;
      }
      throw error;
    }
  }

  private async readConnectionRollback(mailboxId: string): Promise<ConnectionRollback | null> {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(this.connectionRollbackPath(mailboxId), "utf8"));
    } catch {
      return null;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new MailServiceError("MAIL_CONNECTION_ROLLBACK_INVALID", false);
    }
    const record = raw as Record<string, unknown>;
    if (
      typeof record.operation_id !== "string"
      || record.operation_id.length < 1
      || record.operation_id.length > 200
      || !Number.isSafeInteger(record.credential_version)
      || Number(record.credential_version) < 1
    ) {
      throw new MailServiceError("MAIL_CONNECTION_ROLLBACK_INVALID", false);
    }
    const previous = record.previous === null
      ? null
      : parseStoredCredential(record.previous);
    return {
      operation_id: record.operation_id,
      credential_version: Number(record.credential_version),
      previous,
      result: runtimeMailboxConnectResultSchema.parse(record.result),
    };
  }

  private async removeMailboxData(mailboxId: string, removeIndex: boolean): Promise<void> {
    const credentialPath = this.credentialPath(mailboxId);
    const rollbackPath = this.connectionRollbackPath(mailboxId);
    const addressProbePath = this.addressProbePath(mailboxId);
    const credentialDirectory = dirname(credentialPath);
    await Promise.all([
      rm(credentialPath, { force: true }),
      rm(rollbackPath, { force: true }),
      rm(addressProbePath, { force: true }),
      rm(this.fingerprintKeyPath(mailboxId), { force: true }),
    ]);
    const temporaryPrefixes = [
      `${basename(credentialPath)}.`,
      `${basename(rollbackPath)}.`,
      `${basename(addressProbePath)}.`,
    ];
    const credentialEntries = await readdir(credentialDirectory).catch(() => []);
    await Promise.all(credentialEntries
      .filter((entry) => (
        entry.endsWith(".tmp")
        && temporaryPrefixes.some((prefix) => entry.startsWith(prefix))
      ))
      .map((entry) => rm(resolve(credentialDirectory, entry), { force: true })));
    if (removeIndex) {
      const indexPath = this.indexPath(mailboxId);
      await Promise.all([
        rm(indexPath, { force: true }),
        rm(`${indexPath}-wal`, { force: true }),
        rm(`${indexPath}-shm`, { force: true }),
      ]);
    }
  }

  private async readOrCreateFingerprintKey(mailboxId: string): Promise<Buffer> {
    const path = this.fingerprintKeyPath(mailboxId);
    try {
      const existing = await readFile(path);
      if (existing.byteLength !== 32) throw new Error("invalid key length");
      return existing;
    } catch {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await chmod(dirname(path), 0o700);
      const key = randomBytes(32);
      try {
        const handle = await open(path, "wx", 0o600);
        try {
          await handle.writeFile(key);
          await handle.sync();
        } finally {
          await handle.close();
        }
        return key;
      } catch {
        const winner = await readFile(path);
        if (winner.byteLength !== 32) {
          throw new MailServiceError("MAIL_RECEIPT_KEY_INVALID", false);
        }
        return winner;
      }
    }
  }

  private credentialPath(mailboxId: string): string {
    return resolve(
      this.workdir,
      MAILBOXES_DIRECTORY,
      CREDENTIALS_DIRECTORY,
      `${safePathComponent(mailboxId, "mailbox_id")}.json`,
    );
  }

  private fingerprintKeyPath(mailboxId: string): string {
    return resolve(
      this.workdir,
      MAILBOXES_DIRECTORY,
      CREDENTIALS_DIRECTORY,
      `${safePathComponent(mailboxId, "mailbox_id")}.receipt-key`,
    );
  }

  private connectionRollbackPath(mailboxId: string): string {
    return resolve(
      this.workdir,
      MAILBOXES_DIRECTORY,
      CREDENTIALS_DIRECTORY,
      `${safePathComponent(mailboxId, "mailbox_id")}.connection-rollback.json`,
    );
  }

  private addressProbePath(mailboxId: string): string {
    return resolve(
      this.workdir,
      MAILBOXES_DIRECTORY,
      CREDENTIALS_DIRECTORY,
      `${safePathComponent(mailboxId, "mailbox_id")}.address-probe.json`,
    );
  }

  private indexPath(mailboxId: string): string {
    return resolve(
      this.workdir,
      MAILBOXES_DIRECTORY,
      INDEXES_DIRECTORY,
      `${safePathComponent(mailboxId, "mailbox_id")}.sqlite`,
    );
  }

  private openIndex(mailboxId: string): Database.Database {
    const path = this.indexPath(mailboxId);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    chmodSync(dirname(path), 0o700);
    const db = new Database(path);
    chmodSync(path, 0o600);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(`
      create table if not exists metadata (
        key text primary key,
        value text not null
      );
      create table if not exists folders (
        folder_id text primary key,
        path text not null,
        name text not null,
        role text not null,
        selectable integer not null,
        total_count integer,
        unread_count integer,
        uid_validity text
      );
      create table if not exists messages (
        folder_id text not null,
        folder_path text not null,
        uid_validity text not null,
        uid integer not null,
        message_id text not null,
        internet_message_id text,
        in_reply_to text,
        references_json text not null,
        thread_id text not null,
        subject text not null,
        sender_text text not null,
        recipient_text text not null,
        sent_at_ms integer,
        received_at_ms integer,
        summary_json text not null,
        indexed_at_ms integer not null,
        primary key (folder_id, uid_validity, uid)
      );
      create index if not exists messages_internet_id_idx
        on messages (internet_message_id);
      create index if not exists messages_date_idx
        on messages (received_at_ms, sent_at_ms);
      create table if not exists send_receipts (
        idempotency_key text primary key,
        fingerprint text not null,
        result_json text,
        created_at_ms integer not null
      );
      create table if not exists operation_receipts (
        operation_id text primary key,
        fingerprint text not null,
        result_json text,
        created_at_ms integer not null
      );
    `);
    this.pruneIndex(db);
    return db;
  }

  private pruneIndex(db: Database.Database): void {
    db.prepare(`
      delete from messages
      where max(coalesce(received_at_ms, sent_at_ms, 0), indexed_at_ms) < ?
    `).run(this.nowMs() - INDEX_WINDOW_MS);
  }
}

function parseStoredCredential(raw: unknown): StoredCredential {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new MailServiceError("MAIL_CREDENTIAL_INVALID", false);
  }
  const record = raw as Record<string, unknown>;
  const credentialVersion = record.credential_version;
  if (!Number.isSafeInteger(credentialVersion) || Number(credentialVersion) < 1) {
    throw new MailServiceError("MAIL_CREDENTIAL_INVALID", false);
  }
  const operationId = record.operation_id;
  if (operationId !== undefined && operationId !== null && (
    typeof operationId !== "string"
    || operationId.length < 1
    || operationId.length > 200
  )) {
    throw new MailServiceError("MAIL_CREDENTIAL_INVALID", false);
  }
  return {
    credential_version: Number(credentialVersion),
    operation_id: typeof operationId === "string" ? operationId : null,
    connection_result: record.connection_result === undefined || record.connection_result === null
      ? null
      : runtimeMailboxConnectResultSchema.parse(record.connection_result),
    configuration: mailConnectionConfigurationSchema.parse(record.configuration),
  };
}

function sameConnectionConfiguration(
  stored: StoredCredential["configuration"],
  requested: StoredCredential["configuration"],
): boolean {
  // Compare fixed-size digests so a replay never exposes or logs the secret
  // configuration and does not short-circuit on the first differing byte.
  const storedDigest = createHash("sha256").update(JSON.stringify(stored)).digest();
  const requestedDigest = createHash("sha256").update(JSON.stringify(requested)).digest();
  return timingSafeEqual(storedDigest, requestedDigest);
}

function projectFolder(mailboxId: string, folder: ListResponse): MailFolder {
  const specialUse = folder.specialUse?.toLowerCase();
  const path = folder.path;
  const role: MailFolder["role"] = path.toUpperCase() === "INBOX" || specialUse === "\\inbox"
    ? "inbox"
    : specialUse === "\\sent"
      ? "sent"
      : specialUse === "\\drafts"
        ? "drafts"
        : specialUse === "\\trash"
          ? "trash"
          : specialUse === "\\junk"
            ? "junk"
            : specialUse === "\\archive" || specialUse === "\\all"
              ? "archive"
              : "other";
  return {
    folder_id: encodeFolderId(path),
    mailbox_id: mailboxId,
    name: folder.name,
    path,
    role,
    selectable: selectableFolder(folder),
    total_count: folder.status?.messages ?? null,
    unread_count: folder.status?.unseen ?? null,
    uid_validity: folder.status?.uidValidity?.toString() ?? null,
  };
}

function selectableFolder(folder: ListResponse): boolean {
  return ![...folder.flags].some((flag) => flag.toLowerCase() === "\\noselect");
}

function mailCapabilities(client: ImapFlow, folders: ListResponse[]): MailCapabilities {
  const sent = folders.some((folder) => (
    folder.specialUse?.toLowerCase() === "\\sent"
    || /(^|[/.])sent(?: mail| items)?$/iu.test(folder.path)
  ));
  const trash = folders.some((folder) => (
    folder.specialUse?.toLowerCase() === "\\trash"
    || /(^|[/.])trash$/iu.test(folder.path)
  ));
  const move = client.capabilities.has("MOVE");
  return {
    folders: true,
    search: true,
    flags: true,
    move,
    trash: trash && move,
    append_sent: sent,
  };
}

function selectedUidValidity(client: ImapFlow): string {
  if (!client.mailbox) throw new MailServiceError("MAIL_FOLDER_NOT_OPEN", false);
  return client.mailbox.uidValidity.toString();
}

async function parseHeaderBuffer(headers: Buffer | undefined): Promise<ParsedMail> {
  if (!headers) {
    return simpleParser(Buffer.from("\r\n"));
  }
  return simpleParser(Buffer.concat([headers, Buffer.from("\r\n\r\n")]), {
    skipHtmlToText: true,
    skipTextToHtml: true,
  });
}

function participants(
  source: MessageAddressObject[] | { name?: string; address?: string }[] | undefined,
): MailParticipant[] {
  if (!source) return [];
  return source.flatMap((entry) => {
    if (!entry.address) return [];
    const address = entry.address.trim().toLowerCase();
    const participant = mailParticipantSchema.safeParse({
      name: entry.name?.trim()
        ? boundedText(entry.name.trim(), 500)
        : null,
      address,
    });
    return participant.success ? [participant.data] : [];
  });
}

function addressValues(
  value: ParsedMail["to"] | ParsedMail["cc"],
): { name?: string; address?: string }[] | undefined {
  if (!value) return undefined;
  const list = Array.isArray(value) ? value : [value];
  return list.flatMap((addressObject) => addressObject.value);
}

function referenceList(value: ParsedMail["references"]): string[] {
  return (Array.isArray(value) ? value : value ? [value] : [])
    .map(normalizeMessageId)
    .filter((item): item is string => item !== null)
    .slice(0, 100);
}

function attachmentMetadata(root: MessageStructureObject | undefined): MailAttachment[] {
  const result: MailAttachment[] = [];
  const visit = (node: MessageStructureObject): void => {
    const filename = node.dispositionParameters?.filename ?? node.parameters?.name ?? null;
    const disposition = node.disposition?.toLowerCase();
    if (node.part && (filename || disposition === "attachment" || disposition === "inline")) {
      const contentType = node.type?.trim();
      result.push({
        attachment_id: encodeAttachmentId(node.part),
        filename: filename ? boundedText(filename, 1_024) : null,
        content_type: contentType
          ? boundedText(contentType, 255)
          : "application/octet-stream",
        size_bytes: nonnegativeInteger(node.size),
        content_id: node.id ? boundedText(node.id, 1_024) : null,
        disposition: disposition === "inline" ? "inline" : "attachment",
      });
    }
    for (const child of node.childNodes ?? []) visit(child);
  };
  if (root) visit(root);
  return result;
}

function dateMs(value: Date | string | undefined): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) && time >= 0 ? time : null;
}

function boundedText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function nonnegativeInteger(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

function messageIdentity(message: MailMessageSummary): string {
  return `${message.mailbox_id}\0${message.message_id}`;
}

export function encodeFolderId(path: string): string {
  return `mail_folder_${Buffer.from(path, "utf8").toString("base64url")}`;
}

function decodeFolderId(folderId: string): string {
  if (!folderId.startsWith("mail_folder_")) {
    throw new MailServiceError("MAIL_FOLDER_ID_INVALID", false);
  }
  const path = Buffer.from(folderId.slice("mail_folder_".length), "base64url").toString("utf8");
  if (!path || path.includes("\0")) throw new MailServiceError("MAIL_FOLDER_ID_INVALID", false);
  return path;
}

export function encodeMessageId(folderId: string, uidValidity: string, uid: number): string {
  return `mail_message_${Buffer.from(
    `${folderId}\0${uidValidity}\0${uid}`,
    "utf8",
  ).toString("base64url")}`;
}

function decodeMessageId(messageId: string): {
  folderId: string;
  uidValidity: string;
  uid: number;
} {
  if (!messageId.startsWith("mail_message_")) {
    throw new MailServiceError("MAIL_MESSAGE_ID_INVALID", false);
  }
  const decoded = Buffer.from(
    messageId.slice("mail_message_".length),
    "base64url",
  ).toString("utf8");
  const [folderId, uidValidity, uidSource, ...rest] = decoded.split("\0");
  const uid = Number(uidSource);
  if (
    rest.length > 0
    || !folderId?.startsWith("mail_folder_")
    || !/^\d+$/u.test(uidValidity ?? "")
  ) {
    throw new MailServiceError("MAIL_MESSAGE_ID_INVALID", false);
  }
  if (!Number.isSafeInteger(uid) || uid < 1) {
    throw new MailServiceError("MAIL_MESSAGE_ID_INVALID", false);
  }
  return { folderId, uidValidity: uidValidity!, uid };
}

export function encodeAttachmentId(part: string): string {
  return `mail_attachment_${Buffer.from(part, "utf8").toString("base64url")}`;
}

function decodeAttachmentId(attachmentId: string): string {
  if (!attachmentId.startsWith("mail_attachment_")) {
    throw new MailServiceError("MAIL_ATTACHMENT_ID_INVALID", false);
  }
  const part = Buffer.from(
    attachmentId.slice("mail_attachment_".length),
    "base64url",
  ).toString("utf8");
  if (!/^\d+(?:\.\d+)*$/u.test(part)) {
    throw new MailServiceError("MAIL_ATTACHMENT_ID_INVALID", false);
  }
  return part;
}

export function encodeMessageCursor(folderId: string, uidValidity: string, uid: number): string {
  return `mail_cursor_${Buffer.from(
    `${folderId}\0${uidValidity}\0${uid}`,
    "utf8",
  ).toString("base64url")}`;
}

export function decodeMessageCursor(cursor: string): {
  folderId: string;
  uidValidity: string;
  uid: number;
} {
  const encoded = cursor.startsWith("mail_cursor_")
    ? cursor.slice("mail_cursor_".length)
    : "";
  if (!encoded || !/^[A-Za-z0-9_-]+$/u.test(encoded)) {
    throw new MailServiceError("MAIL_CURSOR_INVALID", false);
  }
  const decoded = Buffer.from(encoded, "base64url").toString("utf8");
  if (Buffer.from(decoded, "utf8").toString("base64url") !== encoded) {
    throw new MailServiceError("MAIL_CURSOR_INVALID", false);
  }
  const [folderId, uidValidity, uidSource, ...rest] = decoded.split("\0");
  const uid = Number(uidSource);
  if (
    rest.length > 0
    || !folderId?.startsWith("mail_folder_")
    || !/^\d+$/u.test(uidValidity ?? "")
    || !Number.isSafeInteger(uid)
    || uid < 1
  ) {
    throw new MailServiceError("MAIL_CURSOR_INVALID", false);
  }
  return { folderId, uidValidity: uidValidity!, uid };
}

function mailBodyWithinContract(value: string | null): string | null {
  if (value !== null && value.length > MAX_MAIL_BODY_CHARACTERS) {
    throw new MailServiceError("MAIL_MESSAGE_BODY_TOO_LARGE", false);
  }
  return value;
}

async function streamBuffer(
  stream: NodeJS.ReadableStream | Buffer,
  maxBytes: number,
): Promise<Buffer> {
  if (Buffer.isBuffer(stream)) {
    if (stream.byteLength > maxBytes) throw new MailServiceError("MAIL_ATTACHMENT_TOO_LARGE", false);
    return stream;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream as AsyncIterable<Buffer | Uint8Array | string>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBytes) throw new MailServiceError("MAIL_ATTACHMENT_TOO_LARGE", false);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function smtpOutcomeUnknown(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const smtpError = error as Error & {
    code?: unknown;
    command?: unknown;
    responseCode?: unknown;
  };
  const code = String(smtpError.code ?? "");
  const command = String(smtpError.command ?? "").toUpperCase();
  const hasServerResponse = (
    typeof smtpError.responseCode === "number"
    && Number.isFinite(smtpError.responseCode)
  );
  return !hasServerResponse
    && command === "DATA"
    && [
      "ETIMEDOUT",
      "ECONNECTION",
      "ECONNRESET",
      "EPIPE",
      "ESOCKET",
    ].includes(code);
}

function ownershipProbeMessageId(operationId: string, emailAddress: string): string {
  const digest = createHash("sha256")
    .update(operationId)
    .update("\0")
    .update(emailAddress.trim().toLowerCase())
    .digest("hex");
  return `<fields-mail-address-probe-${digest}@fields.invalid>`;
}

async function sleep(intervalMs: number): Promise<void> {
  await new Promise<void>((resolveSleep) => {
    setTimeout(resolveSleep, intervalMs);
  });
}

function safeMailErrorCode(error: unknown): string {
  if (
    error instanceof MailServiceError
    && /^MAIL_[A-Z0-9_]{1,115}$/u.test(error.code)
  ) {
    return error.code;
  }
  return "MAIL_SENT_COPY_FAILED";
}

export async function writeWorkspaceAttachment(
  workspaceRoot: string,
  relativePath: string,
  content: Buffer,
  testHooks: { beforeCreate?: () => Promise<void> } = {},
): Promise<void> {
  if (isAbsolute(relativePath) || relativePath.includes("\0")) {
    throw new MailServiceError("MAIL_ATTACHMENT_PATH_INVALID", false);
  }
  const root = await realpath(resolve(workspaceRoot)).catch(() => null);
  if (!root) throw new MailServiceError("MAIL_ATTACHMENT_WORKSPACE_UNAVAILABLE", false);
  const target = resolve(root, relativePath);
  const inside = target !== root && target.startsWith(`${root}${sep}`);
  if (!inside || relative(root, target).startsWith("..")) {
    throw new MailServiceError("MAIL_ATTACHMENT_PATH_INVALID", false);
  }
  const relativeTarget = relative(root, target);
  const segments = relativeTarget.split(sep);
  const filename = segments.pop();
  if (!filename || filename === "." || filename === "..") {
    throw new MailServiceError("MAIL_ATTACHMENT_PATH_INVALID", false);
  }
  const directoryHandles = [];
  let directoryHandle = await open(
    root,
    fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
  );
  directoryHandles.push(directoryHandle);
  try {
    for (const segment of segments) {
      if (!segment || segment === "." || segment === "..") {
        throw new MailServiceError("MAIL_ATTACHMENT_PATH_INVALID", false);
      }
      const next = await open(
        `/proc/self/fd/${directoryHandle.fd}/${segment}`,
        fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
      ).catch(() => null);
      if (!next) throw new MailServiceError("MAIL_ATTACHMENT_PATH_INVALID", false);
      const metadata = await next.stat();
      const openedPath = await realpath(`/proc/self/fd/${next.fd}`).catch(() => null);
      if (!metadata.isDirectory() || !openedPath || !pathContained(root, openedPath)) {
        await next.close();
        throw new MailServiceError("MAIL_ATTACHMENT_PATH_INVALID", false);
      }
      directoryHandles.push(next);
      directoryHandle = next;
    }
    await testHooks.beforeCreate?.();
    const handle = await open(
      `/proc/self/fd/${directoryHandle.fd}/${filename}`,
      fsConstants.O_WRONLY
        | fsConstants.O_CREAT
        | fsConstants.O_EXCL
        | fsConstants.O_NOFOLLOW,
      0o600,
    ).catch((error: unknown) => {
      const code = error instanceof Error && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
      throw new MailServiceError(
        code === "EEXIST" ? "MAIL_ATTACHMENT_DESTINATION_EXISTS" : "MAIL_ATTACHMENT_PATH_INVALID",
        false,
      );
    });
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.nlink !== 1) {
      await handle.close();
      throw new MailServiceError("MAIL_ATTACHMENT_NOT_REGULAR", false);
    }
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
  } finally {
    await Promise.all(directoryHandles.reverse().map((handle) => handle.close().catch(() => undefined)));
  }
}

async function readWorkspaceRegularFile(
  workspaceRoot: string,
  workspaceRelativePath: string,
  maxBytes: number,
): Promise<Buffer> {
  if (isAbsolute(workspaceRelativePath) || maxBytes < 0) {
    throw new MailServiceError("MAIL_ATTACHMENT_WORKSPACE_ACCESS_DENIED", false);
  }
  const rootMetadata = await lstat(workspaceRoot);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new MailServiceError("MAIL_ATTACHMENT_WORKSPACE_ACCESS_DENIED", false);
  }
  const root = await realpath(workspaceRoot);
  const target = resolve(root, workspaceRelativePath);
  const relativeTarget = relative(root, target);
  if (
    relativeTarget.length === 0
    || relativeTarget === ".."
    || relativeTarget.startsWith(`..${sep}`)
    || isAbsolute(relativeTarget)
  ) {
    throw new MailServiceError("MAIL_ATTACHMENT_WORKSPACE_ACCESS_DENIED", false);
  }
  let parent = root;
  for (const segment of dirname(relativeTarget).split(sep).filter((item) => item !== ".")) {
    parent = resolve(parent, segment);
    const metadata = await lstat(parent);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new MailServiceError("MAIL_ATTACHMENT_WORKSPACE_ACCESS_DENIED", false);
    }
  }
  let handle;
  try {
    handle = await open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch {
    throw new MailServiceError("MAIL_ATTACHMENT_WORKSPACE_ACCESS_DENIED", false);
  }
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.nlink !== 1) {
      throw new MailServiceError("MAIL_ATTACHMENT_NOT_REGULAR", false);
    }
    const openedPath = await realpath(`/proc/self/fd/${handle.fd}`).catch(() => null);
    if (!openedPath || !pathContained(root, openedPath)) {
      throw new MailServiceError("MAIL_ATTACHMENT_WORKSPACE_ACCESS_DENIED", false);
    }
    if (metadata.size > maxBytes) {
      throw new MailServiceError("MAIL_ATTACHMENT_TOO_LARGE", false);
    }
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes - total + 1));
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) {
        throw new MailServiceError("MAIL_ATTACHMENT_TOO_LARGE", false);
      }
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
}

function pathContained(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation.length > 0
    && relation !== ".."
    && !relation.startsWith(`..${sep}`)
    && !isAbsolute(relation);
}
