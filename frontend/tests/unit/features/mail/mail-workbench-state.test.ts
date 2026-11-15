import assert from "node:assert/strict";
import test from "node:test";

import type { MailMessage } from "@fields/contracts/public/mail";

import {
  applyMessageOperation,
  createForwardDraft,
  createMailWorkbenchState,
  createReplyDraft,
  mailActionAvailability,
  mailWorkbenchReducer,
  reconcileMailTarget,
  resolveMailConnectionAttempt,
  splitMailAddresses,
} from "../../../../features/mail/mail-workbench-state";

test("mail selection transitions clear only downstream state", () => {
  let state = createMailWorkbenchState({
    mailboxId: "mailbox-a",
    folderId: "folder-a",
    messageId: "message-a",
  });
  state = mailWorkbenchReducer(state, { type: "folder_selected", folderId: "folder-b" });
  assert.deepEqual(state.target, {
    mailboxId: "mailbox-a",
    folderId: "folder-b",
    messageId: null,
  });
  state = mailWorkbenchReducer(state, { type: "mailbox_selected", mailboxId: "mailbox-b" });
  assert.deepEqual(state.target, {
    mailboxId: "mailbox-b",
    folderId: null,
    messageId: null,
  });
});

test("search state requires explicit submit and clears selected message", () => {
  let state = createMailWorkbenchState({ mailboxId: "m", folderId: "f", messageId: "x" });
  state = mailWorkbenchReducer(state, { type: "search_changed", value: "invoice" });
  assert.equal(state.searchActive, false);
  state = mailWorkbenchReducer(state, { type: "search_submitted" });
  assert.equal(state.searchActive, true);
  assert.equal(state.target.messageId, null);
});

test("mail target reconciliation preserves visible deep links and falls back deterministically", () => {
  const mailbox = {
    mailbox_id: "m", kind: "personal", target_actor_id: "a", display_name: null,
    email_address: "a@example.test", connection_state: "connected",
    capabilities: { folders: true, search: true, flags: true, move: true, trash: true, append_sent: true },
    last_checked_at_ms: 1, last_error_code: null, access: "personal",
  } as const;
  const folder = {
    folder_id: "f", mailbox_id: "m", name: "Inbox", path: "INBOX", role: "inbox",
    selectable: true, total_count: 1, unread_count: 1, uid_validity: "1",
  } as const;
  const target = reconcileMailTarget(
    { mailboxId: "m", folderId: "f", messageId: "missing" },
    [mailbox],
    [folder],
    [],
  );
  assert.deepEqual(target, { mailboxId: "m", folderId: "f", messageId: null });
});

test("compose recipient parsing and reply retries preserve one idempotency key", () => {
  assert.deepEqual(splitMailAddresses("a@example.test; b@example.test,\nc@example.test"), [
    "a@example.test", "b@example.test", "c@example.test",
  ]);
  const draft = createReplyDraft("m", message());
  const state = mailWorkbenchReducer(createMailWorkbenchState(), { type: "compose_opened", draft });
  assert.equal(state.compose?.idempotencyKey, draft.idempotencyKey);
});

test("reply preserves a normalized multi-turn References chain", () => {
  const draft = createReplyDraft("m", {
    ...message(),
    internet_message_id: " <turn-three@example.test> ",
    references: [
      "<turn-one@example.test>",
      "<turn-two@example.test>",
      "<turn-one@example.test>",
    ],
  });
  assert.equal(draft.inReplyTo, "<turn-three@example.test>");
  assert.deepEqual(draft.references, [
    "<turn-one@example.test>",
    "<turn-two@example.test>",
    "<turn-three@example.test>",
  ]);
});

test("forward quotes readable headers and text without silently forwarding attachments", () => {
  const draft = createForwardDraft("m", {
    ...message(),
    subject: "Quarterly plan",
    from: [{ name: "Alice", address: "alice@example.test" }],
    to: [{ name: null, address: "bob@example.test" }],
    cc: [{ name: "Carol", address: "carol@example.test" }],
    sent_at_ms: Date.UTC(2026, 6, 27, 12),
    text_body: "Original plain-text body",
    attachments: [{
      attachment_id: "attachment-one",
      filename: "plan.txt",
      content_type: "text/plain",
      size_bytes: 12,
      content_id: null,
      disposition: "attachment",
    }],
  });
  assert.equal(draft.subject, "Fwd: Quarterly plan");
  assert.match(draft.body, /From: Alice <alice@example\.test>/u);
  assert.match(draft.body, /To: bob@example\.test/u);
  assert.match(draft.body, /Cc: Carol <carol@example\.test>/u);
  assert.match(draft.body, /Original plain-text body/u);
  assert.deepEqual(draft.attachments, []);
});

test("successful read mutations update the reader/list flags atomically", () => {
  const unread = message();
  const read = applyMessageOperation(unread, "mark_read");
  assert.ok(read);
  assert.equal(read.flags.includes("\\Seen"), true);
  const unreadAgain = applyMessageOperation(read, "mark_unread");
  assert.ok(unreadAgain);
  assert.equal(unreadAgain.flags.some((flag) => flag.toLowerCase() === "\\seen"), false);
  assert.equal(applyMessageOperation(read, "move"), null);
});

test("unknown delivery keeps its key until an explicit new attempt rotates it", () => {
  const draft = createReplyDraft("m", message());
  const opened = mailWorkbenchReducer(createMailWorkbenchState(), {
    type: "compose_opened",
    draft,
  });
  assert.equal(opened.compose?.idempotencyKey, draft.idempotencyKey);
  const explicitAttempt = mailWorkbenchReducer(opened, {
    type: "compose_new_attempt",
    idempotencyKey: "new-send-key",
  });
  assert.equal(explicitAttempt.compose?.idempotencyKey, "new-send-key");
  assert.equal(explicitAttempt.compose?.body, opened.compose?.body);
});

test("connection response-loss retries reuse a key but changed secrets rotate it", () => {
  let ids = 0;
  const input = {
    kind: "personal" as const,
    mailboxId: null,
    targetActorId: "member-one",
    name: "",
    configuration: {
      preset: "google" as const,
      email_address: "member@example.test",
      username: "member@example.test",
      application_password: "first-secret",
      display_name: null,
    },
  };
  const first = resolveMailConnectionAttempt(null, input, () => `key-${++ids}`);
  const replay = resolveMailConnectionAttempt(first, input, () => `key-${++ids}`);
  assert.equal(replay.idempotencyKey, first.idempotencyKey);
  const changed = resolveMailConnectionAttempt(first, {
    ...input,
    configuration: {
      ...input.configuration,
      application_password: "corrected-secret",
    },
  }, () => `key-${++ids}`);
  assert.notEqual(changed.idempotencyKey, first.idempotencyKey);
});

test("limited mailbox capabilities disable only unsupported message actions", () => {
  assert.deepEqual(mailActionAvailability({
    folders: true,
    search: true,
    flags: false,
    move: true,
    trash: false,
    append_sent: true,
  }), {
    flags: false,
    move: true,
    trash: false,
    limited: true,
  });
});

function message(): MailMessage {
  return {
    message_id: "x",
    mailbox_id: "m",
    folder_id: "f",
    internet_message_id: "<x>",
    in_reply_to: null,
    references: [],
    thread_id: "t",
    subject: "Subject",
    from: [{ name: null, address: "a@example.test" }],
    to: [],
    cc: [],
    sent_at_ms: null,
    received_at_ms: null,
    flags: [],
    size_bytes: 0,
    attachments: [],
    indexed_at_ms: 1,
    text_body: "Body",
    html_body: null,
    remote_images_blocked: false,
  };
}
