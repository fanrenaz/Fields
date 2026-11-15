import type {
  MailAttachmentReadInput,
  MailAttachmentReadResult,
  MailFolderListResult,
  MailMessage,
  MailMessageListInput,
  MailMessagePage,
  MailMessageReadInput,
  MailMessageSearchInput,
  MailMessageUpdateInput,
  MailMessageUpdateResult,
  Mailbox,
  MailConnectionConfiguration,
  MailSendInput,
  MailSendResult,
  MailSharedGrant,
} from "@fields/contracts/public/mail";
import type {
  RuntimeMailboxAuthority,
  RuntimeMailboxConnectionOperationInput,
  RuntimeMailboxConnectInput,
  RuntimeMailboxConnectResult,
  RuntimeMailboxDisconnectInput,
} from "@fields/contracts/internal/mail";

export type MailActorAuthority = {
  companyId: string;
  actorId: string;
  isCompanyOwner: boolean;
};

export interface MailRuntimeGateway {
  connect(companyId: string, input: RuntimeMailboxConnectInput): Promise<RuntimeMailboxConnectResult>;
  finalizeConnection(
    companyId: string,
    input: RuntimeMailboxConnectionOperationInput,
  ): Promise<{ ok: true }>;
  rollbackConnection(
    companyId: string,
    input: RuntimeMailboxConnectionOperationInput,
  ): Promise<{ ok: true }>;
  disconnect(companyId: string, input: RuntimeMailboxDisconnectInput): Promise<{ ok: true }>;
  listFolders(companyId: string, authority: RuntimeMailboxAuthority): Promise<MailFolderListResult>;
  listMessages(
    companyId: string,
    authority: RuntimeMailboxAuthority,
    input: Omit<MailMessageListInput, "mailbox_id">,
  ): Promise<MailMessagePage>;
  searchMessages(
    companyId: string,
    authorities: RuntimeMailboxAuthority[],
    input: Omit<MailMessageSearchInput, "mailbox_ids">,
  ): Promise<MailMessagePage>;
  readMessage(
    companyId: string,
    authority: RuntimeMailboxAuthority,
    input: Omit<MailMessageReadInput, "mailbox_id">,
  ): Promise<MailMessage>;
  sendMessage(
    companyId: string,
    authority: RuntimeMailboxAuthority,
    input: Omit<MailSendInput, "mailbox_id">,
  ): Promise<MailSendResult>;
  updateMessage(
    companyId: string,
    authority: RuntimeMailboxAuthority,
    input: Omit<MailMessageUpdateInput, "mailbox_id" | "idempotency_key">,
    operationId: string,
  ): Promise<MailMessageUpdateResult>;
  readAttachment(
    companyId: string,
    authority: RuntimeMailboxAuthority,
    input: Omit<MailAttachmentReadInput, "mailbox_id">,
  ): Promise<MailAttachmentReadResult>;
}

export interface MailApplication {
  listMailboxes(authority: MailActorAuthority): Promise<{ items: Mailbox[] }>;
  readMailbox(authority: MailActorAuthority, mailboxId: string): Promise<Mailbox>;
  connectPersonal(
    authority: MailActorAuthority,
    targetActorId: string | undefined,
    configuration: MailConnectionConfiguration,
    idempotencyKey: string,
  ): Promise<{ mailbox: Mailbox }>;
  connectShared(
    authority: MailActorAuthority,
    input: {
      mailboxId?: string;
      name: string;
      configuration: MailConnectionConfiguration;
      idempotencyKey: string;
    },
  ): Promise<{ mailbox: Mailbox }>;
  disconnect(authority: MailActorAuthority, mailboxId: string): Promise<{
    mailbox_id: string;
    connection_state: "unconnected";
  }>;
  deleteShared(authority: MailActorAuthority, mailboxId: string): Promise<{
    mailbox_id: string;
    deleted: true;
  }>;
  listGrants(authority: MailActorAuthority, mailboxId: string): Promise<{ items: MailSharedGrant[] }>;
  grant(authority: MailActorAuthority, mailboxId: string, actorId: string): Promise<{
    mailbox_id: string;
    actor_id: string;
    granted: boolean;
  }>;
  revoke(authority: MailActorAuthority, mailboxId: string, actorId: string): Promise<{
    mailbox_id: string;
    actor_id: string;
    granted: boolean;
  }>;
  listFolders(authority: MailActorAuthority, mailboxId: string): Promise<MailFolderListResult>;
  listMessages(authority: MailActorAuthority, input: MailMessageListInput): Promise<MailMessagePage>;
  searchMessages(authority: MailActorAuthority, input: MailMessageSearchInput): Promise<MailMessagePage>;
  readMessage(authority: MailActorAuthority, input: MailMessageReadInput): Promise<MailMessage>;
  sendMessage(authority: MailActorAuthority, input: MailSendInput): Promise<MailSendResult>;
  updateMessage(authority: MailActorAuthority, input: MailMessageUpdateInput): Promise<MailMessageUpdateResult>;
  readAttachment(authority: MailActorAuthority, input: MailAttachmentReadInput): Promise<MailAttachmentReadResult>;
  recordRuntimeAudit(authority: MailActorAuthority, input: {
    operationId: string;
    mailboxId: string;
    operation: string;
    itemCount: number;
    sizeBytes: number;
    outcome: string;
  }): Promise<{ ok: true }>;
}

export interface MailMemberCleanupProjection {
  cleanupRemovedMember(input: {
    companyId: string;
    memberId: string;
    operationId: string;
  }): Promise<void>;
}
