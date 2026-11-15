import assert from "node:assert/strict";
import test from "node:test";

import type { MailConnectionConfiguration } from "@fields/contracts/public/mail";

import type {
  ListActiveOrdinaryActorProfilesUseCase,
} from "../../../src/application/actor/index.js";
import type { MailRuntimeGateway } from "../../../src/application/mail/index.js";
import type { BackendDatabase } from "../../../src/infrastructure/persistence/postgres/database-service.js";
import {
  MAILBOX_CONNECTION_RECOVERY_PENDING_CODE,
  PostgresMailApplication,
} from "../../../src/infrastructure/persistence/postgres/repositories/company/mail-repository.js";
import {
  companyMailboxAuditEvents,
  companyMailboxGrants,
  companyMailboxMutationReceipts,
  companyMailboxes,
} from "../../../src/infrastructure/persistence/postgres/schema/company/mail.js";

const authority = {
  companyId: "company-one",
  actorId: "member-one",
  isCompanyOwner: false,
};
const configuration: MailConnectionConfiguration = {
  preset: "custom",
  email_address: "member@example.test",
  username: "member@example.test",
  application_password: "secret",
  display_name: "Member",
  imap: { host: "imap.example.test", port: 993, tls_mode: "implicit_tls" },
  smtp: { host: "smtp.example.test", port: 465, tls_mode: "implicit_tls" },
};

test("Runtime success followed by a DB transaction failure confirms rollback before projection restore", async () => {
  const db = new FakeMailDatabase();
  db.transactionFailures = 1;
  const runtime = new FakeMailRuntime();
  const application = createApplication(db, runtime);

  await assert.rejects(
    application.connectPersonal(authority, undefined, configuration, "connect-db-failure"),
    /database transaction unavailable/u,
  );

  assert.equal(runtime.connectCalls, 1);
  assert.equal(runtime.rollbackCalls, 1);
  assert.equal(runtime.finalizeCalls, 0);
  assert.equal(db.mailbox.credentialVersion, 0);
  assert.equal(db.mailbox.connectionState, "unconnected");
  assert.equal(db.receipt, null);
});

test("a committed receipt survives finalize failure and replay completes without reconnecting", async () => {
  const db = new FakeMailDatabase();
  const runtime = new FakeMailRuntime();
  runtime.finalizeFailures = 3;
  const application = createApplication(db, runtime);

  await assert.rejects(
    application.connectPersonal(authority, undefined, configuration, "connect-finalize"),
    /finalize unavailable/u,
  );
  assert.equal(db.mailbox.connectionState, "connected");
  assert.ok(db.receipt?.resultJson);
  assert.equal(runtime.connectCalls, 1);
  assert.equal(runtime.rollbackCalls, 0);

  const replay = await application.connectPersonal(
    authority,
    undefined,
    configuration,
    "connect-finalize",
  );
  assert.equal(replay.mailbox.connection_state, "connected");
  assert.equal(runtime.connectCalls, 1);
  assert.equal(runtime.finalizeCalls, 4);
});

test("a lost HTTP response replays the committed result and idempotent finalize", async () => {
  const db = new FakeMailDatabase();
  const runtime = new FakeMailRuntime();
  const application = createApplication(db, runtime);

  const first = await application.connectPersonal(
    authority,
    undefined,
    configuration,
    "connect-http-loss",
  );
  const replay = await application.connectPersonal(
    authority,
    undefined,
    configuration,
    "connect-http-loss",
  );

  assert.deepEqual(replay, first);
  assert.equal(runtime.connectCalls, 1);
  assert.equal(runtime.finalizeCalls, 2);
});

test("listing before the first connection does not expose or create a personal mailbox", async () => {
  const db = new FakeMailDatabase();
  db.mailboxDeleted = true;
  const runtime = new FakeMailRuntime();
  const application = createApplication(db, runtime);

  const firstList = await application.listMailboxes(authority);
  const secondList = await application.listMailboxes(authority);

  assert.deepEqual(firstList.items, []);
  assert.deepEqual(secondList, firstList);
  assert.equal(db.mailboxDeleted, true);
  assert.equal(runtime.connectCalls, 0);
  assert.equal(runtime.disconnectCalls, 0);

  const connected = await application.connectPersonal(
    authority,
    undefined,
    configuration,
    "connect-listed-slot",
  );

  assert.equal(connected.mailbox.mailbox_id, db.mailbox.mailboxId);
  assert.equal(connected.mailbox.connection_state, "connected");
  assert.equal(runtime.connectCalls, 1);
});

test("uncertain rollback retains the operation and same-key replay converges", async () => {
  const db = new FakeMailDatabase();
  db.transactionFailures = 1;
  const runtime = new FakeMailRuntime();
  runtime.rollbackFailures = 3;
  const application = createApplication(db, runtime);

  await assert.rejects(
    application.connectPersonal(authority, undefined, configuration, "connect-rollback"),
    (error: unknown) => (
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === MAILBOX_CONNECTION_RECOVERY_PENDING_CODE
    ),
  );
  assert.equal(db.mailbox.connectionState, "validating");
  assert.equal(db.mailbox.credentialVersion, 1);
  assert.ok(db.receipt);

  const replay = await application.connectPersonal(
    authority,
    undefined,
    configuration,
    "connect-rollback",
  );
  assert.equal(replay.mailbox.connection_state, "connected");
  assert.equal(runtime.connectCalls, 2);
  assert.equal(runtime.finalizeCalls, 1);
  assert.ok(db.receipt?.resultJson);
});

test("mailbox mutations and their audit rows roll back together", async (context) => {
  const ownerAuthority = {
    companyId: authority.companyId,
    actorId: "company-owner",
    isCompanyOwner: true,
  };
  const targetActorId = "member-two";
  const scenarios = [
    {
      name: "disconnect",
      prepare: (db: FakeMailDatabase) => db.useSharedMailbox(),
      mutate: (application: PostgresMailApplication) => application.disconnect(
        ownerAuthority,
        "mailbox-shared",
      ),
      assertRolledBack: (db: FakeMailDatabase) => {
        assert.equal(db.mailbox.connectionState, "connected");
        assert.equal(db.mailboxDeleted, false);
      },
    },
    {
      name: "delete shared",
      prepare: (db: FakeMailDatabase) => db.useSharedMailbox(),
      mutate: (application: PostgresMailApplication) => application.deleteShared(
        ownerAuthority,
        "mailbox-shared",
      ),
      assertRolledBack: (db: FakeMailDatabase) => {
        assert.equal(db.mailboxDeleted, false);
      },
    },
    {
      name: "grant",
      prepare: (db: FakeMailDatabase) => db.useSharedMailbox(),
      mutate: (application: PostgresMailApplication) => application.grant(
        ownerAuthority,
        "mailbox-shared",
        targetActorId,
      ),
      assertRolledBack: (db: FakeMailDatabase) => {
        assert.deepEqual(db.grants, []);
      },
    },
    {
      name: "revoke",
      prepare: (db: FakeMailDatabase) => {
        db.useSharedMailbox();
        db.grants = [targetActorId];
      },
      mutate: (application: PostgresMailApplication) => application.revoke(
        ownerAuthority,
        "mailbox-shared",
        targetActorId,
      ),
      assertRolledBack: (db: FakeMailDatabase) => {
        assert.deepEqual(db.grants, [targetActorId]);
      },
    },
  ];

  for (const scenario of scenarios) {
    await context.test(scenario.name, async () => {
      const db = new FakeMailDatabase();
      const runtime = new FakeMailRuntime();
      scenario.prepare(db);
      db.auditInsertFailures = 1;
      const application = createApplication(db, runtime);

      await assert.rejects(
        scenario.mutate(application),
        /audit insert unavailable/u,
      );

      scenario.assertRolledBack(db);
      assert.deepEqual(db.audits, []);
    });
  }
});

function createApplication(
  db: FakeMailDatabase,
  runtime: FakeMailRuntime,
): PostgresMailApplication {
  const actorProfiles = {
    execute: async () => [{
      actorId: authority.actorId,
      companyId: authority.companyId,
      displayName: "Member",
      mark: "ME",
      actorType: "human" as const,
    }],
  };
  return new PostgresMailApplication(
    db as unknown as BackendDatabase,
    runtime as unknown as MailRuntimeGateway,
    actorProfiles as unknown as ListActiveOrdinaryActorProfilesUseCase,
    () => 100,
    () => "fixed-id",
  );
}

class FakeMailRuntime {
  connectCalls = 0;
  disconnectCalls = 0;
  finalizeCalls = 0;
  rollbackCalls = 0;
  finalizeFailures = 0;
  rollbackFailures = 0;

  async connect() {
    this.connectCalls += 1;
    return {
      ok: true as const,
      connection_state: "connected" as const,
      capabilities: {
        folders: true,
        search: true,
        flags: true,
        move: true,
        trash: true,
        append_sent: true,
      },
    };
  }

  async disconnect() {
    this.disconnectCalls += 1;
    return { ok: true as const };
  }

  async finalizeConnection() {
    this.finalizeCalls += 1;
    if (this.finalizeFailures > 0) {
      this.finalizeFailures -= 1;
      throw new Error("finalize unavailable");
    }
    return { ok: true as const };
  }

  async rollbackConnection() {
    this.rollbackCalls += 1;
    if (this.rollbackFailures > 0) {
      this.rollbackFailures -= 1;
      throw new Error("rollback unavailable");
    }
    return { ok: true as const };
  }
}

type MailboxRow = {
  mailboxId: string;
  companyId: string;
  kind: string;
  targetActorId: string | null;
  displayName: string | null;
  emailAddress: string | null;
  connectionState: string;
  credentialVersion: number;
  capabilityFolders: boolean;
  capabilitySearch: boolean;
  capabilityFlags: boolean;
  capabilityMove: boolean;
  capabilityTrash: boolean;
  capabilityAppendSent: boolean;
  lastCheckedAtMs: number | null;
  lastErrorCode: string | null;
  createdByActorId: string;
  createdAtMs: number;
  updatedAtMs: number;
};

type ReceiptRow = {
  companyId: string;
  actorId: string;
  idempotencyKey: string;
  operation: string;
  operationId: string;
  mailboxId: string;
  expectedCredentialVersion: number;
  credentialVersion: number;
  previousMailboxJson: string | null;
  requestFingerprint: string;
  resultJson: string | null;
  createdAtMs: number;
};

class FakeMailDatabase {
  transactionFailures = 0;
  auditInsertFailures = 0;
  mailboxDeleted = false;
  grants: string[] = [];
  mailbox: MailboxRow = {
    mailboxId: "mailbox_personal_7e044d0a938ecb1b1a74241153b9f9a7",
    companyId: authority.companyId,
    kind: "personal",
    targetActorId: authority.actorId,
    displayName: "Member",
    emailAddress: null,
    connectionState: "unconnected",
    credentialVersion: 0,
    capabilityFolders: false,
    capabilitySearch: false,
    capabilityFlags: false,
    capabilityMove: false,
    capabilityTrash: false,
    capabilityAppendSent: false,
    lastCheckedAtMs: null,
    lastErrorCode: null,
    createdByActorId: authority.actorId,
    createdAtMs: 1,
    updatedAtMs: 1,
  };
  receipt: ReceiptRow | null = null;
  audits: unknown[] = [];

  useSharedMailbox(): void {
    this.mailbox = {
      ...this.mailbox,
      mailboxId: "mailbox-shared",
      kind: "shared",
      targetActorId: null,
      displayName: "Shared",
      emailAddress: "shared@example.test",
      connectionState: "connected",
      credentialVersion: 1,
    };
  }

  select(selection?: Record<string, unknown>) {
    return {
      from: (table: unknown) => {
        const rows = table === companyMailboxes
          ? this.mailboxDeleted
            ? []
            : selection && "mailbox" in selection
              ? [{ mailbox: this.mailbox, grantedActorId: null }]
              : [this.mailbox]
          : table === companyMailboxMutationReceipts && this.receipt
            ? [this.receipt]
            : table === companyMailboxGrants
              ? this.grants.map((actorId) => ({ actorId }))
              : [];
        return chainReturning(rows);
      },
    };
  }

  insert(table: unknown) {
    return {
      values: (value: Record<string, unknown>) => {
        let rows: unknown[] = [];
        if (table === companyMailboxMutationReceipts) {
          if (!this.receipt) {
            this.receipt = value as unknown as ReceiptRow;
            rows = [this.receipt];
          }
        } else if (table === companyMailboxes) {
          if (this.mailboxDeleted) {
            this.mailbox = value as unknown as MailboxRow;
            this.mailboxDeleted = false;
            rows = [this.mailbox];
          }
        } else if (table === companyMailboxAuditEvents) {
          this.audits.push(value);
          if (this.auditInsertFailures > 0) {
            this.auditInsertFailures -= 1;
            return chainRejecting(new Error("audit insert unavailable"));
          }
        } else if (table === companyMailboxGrants) {
          const actorId = String(value.actorId);
          if (!this.grants.includes(actorId)) this.grants.push(actorId);
        }
        return chainReturning(rows);
      },
    };
  }

  update(table: unknown) {
    return {
      set: (value: Record<string, unknown>) => ({
        where: () => {
          let rows: unknown[] = [];
          if (table === companyMailboxes) {
            Object.assign(this.mailbox, value);
            rows = [this.mailbox];
          } else if (table === companyMailboxMutationReceipts && this.receipt) {
            Object.assign(this.receipt, value);
            rows = [this.receipt];
          }
          return chainReturning(rows);
        },
      }),
    };
  }

  delete(table: unknown) {
    return {
      where: () => {
        if (table === companyMailboxMutationReceipts) this.receipt = null;
        if (table === companyMailboxes) this.mailboxDeleted = true;
        if (table === companyMailboxGrants) this.grants = [];
        return chainReturning([]);
      },
    };
  }

  async transaction<T>(run: (transaction: FakeMailDatabase) => Promise<T>): Promise<T> {
    if (this.transactionFailures > 0) {
      this.transactionFailures -= 1;
      throw new Error("database transaction unavailable");
    }
    const snapshot = {
      mailbox: { ...this.mailbox },
      mailboxDeleted: this.mailboxDeleted,
      grants: [...this.grants],
      receipt: this.receipt ? { ...this.receipt } : null,
      audits: [...this.audits],
    };
    try {
      return await run(this);
    } catch (error) {
      this.mailbox = snapshot.mailbox;
      this.mailboxDeleted = snapshot.mailboxDeleted;
      this.grants = snapshot.grants;
      this.receipt = snapshot.receipt;
      this.audits = snapshot.audits;
      throw error;
    }
  }
}

function chainReturning(rows: unknown[]) {
  const chain: {
    leftJoin: () => typeof chain;
    where: () => typeof chain;
    orderBy: () => Promise<unknown[]>;
    limit: () => Promise<unknown[]>;
    onConflictDoNothing: () => typeof chain;
    onConflictDoUpdate: () => typeof chain;
    returning: () => Promise<unknown[]>;
    then: Promise<unknown[]>["then"];
  } = {
    leftJoin: () => chain,
    where: () => chain,
    orderBy: async () => rows,
    limit: async () => rows,
    onConflictDoNothing: () => chain,
    onConflictDoUpdate: () => chain,
    returning: async () => rows,
    then: Promise.resolve(rows).then.bind(Promise.resolve(rows)),
  };
  return chain;
}

function chainRejecting(error: Error) {
  const rejected = Promise.reject(error);
  rejected.catch(() => undefined);
  const chain = chainReturning([]);
  chain.then = rejected.then.bind(rejected);
  return chain;
}
