import type { HomeModelSelection, HomeThreadReadResult, MessageImageAttachment } from "@fields/contracts/public/home";
import type { UIChatMessage } from "@lobechat/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ulid } from "ulid";
import { useStore } from "zustand";

import {
  defaultHomeMachineServices,
  type HomeMachineServices,
} from "../../data/home/home-machine-services";
import {
  messageFromError,
  type UiMessageValue,
} from "../../shared/i18n/message";
import {
  projectHomeConversation,
  reduceHomeConversationEvent,
  type FieldsConversationProjection,
} from "./fields-conversation-adapter";
import {
  createConversationStore,
  type ConversationStoreApi,
} from "../../vendor/lobehub/store";
import { subscribeHomeTurnEvents } from "./home-turn-stream";

export type HomeConversationController = {
  messages: UIChatMessage[];
  store: ConversationStoreApi;
  generatingMessageIds: string[];
  activeThreadId: string | null;
  rootThreadId: string | null;
  revision: number | null;
  draft: string;
  loading: boolean;
  submitting: boolean;
  error: UiMessageValue;
  editMessageId: string | null;
  onDraft: (draft: string) => void;
  onSend: (markdown: string, imageAttachments?: MessageImageAttachment[]) => Promise<void>;
  onEdit: (message: UIChatMessage) => void;
  onFork: (message: UIChatMessage) => void;
  onRegenerate: (message: UIChatMessage) => void;
  onDeleteThread: () => void;
  onBranchSwitch: (messageId: string, branchIndex: number) => Promise<void>;
  onRespondToQuestion: (interactionId: string, answers: Record<string, string[]>, resolution: "answered" | "dismissed" | "timed_out") => Promise<void>;
  onSnoozeQuestion: (interactionId: string, mode: "foreground" | "background") => void;
};

type HomeConversationDomainState = Pick<
  HomeThreadReadResult,
  "selected_thread_id" | "root_thread_id" | "revision"
>;

export function useHomeConversation(input: {
  active: boolean;
  selectedThreadId: string | null;
  projectId: string | null;
  timeoutMs: number;
  services: HomeMachineServices;
  modelSelection: HomeModelSelection | null;
  onThreadChanged: (threadId: string) => void;
  onThreadDeleted: () => void;
}): HomeConversationController {
  const { t } = useTranslation();
  const store = useMemo(() => createConversationStore({
    context: {
      surface: "home",
      id: input.selectedThreadId ?? "new",
    },
  }), [input.selectedThreadId]);
  const messages = useStore(store, (state) => state.dbMessages);
  const generatingMessageIds = useStore(store, (state) => state.generatingMessageIds);
  const draft = useStore(store, (state) => state.inputMessage);
  const editMessageId = useStore(store, (state) => state.editingMessageId);
  const [domain, setDomain] = useState<HomeConversationDomainState | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<UiMessageValue>(null);
  const [streamError, setStreamError] = useState<UiMessageValue>(null);
  const requestRef = useRef(0);
  const readResultRef = useRef<HomeThreadReadResult | null>(null);
  const projectionRef = useRef<FieldsConversationProjection | null>(null);

  const read = useCallback(async (threadId: string) => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await input.services.readThread({ threadId });
      if (requestRef.current !== request) return;
      setDomain({
        selected_thread_id: result.selected_thread_id,
        root_thread_id: result.root_thread_id,
        revision: result.revision,
      });
      readResultRef.current = result;
      const projection = projectHomeConversation(result);
      projectionRef.current = projection;
      replaceStoreProjection(store, projection);
    } catch (reason) {
      if (requestRef.current !== request) return;
      if (isMissingHomeThread(reason)) {
        input.onThreadDeleted();
        return;
      }
      setError(messageFromError(reason, "home.threadRestoreFailed"));
    } finally {
      if (requestRef.current === request) setLoading(false);
    }
  }, [input.services, store]);

  useEffect(() => {
    if (!input.active) return;
    if (!input.selectedThreadId) {
      requestRef.current += 1;
      setDomain(null);
      readResultRef.current = null;
      projectionRef.current = null;
      replaceStoreProjection(store, null);
      setLoading(false);
      setError(null);
      store.getState().setEditingMessage(null);
      return;
    }
    void read(input.selectedThreadId);
  }, [input.active, input.selectedThreadId, read, store]);

  useEffect(() => {
    const threadId = domain?.selected_thread_id;
    if (!input.active || !threadId) return;
    const subscription = subscribeHomeTurnEvents({
      threadId,
      services: input.services,
      handlers: {
        onStarted: () => {
          setStreamError(null);
        },
        onEvent: (event) => {
          setStreamError(null);
          const current = projectionRef.current;
          const source = readResultRef.current;
          if (!current || !source) return;
          const next = reduceHomeConversationEvent(current, source, event);
          projectionRef.current = next;
          replaceStoreProjection(store, next);
        },
        onError: (reason) => {
          setStreamError(messageFromError(reason, "home.streamDisconnected"));
        },
        onComplete: () => {
          setStreamError(null);
          void read(threadId);
        },
      },
    });
    return () => subscription.unsubscribe();
  }, [domain?.selected_thread_id, input.active, input.services, read, store]);

  const submit = useCallback(async (markdown: string, imageAttachments: MessageImageAttachment[] = []) => {
    const prompt = markdown.trim();
    if ((!prompt && imageAttachments.length === 0) || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      if (editMessageId && domain) {
        if (imageAttachments.length > 0) throw new Error("Home edit does not accept new image attachments.");
        const turnId = stringMetadata(
          messages.find((candidate) => candidate.id === editMessageId),
          "fieldsTurnId",
        );
        if (!turnId) throw new Error("Home edit anchor Turn is unavailable.");
        const forkThread = input.services.forkThread ?? defaultHomeMachineServices.forkThread!;
        const fork = await forkThread({
          threadId: domain.selected_thread_id,
          anchorTurnId: turnId,
          kind: "edited_user_message",
          prompt,
          expectedRevision: domain.revision,
          idempotencyKey: `home-edit-${ulid()}`,
          timeoutMs: input.timeoutMs,
        });
        store.getState().updateInputMessage("");
        store.getState().setEditingMessage(null);
        input.onThreadChanged(fork.thread_id);
        await read(fork.thread_id);
      } else {
        const result = await input.services.submitTurn({
          threadId: domain?.selected_thread_id ?? null,
          projectId: input.projectId,
          prompt,
          imageAttachments,
          clientMessageId: `home-${ulid()}`,
          timeoutMs: input.timeoutMs,
          ...(input.modelSelection ? {
            model: input.modelSelection.model,
            reasoningEffort: input.modelSelection.reasoning_effort,
          } : {}),
        });
        store.getState().updateInputMessage("");
        if (result.thread_id !== domain?.selected_thread_id) {
          input.onThreadChanged(result.thread_id);
        }
        await read(result.thread_id);
      }
    } catch (reason) {
      setError(messageFromError(reason, "home.promptSendFailed"));
    } finally {
      setSubmitting(false);
    }
  }, [
    editMessageId,
    domain,
    input,
    messages,
    read,
    store,
    submitting,
  ]);

  const edit = useCallback((selected: UIChatMessage) => {
    if (selected.role !== "user" || selected.metadata?.fieldsImported === true) return;
    store.getState().setEditingMessage(selected.id);
    store.getState().updateInputMessage(selected.content);
  }, [store]);

  const regenerate = useCallback(async (selected: UIChatMessage) => {
    if (!domain || submitting || selected.metadata?.fieldsImported === true) return;
    const turnId = stringMetadata(selected, "fieldsTurnId");
    if (!turnId) return;
    setSubmitting(true);
    setError(null);
    try {
      const forkThread = input.services.forkThread ?? defaultHomeMachineServices.forkThread!;
      const result = await forkThread({
        threadId: domain.selected_thread_id,
        anchorTurnId: turnId,
        kind: "regenerated_assistant",
        expectedRevision: domain.revision,
        idempotencyKey: `home-regenerate-${ulid()}`,
        timeoutMs: input.timeoutMs,
      });
      input.onThreadChanged(result.thread_id);
      await read(result.thread_id);
    } catch (reason) {
      setError(messageFromError(reason, "home.promptSendFailed"));
    } finally {
      setSubmitting(false);
    }
  }, [domain, input, read, submitting]);

  const fork = useCallback(async (selected: UIChatMessage) => {
    if (!domain || submitting || selected.metadata?.fieldsImported === true) return;
    const turnId = stringMetadata(selected, "fieldsTurnId");
    if (!turnId) return;
    setSubmitting(true);
    setError(null);
    try {
      const forkThread = input.services.forkThread ?? defaultHomeMachineServices.forkThread!;
      const result = await forkThread({
        threadId: domain.selected_thread_id,
        anchorTurnId: turnId,
        kind: "explicit",
        expectedRevision: domain.revision,
        idempotencyKey: `home-fork-${ulid()}`,
        timeoutMs: input.timeoutMs,
      });
      input.onThreadChanged(result.thread_id);
      await read(result.thread_id);
    } catch (reason) {
      setError(messageFromError(reason, "home.promptSendFailed"));
    } finally {
      setSubmitting(false);
    }
  }, [domain, input, read, submitting]);

  const switchBranch = useCallback(async (messageId: string, branchIndex: number) => {
    if (!domain) return;
    const active = messages.find((message) => message.id === messageId);
    if (!active?.parentId) return;
    const siblings = messages.filter((message) => message.parentId === active.parentId);
    const target = siblings[branchIndex];
    if (!target?.threadId || target.threadId === domain.selected_thread_id) return;
    const selectThreadBranch = input.services.selectThreadBranch
      ?? defaultHomeMachineServices.selectThreadBranch!;
    const result = await selectThreadBranch({
      rootThreadId: domain.root_thread_id,
      threadId: target.threadId,
      expectedRevision: domain.revision,
      idempotencyKey: `home-select-${ulid()}`,
    });
    input.onThreadChanged(result.selected_thread_id);
    await read(result.selected_thread_id);
  }, [domain, input, messages, read]);

  const deleteThread = useCallback(async () => {
    if (!domain || submitting) return;
    const confirmation = window.prompt(
      t("home.deleteThreadConfirmation", { threadId: domain.selected_thread_id }),
    );
    if (confirmation !== domain.selected_thread_id) return;
    setSubmitting(true);
    setError(null);
    try {
      const deleteThreadService = input.services.deleteThread
        ?? defaultHomeMachineServices.deleteThread!;
      await deleteThreadService({
        threadId: domain.selected_thread_id,
        confirmation,
        expectedRevision: domain.revision,
        idempotencyKey: `home-delete-${ulid()}`,
      });
      input.onThreadDeleted();
    } catch (reason) {
      setError(messageFromError(reason, "home.promptSendFailed"));
    } finally {
      setSubmitting(false);
    }
  }, [domain, input, submitting, t]);

  const respondToQuestion = useCallback(async (
    interactionId: string,
    answers: Record<string, string[]>,
    resolution: "answered" | "dismissed" | "timed_out",
  ) => {
    if (!domain?.selected_thread_id) throw new Error("Home question Thread is unavailable.");
    const respond = input.services.respondToQuestion ?? defaultHomeMachineServices.respondToQuestion!;
    await respond({
      threadId: domain.selected_thread_id,
      interactionId,
      answers,
      resolution,
    });
  }, [domain?.selected_thread_id, input.services]);
  const snoozeQuestion = useCallback((interactionId: string, mode: "foreground" | "background") => {
    if (!domain?.selected_thread_id) return;
    const snooze = input.services.snoozeQuestion ?? defaultHomeMachineServices.snoozeQuestion!;
    void snooze({ threadId: domain.selected_thread_id, interactionId, mode }).catch(() => undefined);
  }, [domain?.selected_thread_id, input.services]);

  useDoubleEscapeEdit({
    active: input.active && draft.length === 0 && !submitting,
    messages,
    onEdit: edit,
  });

  return useMemo(() => ({
    messages,
    store,
    generatingMessageIds,
    activeThreadId: domain?.selected_thread_id ?? input.selectedThreadId,
    rootThreadId: domain?.root_thread_id ?? null,
    revision: domain?.revision ?? null,
    draft,
    loading,
    submitting,
    error: error ?? streamError,
    editMessageId,
    onDraft: (value: string) => {
      store.getState().updateInputMessage(value);
      if (!value && editMessageId) store.getState().setEditingMessage(null);
    },
    onSend: submit,
    onEdit: edit,
    onFork: (selected: UIChatMessage) => void fork(selected),
    onRegenerate: (selected: UIChatMessage) => void regenerate(selected),
    onDeleteThread: () => void deleteThread(),
    onBranchSwitch: switchBranch,
    onRespondToQuestion: respondToQuestion,
    onSnoozeQuestion: snoozeQuestion,
  }), [
    deleteThread,
    domain,
    draft,
    edit,
    editMessageId,
    error,
    fork,
    input.selectedThreadId,
    loading,
    generatingMessageIds,
    messages,
    regenerate,
    respondToQuestion,
    snoozeQuestion,
    submit,
    submitting,
    store,
    switchBranch,
  ]);
}

function isMissingHomeThread(error: unknown): boolean {
  if (error instanceof Error && error.message.toLowerCase().includes("home_thread_not_found")) {
    return true;
  }
  if (typeof error !== "object" || error === null) return false;
  const data = (error as { data?: unknown }).data;
  return typeof data === "object"
    && data !== null
    && (data as { code?: unknown }).code === "NOT_FOUND";
}

function useDoubleEscapeEdit(input: {
  active: boolean;
  messages: UIChatMessage[];
  onEdit: (message: UIChatMessage) => void;
}) {
  useEffect(() => {
    if (!input.active) return;
    const onKeyDown = createDoubleEscapeEditHandler(input);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [input]);
}

export function createDoubleEscapeEditHandler(
  input: {
    messages: UIChatMessage[];
    onEdit: (message: UIChatMessage) => void;
  },
  now: () => number = Date.now,
): (event: Pick<KeyboardEvent, "key" | "preventDefault">) => void {
  let firstEscapeAt: number | null = null;
  return (event) => {
    if (event.key !== "Escape") return;
    const occurredAt = now();
    if (firstEscapeAt === null || occurredAt - firstEscapeAt > 800) {
      firstEscapeAt = occurredAt;
      return;
    }
    firstEscapeAt = null;
    const latest = [...input.messages].reverse().find((message) => message.role === "user");
    if (!latest) return;
    event.preventDefault();
    input.onEdit(latest);
  };
}

function stringMetadata(message: UIChatMessage | undefined, key: string): string | null {
  const value = message?.metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function replaceStoreProjection(
  store: ConversationStoreApi,
  projection: FieldsConversationProjection | null,
): void {
  const state = store.getState();
  state.replaceMessages(projection?.messages ?? []);
  const next = new Set(projection?.generatingMessageIds ?? []);
  for (const id of state.generatingMessageIds) {
    if (!next.has(id)) store.getState().setGenerating(id, false);
  }
  for (const id of next) {
    if (!store.getState().generatingMessageIds.includes(id)) {
      store.getState().setGenerating(id, true);
    }
  }
}
