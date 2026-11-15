import {
  mailAttachmentReadResultSchema,
  mailFolderListResultSchema,
  mailMessagePageSchema,
  mailMessageSchema,
  mailMessageUpdateResultSchema,
  mailboxSchema,
  mailSendResultSchema,
  type MailAttachmentReadInput,
  type MailAttachmentReadResult,
  type MailConnectionConfiguration,
  type MailFolderListResult,
  type MailMessage,
  type MailMessageListInput,
  type MailMessagePage,
  type MailMessageReadInput,
  type MailMessageSearchInput,
  type MailMessageUpdateInput,
  type MailMessageUpdateResult,
  type Mailbox,
  type MailSendInput,
  type MailSendResult,
  type MailSharedGrant,
} from "@fields/contracts/public/mail";
import type { RuntimeMailboxAuthority } from "@fields/contracts/internal/mail";
import { and, asc, eq } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";

import type {
  ListActiveOrdinaryActorProfilesUseCase,
} from "../../../../../application/actor/index.js";
import type {
  MailActorAuthority,
  MailApplication,
  MailMemberCleanupProjection,
  MailRuntimeGateway,
} from "../../../../../application/mail/index.js";
import { ApplicationError } from "../../../../../application/platform/errors.js";
import type { BackendDatabase } from "../../database-service.js";
import {
  companyMailboxAuditEvents,
  companyMailboxGrants,
  companyMailboxMutationReceipts,
  companyMailboxes,
} from "../../schema/company/mail.js";

export const MAIL_ACCESS_DENIED_CODE = "MAIL_ACCESS_DENIED";
export const MAILBOX_NOT_FOUND_CODE = "MAILBOX_NOT_FOUND";
export const MAILBOX_INVALID_CODE = "MAILBOX_INVALID";
export const MAILBOX_IDEMPOTENCY_CONFLICT_CODE = "MAILBOX_IDEMPOTENCY_CONFLICT";
export const MAILBOX_CONNECTION_RECOVERY_PENDING_CODE =
  "MAILBOX_CONNECTION_RECOVERY_PENDING";

const EMPTY_CAPABILITIES = {
  folders: false,
  search: false,
  flags: false,
  move: false,
  trash: false,
  append_sent: false,
} as const;

export class PostgresMailMemberCleanupProjection implements MailMemberCleanupProjection {
  constructor(
    private readonly db: BackendDatabase,
    private readonly nowMs: () => number = Date.now,
  ) {}

  async cleanupRemovedMember(input: {
    companyId: string;
    memberId: string;
    operationId: string;
  }): Promise<void> {
    const now = this.nowMs();
    const auditKey = createHash("sha256").update([
      input.companyId,
      input.memberId,
      input.operationId,
    ].join("\0")).digest("hex");
    await this.db.transaction(async (transaction) => {
      const [personal] = await transaction.select({
        mailboxId: companyMailboxes.mailboxId,
      }).from(companyMailboxes).where(and(
        eq(companyMailboxes.companyId, input.companyId),
        eq(companyMailboxes.kind, "personal"),
        eq(companyMailboxes.targetActorId, input.memberId),
      )).limit(1);
      await transaction.delete(companyMailboxGrants).where(and(
        eq(companyMailboxGrants.companyId, input.companyId),
        eq(companyMailboxGrants.actorId, input.memberId),
      ));
      await transaction.delete(companyMailboxes).where(and(
        eq(companyMailboxes.companyId, input.companyId),
        eq(companyMailboxes.kind, "personal"),
        eq(companyMailboxes.targetActorId, input.memberId),
      ));
      await transaction.insert(companyMailboxAuditEvents).values({
        auditEventId: `mail_member_cleanup_${auditKey}`,
        companyId: input.companyId,
        mailboxId: personal?.mailboxId ?? null,
        actorId: input.memberId,
        operation: "member_cleanup",
        itemCount: personal ? 1 : 0,
        sizeBytes: 0,
        outcome: "succeeded",
        createdAtMs: now,
      }).onConflictDoNothing();
    });
  }
}

export class PostgresMailApplication implements MailApplication {
  constructor(
    private readonly db: BackendDatabase,
    private readonly runtime: MailRuntimeGateway,
    private readonly actorProfiles: ListActiveOrdinaryActorProfilesUseCase,
    private readonly nowMs: () => number = Date.now,
    private readonly newId: () => string = randomUUID,
  ) {}

  async listMailboxes(authority: MailActorAuthority): Promise<{ items: Mailbox[] }> {
    const rows = await this.db.select({
      mailbox: companyMailboxes,
      grantedActorId: companyMailboxGrants.actorId,
    }).from(companyMailboxes)
      .leftJoin(
        companyMailboxGrants,
        and(
          eq(companyMailboxGrants.mailboxId, companyMailboxes.mailboxId),
          eq(companyMailboxGrants.actorId, authority.actorId),
        ),
      )
      .where(eq(companyMailboxes.companyId, authority.companyId))
      .orderBy(asc(companyMailboxes.kind), asc(companyMailboxes.displayName));
    const visibleRows = rows.filter(({ mailbox }) => !isPristinePersonalSlot(mailbox));
    const otherPersonalActorIds = visibleRows.flatMap(({ mailbox }) => (
      mailbox.kind === "personal"
      && mailbox.targetActorId
      && mailbox.targetActorId !== authority.actorId
        ? [mailbox.targetActorId]
        : []
    ));
    const actorTypes = new Map<string, string>();
    if (authority.isCompanyOwner && otherPersonalActorIds.length > 0) {
      const targetActors = await this.actorProfiles.execute({
        companyId: authority.companyId,
        actorIds: otherPersonalActorIds,
      });
      for (const actor of targetActors) actorTypes.set(actor.actorId, actor.actorType);
    }
    return {
      items: visibleRows.flatMap(({ mailbox, grantedActorId }) => {
        const access = resolveMailboxAccess({
          requesterActorId: authority.actorId,
          isCompanyOwner: authority.isCompanyOwner,
          kind: mailbox.kind,
          targetActorId: mailbox.targetActorId,
          targetActorType: mailbox.targetActorId
            ? actorTypes.get(mailbox.targetActorId) as "human" | "agent" | undefined
            : undefined,
          granted: Boolean(grantedActorId),
          requireManage: false,
        });
        return access ? [this.project(mailbox, access)] : [];
      }),
    };
  }

  async readMailbox(authority: MailActorAuthority, mailboxId: string): Promise<Mailbox> {
    const access = await this.requireMailbox(authority, mailboxId);
    return this.project(access.row, access.authority.access);
  }

  async connectPersonal(
    authority: MailActorAuthority,
    targetActorId: string | undefined,
    configuration: MailConnectionConfiguration,
    idempotencyKey: string,
  ): Promise<{ mailbox: Mailbox }> {
    const targetId = targetActorId ?? authority.actorId;
    const actor = await this.requireTargetActor(authority.companyId, targetId);
    if (actor.actorType === "human" && targetId !== authority.actorId) {
      throw new ApplicationError(MAIL_ACCESS_DENIED_CODE, false);
    }
    if (actor.actorType === "agent" && !authority.isCompanyOwner) {
      throw new ApplicationError(MAIL_ACCESS_DENIED_CODE, false);
    }
    const {
      application_password: _applicationPassword,
      ...nonSecretConfiguration
    } = configuration;
    const fingerprint = requestFingerprint({
      targetActorId: targetId,
      configuration: nonSecretConfiguration,
    });
    const operation = "connect_personal";
    const existingReceipt = await this.readConnectionReceipt(
      authority,
      idempotencyKey,
      operation,
      fingerprint,
    );
    const mailboxId = existingReceipt?.mailboxId
      ?? personalMailboxId(authority.companyId, targetId);
    const access: RuntimeMailboxAuthority = {
      company_id: authority.companyId,
      requested_by_actor_id: authority.actorId,
      mailbox_id: mailboxId,
      access: targetId === authority.actorId ? "personal" : "company_owner",
    };
    if (existingReceipt) {
      return this.resumeConnectionReceipt(
        authority,
        existingReceipt,
        access,
        configuration,
        configuration.display_name ?? actor.displayName,
      );
    }
    let [existing] = await this.db.select().from(companyMailboxes).where(and(
      eq(companyMailboxes.companyId, authority.companyId),
      eq(companyMailboxes.kind, "personal"),
      eq(companyMailboxes.targetActorId, targetId),
    )).limit(1);
    const now = this.nowMs();
    if (!existing) {
      const [inserted] = await this.db.insert(companyMailboxes).values({
        mailboxId,
        companyId: authority.companyId,
        kind: "personal",
        targetActorId: targetId,
        displayName: configuration.display_name ?? actor.displayName,
        emailAddress: null,
        connectionState: "unconnected",
        credentialVersion: 0,
        ...capabilityColumns(EMPTY_CAPABILITIES),
        lastCheckedAtMs: null,
        lastErrorCode: null,
        createdByActorId: authority.actorId,
        createdAtMs: now,
        updatedAtMs: now,
      })
        .onConflictDoNothing()
        .returning();
      existing = inserted ?? (await this.db.select().from(companyMailboxes).where(and(
        eq(companyMailboxes.companyId, authority.companyId),
        eq(companyMailboxes.kind, "personal"),
        eq(companyMailboxes.targetActorId, targetId),
      )).limit(1))[0];
    }
    if (!existing || existing.mailboxId !== mailboxId) {
      throw new ApplicationError("MAILBOX_OPERATION_IN_PROGRESS", true);
    }
    const receipt = await this.createConnectionReceipt({
      authority,
      idempotencyKey,
      operation,
      fingerprint,
      mailboxId,
      previous: existing,
    });
    return this.resumeConnectionReceipt(
      authority,
      receipt,
      access,
      configuration,
      configuration.display_name ?? actor.displayName,
    );
  }

  async connectShared(
    authority: MailActorAuthority,
    input: {
      mailboxId?: string;
      name: string;
      configuration: MailConnectionConfiguration;
      idempotencyKey: string;
    },
  ): Promise<{ mailbox: Mailbox }> {
    this.requireOwner(authority);
    const {
      application_password: _applicationPassword,
      ...nonSecretConfiguration
    } = input.configuration;
    const fingerprint = requestFingerprint({
      mailboxId: input.mailboxId ?? null,
      name: input.name,
      configuration: nonSecretConfiguration,
    });
    const operation = "connect_shared";
    const existingReceipt = await this.readConnectionReceipt(
      authority,
      input.idempotencyKey,
      operation,
      fingerprint,
    );
    if (existingReceipt) {
      const access: RuntimeMailboxAuthority = {
        company_id: authority.companyId,
        requested_by_actor_id: authority.actorId,
        mailbox_id: existingReceipt.mailboxId,
        access: "company_owner",
      };
      return this.resumeConnectionReceipt(
        authority,
        existingReceipt,
        access,
        input.configuration,
        input.name,
      );
    }
    let [existing] = input.mailboxId
      ? await this.db.select().from(companyMailboxes).where(and(
        eq(companyMailboxes.companyId, authority.companyId),
        eq(companyMailboxes.mailboxId, input.mailboxId),
        eq(companyMailboxes.kind, "shared"),
      )).limit(1)
      : [];
    if (input.mailboxId && !existing) throw new ApplicationError(MAILBOX_NOT_FOUND_CODE, false);
    const now = this.nowMs();
    const mailboxId = existing?.mailboxId ?? `mailbox_${this.newId()}`;
    if (!existing) {
      const [inserted] = await this.db.insert(companyMailboxes).values({
        mailboxId,
        companyId: authority.companyId,
        kind: "shared",
        targetActorId: null,
        displayName: input.name,
        emailAddress: null,
        connectionState: "unconnected",
        credentialVersion: 0,
        ...capabilityColumns(EMPTY_CAPABILITIES),
        lastCheckedAtMs: null,
        lastErrorCode: null,
        createdByActorId: authority.actorId,
        createdAtMs: now,
        updatedAtMs: now,
      }).onConflictDoNothing().returning();
      existing = inserted;
    }
    if (!existing) throw new ApplicationError("MAILBOX_OPERATION_IN_PROGRESS", true);
    const receipt = await this.createConnectionReceipt({
      authority,
      idempotencyKey: input.idempotencyKey,
      operation,
      fingerprint,
      mailboxId,
      previous: existing,
    });
    const access: RuntimeMailboxAuthority = {
      company_id: authority.companyId,
      requested_by_actor_id: authority.actorId,
      mailbox_id: mailboxId,
      access: "company_owner",
    };
    return this.resumeConnectionReceipt(
      authority,
      receipt,
      access,
      input.configuration,
      input.name,
    );
  }

  async disconnect(authority: MailActorAuthority, mailboxId: string) {
    const access = await this.requireMailbox(authority, mailboxId, true);
    await this.runtime.disconnect(authority.companyId, {
      authority: access.authority,
      remove_index: true,
    });
    const now = this.nowMs();
    await this.db.transaction(async (transaction) => {
      await transaction.update(companyMailboxes).set({
        connectionState: "unconnected",
        emailAddress: null,
        ...capabilityColumns(EMPTY_CAPABILITIES),
        lastCheckedAtMs: now,
        lastErrorCode: null,
        updatedAtMs: now,
      }).where(eq(companyMailboxes.mailboxId, mailboxId));
      await transaction.insert(companyMailboxAuditEvents).values(
        auditRow(authority, mailboxId, "disconnect", "succeeded", now, this.newId),
      );
    });
    return { mailbox_id: mailboxId, connection_state: "unconnected" as const };
  }

  async deleteShared(authority: MailActorAuthority, mailboxId: string) {
    this.requireOwner(authority);
    const access = await this.requireMailbox(authority, mailboxId, true);
    if (access.row.kind !== "shared") throw new ApplicationError(MAILBOX_INVALID_CODE, false);
    await this.runtime.disconnect(authority.companyId, {
      authority: access.authority,
      remove_index: true,
    });
    const now = this.nowMs();
    await this.db.transaction(async (transaction) => {
      await transaction.delete(companyMailboxes).where(and(
        eq(companyMailboxes.companyId, authority.companyId),
        eq(companyMailboxes.mailboxId, mailboxId),
      ));
      await transaction.insert(companyMailboxAuditEvents).values(
        auditRow(authority, mailboxId, "delete_shared", "succeeded", now, this.newId),
      );
    });
    return { mailbox_id: mailboxId, deleted: true as const };
  }

  async listGrants(
    authority: MailActorAuthority,
    mailboxId: string,
  ): Promise<{ items: MailSharedGrant[] }> {
    this.requireOwner(authority);
    const mailbox = await this.requireMailbox(authority, mailboxId, true);
    if (mailbox.row.kind !== "shared") throw new ApplicationError(MAILBOX_INVALID_CODE, false);
    const rows = await this.db.select().from(companyMailboxGrants).where(and(
      eq(companyMailboxGrants.companyId, authority.companyId),
      eq(companyMailboxGrants.mailboxId, mailboxId),
    )).orderBy(asc(companyMailboxGrants.grantedAtMs));
    return {
      items: rows.map((row) => ({
        mailbox_id: row.mailboxId,
        actor_id: row.actorId,
        granted_at_ms: row.grantedAtMs,
        granted_by_actor_id: row.grantedByActorId,
      })),
    };
  }

  async grant(authority: MailActorAuthority, mailboxId: string, actorId: string) {
    this.requireOwner(authority);
    const mailbox = await this.requireMailbox(authority, mailboxId, true);
    if (mailbox.row.kind !== "shared") throw new ApplicationError(MAILBOX_INVALID_CODE, false);
    await this.requireTargetActor(authority.companyId, actorId);
    const now = this.nowMs();
    await this.db.transaction(async (transaction) => {
      await transaction.insert(companyMailboxGrants).values({
        companyId: authority.companyId,
        mailboxId,
        actorId,
        grantedByActorId: authority.actorId,
        grantedAtMs: now,
      }).onConflictDoUpdate({
        target: [companyMailboxGrants.mailboxId, companyMailboxGrants.actorId],
        set: { grantedByActorId: authority.actorId, grantedAtMs: now },
      });
      await transaction.insert(companyMailboxAuditEvents).values(
        auditRow(authority, mailboxId, "grant", "succeeded", now, this.newId),
      );
    });
    return { mailbox_id: mailboxId, actor_id: actorId, granted: true };
  }

  async revoke(authority: MailActorAuthority, mailboxId: string, actorId: string) {
    this.requireOwner(authority);
    const mailbox = await this.requireMailbox(authority, mailboxId, true);
    if (mailbox.row.kind !== "shared") throw new ApplicationError(MAILBOX_INVALID_CODE, false);
    const now = this.nowMs();
    await this.db.transaction(async (transaction) => {
      await transaction.delete(companyMailboxGrants).where(and(
        eq(companyMailboxGrants.companyId, authority.companyId),
        eq(companyMailboxGrants.mailboxId, mailboxId),
        eq(companyMailboxGrants.actorId, actorId),
      ));
      await transaction.insert(companyMailboxAuditEvents).values(
        auditRow(authority, mailboxId, "revoke", "succeeded", now, this.newId),
      );
    });
    return { mailbox_id: mailboxId, actor_id: actorId, granted: false };
  }

  async listFolders(authority: MailActorAuthority, mailboxId: string): Promise<MailFolderListResult> {
    const access = await this.requireMailbox(authority, mailboxId);
    return mailFolderListResultSchema.parse(
      await this.runtime.listFolders(authority.companyId, access.authority),
    );
  }

  async listMessages(authority: MailActorAuthority, input: MailMessageListInput): Promise<MailMessagePage> {
    const access = await this.requireMailbox(authority, input.mailbox_id);
    return mailMessagePageSchema.parse(await this.runtime.listMessages(
      authority.companyId,
      access.authority,
      withoutMailbox(input),
    ));
  }

  async searchMessages(authority: MailActorAuthority, input: MailMessageSearchInput): Promise<MailMessagePage> {
    const requested = input.mailbox_ids ?? (await this.listMailboxes(authority)).items
      .filter((mailbox) => mailbox.connection_state === "connected" || mailbox.connection_state === "limited")
      .map((mailbox) => mailbox.mailbox_id);
    if (requested.length === 0) {
      return mailMessagePageSchema.parse({
        items: [],
        next_cursor: null,
        coverage: {
          indexed_from_ms: null,
          includes_remote_results: false,
          partial: false,
          failed_mailbox_ids: [],
        },
      });
    }
    const authorities = await Promise.all(requested.map(async (mailboxId) => {
      const mailbox = await this.requireMailbox(authority, mailboxId);
      if (
        mailbox.row.connectionState !== "connected"
        && mailbox.row.connectionState !== "limited"
      ) {
        throw new ApplicationError("MAILBOX_NOT_CONNECTED", false);
      }
      return mailbox.authority;
    }));
    return mailMessagePageSchema.parse(await this.runtime.searchMessages(
      authority.companyId,
      authorities,
      withoutMailboxIds(input),
    ));
  }

  async readMessage(authority: MailActorAuthority, input: MailMessageReadInput): Promise<MailMessage> {
    const access = await this.requireMailbox(authority, input.mailbox_id);
    return mailMessageSchema.parse(await this.runtime.readMessage(
      authority.companyId,
      access.authority,
      withoutMailbox(input),
    ));
  }

  async sendMessage(authority: MailActorAuthority, input: MailSendInput): Promise<MailSendResult> {
    const access = await this.requireMailbox(authority, input.mailbox_id);
    const result = mailSendResultSchema.parse(await this.runtime.sendMessage(
      authority.companyId,
      access.authority,
      withoutMailbox(input),
    ));
    const sizeBytes = input.attachments.reduce(
      (sum, attachment) => sum + Buffer.byteLength(attachment.content_base64, "base64"),
      0,
    );
    await retryMailAudit(() => this.audit(
      authority,
      input.mailbox_id,
      "send",
      result.outcome,
      1,
      sizeBytes,
      input.idempotency_key,
    ));
    return result;
  }

  async updateMessage(
    authority: MailActorAuthority,
    input: MailMessageUpdateInput,
  ): Promise<MailMessageUpdateResult> {
    const access = await this.requireMailbox(authority, input.mailbox_id);
    const {
      mailbox_id: _mailboxId,
      idempotency_key: operationId,
      ...request
    } = input;
    const result = mailMessageUpdateResultSchema.parse(await this.runtime.updateMessage(
      authority.companyId,
      access.authority,
      request,
      operationId,
    ));
    if (input.operation === "move" || input.operation === "trash") {
      await retryMailAudit(() => this.audit(
        authority,
        input.mailbox_id,
        input.operation,
        "succeeded",
        1,
        0,
        operationId,
      ));
    }
    return result;
  }

  async readAttachment(
    authority: MailActorAuthority,
    input: MailAttachmentReadInput,
  ): Promise<MailAttachmentReadResult> {
    const access = await this.requireMailbox(authority, input.mailbox_id);
    return mailAttachmentReadResultSchema.parse(await this.runtime.readAttachment(
      authority.companyId,
      access.authority,
      withoutMailbox(input),
    ));
  }

  async recordRuntimeAudit(authority: MailActorAuthority, input: {
    operationId: string;
    mailboxId: string;
    operation: string;
    itemCount: number;
    sizeBytes: number;
    outcome: string;
  }): Promise<{ ok: true }> {
    const mailbox = await this.db.select({ mailboxId: companyMailboxes.mailboxId })
      .from(companyMailboxes)
      .where(and(
        eq(companyMailboxes.companyId, authority.companyId),
        eq(companyMailboxes.mailboxId, input.mailboxId),
      ))
      .limit(1);
    if (!mailbox[0]) throw new ApplicationError(MAILBOX_NOT_FOUND_CODE, false);
    const auditKey = createHash("sha256").update([
      authority.companyId,
      authority.actorId,
      input.mailboxId,
      input.operation,
      input.operationId,
    ].join("\0")).digest("hex");
    await this.db.insert(companyMailboxAuditEvents).values({
      auditEventId: `mail_audit_runtime_${auditKey}`,
      companyId: authority.companyId,
      mailboxId: input.mailboxId,
      actorId: authority.actorId,
      operation: input.operation,
      itemCount: input.itemCount,
      sizeBytes: input.sizeBytes,
      outcome: input.outcome,
      createdAtMs: this.nowMs(),
    }).onConflictDoNothing();
    return { ok: true };
  }

  private async readConnectionReceipt(
    authority: MailActorAuthority,
    idempotencyKey: string,
    operation: "connect_personal" | "connect_shared",
    fingerprint: string,
  ): Promise<typeof companyMailboxMutationReceipts.$inferSelect | null> {
    const [receipt] = await this.db.select().from(companyMailboxMutationReceipts).where(and(
      eq(companyMailboxMutationReceipts.companyId, authority.companyId),
      eq(companyMailboxMutationReceipts.actorId, authority.actorId),
      eq(companyMailboxMutationReceipts.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (!receipt) return null;
    if (receipt.operation !== operation || receipt.requestFingerprint !== fingerprint) {
      throw new ApplicationError(MAILBOX_IDEMPOTENCY_CONFLICT_CODE, false);
    }
    return receipt;
  }

  private async createConnectionReceipt(input: {
    authority: MailActorAuthority;
    idempotencyKey: string;
    operation: "connect_personal" | "connect_shared";
    fingerprint: string;
    mailboxId: string;
    previous: typeof companyMailboxes.$inferSelect;
  }): Promise<typeof companyMailboxMutationReceipts.$inferSelect> {
    const operationId = `mail_connect_${createHash("sha256").update([
      input.authority.companyId,
      input.authority.actorId,
      input.idempotencyKey,
    ].join("\0")).digest("hex")}`;
    const [inserted] = await this.db.insert(companyMailboxMutationReceipts).values({
      companyId: input.authority.companyId,
      actorId: input.authority.actorId,
      idempotencyKey: input.idempotencyKey,
      operation: input.operation,
      operationId,
      mailboxId: input.mailboxId,
      expectedCredentialVersion: input.previous.credentialVersion,
      credentialVersion: input.previous.credentialVersion + 1,
      previousMailboxJson: JSON.stringify(input.previous),
      requestFingerprint: input.fingerprint,
      resultJson: null,
      createdAtMs: this.nowMs(),
    }).onConflictDoNothing().returning();
    if (inserted) return inserted;
    const concurrent = await this.readConnectionReceipt(
      input.authority,
      input.idempotencyKey,
      input.operation,
      input.fingerprint,
    );
    if (!concurrent) throw new ApplicationError("MAILBOX_OPERATION_IN_PROGRESS", true);
    return concurrent;
  }

  private async resumeConnectionReceipt(
    authority: MailActorAuthority,
    receipt: typeof companyMailboxMutationReceipts.$inferSelect,
    access: RuntimeMailboxAuthority,
    configuration: MailConnectionConfiguration,
    displayName: string,
  ): Promise<{ mailbox: Mailbox }> {
    if (receipt.resultJson) {
      await retryMailAudit(async () => {
        await this.runtime.finalizeConnection(authority.companyId, {
          authority: access,
          operation_id: receipt.operationId,
          credential_version: receipt.credentialVersion,
        });
      });
      return { mailbox: mailboxSchema.parse(JSON.parse(receipt.resultJson)) };
    }
    const previous = parsePreviousMailbox(receipt.previousMailboxJson);
    const now = this.nowMs();
    const [current] = await this.db.select().from(companyMailboxes).where(and(
      eq(companyMailboxes.companyId, authority.companyId),
      eq(companyMailboxes.mailboxId, receipt.mailboxId),
    )).limit(1);
    if (!current) throw new ApplicationError(MAILBOX_NOT_FOUND_CODE, false);
    if (current.credentialVersion === receipt.expectedCredentialVersion) {
      const claimed = await this.db.update(companyMailboxes).set({
        displayName,
        connectionState: "validating",
        credentialVersion: receipt.credentialVersion,
        lastCheckedAtMs: now,
        lastErrorCode: null,
        updatedAtMs: now,
      }).where(and(
        eq(companyMailboxes.companyId, authority.companyId),
        eq(companyMailboxes.mailboxId, receipt.mailboxId),
        eq(companyMailboxes.credentialVersion, receipt.expectedCredentialVersion),
      )).returning({ mailboxId: companyMailboxes.mailboxId });
      if (claimed.length !== 1) {
        throw new ApplicationError("MAILBOX_OPERATION_IN_PROGRESS", true);
      }
    } else if (current.credentialVersion !== receipt.credentialVersion) {
      throw new ApplicationError("MAILBOX_OPERATION_IN_PROGRESS", true);
    }
    return this.finishConnection(
      authority,
      access,
      receipt.operationId,
      receipt.expectedCredentialVersion,
      receipt.credentialVersion,
      configuration,
      previous,
      {
        actorId: receipt.actorId,
        idempotencyKey: receipt.idempotencyKey,
        requestFingerprint: receipt.requestFingerprint,
      },
    );
  }

  private async finishConnection(
    actorAuthority: MailActorAuthority,
    runtimeAuthority: RuntimeMailboxAuthority,
    operationId: string,
    expectedCredentialVersion: number,
    credentialVersion: number,
    configuration: MailConnectionConfiguration,
    previous?: typeof companyMailboxes.$inferSelect,
    receipt?: {
      actorId: string;
      idempotencyKey: string;
      requestFingerprint: string;
    },
  ): Promise<{ mailbox: Mailbox }> {
    const runtimeOperation = {
      authority: runtimeAuthority,
      operation_id: operationId,
      credential_version: credentialVersion,
    } as const;
    let mailbox: Mailbox;
    try {
      const result = await this.runtime.connect(actorAuthority.companyId, {
        authority: runtimeAuthority,
        operation_id: operationId,
        expected_credential_version: expectedCredentialVersion,
        credential_version: credentialVersion,
        configuration,
      });
      const now = this.nowMs();
      mailbox = await this.db.transaction(async (transaction) => {
        const [mailbox] = await transaction.update(companyMailboxes).set({
          emailAddress: configuration.email_address,
          connectionState: result.connection_state,
          ...capabilityColumns(result.capabilities),
          lastCheckedAtMs: now,
          lastErrorCode: null,
          updatedAtMs: now,
        }).where(and(
          eq(companyMailboxes.companyId, actorAuthority.companyId),
          eq(companyMailboxes.mailboxId, runtimeAuthority.mailbox_id),
          eq(companyMailboxes.credentialVersion, credentialVersion),
        )).returning();
        if (!mailbox) {
          throw new ApplicationError(MAILBOX_NOT_FOUND_CODE, false);
        }
        const auditKey = createHash("sha256").update([
          actorAuthority.companyId,
          actorAuthority.actorId,
          runtimeAuthority.mailbox_id,
          operationId,
        ].join("\0")).digest("hex");
        const projected = this.project(mailbox, runtimeAuthority.access);
        await transaction.insert(companyMailboxAuditEvents).values({
          auditEventId: `mail_connect_${auditKey}`,
          companyId: actorAuthority.companyId,
          mailboxId: runtimeAuthority.mailbox_id,
          actorId: actorAuthority.actorId,
          operation: "connect",
          itemCount: 0,
          sizeBytes: 0,
          outcome: "succeeded",
          createdAtMs: now,
        }).onConflictDoNothing();
        if (receipt) {
          const updatedReceipt = await transaction.update(companyMailboxMutationReceipts).set({
            resultJson: JSON.stringify(projected),
          }).where(and(
            eq(companyMailboxMutationReceipts.companyId, actorAuthority.companyId),
            eq(companyMailboxMutationReceipts.actorId, receipt.actorId),
            eq(companyMailboxMutationReceipts.idempotencyKey, receipt.idempotencyKey),
            eq(companyMailboxMutationReceipts.requestFingerprint, receipt.requestFingerprint),
            eq(companyMailboxMutationReceipts.operationId, operationId),
          )).returning({ operationId: companyMailboxMutationReceipts.operationId });
          if (updatedReceipt.length !== 1) {
            throw new ApplicationError(MAILBOX_IDEMPOTENCY_CONFLICT_CODE, false);
          }
        }
        return projected;
      });
    } catch (error) {
      try {
        await retryMailAudit(async () => {
          await this.runtime.rollbackConnection(actorAuthority.companyId, runtimeOperation);
        });
      } catch {
        // The Runtime may already hold the new credential. Keep the pending
        // receipt and validating projection so replay uses the same operation
        // instead of creating a divergent credential generation.
        throw new ApplicationError(MAILBOX_CONNECTION_RECOVERY_PENDING_CODE, true);
      }
      const now = this.nowMs();
      await this.db.update(companyMailboxes).set(previous ? {
        displayName: previous.displayName,
        emailAddress: previous.emailAddress,
        connectionState: previous.connectionState,
        credentialVersion: previous.credentialVersion,
        capabilityFolders: previous.capabilityFolders,
        capabilitySearch: previous.capabilitySearch,
        capabilityFlags: previous.capabilityFlags,
        capabilityMove: previous.capabilityMove,
        capabilityTrash: previous.capabilityTrash,
        capabilityAppendSent: previous.capabilityAppendSent,
        lastCheckedAtMs: now,
        lastErrorCode: stableMailConnectionErrorCode(error),
        updatedAtMs: now,
      } : {
        connectionState: "error",
        lastCheckedAtMs: now,
        lastErrorCode: stableMailConnectionErrorCode(error),
        updatedAtMs: now,
      }).where(and(
        eq(companyMailboxes.companyId, actorAuthority.companyId),
        eq(companyMailboxes.mailboxId, runtimeAuthority.mailbox_id),
        eq(companyMailboxes.credentialVersion, credentialVersion),
      ));
      if (receipt) {
        await this.db.delete(companyMailboxMutationReceipts).where(and(
          eq(companyMailboxMutationReceipts.companyId, actorAuthority.companyId),
          eq(companyMailboxMutationReceipts.actorId, receipt.actorId),
          eq(companyMailboxMutationReceipts.idempotencyKey, receipt.idempotencyKey),
          eq(companyMailboxMutationReceipts.requestFingerprint, receipt.requestFingerprint),
          eq(companyMailboxMutationReceipts.operationId, operationId),
        ));
      }
      await retryMailAudit(() => this.audit(
        actorAuthority,
        runtimeAuthority.mailbox_id,
        "connect",
        "failed",
      )).catch(() => undefined);
      throw error;
    }
    await retryMailAudit(async () => {
      await this.runtime.finalizeConnection(actorAuthority.companyId, runtimeOperation);
    });
    return { mailbox };
  }

  private async requireTargetActor(companyId: string, actorId: string) {
    const [actor] = await this.actorProfiles.execute({
      companyId,
      actorIds: [actorId],
    });
    if (!actor) {
      throw new ApplicationError(MAILBOX_INVALID_CODE, false);
    }
    return actor;
  }

  private async requireMailbox(
    authority: MailActorAuthority,
    mailboxId: string,
    requireManage = false,
  ): Promise<{
    row: typeof companyMailboxes.$inferSelect;
    authority: RuntimeMailboxAuthority;
  }> {
    const [row] = await this.db.select().from(companyMailboxes).where(and(
      eq(companyMailboxes.companyId, authority.companyId),
      eq(companyMailboxes.mailboxId, mailboxId),
    )).limit(1);
    if (!row) throw new ApplicationError(MAILBOX_NOT_FOUND_CODE, false);
    let granted = false;
    if (!requireManage && row.kind === "shared") {
      const [grant] = await this.db.select({ actorId: companyMailboxGrants.actorId })
        .from(companyMailboxGrants).where(and(
          eq(companyMailboxGrants.companyId, authority.companyId),
          eq(companyMailboxGrants.mailboxId, mailboxId),
          eq(companyMailboxGrants.actorId, authority.actorId),
        )).limit(1);
      granted = Boolean(grant);
    }
    let targetActorType: "human" | "agent" | undefined;
    if (row.kind === "personal" && row.targetActorId !== authority.actorId) {
      const actor = await this.requireTargetActor(authority.companyId, row.targetActorId!);
      targetActorType = actor.actorType;
    }
    const access = resolveMailboxAccess({
      requesterActorId: authority.actorId,
      isCompanyOwner: authority.isCompanyOwner,
      kind: row.kind,
      targetActorId: row.targetActorId,
      targetActorType,
      granted,
      requireManage,
    });
    if (!access) throw new ApplicationError(MAIL_ACCESS_DENIED_CODE, false);
    return {
      row,
      authority: {
        company_id: authority.companyId,
        requested_by_actor_id: authority.actorId,
        mailbox_id: mailboxId,
        access,
      },
    };
  }

  private project(
    row: typeof companyMailboxes.$inferSelect,
    access: Mailbox["access"],
  ): Mailbox {
    return mailboxSchema.parse({
      mailbox_id: row.mailboxId,
      kind: row.kind,
      target_actor_id: row.targetActorId,
      display_name: row.displayName,
      email_address: row.emailAddress,
      connection_state: row.connectionState,
      capabilities: {
        folders: row.capabilityFolders,
        search: row.capabilitySearch,
        flags: row.capabilityFlags,
        move: row.capabilityMove,
        trash: row.capabilityTrash,
        append_sent: row.capabilityAppendSent,
      },
      last_checked_at_ms: row.lastCheckedAtMs,
      last_error_code: row.lastErrorCode,
      access,
    });
  }

  private requireOwner(authority: MailActorAuthority): void {
    if (!authority.isCompanyOwner) throw new ApplicationError(MAIL_ACCESS_DENIED_CODE, false);
  }

  private async audit(
    authority: MailActorAuthority,
    mailboxId: string | null,
    operation: string,
    outcome: string,
    itemCount = 0,
    sizeBytes = 0,
    operationId?: string,
  ): Promise<void> {
    const auditEventId = operationId
      ? `mail_audit_${createHash("sha256").update([
        authority.companyId,
        authority.actorId,
        mailboxId ?? "",
        operation,
        operationId,
      ].join("\0")).digest("hex")}`
      : `mail_audit_${this.newId()}`;
    const insertion = this.db.insert(companyMailboxAuditEvents).values({
      auditEventId,
      companyId: authority.companyId,
      mailboxId,
      actorId: authority.actorId,
      operation,
      itemCount,
      sizeBytes,
      outcome,
      createdAtMs: this.nowMs(),
    });
    if (operationId) {
      await insertion.onConflictDoNothing();
    } else {
      await insertion;
    }
  }
}

function personalMailboxId(companyId: string, actorId: string): string {
  return `mailbox_personal_${createHash("sha256")
    .update(`${companyId}\0${actorId}`)
    .digest("hex")
    .slice(0, 32)}`;
}

function isPristinePersonalSlot(mailbox: typeof companyMailboxes.$inferSelect): boolean {
  return mailbox.kind === "personal"
    && mailbox.connectionState === "unconnected"
    && mailbox.credentialVersion === 0
    && mailbox.emailAddress === null
    && mailbox.lastCheckedAtMs === null
    && mailbox.lastErrorCode === null;
}

export function resolveMailboxAccess(input: {
  requesterActorId: string;
  isCompanyOwner: boolean;
  kind: "personal" | "shared" | string;
  targetActorId: string | null;
  targetActorType?: "human" | "agent";
  granted: boolean;
  requireManage: boolean;
}): RuntimeMailboxAuthority["access"] | null {
  if (input.kind === "personal" && input.targetActorId === input.requesterActorId) {
    return "personal";
  }
  if (input.isCompanyOwner && input.kind === "shared") {
    return "company_owner";
  }
  if (
    input.isCompanyOwner
    && input.kind === "personal"
    && input.targetActorType === "agent"
  ) {
    return "company_owner";
  }
  if (!input.requireManage && input.kind === "shared" && input.granted) {
    return "shared_grant";
  }
  return null;
}

function capabilityColumns(capabilities: Mailbox["capabilities"]) {
  return {
    capabilityFolders: capabilities.folders,
    capabilitySearch: capabilities.search,
    capabilityFlags: capabilities.flags,
    capabilityMove: capabilities.move,
    capabilityTrash: capabilities.trash,
    capabilityAppendSent: capabilities.append_sent,
  };
}

function auditRow(
  authority: MailActorAuthority,
  mailboxId: string | null,
  operation: string,
  outcome: string,
  createdAtMs: number,
  newId: () => string,
  itemCount = 0,
  sizeBytes = 0,
) {
  return {
    auditEventId: `mail_audit_${newId()}`,
    companyId: authority.companyId,
    mailboxId,
    actorId: authority.actorId,
    operation,
    itemCount,
    sizeBytes,
    outcome,
    createdAtMs,
  };
}

function withoutMailbox<T extends { mailbox_id: string }>(input: T): Omit<T, "mailbox_id"> {
  const { mailbox_id: _mailboxId, ...rest } = input;
  return rest;
}

function withoutMailboxIds<T extends { mailbox_ids?: string[] }>(
  input: T,
): Omit<T, "mailbox_ids"> {
  const { mailbox_ids: _mailboxIds, ...rest } = input;
  return rest;
}

function requestFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parsePreviousMailbox(
  value: string | null,
): typeof companyMailboxes.$inferSelect {
  let parsed: unknown;
  try {
    parsed = value ? JSON.parse(value) : null;
  } catch {
    throw new ApplicationError(MAILBOX_INVALID_CODE, false);
  }
  if (
    !parsed
    || typeof parsed !== "object"
    || Array.isArray(parsed)
    || typeof (parsed as { mailboxId?: unknown }).mailboxId !== "string"
    || !Number.isSafeInteger((parsed as { credentialVersion?: unknown }).credentialVersion)
  ) {
    throw new ApplicationError(MAILBOX_INVALID_CODE, false);
  }
  return parsed as typeof companyMailboxes.$inferSelect;
}

const STABLE_CONNECTION_ERROR_CODES = new Set([
  "MAILBOX_IDEMPOTENCY_CONFLICT",
  "MAILBOX_NOT_CONNECTED",
  "MAIL_CONNECTION_CONFIGURATION_INVALID",
  "MAIL_CONNECTION_ROLLBACK_INVALID",
  "MAIL_CONNECTION_SSRF_BLOCKED",
  "MAIL_CREDENTIAL_INVALID",
  "MAIL_CREDENTIAL_VERSION_CONFLICT",
  "MAIL_INBOX_UNAVAILABLE",
]);

export function stableMailConnectionErrorCode(error: unknown): string {
  if (
    error instanceof Error
    && "code" in error
    && typeof (error as { code?: unknown }).code === "string"
  ) {
    const code = (error as { code: string }).code;
    if (STABLE_CONNECTION_ERROR_CODES.has(code)) return code;
  }
  return "MAIL_CONNECTION_FAILED";
}

async function retryMailAudit(operation: () => Promise<void>): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
