import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  mailMcpSaveAttachmentInputSchema,
  mailMcpSendInputSchema,
  mailMcpUpdateInputSchema,
} from "@fields/contracts/internal/mail";
import {
  mailSendInputSchema,
  mailMessageSearchInputSchema,
} from "../../../contracts/src/public/mail.js";

import {
  MAIL_CONNECTION_CONFIGURATION_INVALID,
  MAIL_CONNECTION_SSRF_BLOCKED,
  MailConnectionPolicyError,
  isForbiddenAddress,
  pinnedLookup,
  resolvePublicEndpoint,
} from "../../src/application/mail/connection-policy.js";
import { sanitizeMailHtml, mailThreadId } from "../../src/application/mail/html.js";
import {
  MailServiceError,
  mailEndpointTransportPolicy,
  writeWorkspaceAttachment,
} from "../../src/application/mail/service.js";

test("mail connection policy rejects every non-public route including mapped and compatible IPv6", () => {
  for (const address of [
    "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.1.1",
    "172.16.0.1", "192.0.2.1", "192.168.1.1", "198.18.0.1",
    "198.51.100.1", "203.0.113.1", "224.0.0.1", "::", "::1",
    "::8.8.8.8", "::ffff:127.0.0.1", "fc00::1", "fe80::1",
    "2001:db8::1", "64:ff9b::1", "ff02::1",
  ]) assert.equal(isForbiddenAddress(address), true, address);
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) {
    assert.equal(isForbiddenAddress(address), false, address);
  }
});

test("endpoint resolution rejects literal/local hosts, mixed DNS, empty DNS, and resolver errors", async () => {
  let lookupCalls = 0;
  const unusedLookup = async () => {
    lookupCalls += 1;
    return [{ address: "8.8.8.8", family: 4 as const }];
  };
  for (const host of ["8.8.8.8", "localhost", "mail.localhost", "mail.local", "mail.internal"]) {
    await assert.rejects(
      resolvePublicEndpoint(
        { host, port: 993, tls_mode: "implicit_tls" },
        unusedLookup as never,
      ),
      policyError(MAIL_CONNECTION_SSRF_BLOCKED),
    );
  }
  assert.equal(lookupCalls, 0);
  await assert.rejects(
    resolvePublicEndpoint(
      { host: "mixed.example.test", port: 993, tls_mode: "implicit_tls" },
      (async () => [
        { address: "8.8.8.8", family: 4 as const },
        { address: "127.0.0.1", family: 4 as const },
      ]) as never,
    ),
    policyError(MAIL_CONNECTION_SSRF_BLOCKED),
  );
  await assert.rejects(
    resolvePublicEndpoint(
      { host: "empty.example.test", port: 993, tls_mode: "implicit_tls" },
      (async () => []) as never,
    ),
    policyError(MAIL_CONNECTION_SSRF_BLOCKED),
  );
  await assert.rejects(
    resolvePublicEndpoint(
      { host: "error.example.test", port: 993, tls_mode: "implicit_tls" },
      (async () => {
        throw new Error("resolver unavailable");
      }) as never,
    ),
    policyError(MAIL_CONNECTION_CONFIGURATION_INVALID),
  );
});

test("pinned lookup rejects host drift and never re-resolves a rebound address", async () => {
  let dnsCalls = 0;
  const endpoint = await resolvePublicEndpoint(
    { host: "mail.example.test", port: 993, tls_mode: "implicit_tls" },
    (async () => {
      dnsCalls += 1;
      return dnsCalls === 1
        ? [{ address: "8.8.8.8", family: 4 as const }]
        : [{ address: "127.0.0.1", family: 4 as const }];
    }) as never,
  );
  const lookup = pinnedLookup(endpoint);
  assert.deepEqual(await invokeLookup(lookup, "mail.example.test", { all: true }), [
    { address: "8.8.8.8", family: 4 },
  ]);
  assert.deepEqual(await invokeLookup(lookup, "mail.example.test", { family: 4 }), {
    address: "8.8.8.8",
    family: 4,
  });
  assert.equal(dnsCalls, 1);
  await assert.rejects(
    invokeLookup(lookup, "other.example.test", {}),
    nodeError(MAIL_CONNECTION_SSRF_BLOCKED),
  );
  await assert.rejects(
    invokeLookup(lookup, "mail.example.test", { family: 6 }),
    nodeError("ENOTFOUND"),
  );
});

test("mail transports share one pinned public address and strict TLS identity policy", async () => {
  const endpoint = await resolvePublicEndpoint(
    { host: "mail.example.test", port: 465, tls_mode: "implicit_tls" },
    (async () => [{ address: "8.8.4.4", family: 4 as const }]) as never,
  );
  const policy = mailEndpointTransportPolicy(endpoint);
  assert.deepEqual({
    connectAddress: policy.connectAddress,
    family: policy.family,
    servername: policy.servername,
    tls: policy.tls,
  }, {
    connectAddress: "8.8.4.4",
    family: 4,
    servername: "mail.example.test",
    tls: {
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
      servername: "mail.example.test",
    },
  });
  assert.deepEqual(await invokeLookup(policy.lookup, "mail.example.test", {}), {
    address: "8.8.4.4",
    family: 4,
  });
  assert.throws(
    () => mailEndpointTransportPolicy({
      ...endpoint,
      addresses: [{ address: "127.0.0.1", family: 4 }],
    }),
    (error: unknown) => (
      error instanceof MailServiceError && error.code === MAIL_CONNECTION_SSRF_BLOCKED
    ),
  );
});

test("mail HTML strips active content, remote images, SVG data, and malformed raster data", () => {
  const result = sanitizeMailHtml([
    "<script>alert(1)</script>",
    '<img src="https://tracker.example/pixel">',
    '<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">',
    '<img src="data:image/png;base64,%%%">',
    '<img src="data:image/png;base64,iVBORw==">',
    '<a href="javascript:alert(1)">bad</a>',
    '<a href="/same-origin">relative</a>',
    '<a href="//tracker.example/path">protocol relative</a>',
  ].join(""));
  assert.equal(result.remoteImagesBlocked, true);
  assert.doesNotMatch(result.html, /script|javascript:|svg\+xml|tracker\.example|same-origin|%%%/iu);
  assert.match(result.html, /data:image\/png;base64,iVBORw==/u);
});

test("thread surrogates do not collapse no-ID messages across folders", () => {
  const first = mailThreadId({
    messageId: null,
    inReplyTo: null,
    references: [],
    surrogateId: "mailbox:folder-a:1:10",
  });
  const second = mailThreadId({
    messageId: null,
    inReplyTo: null,
    references: [],
    surrogateId: "mailbox:folder-b:1:10",
  });
  assert.notEqual(first, second);
});

test("workspace attachment creation stays on the opened parent during a symlink swap", async () => {
  const root = await mkdtemp(join(tmpdir(), "mail-write-root-"));
  const outside = await mkdtemp(join(tmpdir(), "mail-write-outside-"));
  try {
    await mkdir(join(root, "safe"));
    await writeWorkspaceAttachment(root, "safe/message.bin", Buffer.from("safe"), {
      beforeCreate: async () => {
        await rename(join(root, "safe"), join(root, "safe-opened"));
        await symlink(outside, join(root, "safe"));
      },
    });
    assert.equal(await readFile(join(root, "safe-opened", "message.bin"), "utf8"), "safe");
    await assert.rejects(readFile(join(outside, "message.bin")));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("workspace attachment creation rejects traversal and existing destinations", async () => {
  const root = await mkdtemp(join(tmpdir(), "mail-write-"));
  try {
    await assert.rejects(
      writeWorkspaceAttachment(root, "../escape", Buffer.from("x")),
      (error: unknown) => error instanceof MailServiceError
        && error.code === "MAIL_ATTACHMENT_PATH_INVALID",
    );
    await writeWorkspaceAttachment(root, "first", Buffer.from("x"));
    await assert.rejects(
      writeWorkspaceAttachment(root, "first", Buffer.from("y")),
      (error: unknown) => error instanceof MailServiceError
        && error.code === "MAIL_ATTACHMENT_DESTINATION_EXISTS",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mail contracts require canonical Base64 and enforce the aggregate 25 MiB boundary", () => {
  const base = {
    mailbox_id: "mailbox",
    idempotency_key: "operation",
    recipients: { to: ["recipient@example.test"], cc: [], bcc: [] },
    subject: "subject",
    attachments: [],
    references: [],
  };
  for (const content_base64 of ["%%%", "A", "AAA==", "AAAA=", "YW Jj", "YWJj\n"]) {
    assert.equal(mailSendInputSchema.safeParse({
      ...base,
      attachments: [{ filename: "x", content_type: "application/octet-stream", content_base64 }],
    }).success, false, content_base64);
  }
  const boundary = Buffer.alloc(25 * 1024 * 1024).toString("base64");
  assert.equal(mailSendInputSchema.safeParse({
    ...base,
    attachments: [{ filename: "x", content_type: "application/octet-stream", content_base64: boundary }],
  }).success, true);
  assert.equal(mailSendInputSchema.safeParse({
    ...base,
    attachments: [
      { filename: "x", content_type: "application/octet-stream", content_base64: boundary },
      { filename: "y", content_type: "application/octet-stream", content_base64: "AA==" },
    ],
  }).success, false);
});

test("mail search has no misleading cursor and model tools expose workspace paths only", () => {
  assert.equal(mailMessageSearchInputSchema.safeParse({
    search_term: "x", limit: 10, include_remote_history: false, cursor: "ignored",
  }).success, false);
  assert.equal(mailMcpSendInputSchema.safeParse({
    mailbox_id: "mailbox",
    idempotency_key: "operation",
    recipients: { to: ["recipient@example.test"], cc: [], bcc: [] },
    subject: "subject",
    attachments: [{ filename: "x", content_base64: "AA==" }],
    references: [],
  }).success, false);
  assert.equal(mailMcpUpdateInputSchema.safeParse({
    mailbox_id: "mailbox", folder_id: "folder", message_id: "message",
    operation: "trash", idempotency_key: "operation", actor_id: "spoof",
  }).success, false);
  assert.equal(mailMcpSaveAttachmentInputSchema.safeParse({
    mailbox_id: "mailbox", folder_id: "folder", message_id: "message",
    attachment_id: "attachment", workspace_relative_path: "downloads/x",
  }).success, false);
});

function policyError(code: string) {
  return (error: unknown) => (
    error instanceof MailConnectionPolicyError && error.code === code
  );
}

function nodeError(code: string) {
  return (error: unknown) => (
    error instanceof Error
    && "code" in error
    && error.code === code
  );
}

function invokeLookup(
  lookup: ReturnType<typeof pinnedLookup>,
  hostname: string,
  options: { all?: boolean; family?: number },
): Promise<unknown> {
  const callable = lookup as unknown as (
    host: string,
    lookupOptions: { all?: boolean; family?: number },
    callback: (
      error: NodeJS.ErrnoException | null,
      address: string | Array<{ address: string; family: number }>,
      family?: number,
    ) => void,
  ) => void;
  return new Promise((resolve, reject) => {
    callable(hostname, options, (error, address, family) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(Array.isArray(address) ? address : { address, family });
    });
  });
}
