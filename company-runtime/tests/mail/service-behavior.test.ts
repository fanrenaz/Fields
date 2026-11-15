import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  runtimeMailboxSendInputSchema,
} from "@fields/contracts/internal/mail";
import type {
  MailConnectionConfiguration,
  MailMessageSummary,
} from "@fields/contracts/public/mail";
import type Database from "better-sqlite3";
import { simpleParser } from "mailparser";

import type { ResolvedMailConnection } from "../../src/application/mail/connection-policy.js";
import {
  CompanyMailService,
  MailServiceError,
  decodeMessageCursor,
  encodeAttachmentId,
  encodeFolderId,
  encodeMessageCursor,
  encodeMessageId,
  type CompanyMailServiceOptions,
} from "../../src/application/mail/service.js";
import { memberWorkspaceLayout } from "../../src/infrastructure/filesystem/workspace.js";

const configuration: MailConnectionConfiguration = {
  preset: "custom",
  email_address: "sender@example.test",
  username: "sender@example.test",
  application_password: "app-password",
  display_name: "Sender",
  imap: { host: "imap.example.test", port: 993, tls_mode: "implicit_tls" },
  smtp: { host: "smtp.example.test", port: 465, tls_mode: "implicit_tls" },
};
const resolved: ResolvedMailConnection = {
  configuration,
  imap: {
    ...configuration.imap!,
    addresses: [{ address: "8.8.8.8", family: 4 }],
  },
  smtp: {
    ...configuration.smtp!,
    addresses: [{ address: "8.8.4.4", family: 4 }],
  },
};
const authority = {
  company_id: "company-one",
  requested_by_actor_id: "member-one",
  mailbox_id: "mailbox-one",
  access: "personal" as const,
};

test("credential versions serialize, replay, finalize, and rollback without overwriting a winner", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "mail-connection-"));
  let imapConnects = 0;
  const service = connectedTestService(workdir, () => {
    imapConnects += 1;
  });
  try {
    const firstInput = {
      authority,
      operation_id: "connect-one",
      expected_credential_version: 0,
      credential_version: 1,
      configuration,
    };
    const [first, concurrent] = await Promise.allSettled([
      service.connect(firstInput),
      service.connect({
        ...firstInput,
        operation_id: "connect-conflict",
      }),
    ]);
    assert.equal(first.status, "fulfilled");
    assert.equal(concurrent.status, "rejected");
    assert.ok(concurrent.status === "rejected"
      && concurrent.reason instanceof MailServiceError
      && concurrent.reason.code === "MAIL_CREDENTIAL_VERSION_CONFLICT");
    assert.equal(imapConnects, 1);

    await service.connect(firstInput);
    assert.equal(imapConnects, 1, "same operation replays the durable active result");
    await assert.rejects(
      service.connect({
        ...firstInput,
        configuration: {
          ...configuration,
          application_password: "different-secret",
        },
      }),
      (error: unknown) => (
        error instanceof MailServiceError
        && error.code === "MAILBOX_IDEMPOTENCY_CONFLICT"
      ),
    );
    assert.equal(imapConnects, 1, "a conflicting secret is rejected before network access");
    await service.finalizeConnection({
      authority,
      operation_id: "connect-one",
      credential_version: 1,
    });
    await service.finalizeConnection({
      authority,
      operation_id: "connect-one",
      credential_version: 1,
    });

    await service.connect({
      authority,
      operation_id: "connect-two",
      expected_credential_version: 1,
      credential_version: 2,
      configuration,
    });
    await service.rollbackConnection({
      authority,
      operation_id: "connect-one",
      credential_version: 1,
    });
    assert.equal((await storedCredential(workdir)).credential_version, 2);
    await service.rollbackConnection({
      authority,
      operation_id: "connect-two",
      credential_version: 2,
    });
    assert.equal((await storedCredential(workdir)).credential_version, 1);
    assert.equal(
      (await stat(join(workdir, "mailboxes", "credentials", "mailbox-one.json"))).mode & 0o777,
      0o600,
    );
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("connection proves exact From ownership by SMTP acceptance and IMAP Message-ID readback", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "mail-address-probe-"));
  const folders = [
    testFolder("INBOX", "\\Inbox"),
    testFolder("Trash", "\\Trash"),
  ];
  let currentFolder = "";
  let sentMessageId = "";
  let sendCalls = 0;
  const moved: Array<{ uid: number; destination: string }> = [];
  const service = new CompanyMailService(workdir, Date.now, {
    resolveConnection: async () => resolved,
    addressProbeAttempts: 1,
    sleep: async () => undefined,
  });
  const client = {
    usable: true,
    mailbox: { uidValidity: 1n },
    capabilities: new Set(["MOVE"]),
    async connect() {},
    async list() {
      return folders;
    },
    async getMailboxLock(path: string) {
      currentFolder = path;
      return { release() {} };
    },
    async search() {
      return currentFolder === "INBOX" && sentMessageId ? [42] : [];
    },
    async fetchOne() {
      return {
        headers: Buffer.from(`Message-ID: ${sentMessageId}\r\n`),
      };
    },
    async messageMove(uid: number, destination: string) {
      moved.push({ uid, destination });
      return true;
    },
    async logout() {},
    close() {},
  };
  Reflect.set(service, "imapClient", () => client);
  Reflect.set(service, "smtpTransport", () => ({
    async verify() {
      return true;
    },
    async sendMail(input: {
      envelope: { from: string; to: string[] };
      from: string;
      to: string;
      messageId: string;
    }) {
      sendCalls += 1;
      assert.deepEqual(input.envelope, {
        from: configuration.email_address,
        to: [configuration.email_address],
      });
      assert.equal(input.from, configuration.email_address);
      assert.equal(input.to, configuration.email_address);
      sentMessageId = input.messageId;
      return {
        accepted: [configuration.email_address],
        rejected: [],
        messageId: input.messageId,
      };
    },
    close() {},
  }));
  Reflect.set(service, "syncRecentIndex", async () => undefined);
  const probePath = join(
    workdir,
    "mailboxes",
    "credentials",
    "mailbox-one.address-probe.json",
  );
  try {
    await service.connect({
      authority,
      operation_id: "strict-address-probe",
      expected_credential_version: 0,
      credential_version: 1,
      configuration,
    });
    assert.equal(sendCalls, 1);
    assert.match(
      sentMessageId,
      /^<fields-mail-address-probe-[\da-f]{64}@fields\.invalid>$/u,
    );
    assert.deepEqual(moved, [{ uid: 42, destination: "Trash" }]);
    assert.equal((await stat(probePath)).mode & 0o777, 0o600);
    assert.equal(
      JSON.parse(await readFile(probePath, "utf8")).status,
      "verified",
    );
    await service.finalizeConnection({
      authority,
      operation_id: "strict-address-probe",
      credential_version: 1,
    });
    await assert.rejects(stat(probePath), hasCode("ENOENT"));
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("uncertain ownership probe is durable and never automatically resent", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "mail-address-probe-unknown-"));
  let sendCalls = 0;
  const service = new CompanyMailService(workdir, Date.now, {
    resolveConnection: async () => resolved,
    addressProbeAttempts: 1,
    sleep: async () => undefined,
  });
  const client = {
    usable: true,
    mailbox: { uidValidity: 1n },
    capabilities: new Set(["MOVE"]),
    async connect() {},
    async list() {
      return [testFolder("INBOX", "\\Inbox")];
    },
    async getMailboxLock() {
      return { release() {} };
    },
    async search() {
      return [];
    },
    async logout() {},
    close() {},
  };
  Reflect.set(service, "imapClient", () => client);
  Reflect.set(service, "smtpTransport", () => ({
    async verify() {
      return true;
    },
    async sendMail() {
      sendCalls += 1;
      throw Object.assign(new Error("DATA response lost"), {
        code: "ECONNRESET",
        command: "DATA",
      });
    },
    close() {},
  }));
  Reflect.set(service, "syncRecentIndex", async () => undefined);
  const connectInput = {
    authority,
    operation_id: "uncertain-address-probe",
    expected_credential_version: 0,
    credential_version: 1,
    configuration,
  };
  try {
    await assert.rejects(
      service.connect(connectInput),
      mailError("MAIL_ADDRESS_PROBE_UNKNOWN"),
    );
    await assert.rejects(
      service.connect(connectInput),
      mailError("MAIL_ADDRESS_PROBE_UNKNOWN"),
    );
    await assert.rejects(
      service.connect({
        ...connectInput,
        operation_id: "uncertain-address-probe-new-operation",
      }),
      mailError("MAIL_ADDRESS_PROBE_UNKNOWN"),
    );
    assert.equal(sendCalls, 1);
    const receiptPath = join(
      workdir,
      "mailboxes",
      "credentials",
      "mailbox-one.address-probe.json",
    );
    assert.equal(
      JSON.parse(await readFile(receiptPath, "utf8")).status,
      "unknown",
    );
    await writeFile(receiptPath, "{corrupt-receipt", { mode: 0o600 });
    await assert.rejects(
      service.connect(connectInput),
      mailError("MAIL_ADDRESS_PROBE_RECEIPT_INVALID"),
    );
    assert.equal(sendCalls, 1);
    await service.disconnect({ authority, remove_index: true });
    await assert.rejects(stat(receiptPath), hasCode("ENOENT"));
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("cursor binds folder, UIDVALIDITY, and UID canonically", () => {
  const cursor = encodeMessageCursor("mail_folder_SU5CT1g", "700", 42);
  assert.deepEqual(decodeMessageCursor(cursor), {
    folderId: "mail_folder_SU5CT1g",
    uidValidity: "700",
    uid: 42,
  });
  assert.throws(() => decodeMessageCursor(`${cursor}=`), (error: unknown) => (
    error instanceof MailServiceError && error.code === "MAIL_CURSOR_INVALID"
  ));
});

test("UIDVALIDITY reset removes stale folder rows and 30-day pruning honors recent access", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "mail-index-"));
  let now = 1_800_000_000_000;
  const service = new CompanyMailService(workdir, () => now);
  const openIndex = Reflect.get(service, "openIndex") as (
    this: CompanyMailService,
    mailboxId: string,
  ) => Database.Database;
  const reset = Reflect.get(service, "resetFolderOnUidValidityChange") as (
    this: CompanyMailService,
    mailboxId: string,
    folderId: string,
    path: string,
    uidValidity: string,
  ) => void;
  const folderId = encodeFolderId("INBOX");
  const summary = messageSummary(folderId, encodeMessageId(folderId, "1", 1), "stale");
  try {
    let db = openIndex.call(service, authority.mailbox_id);
    db.prepare(`
      insert into folders (
        folder_id, path, name, role, selectable, total_count, unread_count, uid_validity
      ) values (?, 'INBOX', 'Inbox', 'inbox', 1, 2, 0, '1')
    `).run(folderId);
    insertIndexedMessage(db, summary, "1", 1, now - 31 * 24 * 60 * 60 * 1_000);
    insertIndexedMessage(
      db,
      { ...summary, message_id: encodeMessageId(folderId, "1", 2), subject: "recently accessed" },
      "1",
      2,
      now,
    );
    db.close();

    now += 30 * 24 * 60 * 60 * 1_000;
    db = openIndex.call(service, authority.mailbox_id);
    assert.deepEqual(
      (db.prepare("select subject from messages order by uid").all() as Array<{ subject: string }>)
        .map((row) => row.subject),
      ["recently accessed"],
    );
    db.close();

    reset.call(service, authority.mailbox_id, folderId, "INBOX", "2");
    db = openIndex.call(service, authority.mailbox_id);
    assert.equal((db.prepare("select count(*) as count from messages").get() as { count: number }).count, 0);
    assert.equal(
      (db.prepare("select uid_validity from folders where folder_id = ?").get(folderId) as {
        uid_validity: string;
      }).uid_validity,
      "2",
    );
    db.close();
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("continuous index refresh fetches new UIDs plus a bounded recent flag window", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "mail-index-incremental-"));
  const now = 1_800_000_000_000;
  const service = new CompanyMailService(workdir, () => now);
  const folder = testFolder("INBOX", "\\Inbox");
  const folderId = encodeFolderId("INBOX");
  const openIndex = Reflect.get(service, "openIndex") as (
    this: CompanyMailService,
    mailboxId: string,
  ) => Database.Database;
  const syncRecentIndex = Reflect.get(service, "syncRecentIndex") as (
    this: CompanyMailService,
    mailboxId: string,
    client: object,
    folders: ReturnType<typeof testFolder>[],
  ) => Promise<void>;
  const fetchedUids: number[] = [];
  let remoteUids = Array.from({ length: 601 }, (_value, index) => index + 1);
  Reflect.set(service, "fetchAndIndex", async (
    _mailboxId: string,
    _folderId: string,
    _folderPath: string,
    _uidValidity: string,
    _client: object,
    uids: number[],
  ) => {
    fetchedUids.push(...uids);
    return [];
  });
  const client = {
    mailbox: { uidValidity: 1n },
    async getMailboxLock() {
      return { release() {} };
    },
    async search() {
      return remoteUids;
    },
  };
  try {
    const db = openIndex.call(service, authority.mailbox_id);
    const insertMany = db.transaction(() => {
      for (let uid = 1; uid <= 600; uid += 1) {
        insertIndexedMessage(
          db,
          {
            ...messageSummary(folderId, encodeMessageId(folderId, "1", uid), `existing-${uid}`),
            sent_at_ms: now,
            received_at_ms: now,
            indexed_at_ms: now,
          },
          "1",
          uid,
          now,
        );
      }
    });
    insertMany();
    db.close();

    await syncRecentIndex.call(service, authority.mailbox_id, client, [folder]);
    assert.deepEqual(
      fetchedUids,
      Array.from({ length: 500 }, (_value, index) => index + 102),
    );

    fetchedUids.length = 0;
    remoteUids = remoteUids.slice(1);
    await syncRecentIndex.call(service, authority.mailbox_id, client, [folder]);
    assert.deepEqual(
      fetchedUids,
      Array.from({ length: 500 }, (_value, index) => index + 102),
    );
    const afterRemoval = openIndex.call(service, authority.mailbox_id);
    assert.equal(
      (afterRemoval.prepare(
        "select count(*) as count from messages where folder_id = ? and uid = 1",
      ).get(folderId) as { count: number }).count,
      0,
    );
    afterRemoval.close();
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("background indexing reconnects after failure and shutdown clears its timer", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "mail-index-lifecycle-"));
  let scheduled: (() => void) | null = null;
  let cleared = 0;
  const timer = { unref() {} } as ReturnType<typeof setInterval>;
  const service = connectedTestService(workdir, undefined, Date.now, {
    serviceOptions: {
      setInterval(callback) {
        scheduled = callback;
        return timer;
      },
      clearInterval(handle) {
        assert.equal(handle, timer);
        cleared += 1;
      },
      indexRefreshIntervalMs: 25,
    },
  });
  try {
    await service.connect({
      authority,
      operation_id: "background-index-connect",
      expected_credential_version: 0,
      credential_version: 1,
      configuration,
    });
    let connectAttempts = 0;
    let syncCalls = 0;
    Reflect.set(service, "imapClient", () => {
      let usable = false;
      return {
        get usable() {
          return usable;
        },
        async connect() {
          connectAttempts += 1;
          if (connectAttempts === 1) throw new Error("temporary disconnect");
          usable = true;
        },
        async list() {
          return [testFolder("INBOX", "\\Inbox")];
        },
        async logout() {
          usable = false;
        },
        close() {
          usable = false;
        },
      };
    });
    Reflect.set(service, "syncRecentIndex", async () => {
      syncCalls += 1;
    });

    service.startBackgroundIndexing();
    service.startBackgroundIndexing();
    assert.ok(scheduled);
    assert.deepEqual(await service.refreshIndexesNow(), {
      refreshed_mailbox_ids: [],
      failed_mailbox_ids: [authority.mailbox_id],
    });
    await writeFile(
      join(workdir, "mailboxes", "credentials", "mailbox-corrupt.json"),
      "{not-json",
      { mode: 0o600 },
    );
    const firstScheduledRefresh = scheduled as (() => void) | null;
    assert.ok(firstScheduledRefresh);
    firstScheduledRefresh();
    assert.deepEqual(await service.refreshIndexesNow(), {
      refreshed_mailbox_ids: [authority.mailbox_id],
      failed_mailbox_ids: ["mailbox-corrupt"],
    });
    assert.equal(connectAttempts, 2);
    assert.equal(syncCalls, 1);

    await service.shutdown();
    assert.equal(cleared, 1);
    const stoppedScheduledRefresh = scheduled as (() => void) | null;
    assert.ok(stoppedScheduledRefresh);
    stoppedScheduledRefresh();
    assert.deepEqual(await service.refreshIndexesNow(), {
      refreshed_mailbox_ids: [],
      failed_mailbox_ids: [],
    });
    assert.equal(connectAttempts, 2);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("indexed search matches stable ISO UTC sent and received dates", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "mail-date-search-"));
  const now = Date.parse("2026-08-01T00:00:00.000Z");
  const service = new CompanyMailService(workdir, () => now);
  const openIndex = Reflect.get(service, "openIndex") as (
    this: CompanyMailService,
    mailboxId: string,
  ) => Database.Database;
  const folderId = encodeFolderId("INBOX");
  const sentAt = Date.parse("2026-07-27T12:34:56.789Z");
  const receivedAt = Date.parse("2026-07-28T01:02:03.004Z");
  const sent = {
    ...messageSummary(folderId, encodeMessageId(folderId, "1", 1), "sent date"),
    sent_at_ms: sentAt,
    received_at_ms: null,
  };
  const received = {
    ...messageSummary(folderId, encodeMessageId(folderId, "1", 2), "received date"),
    sent_at_ms: null,
    received_at_ms: receivedAt,
  };
  try {
    const db = openIndex.call(service, authority.mailbox_id);
    insertIndexedMessage(db, sent, "1", 1, now);
    insertIndexedMessage(db, received, "1", 2, now);
    db.close();

    const sentResult = await service.searchMessages({
      authorities: [authority],
      request: {
        search_term: "2026-07-27T12:34:56.789Z",
        limit: 10,
        include_remote_history: false,
      },
    });
    assert.deepEqual(sentResult.items.map((item) => item.message_id), [sent.message_id]);

    const receivedResult = await service.searchMessages({
      authorities: [authority],
      request: {
        search_term: "2026-07-28T01:02:03.004Z",
        limit: 10,
        include_remote_history: false,
      },
    });
    assert.deepEqual(
      receivedResult.items.map((item) => item.message_id),
      [received.message_id],
    );
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("message coverage reports the durable index horizon instead of a moving clock", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "mail-index-coverage-"));
  let now = Date.parse("2026-07-27T00:00:00.000Z");
  const initialIndexedFrom = now - 30 * 24 * 60 * 60 * 1_000;
  const service = new CompanyMailService(workdir, () => now);
  const openIndex = Reflect.get(service, "openIndex") as (
    this: CompanyMailService,
    mailboxId: string,
  ) => Database.Database;
  const folderId = encodeFolderId("INBOX");
  try {
    let db = openIndex.call(service, authority.mailbox_id);
    db.prepare("insert or replace into metadata (key, value) values ('indexed_from_ms', ?)")
      .run(String(initialIndexedFrom));
    db.close();

    now += 7 * 24 * 60 * 60 * 1_000;
    const indexedSearch = await service.searchMessages({
      authorities: [authority],
      request: {
        search_term: "no result",
        limit: 10,
        include_remote_history: false,
      },
    });
    assert.equal(indexedSearch.coverage.indexed_from_ms, initialIndexedFrom);

    Reflect.set(service, "withImap", async (
      _authority: unknown,
      run: (client: object) => Promise<unknown>,
    ) => run({
      mailbox: { uidValidity: 1n },
      async getMailboxLock() {
        return { release() {} };
      },
      async search() {
        return [];
      },
    }));
    const listed = await service.listMessages({
      authority,
      request: { folder_id: folderId, limit: 10 },
    });
    assert.equal(listed.coverage.indexed_from_ms, initialIndexedFrom);

    const otherAuthority = {
      ...authority,
      mailbox_id: "mailbox-two",
      access: "shared_grant" as const,
    };
    const laterIndexedFrom = initialIndexedFrom + 1_000;
    db = openIndex.call(service, otherAuthority.mailbox_id);
    db.prepare("insert or replace into metadata (key, value) values ('indexed_from_ms', ?)")
      .run(String(laterIndexedFrom));
    db.close();
    const combined = await service.searchMessages({
      authorities: [authority, otherAuthority],
      request: {
        search_term: "no result",
        limit: 10,
        include_remote_history: false,
      },
    });
    assert.equal(combined.coverage.indexed_from_ms, laterIndexedFrom);

    db = openIndex.call(service, otherAuthority.mailbox_id);
    db.prepare("delete from metadata where key = 'indexed_from_ms'").run();
    db.close();
    const incomplete = await service.searchMessages({
      authorities: [authority, otherAuthority],
      request: {
        search_term: "no result",
        limit: 10,
        include_remote_history: false,
      },
    });
    assert.equal(incomplete.coverage.indexed_from_ms, null);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("remote search does not collapse mailbox-local message identifiers", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "mail-search-identity-"));
  const service = new CompanyMailService(workdir);
  const openIndex = Reflect.get(service, "openIndex") as (
    this: CompanyMailService,
    mailboxId: string,
  ) => Database.Database;
  const folderId = encodeFolderId("INBOX");
  const sharedMessageId = encodeMessageId(folderId, "1", 1);
  const indexed = messageSummary(folderId, sharedMessageId, "indexed");
  const otherAuthority = {
    ...authority,
    mailbox_id: "mailbox-two",
    access: "shared_grant" as const,
  };
  const remote = {
    ...messageSummary(folderId, sharedMessageId, "remote"),
    mailbox_id: otherAuthority.mailbox_id,
  };
  Reflect.set(service, "searchRemoteMailbox", async (
    current: typeof authority,
  ) => current.mailbox_id === otherAuthority.mailbox_id ? [remote] : []);
  try {
    const db = openIndex.call(service, authority.mailbox_id);
    insertIndexedMessage(db, indexed, "1", 1, Date.now());
    db.close();
    const result = await service.searchMessages({
      authorities: [authority, otherAuthority],
      request: {
        search_term: "indexed",
        limit: 10,
        include_remote_history: true,
      },
    });
    assert.deepEqual(
      new Set(result.items.map((item) => `${item.mailbox_id}:${item.subject}`)),
      new Set(["mailbox-one:indexed", "mailbox-two:remote"]),
    );
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("Trash capability requires both IMAP MOVE and a Trash folder", async () => {
  const scenarios = [
    {
      name: "Trash folder without MOVE",
      capabilities: [] as string[],
      folders: [testFolder("INBOX", "\\Inbox"), testFolder("Trash", "\\Trash")],
      expectedMove: false,
      expectedTrash: false,
    },
    {
      name: "MOVE without Trash folder",
      capabilities: ["MOVE"],
      folders: [testFolder("INBOX", "\\Inbox")],
      expectedMove: true,
      expectedTrash: false,
    },
    {
      name: "MOVE with Trash folder",
      capabilities: ["MOVE"],
      folders: [testFolder("INBOX", "\\Inbox"), testFolder("Trash", "\\Trash")],
      expectedMove: true,
      expectedTrash: true,
    },
  ];

  for (const [index, scenario] of scenarios.entries()) {
    const workdir = await mkdtemp(join(tmpdir(), "mail-capabilities-"));
    const service = connectedTestService(workdir, undefined, Date.now, {
      capabilities: scenario.capabilities,
      folders: scenario.folders,
    });
    try {
      const result = await service.connect({
        authority,
        operation_id: `capabilities-${index}`,
        expected_credential_version: 0,
        credential_version: 1,
        configuration,
      });
      assert.equal(result.capabilities.move, scenario.expectedMove, scenario.name);
      assert.equal(result.capabilities.trash, scenario.expectedTrash, scenario.name);
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  }
});

test("standard MIME reply chains resolve to one indexed thread", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "mail-thread-"));
  const service = new CompanyMailService(workdir, () => 100);
  const project = Reflect.get(service, "projectAndIndexMessage") as (
    this: CompanyMailService,
    mailboxId: string,
    folderId: string,
    folderPath: string,
    uidValidity: string,
    fetched: object,
    parsed: Awaited<ReturnType<typeof simpleParser>>,
  ) => Promise<MailMessageSummary>;
  const folderId = encodeFolderId("INBOX");
  try {
    const root = await project.call(
      service,
      authority.mailbox_id,
      folderId,
      "INBOX",
      "9",
      fetchedMessage(1),
      await simpleParser([
        "Message-ID: <root@example.test>",
        "From: one@example.test",
        "To: sender@example.test",
        "Subject: Root",
        "",
        "Root body",
      ].join("\r\n")),
    );
    const reply = await project.call(
      service,
      authority.mailbox_id,
      folderId,
      "INBOX",
      "9",
      fetchedMessage(2),
      await simpleParser([
        "Message-ID: <reply@example.test>",
        "In-Reply-To: <root@example.test>",
        "References: <root@example.test>",
        "From: two@example.test",
        "To: sender@example.test",
        "Subject: Re: Root",
        "",
        "Reply body",
      ].join("\r\n")),
    );
    const secondReply = await project.call(
      service,
      authority.mailbox_id,
      folderId,
      "INBOX",
      "9",
      fetchedMessage(3),
      await simpleParser([
        "Message-ID: <reply-two@example.test>",
        "In-Reply-To: <reply@example.test>",
        "References: <root@example.test> <reply@example.test>",
        "From: one@example.test",
        "To: sender@example.test",
        "Subject: Re: Root",
        "",
        "Second reply body",
      ].join("\r\n")),
    );
    assert.equal(reply.thread_id, root.thread_id);
    assert.equal(secondReply.thread_id, root.thread_id);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("untrusted MIME metadata is bounded before contract and index projection", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "mail-metadata-bounds-"));
  const service = new CompanyMailService(workdir, () => 100);
  const project = Reflect.get(service, "projectAndIndexMessage") as (
    this: CompanyMailService,
    mailboxId: string,
    folderId: string,
    folderPath: string,
    uidValidity: string,
    fetched: object,
    parsed: Awaited<ReturnType<typeof simpleParser>>,
  ) => Promise<MailMessageSummary>;
  const openIndex = Reflect.get(service, "openIndex") as (
    this: CompanyMailService,
    mailboxId: string,
  ) => Database.Database;
  const folderId = encodeFolderId("INBOX");
  const references = Array.from(
    { length: 120 },
    (_, index) => `<reference-${index}@example.test>`,
  );
  try {
    const summary = await project.call(
      service,
      authority.mailbox_id,
      folderId,
      "INBOX",
      "9",
      {
        ...fetchedMessage(1),
        flags: new Set(["x".repeat(300)]),
        bodyStructure: {
          part: "2",
          type: `application/${"x".repeat(300)}`,
          size: 12,
          id: "c".repeat(1_100),
          disposition: "attachment",
          dispositionParameters: { filename: "f".repeat(1_100) },
          childNodes: [],
        },
      },
      {
        messageId: `<${"m".repeat(2_100)}>`,
        inReplyTo: `<${"p".repeat(2_100)}>`,
        references,
        subject: "s".repeat(5_000),
        from: {
          value: [{ name: "n".repeat(600), address: "sender@example.test" }],
        },
        to: {
          value: [{ name: "", address: "recipient@example.test" }],
        },
      } as Awaited<ReturnType<typeof simpleParser>>,
    );
    assert.equal(summary.subject.length, 4_096);
    assert.equal(summary.internet_message_id, null);
    assert.equal(summary.from[0]?.name?.length, 500);
    assert.equal(summary.flags[0]?.length, 255);
    assert.equal(summary.attachments[0]?.filename?.length, 1_024);
    assert.equal(summary.attachments[0]?.content_type.length, 255);
    assert.equal(summary.attachments[0]?.content_id?.length, 1_024);
    const db = openIndex.call(service, authority.mailbox_id);
    const row = db.prepare(`
      select in_reply_to, references_json from messages where message_id = ?
    `).get(summary.message_id) as {
      in_reply_to: string | null;
      references_json: string;
    };
    db.close();
    assert.equal(row.in_reply_to, null);
    assert.equal((JSON.parse(row.references_json) as string[]).length, 100);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("oversized external message bodies fail with one stable Mail error", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "mail-body-bounds-"));
  const service = new CompanyMailService(workdir);
  const folderId = encodeFolderId("INBOX");
  const messageId = encodeMessageId(folderId, "7", 11);
  const source = Buffer.from([
    "Message-ID: <large@example.test>",
    "From: sender@example.test",
    "To: recipient@example.test",
    "Subject: Oversized body",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "x".repeat(10_000_001),
  ].join("\r\n"));
  Reflect.set(service, "withImap", async (
    _authority: unknown,
    run: (client: object) => Promise<unknown>,
  ) => run({
    mailbox: { uidValidity: 7n },
    async getMailboxLock() {
      return { release() {} };
    },
    async fetchOne() {
      return {
        ...fetchedMessage(11),
        source,
        size: source.byteLength,
      };
    },
  }));
  try {
    await assert.rejects(
      service.readMessage({
        authority,
        request: { folder_id: folderId, message_id: messageId },
      }),
      (error: unknown) => (
        error instanceof MailServiceError
        && error.code === "MAIL_MESSAGE_BODY_TOO_LARGE"
        && error.retryable === false
      ),
    );
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("send receipts prevent duplicates and preserve Sent failure, SMTP unknown, and stale unknown", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "mail-send-"));
  let now = 2_000_000_000_000;
  const service = connectedTestService(workdir, undefined, () => now);
  let smtpCalls = 0;
  const smtpMessages: Array<{
    envelope: { from: string; to: string[] };
    raw: Buffer;
  }> = [];
  let appendSucceeds = true;
  try {
    await service.connect({
      authority,
      operation_id: "connect-send",
      expected_credential_version: 0,
      credential_version: 1,
      configuration,
    });
    Reflect.set(service, "smtpTransport", () => ({
      async sendMail(message: {
        envelope: { from: string; to: string[] };
        raw: Buffer;
      }) {
        smtpCalls += 1;
        smtpMessages.push(message);
        return { messageId: `<sent-${smtpCalls}@example.test>` };
      },
      close() {},
    }));
    Reflect.set(service, "withImap", async (
      _authority: unknown,
      run: (client: object) => Promise<unknown>,
    ) => run({
      async list() {
        return [{ path: "Sent", specialUse: "\\Sent", flags: new Set<string>() }];
      },
      async append() {
        return appendSucceeds ? { uid: 1 } : false;
      },
    }));

    const firstInput = sendInput("send-once");
    firstInput.request.recipients.bcc = ["hidden@example.test"];
    const first = await service.sendMessage(firstInput);
    const replay = await service.sendMessage(firstInput);
    assert.equal(first.outcome, "sent");
    assert.deepEqual(replay, first);
    assert.equal(smtpCalls, 1);
    assert.ok(smtpMessages[0]?.envelope.to.includes("hidden@example.test"));
    assert.doesNotMatch(smtpMessages[0]!.raw.toString("utf8"), /^Bcc:/imu);

    appendSucceeds = false;
    const copyFailed = await service.sendMessage(sendInput("send-copy-failed"));
    assert.equal(copyFailed.outcome, "sent_copy_failed");
    assert.equal(copyFailed.sent_copy_error_code, "MAIL_SENT_APPEND_FAILED");

    const secretLikeCode = "imap-password=must-not-cross-boundary";
    Reflect.set(service, "withImap", async () => {
      throw Object.assign(new Error("provider adapter failed"), { code: secretLikeCode });
    });
    const sanitizedCopyFailure = await service.sendMessage(sendInput("send-copy-sanitized"));
    assert.equal(sanitizedCopyFailure.outcome, "sent_copy_failed");
    assert.equal(sanitizedCopyFailure.sent_copy_error_code, "MAIL_SENT_COPY_FAILED");
    assert.equal(JSON.stringify(sanitizedCopyFailure).includes(secretLikeCode), false);

    appendSucceeds = true;
    Reflect.set(service, "withImap", async (
      _authority: unknown,
      run: (client: object) => Promise<unknown>,
    ) => run({
      async list() {
        return [{ path: "Sent", specialUse: "\\Sent", flags: new Set<string>() }];
      },
      async append() {
        return { uid: 1 };
      },
    }));
    let preConnectUnavailable = true;
    Reflect.set(service, "smtpTransport", () => ({
      async sendMail() {
        smtpCalls += 1;
        if (preConnectUnavailable) {
          throw Object.assign(new Error("TCP connect failed"), {
            code: "ECONNECTION",
            command: "CONN",
          });
        }
        return { messageId: "<retry-after-connect@example.test>" };
      },
      close() {},
    }));
    const retryAfterConnectInput = sendInput("send-retry-after-connect");
    await assert.rejects(
      service.sendMessage(retryAfterConnectInput),
      /TCP connect failed/u,
    );
    preConnectUnavailable = false;
    const retryAfterConnect = await service.sendMessage(retryAfterConnectInput);
    assert.equal(retryAfterConnect.outcome, "sent");

    Reflect.set(service, "smtpTransport", () => ({
      async sendMail() {
        smtpCalls += 1;
        throw Object.assign(new Error("socket ended after DATA"), {
          code: "ETIMEDOUT",
          command: "DATA",
        });
      },
      close() {},
    }));
    const unknownInput = sendInput("send-unknown");
    const unknownCallsBefore = smtpCalls;
    const unknown = await service.sendMessage(unknownInput);
    const unknownReplay = await service.sendMessage(unknownInput);
    assert.equal(unknown.outcome, "unknown");
    assert.deepEqual(unknownReplay, unknown);
    assert.equal(smtpCalls, unknownCallsBefore + 1);

    const staleInput = runtimeMailboxSendInputSchema.parse(sendInput("send-stale"));
    const readKey = Reflect.get(service, "readOrCreateFingerprintKey") as (
      this: CompanyMailService,
      mailboxId: string,
    ) => Promise<Buffer>;
    const openIndex = Reflect.get(service, "openIndex") as (
      this: CompanyMailService,
      mailboxId: string,
    ) => Database.Database;
    const key = await readKey.call(service, authority.mailbox_id);
    const fingerprint = createHmac("sha256", key)
      .update(JSON.stringify(staleInput.request))
      .digest("hex");
    const db = openIndex.call(service, authority.mailbox_id);
    db.prepare(`
      insert into send_receipts (idempotency_key, fingerprint, result_json, created_at_ms)
      values (?, ?, null, ?)
    `).run("send-stale", fingerprint, now);
    db.close();
    now += 5 * 60 * 1_000;
    const callsBeforeStale = smtpCalls;
    const stale = await service.sendMessage(staleInput);
    assert.equal(stale.outcome, "unknown");
    assert.equal(smtpCalls, callsBeforeStale);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("flags, move, Trash, attachment read, and workspace save are idempotent", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "mail-operations-"));
  const service = new CompanyMailService(workdir);
  const folderId = encodeFolderId("INBOX");
  const messageId = encodeMessageId(folderId, "7", 11);
  const attachmentId = encodeAttachmentId("2");
  let flagAdds = 0;
  let moves = 0;
  Reflect.set(service, "withImap", async (
    _authority: unknown,
    run: (client: object) => Promise<unknown>,
  ) => run({
    mailbox: { uidValidity: 7n },
    capabilities: new Set(["MOVE"]),
    async getMailboxLock() {
      return { release() {} };
    },
    async messageFlagsAdd() {
      flagAdds += 1;
    },
    async messageFlagsRemove() {},
    async messageMove() {
      moves += 1;
      return true;
    },
    async list() {
      return [{ path: "Trash", specialUse: "\\Trash", flags: new Set<string>() }];
    },
    async download() {
      return {
        content: Buffer.from("attachment body"),
        meta: {
          filename: "f".repeat(1_100),
          contentType: `application/${"x".repeat(300)}`,
        },
      };
    },
  }));
  try {
    const openIndex = Reflect.get(service, "openIndex") as (
      this: CompanyMailService,
      mailboxId: string,
    ) => Database.Database;
    let db = openIndex.call(service, authority.mailbox_id);
    insertIndexedMessage(
      db,
      messageSummary(folderId, messageId, "indexed operation"),
      "7",
      11,
      Date.now(),
    );
    db.close();
    const update = {
      authority,
      operation_id: "mark-read-one",
      request: { folder_id: folderId, message_id: messageId, operation: "mark_read" as const },
    };
    await service.updateMessage(update);
    await service.updateMessage(update);
    assert.equal(flagAdds, 1);
    db = openIndex.call(service, authority.mailbox_id);
    const updatedSummary = JSON.parse((db.prepare(`
      select summary_json from messages where message_id = ?
    `).get(messageId) as { summary_json: string }).summary_json) as MailMessageSummary;
    assert.deepEqual(updatedSummary.flags, ["\\Seen"]);
    db.close();
    await service.updateMessage({
      authority,
      operation_id: "trash-one",
      request: { folder_id: folderId, message_id: messageId, operation: "trash" },
    });
    assert.equal(moves, 1);
    db = openIndex.call(service, authority.mailbox_id);
    assert.equal(
      (db.prepare("select count(*) as count from messages").get() as { count: number }).count,
      0,
    );
    db.close();

    const attachment = await service.readAttachment({
      authority,
      request: { folder_id: folderId, message_id: messageId, attachment_id: attachmentId },
    });
    assert.equal(Buffer.from(attachment.content_base64, "base64").toString(), "attachment body");
    assert.equal(attachment.filename?.length, 1_024);
    assert.equal(attachment.content_type.length, 255);
    const workspace = memberWorkspaceLayout(workdir, authority.requested_by_actor_id).workspace;
    await mkdir(join(workspace, "downloads"), { recursive: true });
    const save = {
      authority,
      member_id: authority.requested_by_actor_id,
      operation_id: "save-one",
      request: { folder_id: folderId, message_id: messageId, attachment_id: attachmentId },
      workspace_relative_path: "downloads/attachment.txt",
    };
    const first = await service.saveAttachment(save);
    const replay = await service.saveAttachment(save);
    assert.deepEqual(replay, first);
    assert.equal(await readFile(join(workspace, "downloads", "attachment.txt"), "utf8"),
      "attachment body");
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("move and Trash never use ImapFlow's expunging fallback without MOVE", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "mail-no-move-"));
  const service = new CompanyMailService(workdir);
  const folderId = encodeFolderId("INBOX");
  const messageId = encodeMessageId(folderId, "7", 11);
  let moveCalls = 0;
  let listCalls = 0;
  Reflect.set(service, "withImap", async (
    _authority: unknown,
    run: (client: object) => Promise<unknown>,
  ) => run({
    mailbox: { uidValidity: 7n },
    capabilities: new Set<string>(),
    async getMailboxLock() {
      return { release() {} };
    },
    async messageMove() {
      moveCalls += 1;
      return true;
    },
    async list() {
      listCalls += 1;
      return [{ path: "Trash", specialUse: "\\Trash", flags: new Set<string>() }];
    },
  }));
  try {
    await assert.rejects(
      service.updateMessage({
        authority,
        request: {
          folder_id: folderId,
          message_id: messageId,
          operation: "move",
          destination_folder_id: encodeFolderId("Archive"),
        },
      }),
      (error: unknown) => (
        error instanceof MailServiceError && error.code === "MAIL_MOVE_UNSUPPORTED"
      ),
    );
    await assert.rejects(
      service.updateMessage({
        authority,
        request: {
          folder_id: folderId,
          message_id: messageId,
          operation: "trash",
        },
      }),
      (error: unknown) => (
        error instanceof MailServiceError && error.code === "MAIL_TRASH_UNAVAILABLE"
      ),
    );
    assert.equal(moveCalls, 0);
    assert.equal(listCalls, 0);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("disconnect removes SQLite sidecars and interrupted credential writes", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "mail-disconnect-cleanup-"));
  const service = new CompanyMailService(workdir);
  const credentialDirectory = join(workdir, "mailboxes", "credentials");
  const indexDirectory = join(workdir, "mailboxes", "indexes");
  const credential = join(credentialDirectory, "mailbox-one.json");
  const rollback = join(credentialDirectory, "mailbox-one.connection-rollback.json");
  const receiptKey = join(credentialDirectory, "mailbox-one.receipt-key");
  const addressProbe = join(credentialDirectory, "mailbox-one.address-probe.json");
  const index = join(indexDirectory, "mailbox-one.sqlite");
  const artifacts = [
    credential,
    `${credential}.123.operation.tmp`,
    rollback,
    `${rollback}.123.operation.tmp`,
    addressProbe,
    `${addressProbe}.123.operation.tmp`,
    receiptKey,
    index,
    `${index}-wal`,
    `${index}-shm`,
  ];
  try {
    await mkdir(credentialDirectory, { recursive: true });
    await mkdir(indexDirectory, { recursive: true });
    await Promise.all(artifacts.map((path) => writeFile(path, "sensitive")));
    await service.disconnect({ authority, remove_index: true });
    for (const path of artifacts) {
      await assert.rejects(stat(path), (error: unknown) => (
        error instanceof Error
        && "code" in error
        && error.code === "ENOENT"
      ));
    }
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

function connectedTestService(
  workdir: string,
  onImapConnect?: () => void,
  nowMs: () => number = Date.now,
  options: {
    capabilities?: string[];
    folders?: ReturnType<typeof testFolder>[];
    serviceOptions?: Omit<CompanyMailServiceOptions, "resolveConnection">;
  } = {},
): CompanyMailService {
  const service = new CompanyMailService(workdir, nowMs, {
    ...options.serviceOptions,
    resolveConnection: async () => resolved,
  });
  Reflect.set(service, "imapClient", () => ({
    usable: true,
    capabilities: new Set(options.capabilities ?? ["MOVE"]),
    async connect() {
      onImapConnect?.();
    },
    async list() {
      return options.folders ?? [testFolder("INBOX", "\\Inbox")];
    },
    async logout() {},
    close() {},
  }));
  Reflect.set(service, "smtpTransport", () => ({
    async verify() {
      return true;
    },
    close() {},
  }));
  Reflect.set(service, "syncRecentIndex", async () => undefined);
  Reflect.set(service, "verifyMailboxAddressOwnership", async () => undefined);
  return service;
}

function mailError(code: string): (error: unknown) => boolean {
  return (error: unknown) => (
    error instanceof MailServiceError
    && error.code === code
    && error.retryable === false
  );
}

function hasCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => (
    error instanceof Error
    && "code" in error
    && error.code === code
  );
}

function testFolder(path: string, specialUse?: string) {
  return {
    path,
    name: path,
    specialUse,
    flags: new Set<string>(),
    status: { messages: 0, unseen: 0, uidValidity: 1n },
  };
}

async function storedCredential(workdir: string): Promise<{
  credential_version: number;
  operation_id: string;
}> {
  return JSON.parse(await readFile(
    join(workdir, "mailboxes", "credentials", "mailbox-one.json"),
    "utf8",
  )) as { credential_version: number; operation_id: string };
}

function messageSummary(
  folderId: string,
  messageId: string,
  subject: string,
): MailMessageSummary {
  return {
    message_id: messageId,
    mailbox_id: authority.mailbox_id,
    folder_id: folderId,
    internet_message_id: `<${subject}@example.test>`,
    thread_id: `thread-${subject}`,
    subject,
    from: [{ name: null, address: "one@example.test" }],
    to: [{ name: null, address: "sender@example.test" }],
    cc: [],
    sent_at_ms: 1,
    received_at_ms: 1,
    flags: [],
    size_bytes: 1,
    attachments: [],
    indexed_at_ms: 1,
  };
}

function insertIndexedMessage(
  db: Database.Database,
  summary: MailMessageSummary,
  uidValidity: string,
  uid: number,
  indexedAtMs: number,
): void {
  db.prepare(`
    insert into messages (
      folder_id, folder_path, uid_validity, uid, message_id,
      internet_message_id, in_reply_to, references_json, thread_id,
      subject, sender_text, recipient_text, sent_at_ms, received_at_ms,
      summary_json, indexed_at_ms
    ) values (?, 'INBOX', ?, ?, ?, ?, null, '[]', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    summary.folder_id,
    uidValidity,
    uid,
    summary.message_id,
    summary.internet_message_id,
    summary.thread_id,
    summary.subject,
    "one@example.test",
    "sender@example.test",
    summary.sent_at_ms,
    summary.received_at_ms,
    JSON.stringify({ ...summary, indexed_at_ms: indexedAtMs }),
    indexedAtMs,
  );
}

function fetchedMessage(uid: number) {
  return {
    uid,
    flags: new Set<string>(),
    size: 10,
    internalDate: new Date(100),
  };
}

function sendInput(idempotencyKey: string) {
  return {
    authority,
    request: {
      idempotency_key: idempotencyKey,
      recipients: {
        to: ["recipient@example.test"],
        cc: [] as string[],
        bcc: [] as string[],
      },
      subject: "Subject",
      text_body: "Body",
      references: [],
      attachments: [],
    },
  };
}
