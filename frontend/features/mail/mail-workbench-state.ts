import type {
  MailCapabilities,
  MailConnectionConfiguration,
  MailFolder,
  MailMessage,
  MailMessageSummary,
  Mailbox,
} from "@fields/contracts/public/mail";

export type MailTarget = {
  mailboxId: string | null;
  folderId: string | null;
  messageId: string | null;
};

export type MailComposeMode = "new" | "reply" | "forward";

export type MailComposeDraft = {
  idempotencyKey: string;
  mode: MailComposeMode;
  mailboxId: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references: string[];
  attachments: File[];
};

export type MailWorkbenchState = {
  target: MailTarget;
  searchTerm: string;
  searchActive: boolean;
  includeRemoteHistory: boolean;
  compose: MailComposeDraft | null;
};

export type MailWorkbenchAction =
  | { type: "mailbox_selected"; mailboxId: string }
  | { type: "folder_selected"; folderId: string }
  | { type: "message_selected"; messageId: string }
  | { type: "target_reconciled"; target: MailTarget }
  | { type: "search_changed"; value: string }
  | { type: "search_submitted" }
  | { type: "search_cleared" }
  | { type: "remote_history_changed"; value: boolean }
  | { type: "compose_opened"; draft: MailComposeDraft }
  | { type: "compose_new_attempt"; idempotencyKey: string }
  | { type: "compose_closed" };

export type MailConnectionAttempt = {
  requestIdentity: string;
  idempotencyKey: string;
};

export function createMailWorkbenchState(target?: Partial<MailTarget>): MailWorkbenchState {
  return {
    target: {
      mailboxId: target?.mailboxId ?? null,
      folderId: target?.folderId ?? null,
      messageId: target?.messageId ?? null,
    },
    searchTerm: "",
    searchActive: false,
    includeRemoteHistory: false,
    compose: null,
  };
}

export function mailWorkbenchReducer(
  state: MailWorkbenchState,
  action: MailWorkbenchAction,
): MailWorkbenchState {
  switch (action.type) {
    case "mailbox_selected":
      return {
        ...state,
        target: { mailboxId: action.mailboxId, folderId: null, messageId: null },
        searchActive: false,
      };
    case "folder_selected":
      return {
        ...state,
        target: { ...state.target, folderId: action.folderId, messageId: null },
        searchActive: false,
      };
    case "message_selected":
      return {
        ...state,
        target: { ...state.target, messageId: action.messageId },
      };
    case "target_reconciled":
      return { ...state, target: action.target };
    case "search_changed":
      return { ...state, searchTerm: action.value };
    case "search_submitted":
      return state.searchTerm.trim()
        ? { ...state, searchActive: true, target: { ...state.target, messageId: null } }
        : state;
    case "search_cleared":
      return {
        ...state,
        searchActive: false,
        searchTerm: "",
        target: { ...state.target, messageId: null },
      };
    case "remote_history_changed":
      return { ...state, includeRemoteHistory: action.value };
    case "compose_opened":
      return { ...state, compose: action.draft };
    case "compose_new_attempt":
      return state.compose
        ? {
          ...state,
          compose: {
            ...state.compose,
            idempotencyKey: action.idempotencyKey,
          },
        }
        : state;
    case "compose_closed":
      return { ...state, compose: null };
  }
}

export function reconcileMailTarget(
  target: MailTarget,
  mailboxes: readonly Mailbox[],
  folders: readonly MailFolder[],
  messages: readonly MailMessageSummary[],
): MailTarget {
  const mailbox = mailboxes.find((item) => item.mailbox_id === target.mailboxId)
    ?? mailboxes[0]
    ?? null;
  if (!mailbox) return { mailboxId: null, folderId: null, messageId: null };
  const mailboxChanged = mailbox.mailbox_id !== target.mailboxId;
  const folder = !mailboxChanged
    ? folders.find((item) => item.folder_id === target.folderId)
      ?? folders.find((item) => item.role === "inbox")
      ?? folders[0]
      ?? null
    : folders.find((item) => item.role === "inbox") ?? folders[0] ?? null;
  if (!folder) {
    return { mailboxId: mailbox.mailbox_id, folderId: null, messageId: null };
  }
  const message = !mailboxChanged && folder.folder_id === target.folderId
    ? messages.find((item) => item.message_id === target.messageId) ?? null
    : null;
  return {
    mailboxId: mailbox.mailbox_id,
    folderId: folder.folder_id,
    messageId: message?.message_id ?? null,
  };
}

export function splitMailAddresses(value: string): string[] {
  return value
    .split(/[,\n;]/u)
    .map((address) => address.trim())
    .filter(Boolean);
}

export function messageIsUnread(message: MailMessageSummary): boolean {
  return !message.flags.some((flag) => flag.toLowerCase() === "\\seen");
}

export function applyMessageOperation<T extends MailMessageSummary>(
  message: T,
  operation: "mark_read" | "mark_unread" | "move" | "trash",
): T | null {
  if (operation === "move" || operation === "trash") return null;
  const flags = message.flags.filter((flag) => flag.toLowerCase() !== "\\seen");
  return {
    ...message,
    flags: operation === "mark_read" ? [...flags, "\\Seen"] : flags,
  };
}

export function mailActionAvailability(capabilities: MailCapabilities) {
  return {
    flags: capabilities.flags,
    move: capabilities.move,
    trash: capabilities.trash,
    limited: !capabilities.flags || !capabilities.move || !capabilities.trash,
  };
}

export function resolveMailConnectionAttempt(
  previous: MailConnectionAttempt | null,
  input: {
    kind: "personal" | "shared";
    mailboxId: string | null;
    targetActorId: string;
    name: string;
    configuration: MailConnectionConfiguration;
  },
  createId: () => string = () => crypto.randomUUID(),
): MailConnectionAttempt {
  // The complete identity intentionally remains browser-local and includes the
  // secret. It is never logged or sent separately; it only decides whether a
  // response-loss retry may reuse the same idempotency key.
  const requestIdentity = JSON.stringify(input);
  return previous?.requestIdentity === requestIdentity
    ? previous
    : { requestIdentity, idempotencyKey: createId() };
}

export function createReplyDraft(
  mailboxId: string,
  message: MailMessage,
): MailComposeDraft {
  const inReplyTo = normalizedMessageReference(message.internet_message_id);
  return {
    idempotencyKey: crypto.randomUUID(),
    mode: "reply",
    mailboxId,
    to: message.from.map((participant) => participant.address).join(", "),
    cc: "",
    bcc: "",
    subject: /^re:/iu.test(message.subject) ? message.subject : `Re: ${message.subject}`,
    body: "",
    inReplyTo,
    references: normalizedMessageReferences([
      ...message.references,
      ...(inReplyTo ? [inReplyTo] : []),
    ]),
    attachments: [],
  };
}

export function createForwardDraft(
  mailboxId: string,
  message: MailMessage,
): MailComposeDraft {
  const forwardedHeaders = [
    "---------- Forwarded message ----------",
    `From: ${message.from.map(formatDraftParticipant).join(", ")}`,
    `Date: ${formatDraftDate(message.sent_at_ms ?? message.received_at_ms)}`,
    `Subject: ${message.subject}`,
    `To: ${message.to.map(formatDraftParticipant).join(", ")}`,
    ...(message.cc.length > 0
      ? [`Cc: ${message.cc.map(formatDraftParticipant).join(", ")}`]
      : []),
    "",
    message.text_body ?? "[HTML body not included]",
  ];
  return {
    idempotencyKey: crypto.randomUUID(),
    mode: "forward",
    mailboxId,
    to: "",
    cc: "",
    bcc: "",
    subject: /^fwd:/iu.test(message.subject) ? message.subject : `Fwd: ${message.subject}`,
    body: forwardedHeaders.join("\n"),
    references: [],
    attachments: [],
  };
}

function normalizedMessageReference(value: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length <= 2_048 ? normalized : undefined;
}

function normalizedMessageReferences(values: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    const normalized = normalizedMessageReference(value);
    if (normalized) unique.add(normalized);
  }
  return [...unique].slice(-100);
}

function formatDraftParticipant(
  participant: MailMessage["from"][number],
): string {
  return participant.name
    ? `${participant.name} <${participant.address}>`
    : participant.address;
}

function formatDraftDate(value: number | null): string {
  return value === null ? "" : new Date(value).toISOString();
}
