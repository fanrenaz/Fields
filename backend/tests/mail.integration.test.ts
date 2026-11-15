import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  access,
  mkdtemp,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  RuntimeMailboxAuthority,
  RuntimeMailboxConnectionOperationInput,
  RuntimeMailboxConnectInput,
  RuntimeMailboxDisconnectInput,
} from "@fields/contracts/internal/mail";
import {
  mailConnectionConfigurationSchema,
  type MailAttachmentReadInput,
  type MailMessageListInput,
  type MailMessageReadInput,
  type MailMessageSearchInput,
  type MailMessageSummary,
  type MailMessageUpdateInput,
  type MailSendInput,
} from "@fields/contracts/public/mail";
import { sql } from "drizzle-orm";

import {
  ListActiveOrdinaryActorProfiles,
} from "../src/application/actor/index.js";
import type { MailRuntimeGateway } from "../src/application/mail/index.js";
import { ApplicationError } from "../src/application/platform/errors.js";
import { createBackendDatabaseService } from "../src/infrastructure/persistence/postgres/database-service.js";
import {
  MAIL_ACCESS_DENIED_CODE,
  MAILBOX_NOT_FOUND_CODE,
  PostgresActorDirectoryRepository,
  PostgresMailApplication,
  PostgresMailMemberCleanupProjection,
} from "../src/infrastructure/persistence/postgres/repositories/index.js";
import {
  postgresTransactionForOwner,
} from "../src/infrastructure/persistence/postgres/unit-of-work/index.js";
import { CompanyMailService } from "../../company-runtime/src/application/mail/service.js";

const optIn = process.env.FIELDS_REAL_MAIL_INTEGRATION_TEST === "1";
const databaseUrl = process.env.FIELDS_INTEGRATION_DATABASE_URL?.trim() ?? "";
const rawConfiguration = process.env.FIELDS_REAL_MAIL_CONFIGURATION_JSON?.trim() ?? "";
if (optIn && !databaseUrl) {
  throw new Error("FIELDS_INTEGRATION_DATABASE_URL is required for real Mail integration");
}
if (optIn && !rawConfiguration) {
  throw new Error("FIELDS_REAL_MAIL_CONFIGURATION_JSON is required from conn-test");
}
const skip = optIn
  ? false
  : "Set FIELDS_REAL_MAIL_INTEGRATION_TEST=1 to run real PostgreSQL and Runtime Mail integration.";

test("real PostgreSQL and Runtime enforce Mail ACL and local credential cleanup", {
  skip,
  timeout: 360_000,
}, async () => {
  const configuration = mailConnectionConfigurationSchema.parse(
    JSON.parse(rawConfiguration),
  );
  const database = createBackendDatabaseService({ databaseUrl });
  const workdir = await mkdtemp(join(tmpdir(), "fields-mail-integration-"));
  const runtimeService = new CompanyMailService(workdir);
  const runtime = new InProcessMailRuntimeGateway(runtimeService);
  const actorProfiles = new ListActiveOrdinaryActorProfiles({
    profiles: new PostgresActorDirectoryRepository(
      database.db,
      postgresTransactionForOwner,
    ),
  });
  const cleanup = new PostgresMailMemberCleanupProjection(database.db);
  const suffix = randomUUID().replaceAll("-", "");
  const companyId = `it_mail_company_${suffix}`;
  const foreignCompanyId = `it_mail_foreign_company_${suffix}`;
  const ownerId = `it_mail_owner_${suffix}`;
  const humanId = `it_mail_human_${suffix}`;
  const agentId = `it_mail_agent_${suffix}`;
  const foreignOwnerId = `it_mail_foreign_owner_${suffix}`;
  const owner = authority(companyId, ownerId, true);
  const human = authority(companyId, humanId, false);
  const agent = authority(companyId, agentId, false);
  const foreignOwner = authority(foreignCompanyId, foreignOwnerId, true);
  const mail = new PostgresMailApplication(
    database.db,
    runtime,
    actorProfiles,
  );
  const now = Date.now();
  const connectedMailboxIds = new Set<string>();
  const publicResults: unknown[] = [];

  try {
    await database.db.transaction(async (transaction) => {
      await transaction.execute(sql`
        insert into companies (id, name, status, created_at_ms, updated_at_ms)
        values
          (${companyId}, 'Mail integration', 'active', ${now}, ${now}),
          (${foreignCompanyId}, 'Foreign mail integration', 'active', ${now}, ${now})
      `);
      await transaction.execute(sql`
        insert into actors (
          id, company_id, type, display_name, mark, company_role, status,
          created_at_ms, updated_at_ms
        ) values
          (${ownerId}, ${companyId}, 'human', 'Mail Owner', 'MO', 'owner', 'active', ${now}, ${now}),
          (${humanId}, ${companyId}, 'human', 'Mail Human', 'MH', 'member', 'active', ${now}, ${now}),
          (${agentId}, ${companyId}, 'agent', 'Mail Agent', 'MA', 'member', 'active', ${now}, ${now}),
          (${foreignOwnerId}, ${foreignCompanyId}, 'human', 'Foreign Owner', 'FO', 'owner', 'active', ${now}, ${now})
      `);
    });

    const humanConnection = await mail.connectPersonal(
      human,
      undefined,
      configuration,
      `connect-human-${suffix}`,
    );
    publicResults.push(humanConnection);
    const humanMailboxId = humanConnection.mailbox.mailbox_id;
    connectedMailboxIds.add(humanMailboxId);
    await assertLocalArtifactsPresent(
      workdir,
      humanMailboxId,
      configuration.application_password,
    );
    const humanMailbox = await mail.readMailbox(human, humanMailboxId);
    publicResults.push(humanMailbox);
    assert.equal(humanMailbox.access, "personal");
    await assert.rejects(
      mail.readMailbox(owner, humanMailboxId),
      applicationError(MAIL_ACCESS_DENIED_CODE),
    );

    await assert.rejects(
      mail.connectPersonal(
        human,
        agentId,
        configuration,
        `human-connect-agent-${suffix}`,
      ),
      applicationError(MAIL_ACCESS_DENIED_CODE),
    );
    const agentConnection = await mail.connectPersonal(
      owner,
      agentId,
      configuration,
      `connect-agent-${suffix}`,
    );
    publicResults.push(agentConnection);
    const agentMailboxId = agentConnection.mailbox.mailbox_id;
    connectedMailboxIds.add(agentMailboxId);
    await assertLocalArtifactsPresent(
      workdir,
      agentMailboxId,
      configuration.application_password,
    );
    const ownerAgentMailbox = await mail.readMailbox(owner, agentMailboxId);
    const agentMailbox = await mail.readMailbox(agent, agentMailboxId);
    publicResults.push(ownerAgentMailbox, agentMailbox);
    assert.equal(ownerAgentMailbox.access, "company_owner");
    assert.equal(agentMailbox.access, "personal");
    await assert.rejects(
      mail.readMailbox(human, agentMailboxId),
      applicationError(MAIL_ACCESS_DENIED_CODE),
    );

    const sharedConnection = await mail.connectShared(owner, {
      name: "Mail integration shared",
      configuration,
      idempotencyKey: `connect-shared-${suffix}`,
    });
    publicResults.push(sharedConnection);
    const sharedMailboxId = sharedConnection.mailbox.mailbox_id;
    connectedMailboxIds.add(sharedMailboxId);
    await assertLocalArtifactsPresent(
      workdir,
      sharedMailboxId,
      configuration.application_password,
    );

    publicResults.push(await mail.grant(owner, sharedMailboxId, humanId));
    const grantedMailbox = await mail.readMailbox(human, sharedMailboxId);
    publicResults.push(grantedMailbox);
    assert.equal(grantedMailbox.access, "shared_grant");
    await assert.rejects(
      mail.grant(human, sharedMailboxId, agentId),
      applicationError(MAIL_ACCESS_DENIED_CODE),
    );

    const folders = await mail.listFolders(human, sharedMailboxId);
    publicResults.push(folders);
    const sentFolder = folders.items.find((folder) => folder.role === "sent");
    assert.ok(sentFolder, "conn-test mailbox must expose a Sent folder");
    const subject = `Fields Backend Mail ACL ${Date.now()}-${suffix}`;
    const sent = await mail.sendMessage(human, {
      mailbox_id: sharedMailboxId,
      idempotency_key: `send-shared-${suffix}`,
      recipients: {
        to: [configuration.email_address],
        cc: [],
        bcc: [],
      },
      subject,
      text_body: "Backend Mail ACL integration sentinel",
      references: [],
      attachments: [],
    });
    publicResults.push(sent);
    assert.equal(sent.outcome, "sent");
    const sentinel = await pollMessage(
      mail,
      human,
      sharedMailboxId,
      sentFolder.folder_id,
      subject,
    );

    publicResults.push(await mail.revoke(owner, sharedMailboxId, humanId));
    await assert.rejects(
      mail.readMailbox(human, sharedMailboxId),
      applicationError(MAIL_ACCESS_DENIED_CODE),
    );
    await assert.rejects(
      mail.readMailbox(foreignOwner, sharedMailboxId),
      applicationError(MAILBOX_NOT_FOUND_CODE),
    );
    const foreignMailboxes = await mail.listMailboxes(foreignOwner);
    publicResults.push(foreignMailboxes);
    assert.equal(foreignMailboxes.items.length, 1);
    assert.equal(foreignMailboxes.items[0]?.target_actor_id, foreignOwnerId);
    assert.equal(foreignMailboxes.items[0]?.connection_state, "unconnected");

    assertNoCredentialProjection(publicResults, configuration.application_password);
    const persisted = rows<{ value: unknown }>(await database.db.execute(sql`
      select to_jsonb(mailbox) as value
      from company_mailboxes mailbox
      where mailbox.company_id = ${companyId}
      union all
      select to_jsonb(receipt) as value
      from company_mailbox_mutation_receipts receipt
      where receipt.company_id = ${companyId}
      union all
      select to_jsonb(audit) as value
      from company_mailbox_audit_events audit
      where audit.company_id = ${companyId}
    `));
    assertNoCredentialProjection(persisted, configuration.application_password);

    await mail.disconnect(owner, agentMailboxId);
    connectedMailboxIds.delete(agentMailboxId);
    await assertLocalArtifactsAbsent(workdir, agentMailboxId);

    await mail.disconnect(owner, sharedMailboxId);
    connectedMailboxIds.delete(sharedMailboxId);
    await assertLocalArtifactsAbsent(workdir, sharedMailboxId);
    const reconnected = await mail.connectShared(owner, {
      mailboxId: sharedMailboxId,
      name: "Mail integration shared",
      configuration,
      idempotencyKey: `reconnect-shared-${suffix}`,
    });
    publicResults.push(reconnected);
    connectedMailboxIds.add(sharedMailboxId);
    const reconnectedFolders = await mail.listFolders(owner, sharedMailboxId);
    const reconnectedSent = reconnectedFolders.items.find((folder) => folder.role === "sent");
    assert.ok(reconnectedSent, "reconnected conn-test mailbox must expose a Sent folder");
    const afterDisconnect = await pollMessage(
      mail,
      owner,
      sharedMailboxId,
      reconnectedSent.folder_id,
      subject,
    );
    assert.equal(afterDisconnect.message_id, sentinel.message_id);
    assert.equal(afterDisconnect.internet_message_id, sentinel.internet_message_id);

    await mail.grant(owner, sharedMailboxId, humanId);
    await runtimeService.cleanupMember(companyId, humanId);
    connectedMailboxIds.delete(humanMailboxId);
    await cleanup.cleanupRemovedMember({
      companyId,
      memberId: humanId,
      operationId: `remove-human-${suffix}`,
    });
    await assertLocalArtifactsAbsent(workdir, humanMailboxId);
    await assert.rejects(
      mail.readMailbox(human, sharedMailboxId),
      applicationError(MAIL_ACCESS_DENIED_CODE),
    );
    const personalRows = rows<{ count: string }>(await database.db.execute(sql`
      select count(*)::text as count
      from company_mailboxes
      where company_id = ${companyId}
        and kind = 'personal'
        and target_actor_id = ${humanId}
    `));
    assert.deepEqual(personalRows, [{ count: "0" }]);
    const grantRows = rows<{ count: string }>(await database.db.execute(sql`
      select count(*)::text as count
      from company_mailbox_grants
      where company_id = ${companyId}
        and actor_id = ${humanId}
    `));
    assert.deepEqual(grantRows, [{ count: "0" }]);
    const afterRemoval = await pollMessage(
      mail,
      owner,
      sharedMailboxId,
      reconnectedSent.folder_id,
      subject,
    );
    assert.equal(afterRemoval.message_id, sentinel.message_id);
    assert.equal(afterRemoval.internet_message_id, sentinel.internet_message_id);
  } finally {
    for (const mailboxId of connectedMailboxIds) {
      await runtimeService.disconnect({
        authority: {
          company_id: companyId,
          requested_by_actor_id: ownerId,
          mailbox_id: mailboxId,
          access: "company_owner",
        },
        remove_index: true,
      }).catch(() => undefined);
    }
    await rm(workdir, { recursive: true, force: true });
    try {
      await database.db.transaction(async (transaction) => {
        await transaction.execute(sql`
          delete from company_mailbox_audit_events
          where company_id in (${companyId}, ${foreignCompanyId})
        `);
        await transaction.execute(sql`
          delete from company_mailbox_mutation_receipts
          where company_id in (${companyId}, ${foreignCompanyId})
        `);
        await transaction.execute(sql`
          delete from company_mailbox_grants
          where company_id in (${companyId}, ${foreignCompanyId})
        `);
        await transaction.execute(sql`
          delete from company_mailboxes
          where company_id in (${companyId}, ${foreignCompanyId})
        `);
        await transaction.execute(sql`
          delete from actors
          where company_id in (${companyId}, ${foreignCompanyId})
        `);
        await transaction.execute(sql`
          delete from companies
          where id in (${companyId}, ${foreignCompanyId})
        `);
      });
    } finally {
      await database.close();
    }
  }
});

class InProcessMailRuntimeGateway implements MailRuntimeGateway {
  constructor(private readonly service: CompanyMailService) {}

  connect(companyId: string, input: RuntimeMailboxConnectInput) {
    assertCompany(companyId, input.authority);
    return this.service.connect(input);
  }

  finalizeConnection(
    companyId: string,
    input: RuntimeMailboxConnectionOperationInput,
  ) {
    assertCompany(companyId, input.authority);
    return this.service.finalizeConnection(input);
  }

  rollbackConnection(
    companyId: string,
    input: RuntimeMailboxConnectionOperationInput,
  ) {
    assertCompany(companyId, input.authority);
    return this.service.rollbackConnection(input);
  }

  disconnect(companyId: string, input: RuntimeMailboxDisconnectInput) {
    assertCompany(companyId, input.authority);
    return this.service.disconnect(input);
  }

  listFolders(companyId: string, authority: RuntimeMailboxAuthority) {
    assertCompany(companyId, authority);
    return this.service.listFolders({ authority });
  }

  listMessages(
    companyId: string,
    authority: RuntimeMailboxAuthority,
    input: Omit<MailMessageListInput, "mailbox_id">,
  ) {
    assertCompany(companyId, authority);
    return this.service.listMessages({ authority, request: input });
  }

  searchMessages(
    companyId: string,
    authorities: RuntimeMailboxAuthority[],
    input: Omit<MailMessageSearchInput, "mailbox_ids">,
  ) {
    for (const authority of authorities) assertCompany(companyId, authority);
    return this.service.searchMessages({ authorities, request: input });
  }

  readMessage(
    companyId: string,
    authority: RuntimeMailboxAuthority,
    input: Omit<MailMessageReadInput, "mailbox_id">,
  ) {
    assertCompany(companyId, authority);
    return this.service.readMessage({ authority, request: input });
  }

  sendMessage(
    companyId: string,
    authority: RuntimeMailboxAuthority,
    input: Omit<MailSendInput, "mailbox_id">,
  ) {
    assertCompany(companyId, authority);
    return this.service.sendMessage({ authority, request: input });
  }

  updateMessage(
    companyId: string,
    authority: RuntimeMailboxAuthority,
    input: Omit<MailMessageUpdateInput, "mailbox_id" | "idempotency_key">,
    operationId: string,
  ) {
    assertCompany(companyId, authority);
    return this.service.updateMessage({
      authority,
      request: input,
      operation_id: operationId,
    });
  }

  readAttachment(
    companyId: string,
    authority: RuntimeMailboxAuthority,
    input: Omit<MailAttachmentReadInput, "mailbox_id">,
  ) {
    assertCompany(companyId, authority);
    return this.service.readAttachment({ authority, request: input });
  }
}

function authority(companyId: string, actorId: string, isCompanyOwner: boolean) {
  return { companyId, actorId, isCompanyOwner };
}

function assertCompany(companyId: string, authority: RuntimeMailboxAuthority): void {
  assert.equal(authority.company_id, companyId);
}

function applicationError(code: string) {
  return (error: unknown) => (
    error instanceof ApplicationError
    && error.code === code
  );
}

function artifactPaths(workdir: string, mailboxId: string): string[] {
  const credentialRoot = join(workdir, "mailboxes", "credentials");
  const index = join(workdir, "mailboxes", "indexes", `${mailboxId}.sqlite`);
  return [
    join(credentialRoot, `${mailboxId}.json`),
    join(credentialRoot, `${mailboxId}.connection-rollback.json`),
    join(credentialRoot, `${mailboxId}.receipt-key`),
    index,
    `${index}-wal`,
    `${index}-shm`,
  ];
}

async function assertLocalArtifactsPresent(
  workdir: string,
  mailboxId: string,
  password: string,
): Promise<void> {
  const [credential, , , index] = artifactPaths(workdir, mailboxId);
  assert.ok(credential);
  assert.ok(index);
  assert.equal((await stat(credential)).mode & 0o777, 0o600);
  assert.equal((await stat(index)).mode & 0o777, 0o600);
  assert.equal((await readFile(credential)).includes(Buffer.from(password)), true);
  assert.equal((await readFile(index)).includes(Buffer.from(password)), false);
}

async function assertLocalArtifactsAbsent(workdir: string, mailboxId: string): Promise<void> {
  for (const path of artifactPaths(workdir, mailboxId)) {
    await assert.rejects(access(path), { code: "ENOENT" });
  }
}

function assertNoCredentialProjection(value: unknown, password: string): void {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes(password), false);
  assert.equal(serialized.includes("application_password"), false);
}

async function pollMessage(
  mail: PostgresMailApplication,
  actorAuthority: ReturnType<typeof authority>,
  mailboxId: string,
  folderId: string,
  subject: string,
): Promise<MailMessageSummary> {
  const deadline = Date.now() + 60_000;
  do {
    const page = await mail.listMessages(actorAuthority, {
      mailbox_id: mailboxId,
      folder_id: folderId,
      limit: 100,
    });
    const message = page.items.find((item) => item.subject === subject);
    if (message) return message;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  } while (Date.now() < deadline);
  throw new Error("conn-test did not expose the Mail ACL integration sentinel");
}

function rows<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && "rows" in value) {
    const result = (value as { rows?: unknown }).rows;
    return Array.isArray(result) ? result as T[] : [];
  }
  return [];
}
