import type {
  MailConnectionConfiguration,
  MailFolder,
  MailMessage,
  MailMessagePage,
  MailMessageSummary,
  MailProviderPreset,
  Mailbox,
} from "@fields/contracts/public/mail";
import {
  Alert,
  Empty,
  Flexbox,
  ScrollArea,
  Select,
  Skeleton,
  Tag,
  Text,
} from "@lobehub/ui";
import {
  Button,
  Checkbox,
  Input,
  InputPassword,
  Modal,
  TextArea,
  Tooltip,
} from "@lobehub/ui/base-ui";
import {
  Archive,
  CornerUpLeft,
  Download,
  Forward,
  Inbox,
  Mail,
  MailOpen,
  Paperclip,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { backendTrpc } from "../../data/boundary/backend-trpc";
import { openExternalUrl } from "../../shared/platform/external-navigation";
import {
  applyMessageOperation,
  createForwardDraft,
  createMailWorkbenchState,
  createReplyDraft,
  mailActionAvailability,
  mailWorkbenchReducer,
  messageIsUnread,
  resolveMailConnectionAttempt,
  splitMailAddresses,
  type MailComposeDraft,
  type MailConnectionAttempt,
  type MailTarget,
} from "./mail-workbench-state";

const centerState = {
  alignItems: "center",
  display: "flex",
  flex: 1,
  justifyContent: "center",
  minHeight: 0,
  padding: 24,
} as const;

export type MailWorkbenchProps = {
  actorId: string;
  api?: typeof backendTrpc;
  canManageShared: boolean;
  initialTarget?: Partial<MailTarget>;
  onTargetChange?: (target: MailTarget) => void;
  toast: MailToastActions;
};

type MailToastActions = {
  error(title: string, message?: string): void;
  success(title: string, message?: string): void;
};

export function MailWorkbench({
  actorId,
  api = backendTrpc,
  canManageShared,
  initialTarget,
  onTargetChange,
  toast,
}: MailWorkbenchProps) {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(
    mailWorkbenchReducer,
    initialTarget,
    createMailWorkbenchState,
  );
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [folders, setFolders] = useState<MailFolder[]>([]);
  const [messagePage, setMessagePage] = useState<MailMessagePage | null>(null);
  const [message, setMessage] = useState<MailMessage | null>(null);
  const [mailboxesState, setMailboxesState] = useState<"loading" | "ready" | "error">("loading");
  const [foldersState, setFoldersState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [messagesState, setMessagesState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [messageState, setMessageState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [connectionMailbox, setConnectionMailbox] = useState<Mailbox | null | undefined>(undefined);
  const [managementOpen, setManagementOpen] = useState(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [sendOutcome, setSendOutcome] = useState<"sent_copy_failed" | "unknown" | null>(null);
  const requestSequence = useRef(0);
  const messageOperationKeys = useRef(new Map<string, string>());

  const selectedMailbox = mailboxes.find((item) => item.mailbox_id === state.target.mailboxId) ?? null;
  const summaries = messagePage?.items ?? [];
  const selectedSummary = summaries.find((item) => item.message_id === state.target.messageId) ?? null;
  const readerSummary = message?.message_id === state.target.messageId
    ? message
    : selectedSummary;

  useEffect(() => {
    onTargetChange?.(state.target);
  }, [onTargetChange, state.target]);

  async function refreshMailboxes(preferredMailboxId = state.target.mailboxId) {
    const requestId = ++requestSequence.current;
    setMailboxesState("loading");
    try {
      const result = await api.mail.mailboxes.list.query();
      if (requestSequence.current !== requestId) return;
      setMailboxes(result.items);
      setMailboxesState("ready");
      const selected = result.items.find((item) => item.mailbox_id === preferredMailboxId)
        ?? result.items[0]
        ?? null;
      if (selected && selected.mailbox_id !== state.target.mailboxId) {
        dispatch({ type: "mailbox_selected", mailboxId: selected.mailbox_id });
      }
    } catch {
      if (requestSequence.current === requestId) setMailboxesState("error");
    }
  }

  useEffect(() => {
    void refreshMailboxes(initialTarget?.mailboxId ?? null);
    // The initial deep target is intentionally consumed once.
  }, []);

  useEffect(() => {
    const mailboxId = state.target.mailboxId;
    if (!mailboxId) {
      setFolders([]);
      setFoldersState("idle");
      return;
    }
    let active = true;
    setFoldersState("loading");
    void api.mail.folders.list.query({ mailbox_id: mailboxId })
      .then((result) => {
        if (!active) return;
        setFolders(result.items);
        setFoldersState("ready");
        const preferred = result.items.find((item) => item.folder_id === state.target.folderId)
          ?? result.items.find((item) => item.role === "inbox")
          ?? result.items[0]
          ?? null;
        if (preferred && preferred.folder_id !== state.target.folderId) {
          dispatch({ type: "folder_selected", folderId: preferred.folder_id });
        }
      })
      .catch(() => {
        if (active) setFoldersState("error");
      });
    return () => {
      active = false;
    };
  }, [api, state.target.mailboxId]);

  useEffect(() => {
    const mailboxId = state.target.mailboxId;
    const folderId = state.target.folderId;
    if (!mailboxId || (!folderId && !state.searchActive)) {
      setMessagePage(null);
      setMessagesState("idle");
      return;
    }
    let active = true;
    setMessagesState("loading");
    const request = state.searchActive
      ? api.mail.messages.search.query({
        mailbox_ids: searchableMailboxIds(mailboxes),
        search_term: state.searchTerm.trim(),
        include_remote_history: state.includeRemoteHistory,
        limit: 50,
      })
      : api.mail.messages.list.query({
        mailbox_id: mailboxId,
        folder_id: folderId!,
        limit: 50,
      });
    void request.then((result) => {
      if (!active) return;
      setMessagePage(result);
      setMessagesState("ready");
    }).catch(() => {
      if (active) setMessagesState("error");
    });
    return () => {
      active = false;
    };
  }, [
    api,
    mailboxes,
    state.includeRemoteHistory,
    state.searchActive,
    state.searchTerm,
    state.target.folderId,
    state.target.mailboxId,
  ]);

  useEffect(() => {
    const { mailboxId, folderId, messageId } = state.target;
    if (!mailboxId || !folderId || !messageId) {
      setMessage(null);
      setMessageState("idle");
      return;
    }
    let active = true;
    setMessageState("loading");
    void api.mail.messages.read.query({
      mailbox_id: mailboxId,
      folder_id: folderId,
      message_id: messageId,
    }).then((result) => {
      if (!active) return;
      setMessage(result);
      setMessageState("ready");
    }).catch(() => {
      if (active) setMessageState("error");
    });
    return () => {
      active = false;
    };
  }, [api, state.target.folderId, state.target.mailboxId, state.target.messageId]);

  async function refreshMessages() {
    const mailboxId = state.target.mailboxId;
    const folderId = state.target.folderId;
    if (!mailboxId || (!folderId && !state.searchActive)) return;
    setMessagesState("loading");
    try {
      const result = state.searchActive
        ? await api.mail.messages.search.query({
          mailbox_ids: searchableMailboxIds(mailboxes),
          search_term: state.searchTerm.trim(),
          include_remote_history: state.includeRemoteHistory,
          limit: 50,
        })
        : await api.mail.messages.list.query({
          mailbox_id: mailboxId,
          folder_id: folderId!,
          limit: 50,
        });
      setMessagePage(result);
      setMessagesState("ready");
    } catch {
      setMessagesState("error");
    }
  }

  async function loadMore() {
    if (!messagePage?.next_cursor || !state.target.mailboxId) return;
    setMessagesState("loading");
    try {
      const next = state.searchActive
        ? await api.mail.messages.search.query({
          mailbox_ids: searchableMailboxIds(mailboxes),
          search_term: state.searchTerm.trim(),
          include_remote_history: state.includeRemoteHistory,
          limit: 50,
        })
        : await api.mail.messages.list.query({
          mailbox_id: state.target.mailboxId,
          folder_id: state.target.folderId!,
          cursor: messagePage.next_cursor,
          limit: 50,
        });
      setMessagePage({
        ...next,
        items: appendUniqueMessages(messagePage.items, next.items),
      });
      setMessagesState("ready");
    } catch {
      setMessagesState("error");
    }
  }

  async function updateMessage(
    summary: MailMessageSummary,
    operation: "mark_read" | "mark_unread" | "move" | "trash",
    destinationFolderId?: string,
  ) {
    const operationKey = [
      summary.mailbox_id,
      summary.folder_id,
      summary.message_id,
      operation,
      destinationFolderId ?? "",
    ].join("\0");
    const idempotencyKey = messageOperationKeys.current.get(operationKey)
      ?? crypto.randomUUID();
    messageOperationKeys.current.set(operationKey, idempotencyKey);
    setMutationBusy(true);
    try {
      await api.mail.messages.update.mutate({
        mailbox_id: summary.mailbox_id,
        folder_id: summary.folder_id,
        message_id: summary.message_id,
        operation,
        destination_folder_id: destinationFolderId,
        idempotency_key: idempotencyKey,
      });
      messageOperationKeys.current.delete(operationKey);
      setMessagePage((current) => current
        ? {
          ...current,
          items: current.items.flatMap((item) => {
            if (item.message_id !== summary.message_id) return [item];
            const updated = applyMessageOperation(item, operation);
            return updated ? [updated] : [];
          }),
        }
        : current);
      setMessage((current) => {
        if (current?.message_id !== summary.message_id) return current;
        return applyMessageOperation(current, operation);
      });
      await refreshMessages();
      if (operation === "move" || operation === "trash") {
        dispatch({
          type: "target_reconciled",
          target: { ...state.target, messageId: null },
        });
      }
    } catch {
      toast.error(t("mail.actionFailed"));
    } finally {
      setMutationBusy(false);
    }
  }

  async function downloadAttachment(
    summary: MailMessageSummary,
    attachmentId: string,
  ) {
    try {
      const result = await api.mail.attachments.read.query({
        mailbox_id: summary.mailbox_id,
        folder_id: summary.folder_id,
        message_id: summary.message_id,
        attachment_id: attachmentId,
      });
      downloadBase64(result.content_base64, result.content_type, result.filename ?? t("mail.attachment"));
    } catch {
      toast.error(t("mail.attachmentFailed"));
    }
  }

  async function sendDraft(draft: MailComposeDraft) {
    dispatch({ type: "compose_opened", draft });
    setMutationBusy(true);
    setSendOutcome(null);
    try {
      const result = await api.mail.messages.send.mutate({
        mailbox_id: draft.mailboxId,
        idempotency_key: draft.idempotencyKey,
        recipients: {
          to: splitMailAddresses(draft.to),
          cc: splitMailAddresses(draft.cc),
          bcc: splitMailAddresses(draft.bcc),
        },
        subject: draft.subject,
        text_body: draft.body,
        in_reply_to: draft.inReplyTo,
        references: draft.references,
        attachments: await Promise.all(draft.attachments.map(fileToMailAttachment)),
      });
      if (result.outcome === "sent") {
        dispatch({ type: "compose_closed" });
        toast.success(t("mail.sent"));
      } else if (result.outcome === "sent_copy_failed") {
        dispatch({ type: "compose_closed" });
        setSendOutcome(result.outcome);
      } else {
        setSendOutcome("unknown");
      }
      await refreshMessages();
    } catch {
      toast.error(t("mail.sendFailed"));
    } finally {
      setMutationBusy(false);
    }
  }

  const connectedMailboxes = mailboxes.filter((item) => (
    item.connection_state === "connected" || item.connection_state === "limited"
  ));
  const newDraft = selectedMailbox && (
    selectedMailbox.connection_state === "connected"
    || selectedMailbox.connection_state === "limited"
  )
    ? emptyComposeDraft(selectedMailbox.mailbox_id)
    : null;

  return (
    <div className="mail-workbench">
      <header className="mail-workbench__header">
        <div style={{ alignItems: "center", display: "flex", gap: 10, minWidth: 0 }}>
          <Mail size={19} />
          <strong>{t("mail.title")}</strong>
          {selectedMailbox?.connection_state === "limited"
            ? <Tag color="warning">{t("mail.limited")}</Tag>
            : null}
        </div>
        <div className="mail-workbench__search">
          <Input
            aria-label={t("mail.search")}
            onChange={(event) => dispatch({ type: "search_changed", value: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter") dispatch({ type: "search_submitted" });
            }}
            placeholder={t("mail.search")}
            prefix={<Search size={14} />}
            suffix={state.searchTerm ? (
              <Button
                aria-label={`${t("common.close")} ${t("mail.search")}`}
                icon={<X size={12} />}
                onClick={() => dispatch({ type: "search_cleared" })}
                shape="circle"
                size="small"
                type="text"
              />
            ) : undefined}
            value={state.searchTerm}
          />
          {state.searchActive ? (
            <Checkbox
              checked={state.includeRemoteHistory}
              onChange={(checked) => dispatch({
                type: "remote_history_changed",
                value: checked,
              })}
            >
              {t("mail.searchOlder")}
            </Checkbox>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <Tooltip title={t("common.refresh")}>
            <Button
              aria-label={t("common.refresh")}
              icon={<RefreshCw size={15} />}
              loading={mailboxesState === "loading" || messagesState === "loading"}
              onClick={() => void Promise.all([refreshMailboxes(), refreshMessages()])}
              shape="circle"
              size="small"
              type="text"
            />
          </Tooltip>
          <Tooltip title={t("mail.manage")}>
            <Button
              aria-label={t("mail.manage")}
              icon={<Settings2 size={15} />}
              onClick={() => setManagementOpen(true)}
              shape="circle"
              size="small"
              type="text"
            />
          </Tooltip>
          <Button
            disabled={!newDraft}
            icon={<PenLine size={15} />}
            onClick={() => {
              if (newDraft) dispatch({ type: "compose_opened", draft: newDraft });
            }}
            size="small"
            type="primary"
          >
            {t("mail.compose")}
          </Button>
        </div>
      </header>
      {sendOutcome ? (
        <Alert
          action={sendOutcome === "unknown" && state.compose ? (
            <Button
              onClick={() => {
                dispatch({
                  type: "compose_new_attempt",
                  idempotencyKey: crypto.randomUUID(),
                });
                setSendOutcome(null);
              }}
              size="small"
            >
              {t("mail.newSendAttempt")}
            </Button>
          ) : undefined}
          closable
          onClose={() => setSendOutcome(null)}
          showIcon
          title={t(`mail.sendOutcomes.${sendOutcome}`)}
          type="warning"
        />
      ) : null}
      <div className="mail-workbench__columns">
        <aside className="mail-workbench__navigation">
          <MailboxNavigation
            folders={folders}
            foldersState={foldersState}
            mailboxes={mailboxes}
            mailboxesState={mailboxesState}
            onConnect={() => setConnectionMailbox(null)}
            onFolder={(folderId) => dispatch({ type: "folder_selected", folderId })}
            onMailbox={(mailboxId) => dispatch({ type: "mailbox_selected", mailboxId })}
            onRetry={() => void refreshMailboxes()}
            selectedFolderId={state.target.folderId}
            selectedMailboxId={state.target.mailboxId}
          />
        </aside>
        <section className="mail-workbench__messages">
          <MessageList
            activeMessageId={state.target.messageId}
            coverage={messagePage?.coverage ?? null}
            hasMore={Boolean(messagePage?.next_cursor)}
            items={summaries}
            onLoadMore={() => void loadMore()}
            onMessage={(summary) => dispatch({
              type: "target_reconciled",
              target: {
                mailboxId: summary.mailbox_id,
                folderId: summary.folder_id,
                messageId: summary.message_id,
              },
            })}
            onRetry={() => void refreshMessages()}
            searchActive={state.searchActive}
            state={messagesState}
          />
        </section>
        <main className="mail-workbench__reader">
          <MessageReader
            capabilities={selectedMailbox?.capabilities ?? {
              folders: false,
              search: false,
              flags: false,
              move: false,
              trash: false,
              append_sent: false,
            }}
            folders={folders}
            message={message}
            onDownload={(attachmentId) => {
              if (readerSummary) void downloadAttachment(readerSummary, attachmentId);
            }}
            onForward={() => {
              if (message?.message_id === state.target.messageId) dispatch({
                type: "compose_opened",
                draft: createForwardDraft(message.mailbox_id, message),
              });
            }}
            onReply={() => {
              if (message?.message_id === state.target.messageId) dispatch({
                type: "compose_opened",
                draft: createReplyDraft(message.mailbox_id, message),
              });
            }}
            onUpdate={(operation, destinationFolderId) => {
              if (readerSummary) void updateMessage(readerSummary, operation, destinationFolderId);
            }}
            state={messageState}
            summary={readerSummary}
            updating={mutationBusy}
          />
        </main>
      </div>
      <ConnectionDialog
        actorId={actorId}
        api={api}
        canManageShared={canManageShared}
        mailbox={connectionMailbox ?? null}
        onClose={() => setConnectionMailbox(undefined)}
        onConnected={(mailboxId) => {
          setConnectionMailbox(undefined);
          void refreshMailboxes(mailboxId);
        }}
        open={connectionMailbox !== undefined}
        toast={toast}
      />
      <MailboxManagementDialog
        actorId={actorId}
        api={api}
        canManageShared={canManageShared}
        mailboxes={mailboxes}
        onChanged={() => void refreshMailboxes()}
        onClose={() => setManagementOpen(false)}
        onConnect={() => {
          setManagementOpen(false);
          setConnectionMailbox(null);
        }}
        onReconnect={(mailbox) => {
          setManagementOpen(false);
          setConnectionMailbox(mailbox);
        }}
        open={managementOpen}
        toast={toast}
      />
      <ComposeDialog
        busy={mutationBusy}
        draft={state.compose}
        mailboxes={connectedMailboxes}
        onClose={() => dispatch({ type: "compose_closed" })}
        onSend={(draft) => void sendDraft(draft)}
      />
    </div>
  );
}

function MailboxNavigation({
  mailboxes,
  folders,
  mailboxesState,
  foldersState,
  selectedMailboxId,
  selectedFolderId,
  onMailbox,
  onFolder,
  onConnect,
  onRetry,
}: {
  mailboxes: Mailbox[];
  folders: MailFolder[];
  mailboxesState: "loading" | "ready" | "error";
  foldersState: "idle" | "loading" | "ready" | "error";
  selectedMailboxId: string | null;
  selectedFolderId: string | null;
  onMailbox: (mailboxId: string) => void;
  onFolder: (folderId: string) => void;
  onConnect: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  if (mailboxesState === "loading" && mailboxes.length === 0) {
    return <div style={centerState}><Skeleton active paragraph={{ rows: 4 }} title={false} /></div>;
  }
  if (mailboxesState === "error" && mailboxes.length === 0) {
    return (
      <div style={centerState}>
        <Flexbox align="center" gap={12}><Empty description={t("mail.loadFailed")} /><Button onClick={onRetry}>{t("common.retry")}</Button></Flexbox>
      </div>
    );
  }
  if (mailboxes.length === 0) {
    return (
      <div style={centerState}>
        <Flexbox align="center" gap={12}><Empty description={t("mail.noMailboxes")} /><Button icon={<Plus size={14} />} onClick={onConnect}>{t("mail.connect")}</Button></Flexbox>
      </div>
    );
  }
  return (
    <ScrollArea scrollFade style={{ height: "100%" }}>
      <div className="mail-workbench__nav-list">
        {mailboxes.map((mailbox) => (
          <div key={mailbox.mailbox_id}>
            <button
              className={`mail-workbench__row${mailbox.mailbox_id === selectedMailboxId ? " is-active" : ""}`}
              onClick={() => onMailbox(mailbox.mailbox_id)}
              type="button"
            >
              <span className="mail-workbench__row-icon">
                <Mail size={15} />
              </span>
              <span className="mail-workbench__row-copy">
                <strong>{mailbox.display_name ?? mailbox.email_address ?? t("mail.mailbox")}</strong>
                <small>{mailbox.email_address ?? t(`mail.states.${mailbox.connection_state}`)}</small>
              </span>
              <MailboxStateDot state={mailbox.connection_state} />
            </button>
            {mailbox.mailbox_id === selectedMailboxId ? (
              <div className="mail-workbench__folders">
                {foldersState === "loading" ? (
                  <Skeleton active paragraph={{ rows: 3 }} title={false} />
                ) : foldersState === "error" ? (
                  <Text type="danger">{t("mail.foldersFailed")}</Text>
                ) : folders.length === 0 ? (
                  <Text type="secondary">{t("mail.noFolders")}</Text>
                ) : folders.map((folder) => (
                  <button
                    className={`mail-workbench__folder${folder.folder_id === selectedFolderId ? " is-active" : ""}`}
                    disabled={!folder.selectable}
                    key={folder.folder_id}
                    onClick={() => onFolder(folder.folder_id)}
                    type="button"
                  >
                    <span>{folderIcon(folder.role)}</span>
                    <span>{folder.name}</span>
                    {folder.unread_count ? (
                      <Tag color="red" shape="round" size="small">
                        {folder.unread_count > 999 ? "999+" : folder.unread_count}
                      </Tag>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        <Button block icon={<Plus size={14} />} onClick={onConnect} size="small" type="text">
          {t("mail.connect")}
        </Button>
      </div>
    </ScrollArea>
  );
}

function MessageList({
  items,
  state,
  activeMessageId,
  coverage,
  searchActive,
  hasMore,
  onMessage,
  onRetry,
  onLoadMore,
}: {
  items: MailMessageSummary[];
  state: "idle" | "loading" | "ready" | "error";
  activeMessageId: string | null;
  coverage: MailMessagePage["coverage"] | null;
  searchActive: boolean;
  hasMore: boolean;
  onMessage: (message: MailMessageSummary) => void;
  onRetry: () => void;
  onLoadMore: () => void;
}) {
  const { t } = useTranslation();
  if ((state === "loading" || state === "idle") && items.length === 0) {
    return <div style={centerState}><Skeleton active paragraph={{ rows: 7 }} title={false} /></div>;
  }
  if (state === "error" && items.length === 0) {
    return (
      <div style={centerState}>
        <Flexbox align="center" gap={12}><Empty description={t("mail.messagesFailed")} /><Button onClick={onRetry}>{t("common.retry")}</Button></Flexbox>
      </div>
    );
  }
  if (items.length === 0) {
    return <div style={centerState}><Empty description={t(searchActive ? "mail.noSearchResults" : "mail.noMessages")} /></div>;
  }
  return (
    <Flexbox style={{ height: "100%", minHeight: 0 }}>
      {searchActive && coverage ? <MailCoverage coverage={coverage} /> : null}
      <ScrollArea scrollFade style={{ flex: 1, minHeight: 0 }}>
        <div role="list">
          {items.map((item) => (
            <button
              className={`mail-workbench__message${item.message_id === activeMessageId ? " is-active" : ""}${messageIsUnread(item) ? " is-unread" : ""}`}
              key={`${item.mailbox_id}:${item.folder_id}:${item.message_id}`}
              onClick={() => onMessage(item)}
              role="listitem"
              type="button"
            >
              <div className="mail-workbench__message-line">
                <strong>{participantLabel(item.from, t("mail.unknownSender"))}</strong>
                <time>{formatMailDate(item.received_at_ms ?? item.sent_at_ms)}</time>
              </div>
              <div className="mail-workbench__subject">{item.subject || t("mail.noSubject")}</div>
              <div className="mail-workbench__message-meta">
                {item.attachments.length > 0 ? <Paperclip size={12} /> : null}
                <span>{formatBytes(item.size_bytes)}</span>
              </div>
            </button>
          ))}
          {hasMore ? (
            <Button block loading={state === "loading"} onClick={onLoadMore} type="text">
              {t("mail.more")}
            </Button>
          ) : null}
        </div>
      </ScrollArea>
    </Flexbox>
  );
}

function MessageReader({
  capabilities,
  summary,
  message,
  state,
  folders,
  updating,
  onReply,
  onForward,
  onUpdate,
  onDownload,
}: {
  capabilities: Mailbox["capabilities"];
  summary: MailMessageSummary | null;
  message: MailMessage | null;
  state: "idle" | "loading" | "ready" | "error";
  folders: MailFolder[];
  updating: boolean;
  onReply: () => void;
  onForward: () => void;
  onUpdate: (
    operation: "mark_read" | "mark_unread" | "move" | "trash",
    destinationFolderId?: string,
  ) => void;
  onDownload: (attachmentId: string) => void;
}) {
  const { t } = useTranslation();
  if (!summary) return <div style={centerState}><Empty description={t("mail.selectMessage")} /></div>;
  if (state === "loading" || state === "idle") {
    return <div style={centerState}><Skeleton active paragraph={{ rows: 8 }} /></div>;
  }
  if (state === "error" || !message) {
    return <div style={centerState}><Empty description={t("mail.messageFailed")} /></div>;
  }
  const availability = mailActionAvailability(capabilities);
  return (
    <Flexbox style={{ height: "100%", minHeight: 0 }}>
      <div className="mail-workbench__reader-actions">
        <Tooltip title={t("mail.reply")}><Button aria-label={t("mail.reply")} icon={<CornerUpLeft size={15} />} onClick={onReply} shape="circle" size="small" type="text" /></Tooltip>
        <Tooltip title={t("mail.forward")}><Button aria-label={t("mail.forward")} icon={<Forward size={15} />} onClick={onForward} shape="circle" size="small" type="text" /></Tooltip>
        <Tooltip title={availability.flags ? t(messageIsUnread(summary) ? "mail.markRead" : "mail.markUnread") : t("mail.unsupportedAction")}><Button aria-label={t(messageIsUnread(summary) ? "mail.markRead" : "mail.markUnread")} disabled={updating || !availability.flags} icon={messageIsUnread(summary) ? <MailOpen size={15} /> : <Mail size={15} />} onClick={() => onUpdate(messageIsUnread(summary) ? "mark_read" : "mark_unread")} shape="circle" size="small" type="text" /></Tooltip>
        <Select
          aria-label={t("mail.move")}
          disabled={updating || !summary || !availability.move}
          onChange={(folderId) => onUpdate("move", folderId)}
          options={folders.filter((folder) => folder.selectable && folder.folder_id !== summary.folder_id).map((folder) => ({ label: folder.name, value: folder.folder_id }))}
          placeholder={t("mail.move")}
          size="small"
          style={{ minWidth: 120 }}
          suffixIcon={<Archive size={13} />}
          value={undefined}
        />
        <Tooltip title={availability.trash ? t("mail.trash") : t("mail.unsupportedAction")}><Button aria-label={t("mail.trash")} disabled={updating || !availability.trash} icon={<Trash2 size={15} />} onClick={() => onUpdate("trash")} shape="circle" size="small" type="text" /></Tooltip>
        {availability.limited ? <Tag color="warning">{t("mail.unsupportedActions")}</Tag> : null}
      </div>
      <ScrollArea scrollFade style={{ flex: 1, minHeight: 0 }}>
        <article className="mail-workbench__article">
          <h1>{message.subject || t("mail.noSubject")}</h1>
          <div className="mail-workbench__participants">
            <strong>{participantLabel(message.from, t("mail.unknownSender"))}</strong>
            <span>{message.from.map(formatParticipant).join(", ")}</span>
            <time>{formatMailDate(message.received_at_ms ?? message.sent_at_ms, true)}</time>
          </div>
          <dl className="mail-workbench__recipients">
            <dt>{t("mail.to")}</dt>
            <dd>{message.to.map(formatParticipant).join(", ")}</dd>
            {message.cc.length > 0 ? <><dt>{t("mail.cc")}</dt><dd>{message.cc.map(formatParticipant).join(", ")}</dd></> : null}
          </dl>
          {message.remote_images_blocked ? (
            <Alert showIcon title={t("mail.remoteImagesBlocked")} type="info" />
          ) : null}
          {message.html_body ? (
            <div
              className="mail-workbench__html"
              dangerouslySetInnerHTML={{ __html: message.html_body }}
              onClick={handleSanitizedHtmlClick}
            />
          ) : (
            <pre className="mail-workbench__plain">{message.text_body ?? ""}</pre>
          )}
          {message.attachments.length > 0 ? (
            <section className="mail-workbench__attachments">
              <h2>{t("mail.attachments")}</h2>
              {message.attachments.map((attachment) => (
                <Button
                  icon={<Download size={14} />}
                  key={attachment.attachment_id}
                  onClick={() => onDownload(attachment.attachment_id)}
                  size="small"
                >
                  {attachment.filename ?? t("mail.attachment")} · {formatBytes(attachment.size_bytes)}
                </Button>
              ))}
            </section>
          ) : null}
        </article>
      </ScrollArea>
    </Flexbox>
  );
}

function MailCoverage({ coverage }: { coverage: MailMessagePage["coverage"] }) {
  const { t } = useTranslation();
  if (!coverage.partial && coverage.failed_mailbox_ids.length === 0 && coverage.includes_remote_results) {
    return null;
  }
  return (
    <div className="mail-workbench__coverage">
      {t("mail.coverage", {
        date: coverage.indexed_from_ms ? new Date(coverage.indexed_from_ms).toLocaleDateString() : t("mail.unknownDate"),
        failed: coverage.failed_mailbox_ids.length,
        scope: coverage.includes_remote_results ? t("mail.remoteIncluded") : t("mail.indexedOnly"),
      })}
    </div>
  );
}

function ConnectionDialog({
  open,
  mailbox,
  api,
  canManageShared,
  actorId,
  onClose,
  onConnected,
  toast,
}: {
  open: boolean;
  mailbox: Mailbox | null;
  api: typeof backendTrpc;
  canManageShared: boolean;
  actorId: string;
  onClose: () => void;
  onConnected: (mailboxId: string) => void;
  toast: MailToastActions;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<"personal" | "shared">("personal");
  const [preset, setPreset] = useState<MailProviderPreset>("google");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("993");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("465");
  const [imapTlsMode, setImapTlsMode] = useState<"implicit_tls" | "starttls">("implicit_tls");
  const [smtpTlsMode, setSmtpTlsMode] = useState<"implicit_tls" | "starttls">("implicit_tls");
  const [targetActorId, setTargetActorId] = useState(actorId);
  const [agentActors, setAgentActors] = useState<Array<{ actor_id: string; display_name: string }>>([]);
  const [working, setWorking] = useState(false);
  const connectAttempt = useRef<MailConnectionAttempt | null>(null);

  useEffect(() => {
    if (!open) return;
    setKind(mailbox?.kind ?? "personal");
    setPreset("google");
    setName(mailbox?.display_name ?? "");
    setEmail(mailbox?.email_address ?? "");
    setUsername(mailbox?.email_address ?? "");
    setPassword("");
    setDisplayName("");
    setImapHost("");
    setImapPort("993");
    setImapTlsMode("implicit_tls");
    setSmtpHost("");
    setSmtpPort("465");
    setSmtpTlsMode("implicit_tls");
    setTargetActorId(mailbox?.target_actor_id ?? actorId);
    connectAttempt.current = null;
    if (!canManageShared) return;
    void api.company.actors.list.query().then((result) => {
      setAgentActors(result.items.filter((item) => (
        item.actor_id === actorId || item.actor_type === "agent"
      )).map((item) => ({ actor_id: item.actor_id, display_name: item.display_name })));
    }).catch(() => undefined);
  }, [actorId, api, canManageShared, mailbox, open]);

  async function submit() {
    if (working) return;
    setWorking(true);
    const configuration: MailConnectionConfiguration = {
      preset,
      email_address: email.trim(),
      username: username.trim(),
      application_password: password,
      display_name: displayName.trim() || null,
      ...(preset === "custom" ? {
        imap: { host: imapHost.trim(), port: Number(imapPort), tls_mode: imapTlsMode },
        smtp: { host: smtpHost.trim(), port: Number(smtpPort), tls_mode: smtpTlsMode },
      } : {}),
    };
    const attempt = resolveMailConnectionAttempt(connectAttempt.current, {
      kind,
      mailboxId: mailbox?.mailbox_id ?? null,
      targetActorId,
      name: name.trim(),
      configuration,
    });
    connectAttempt.current = attempt;
    try {
      const result = kind === "shared"
        ? await api.mail.mailboxes.connectShared.mutate({
          mailbox_id: mailbox?.kind === "shared" ? mailbox.mailbox_id : undefined,
          name: name.trim(),
          configuration,
          idempotency_key: attempt.idempotencyKey,
        })
        : await api.mail.mailboxes.connectPersonal.mutate({
          target_actor_id: targetActorId,
          configuration,
          idempotency_key: attempt.idempotencyKey,
        });
      setPassword("");
      connectAttempt.current = null;
      onConnected(result.mailbox.mailbox_id);
    } catch {
      setPassword("");
      toast.error(t("mail.connectFailed"));
    } finally {
      setWorking(false);
    }
  }

  const valid = Boolean(email.trim() && username.trim() && password && (
    preset !== "custom" || (imapHost.trim() && smtpHost.trim() && Number(imapPort) && Number(smtpPort))
  ) && (kind === "personal" || name.trim()));
  return (
    <Modal
      cancelText={t("common.cancel")}
      confirmLoading={working}
      destroyOnHidden
      okButtonProps={{ disabled: !valid }}
      okText={t("mail.connect")}
      onCancel={onClose}
      onOk={() => void submit()}
      open={open}
      title={t("mail.connectMailbox")}
    >
      <div className="mail-workbench__form">
        {canManageShared ? (
          <Field label={t("mail.mailboxType")}>
            <Select
              disabled={Boolean(mailbox)}
              onChange={setKind}
              options={[
                { label: t("mail.personal"), value: "personal" },
                { label: t("mail.shared"), value: "shared" },
              ]}
              value={kind}
            />
          </Field>
        ) : null}
        {kind === "personal" && canManageShared ? (
          <Field label={t("mail.personalOwner")}>
            <Select
              disabled={Boolean(mailbox)}
              onChange={setTargetActorId}
              options={agentActors.map((actor) => ({ label: actor.display_name, value: actor.actor_id }))}
              value={targetActorId}
            />
          </Field>
        ) : null}
        {kind === "shared" ? <Field label={t("mail.sharedName")}><Input onChange={(event) => setName(event.target.value)} value={name} /></Field> : null}
        <Field label={t("mail.provider")}>
          <Select
            onChange={setPreset}
            options={(["google", "microsoft", "aliyun", "tencent", "netease", "qq", "custom"] as MailProviderPreset[]).map((value) => ({
              label: t(`mail.providers.${value}`),
              value,
            }))}
            value={preset}
          />
        </Field>
        <Field label={t("mail.email")}><Input autoComplete="email" onChange={(event) => { setEmail(event.target.value); if (!username) setUsername(event.target.value); }} value={email} /></Field>
        <Field label={t("mail.username")}><Input autoComplete="username" onChange={(event) => setUsername(event.target.value)} value={username} /></Field>
        <Field label={t("mail.applicationPassword")}><InputPassword autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} value={password} /></Field>
        <Field label={t("mail.displayName")}><Input onChange={(event) => setDisplayName(event.target.value)} value={displayName} /></Field>
        {preset === "custom" ? (
          <div className="mail-workbench__endpoint-grid">
            <Field label={t("mail.imapHost")}><Input onChange={(event) => setImapHost(event.target.value)} value={imapHost} /></Field>
            <Field label={t("mail.port")}><Input inputMode="numeric" onChange={(event) => setImapPort(event.target.value)} value={imapPort} /></Field>
            <Field label={t("mail.tlsMode")}><Select onChange={setImapTlsMode} options={tlsOptions(t)} value={imapTlsMode} /></Field>
            <span />
            <Field label={t("mail.smtpHost")}><Input onChange={(event) => setSmtpHost(event.target.value)} value={smtpHost} /></Field>
            <Field label={t("mail.port")}><Input inputMode="numeric" onChange={(event) => setSmtpPort(event.target.value)} value={smtpPort} /></Field>
            <Field label={t("mail.tlsMode")}><Select onChange={setSmtpTlsMode} options={tlsOptions(t)} value={smtpTlsMode} /></Field>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function MailboxManagementDialog({
  open,
  mailboxes,
  actorId,
  api,
  canManageShared,
  onClose,
  onConnect,
  onReconnect,
  onChanged,
  toast,
}: {
  open: boolean;
  mailboxes: Mailbox[];
  actorId: string;
  api: typeof backendTrpc;
  canManageShared: boolean;
  onClose: () => void;
  onConnect: () => void;
  onReconnect: (mailbox: Mailbox) => void;
  onChanged: () => void;
  toast: MailToastActions;
}) {
  const { t } = useTranslation();
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [grantMailboxId, setGrantMailboxId] = useState<string | null>(null);

  async function disconnect(mailbox: Mailbox) {
    setWorkingId(mailbox.mailbox_id);
    try {
      await api.mail.mailboxes.disconnect.mutate({ mailbox_id: mailbox.mailbox_id });
      onChanged();
    } catch {
      toast.error(t("mail.actionFailed"));
    } finally {
      setWorkingId(null);
    }
  }

  async function deleteShared(mailbox: Mailbox) {
    setWorkingId(mailbox.mailbox_id);
    try {
      await api.mail.mailboxes.deleteShared.mutate({ mailbox_id: mailbox.mailbox_id });
      onChanged();
    } catch {
      toast.error(t("mail.actionFailed"));
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <>
      <Modal
        destroyOnHidden
        footer={<><Button onClick={onClose}>{t("common.close")}</Button><Button icon={<Plus size={14} />} onClick={onConnect} type="primary">{t("mail.connect")}</Button></>}
        onCancel={onClose}
        open={open}
        title={t("mail.manage")}
        width={720}
      >
        <div className="mail-workbench__manage-list">
          {mailboxes.length === 0 ? <Empty description={t("mail.noMailboxes")} /> : mailboxes.map((mailbox) => (
            <div className="mail-workbench__manage-row" key={mailbox.mailbox_id}>
              <div style={{ minWidth: 0 }}>
                <strong>{mailbox.display_name ?? mailbox.email_address ?? t("mail.mailbox")}</strong>
                <div><Text type="secondary">{mailbox.email_address ?? t(`mail.states.${mailbox.connection_state}`)}</Text></div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {canManageShared && mailbox.kind === "shared" ? <Button onClick={() => setGrantMailboxId(mailbox.mailbox_id)} size="small">{t("mail.access")}</Button> : null}
                {mailbox.access !== "shared_grant" ? <Button onClick={() => onReconnect(mailbox)} size="small">{t("mail.reconnect")}</Button> : null}
                {mailbox.access !== "shared_grant" ? <Button loading={workingId === mailbox.mailbox_id} onClick={() => void disconnect(mailbox)} size="small">{t("mail.disconnect")}</Button> : null}
                {mailbox.access === "company_owner" && mailbox.kind === "shared" ? <Button danger disabled={workingId !== null} onClick={() => void deleteShared(mailbox)} size="small">{t("common.delete")}</Button> : null}
              </div>
            </div>
          ))}
        </div>
      </Modal>
      <GrantDialog
        actorId={actorId}
        api={api}
        mailboxId={grantMailboxId}
        onClose={() => setGrantMailboxId(null)}
        toast={toast}
      />
    </>
  );
}

function GrantDialog({
  mailboxId,
  actorId,
  api,
  onClose,
  toast,
}: {
  mailboxId: string | null;
  actorId: string;
  api: typeof backendTrpc;
  onClose: () => void;
  toast: MailToastActions;
}) {
  const { t } = useTranslation();
  const [actors, setActors] = useState<Array<{ actor_id: string; display_name: string }>>([]);
  const [granted, setGranted] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!mailboxId) return;
    let active = true;
    setLoading(true);
    void Promise.all([
      api.company.actors.list.query(),
      api.mail.shared.grants.list.query({ mailbox_id: mailboxId }),
    ]).then(([actorResult, grantResult]) => {
      if (!active) return;
      setActors(actorResult.items.map((item) => ({
        actor_id: item.actor_id,
        display_name: item.display_name,
      })));
      setGranted(grantResult.items.map((item) => item.actor_id));
    }).catch(() => toast.error(t("mail.actionFailed")))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, mailboxId, t, toast]);

  async function grant() {
    if (!mailboxId || !selected) return;
    setLoading(true);
    try {
      await api.mail.shared.grants.grant.mutate({ mailbox_id: mailboxId, actor_id: selected });
      setGranted((current) => current.includes(selected) ? current : [...current, selected]);
      setSelected(undefined);
    } catch {
      toast.error(t("mail.actionFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function revoke(targetActorId: string) {
    if (!mailboxId) return;
    setLoading(true);
    try {
      await api.mail.shared.grants.revoke.mutate({ mailbox_id: mailboxId, actor_id: targetActorId });
      setGranted((current) => current.filter((item) => item !== targetActorId));
    } catch {
      toast.error(t("mail.actionFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      destroyOnHidden
      footer={<Button onClick={onClose}>{t("common.close")}</Button>}
      onCancel={onClose}
      open={Boolean(mailboxId)}
      title={t("mail.access")}
    >
      <div className="mail-workbench__form">
        <div style={{ display: "flex", gap: 8 }}>
          <Select
            disabled={loading}
            onChange={setSelected}
            options={actors.filter((actor) => actor.actor_id !== actorId && !granted.includes(actor.actor_id)).map((actor) => ({
              label: actor.display_name,
              value: actor.actor_id,
            }))}
            placeholder={t("mail.selectMember")}
            style={{ flex: 1 }}
            value={selected}
          />
          <Button disabled={!selected} loading={loading} onClick={() => void grant()}>{t("mail.grant")}</Button>
        </div>
        {granted.length === 0 ? <Empty description={t("mail.noGrants")} /> : granted.map((grantedActorId) => (
          <div className="mail-workbench__manage-row" key={grantedActorId}>
            <span>{actors.find((item) => item.actor_id === grantedActorId)?.display_name ?? grantedActorId}</span>
            <Button danger disabled={loading} onClick={() => void revoke(grantedActorId)} size="small">{t("mail.revoke")}</Button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function ComposeDialog({
  draft,
  busy,
  mailboxes,
  onClose,
  onSend,
}: {
  draft: MailComposeDraft | null;
  busy: boolean;
  mailboxes: Mailbox[];
  onClose: () => void;
  onSend: (draft: MailComposeDraft) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState<MailComposeDraft | null>(draft);
  useEffect(() => setValue(draft), [draft]);
  if (!value) {
    return <Modal open={false} />;
  }
  const recipientCount = splitMailAddresses(value.to).length
    + splitMailAddresses(value.cc).length
    + splitMailAddresses(value.bcc).length;
  const attachmentBytes = value.attachments.reduce((sum, file) => sum + file.size, 0);
  const valid = recipientCount >= 1 && recipientCount <= 100 && attachmentBytes <= 25 * 1024 * 1024;
  return (
    <Modal
      cancelText={t("common.cancel")}
      confirmLoading={busy}
      destroyOnHidden
      okButtonProps={{ disabled: !valid }}
      okText={t("mail.send")}
      onCancel={onClose}
      onOk={() => onSend(value)}
      open
      title={t(`mail.composeModes.${value.mode}`)}
      width={760}
    >
      <div className="mail-workbench__form">
        <Field label={t("mail.from")}>
          <Select
            onChange={(mailboxId) => setValue({ ...value, mailboxId })}
            options={mailboxes.map((mailbox) => ({
              label: mailbox.display_name ?? mailbox.email_address ?? mailbox.mailbox_id,
              value: mailbox.mailbox_id,
            }))}
            value={value.mailboxId}
          />
        </Field>
        <Field label={t("mail.to")}><Input onChange={(event) => setValue({ ...value, to: event.target.value })} value={value.to} /></Field>
        <div className="mail-workbench__endpoint-grid">
          <Field label={t("mail.cc")}><Input onChange={(event) => setValue({ ...value, cc: event.target.value })} value={value.cc} /></Field>
          <Field label={t("mail.bcc")}><Input onChange={(event) => setValue({ ...value, bcc: event.target.value })} value={value.bcc} /></Field>
        </div>
        <Field label={t("mail.subject")}><Input onChange={(event) => setValue({ ...value, subject: event.target.value })} value={value.subject} /></Field>
        <Field label={t("mail.body")}><TextArea autoSize={{ minRows: 9, maxRows: 16 }} onChange={(event) => setValue({ ...value, body: event.target.value })} value={value.body} /></Field>
        <div className="mail-workbench__compose-attachments">
          <label className="mail-workbench__file-button">
            <Paperclip size={14} />
            <span>{t("mail.addAttachment")}</span>
            <input
              hidden
              multiple
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                setValue({ ...value, attachments: [...value.attachments, ...files] });
                event.target.value = "";
              }}
              type="file"
            />
          </label>
          {value.attachments.map((file, index) => (
            <Tag
              closable
              key={`${file.name}:${file.lastModified}:${index}`}
              onClose={() => setValue({
                ...value,
                attachments: value.attachments.filter((_, current) => current !== index),
              })}
            >
              {file.name} · {formatBytes(file.size)}
            </Tag>
          ))}
        </div>
        {!valid && attachmentBytes > 25 * 1024 * 1024 ? <Text type="danger">{t("mail.attachmentsTooLarge")}</Text> : null}
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="mail-workbench__field"><span>{label}</span>{children}</label>;
}

function tlsOptions(t: (key: string) => string) {
  return [
    { label: t("mail.implicitTls"), value: "implicit_tls" as const },
    { label: t("mail.starttls"), value: "starttls" as const },
  ];
}

function MailboxStateDot({ state }: { state: Mailbox["connection_state"] }) {
  const color = state === "connected"
    ? "var(--ant-color-success)"
    : state === "limited" || state === "validating"
      ? "var(--ant-color-warning)"
      : state === "error"
        ? "var(--ant-color-error)"
        : "var(--ant-color-text-quaternary)";
  return <i aria-hidden style={{ background: color, borderRadius: "50%", height: 8, width: 8 }} />;
}

function folderIcon(role: MailFolder["role"]): ReactNode {
  if (role === "inbox") return <Inbox size={14} />;
  if (role === "sent") return <Send size={14} />;
  if (role === "trash") return <Trash2 size={14} />;
  if (role === "archive") return <Archive size={14} />;
  return <Mail size={14} />;
}

function participantLabel(
  participants: MailMessageSummary["from"],
  fallback: string,
): string {
  const participant = participants[0];
  return participant?.name ?? participant?.address ?? fallback;
}

function formatParticipant(participant: MailMessageSummary["from"][number]): string {
  return participant.name ? `${participant.name} <${participant.address}>` : participant.address;
}

function formatMailDate(value: number | null, detailed = false): string {
  if (value === null) return "";
  return new Intl.DateTimeFormat(undefined, detailed
    ? { dateStyle: "medium", timeStyle: "short" }
    : { month: "short", day: "numeric" }).format(new Date(value));
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function appendUniqueMessages(
  current: MailMessageSummary[],
  next: MailMessageSummary[],
): MailMessageSummary[] {
  const seen = new Set(current.map((item) => `${item.mailbox_id}:${item.folder_id}:${item.message_id}`));
  return [...current, ...next.filter((item) => {
    const key = `${item.mailbox_id}:${item.folder_id}:${item.message_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })];
}

function searchableMailboxIds(mailboxes: readonly Mailbox[]): string[] {
  return mailboxes
    .filter((mailbox) => (
      mailbox.connection_state === "connected"
      || mailbox.connection_state === "limited"
    ))
    .map((mailbox) => mailbox.mailbox_id);
}

function emptyComposeDraft(mailboxId: string): MailComposeDraft {
  return {
    idempotencyKey: crypto.randomUUID(),
    mode: "new",
    mailboxId,
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    body: "",
    references: [],
    attachments: [],
  };
}

async function fileToMailAttachment(file: File) {
  return {
    filename: file.name,
    content_type: file.type || "application/octet-stream",
    content_base64: await fileToBase64(file),
  };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("file read failed"));
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.readAsDataURL(file);
  });
}

function downloadBase64(content: string, contentType: string, filename: string): void {
  const bytes = Uint8Array.from(atob(content), (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function handleSanitizedHtmlClick(event: ReactMouseEvent<HTMLDivElement>): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return;
  event.preventDefault();
  try {
    openExternalUrl(anchor.href);
  } catch {
    // Runtime sanitation already strips unsafe protocols; ignore stale invalid hrefs.
  }
}
