import type { AgentTurnSnapshot } from "@fields/contracts/public/agent-activity";
import type { UIChatMessage } from "@lobechat/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ulid } from "ulid";
import { useStore } from "zustand";

import {
  defaultRoomMachineServices,
  type RoomMachineMessageEvent,
  type RoomMachineServices,
} from "../../data/room/room-machine-services";
import type { ComposerReferenceTarget } from "../../shared/types/composer";
import { message, messageFromError, type UiMessageValue } from "../../shared/i18n/message";
import type { TimelineMessage } from "../../shared/types/timeline";
import type { RoomMessageImageAttachment } from "@fields/contracts/public/room";
import {
  projectRoomConversation,
  reduceAgentTurnSnapshot,
} from "./fields-conversation-adapter";
import { markdownPlainText } from "./markdown-plain-text";
import {
  createConversationStore,
  type ConversationStoreApi,
} from "../../vendor/lobehub/store";

type CurrentUser = {
  id: string;
  name: string;
  mark: string;
};

export type RoomConversationController = {
  timelineMessages: TimelineMessage[];
  messages: UIChatMessage[];
  store: ConversationStoreApi;
  generatingMessageIds: string[];
  loading: boolean;
  submitting: boolean;
  error: UiMessageValue;
  refresh: () => void;
  mergeMessageContext: (messages: TimelineMessage[]) => void;
  sendMessage: (input: {
    markdown: string;
    replyToMessageIds?: string[];
    branchMessageId?: string;
    references?: ComposerReferenceTarget[];
    imageAttachments?: RoomMessageImageAttachment[];
  }) => boolean;
  editMessage: (input: {
    messageId: string;
    markdown: string;
    expectedRevision: number;
  }) => Promise<void>;
  deleteMessage: (input: {
    messageId: string;
    expectedRevision: number;
  }) => Promise<void>;
  regenerateAgentReply: (input: {
    messageId: string;
    expectedRevision: number;
  }) => Promise<void>;
  switchBranch: (messageId: string, branchIndex: number) => Promise<void>;
};

export function useRoomConversation(input: {
  roomId: string | null;
  currentUser: CurrentUser;
  initialMessages?: TimelineMessage[];
  services: RoomMachineServices;
}): RoomConversationController {
  const store = useMemo(() => createConversationStore({
    context: {
      surface: "room",
      id: input.roomId ?? "none",
    },
    initialMessages: projectRoomConversation(
      sortTimelineMessages(input.initialMessages ?? []),
      input.currentUser.id,
    ),
  }), [input.currentUser.id, input.roomId]);
  const messages = useStore(store, (state) => state.dbMessages);
  const generatingMessageIds = useStore(store, (state) => state.generatingMessageIds);
  const sourceRef = useRef<{
    roomId: string | null;
    timelineMessages: TimelineMessage[];
    snapshots: Readonly<Record<string, AgentTurnSnapshot>>;
  }>({
    roomId: input.roomId,
    timelineMessages: sortTimelineMessages(input.initialMessages ?? []),
    snapshots: {},
  });
  if (sourceRef.current.roomId !== input.roomId) {
    sourceRef.current = {
      roomId: input.roomId,
      timelineMessages: sortTimelineMessages(input.initialMessages ?? []),
      snapshots: {},
    };
  }
  const timelineMessages = sourceRef.current.timelineMessages;
  const setTimelineMessages = useCallback((
    update: TimelineMessage[] | ((current: TimelineMessage[]) => TimelineMessage[]),
  ) => {
    const current = sourceRef.current.timelineMessages;
    const next = typeof update === "function" ? update(current) : update;
    sourceRef.current.timelineMessages = next;
    replaceRoomStoreProjection(
      store,
      next,
      input.currentUser.id,
      sourceRef.current.snapshots,
    );
  }, [input.currentUser.id, store]);
  const setSnapshots = useCallback((
    update: Readonly<Record<string, AgentTurnSnapshot>>
      | ((current: Readonly<Record<string, AgentTurnSnapshot>>) => Readonly<Record<string, AgentTurnSnapshot>>),
  ) => {
    const current = sourceRef.current.snapshots;
    const next = typeof update === "function" ? update(current) : update;
    sourceRef.current.snapshots = next;
    replaceRoomStoreProjection(
      store,
      sourceRef.current.timelineMessages,
      input.currentUser.id,
      next,
    );
  }, [input.currentUser.id, store]);
  const [loading, setLoading] = useState(Boolean(input.roomId));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<UiMessageValue>(null);
  const requestRef = useRef(0);

  const load = useCallback(async (roomId: string) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const items = await listAllRoomMessages(input.services.listMessages, roomId);
      if (requestRef.current !== requestId) return;
      setTimelineMessages((current) => mergeLoadedMessages(current, items));
    } catch (reason) {
      if (requestRef.current === requestId) {
        setError(messageFromError(reason, "room.messagesLoadFailed"));
      }
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [input.services, setTimelineMessages]);

  useEffect(() => {
    requestRef.current += 1;
    setTimelineMessages(sortTimelineMessages(input.initialMessages ?? []));
    setSnapshots({});
    setSubmitting(false);
    setError(null);
    if (!input.roomId) {
      setLoading(false);
      return;
    }
    void load(input.roomId);
  }, [input.initialMessages, input.roomId, load, setSnapshots, setTimelineMessages]);

  useEffect(() => {
    if (!input.roomId) return;
    const roomId = input.roomId;
    const subscription = input.services.subscribeMessageEvents(
      { roomId },
      {
        onEvent: (event) => {
          setTimelineMessages((current) => reduceRoomMessageEvent(current, event));
          setError(null);
        },
        onError: (reason) => {
          setError(messageFromError(reason, "room.messageStreamDisconnected"));
        },
        onComplete: () => {
          setError(message("room.messageStreamDisconnected"));
        },
      },
    );
    return () => subscription.unsubscribe();
  }, [input.roomId, input.services, setTimelineMessages]);

  const executionIds = unique(timelineMessages.flatMap((candidate) => (
    candidate.kind === "message" && candidate.agent_turn
      ? [candidate.agent_turn.execution_id]
      : []
  )));
  const executionKey = executionIds.join("\0");

  useEffect(() => {
    if (!input.roomId) return;
    const roomId = input.roomId;
    const subscriptions = executionIds.map((executionId) => {
      let subscription: ReturnType<RoomMachineServices["watchAgentActivity"]> | null = null;
      subscription = input.services.watchAgentActivity(
        { roomId, executionId },
        {
          onEvent: (event) => {
            setSnapshots((current) => {
              const previous = current[executionId];
              if (event.type === "agent_turn.snapshot") {
                return { ...current, [executionId]: event.snapshot };
              }
              if (!previous) return current;
              return { ...current, [executionId]: reduceAgentTurnSnapshot(previous, event) };
            });
            const status = event.type === "agent_turn.snapshot"
              ? event.snapshot.status
              : event.type === "agent_turn.status"
                ? event.status
                : null;
            if (isTerminalAgentTurnStatus(status)) {
              queueMicrotask(() => subscription?.unsubscribe());
            }
          },
          onError: () => undefined,
          onComplete: () => undefined,
        },
      );
      return subscription;
    });
    return () => {
      for (const subscription of subscriptions) subscription.unsubscribe();
    };
  }, [executionKey, input.roomId, input.services]);

  const refresh = useCallback(() => {
    if (input.roomId) void load(input.roomId);
  }, [input.roomId, load]);

  const mergeMessageContext = useCallback((messages: TimelineMessage[]) => {
    setTimelineMessages((current) => mergeLoadedMessages(current, messages));
  }, []);

  const sendMessage = useCallback((request: {
    markdown: string;
    replyToMessageIds?: string[];
    branchMessageId?: string;
    references?: ComposerReferenceTarget[];
    imageAttachments?: RoomMessageImageAttachment[];
  }) => {
    const roomId = input.roomId;
    const markdown = request.markdown.trim();
    if (!roomId || (!markdown && (request.imageAttachments?.length ?? 0) === 0) || submitting) return false;
    const clientMessageId = `room-${ulid()}`;
    const optimistic = optimisticRoomMessage({
      clientMessageId,
      currentUser: input.currentUser,
      markdown,
      occurredAt: Date.now(),
      replyToMessageIds: request.replyToMessageIds,
      messages: timelineMessages,
    });
    setTimelineMessages((current) => upsertMessage(current, optimistic));
    setSubmitting(true);
    setError(null);
    void input.services.sendMessage({
      roomId,
      clientMessageId,
      markdown,
      ...(request.replyToMessageIds ? { replyToMessageIds: request.replyToMessageIds } : {}),
      ...(request.branchMessageId ? { branchMessageId: request.branchMessageId } : {}),
      ...(request.references ? { references: request.references } : {}),
      ...(request.imageAttachments ? { imageAttachments: request.imageAttachments } : {}),
    }).then((result) => {
      setTimelineMessages((current) => reconcileOptimisticMessage(
        current,
        clientMessageId,
        result.message,
      ));
    }).catch((reason) => {
      const nextError = messageFromError(reason, "room.messageSendFailed");
      setTimelineMessages((current) => markOptimisticMessageFailed(
        current,
        clientMessageId,
        nextError,
      ));
      setError(nextError);
    }).finally(() => setSubmitting(false));
    return true;
  }, [input.currentUser, input.roomId, input.services, submitting, timelineMessages]);

  const editMessage = useCallback(async (request: {
    messageId: string;
    markdown: string;
    expectedRevision: number;
  }) => {
    if (!input.roomId) return;
    setError(null);
    try {
      const edit = input.services.editMessage ?? defaultRoomMachineServices.editMessage!;
      await edit({
        roomId: input.roomId,
        messageId: request.messageId,
        markdown: request.markdown,
        expectedRevision: request.expectedRevision,
        idempotencyKey: `room-edit-${ulid()}`,
      });
      await load(input.roomId);
    } catch (reason) {
      setError(messageFromError(reason, "room.messageSendFailed"));
    }
  }, [input.roomId, input.services, load]);

  const deleteMessage = useCallback(async (request: {
    messageId: string;
    expectedRevision: number;
  }) => {
    if (!input.roomId) return;
    setError(null);
    try {
      const remove = input.services.deleteMessage ?? defaultRoomMachineServices.deleteMessage!;
      await remove({
        roomId: input.roomId,
        messageId: request.messageId,
        expectedRevision: request.expectedRevision,
        idempotencyKey: `room-delete-${ulid()}`,
      });
      await load(input.roomId);
    } catch (reason) {
      setError(messageFromError(reason, "room.messageSendFailed"));
    }
  }, [input.roomId, input.services, load]);

  const regenerateAgentReply = useCallback(async (request: {
    messageId: string;
    expectedRevision: number;
  }) => {
    if (!input.roomId) return;
    setError(null);
    try {
      const regenerate = input.services.regenerateAgentReply
        ?? defaultRoomMachineServices.regenerateAgentReply!;
      await regenerate({
        roomId: input.roomId,
        messageId: request.messageId,
        expectedRevision: request.expectedRevision,
        idempotencyKey: `room-regenerate-${ulid()}`,
      });
      await load(input.roomId);
    } catch (reason) {
      setError(messageFromError(reason, "room.messageSendFailed"));
    }
  }, [input.roomId, input.services, load]);

  const switchBranch = useCallback(async (messageId: string, branchIndex: number) => {
    const roomId = input.roomId;
    const selected = timelineMessages.find((message) => uiMessageMatches(message, messageId));
    const version = selected?.kind === "message" ? selected.agent_reply_version : undefined;
    if (!roomId || !version) return;
    const candidates = timelineMessages
      .filter((message): message is Extract<TimelineMessage, { kind: "message" }> => (
        message.kind === "message"
        && message.agent_reply_version?.group_id === version.group_id
      ))
      .sort((left, right) => (
        left.agent_reply_version!.version_number - right.agent_reply_version!.version_number
      ));
    const target = candidates[branchIndex];
    if (!target || target.agent_reply_version?.selected) return;
    setError(null);
    try {
      const selectVersion = input.services.selectAgentReplyVersion
        ?? defaultRoomMachineServices.selectAgentReplyVersion!;
      const result = await selectVersion({
        roomId,
        versionGroupId: version.group_id,
        messageId: target.id,
        expectedRevision: version.selection_revision ?? 0,
        idempotencyKey: `room-select-${ulid()}`,
      });
      setTimelineMessages((current) => applyVersionSelection(
        current,
        result.version_group_id,
        result.selected_message_id,
        result.revision,
      ));
    } catch (reason) {
      setError(messageFromError(reason, "room.messageSendFailed"));
    }
  }, [input.roomId, input.services, timelineMessages]);

  return {
    timelineMessages,
    messages,
    store,
    generatingMessageIds,
    loading,
    submitting,
    error,
    refresh,
    mergeMessageContext,
    sendMessage,
    editMessage,
    deleteMessage,
    regenerateAgentReply,
    switchBranch,
  };
}

export async function listAllRoomMessages(
  listMessages: RoomMachineServices["listMessages"],
  roomId: string,
): Promise<TimelineMessage[]> {
  const items: TimelineMessage[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const result = await listMessages({
      roomId,
      cursor,
      limit: 100,
    });
    items.push(...result.items);
    const nextCursor = result.page.next_cursor;
    if (!nextCursor || seenCursors.has(nextCursor)) {
      cursor = null;
    } else {
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }
  } while (cursor);
  return items;
}

export function reduceRoomMessageEvent(
  messages: TimelineMessage[],
  event: RoomMachineMessageEvent,
): TimelineMessage[] {
  if (event.type === "room.message.deleted") {
    return messages.filter((candidate) => candidate.id !== String(event.message_id));
  }
  if (event.type === "room.agent_reply.selection_changed") {
    const selection = event as {
      version_group_id: string;
      selected_message_id: string;
      revision: number;
    };
    return applyVersionSelection(
      messages,
      selection.version_group_id,
      selection.selected_message_id,
      selection.revision,
    );
  }
  const messageEvent = event as RoomMachineMessageEvent & { message: TimelineMessage };
  const clientMessageId = messageEvent.message.kind === "message"
    ? messageEvent.message.delivery?.client_message_id
    : undefined;
  return clientMessageId
    ? reconcileOptimisticMessage(messages, clientMessageId, messageEvent.message)
    : upsertMessage(messages, canonicalMessage(messageEvent.message));
}

function applyVersionSelection(
  messages: TimelineMessage[],
  versionGroupId: string,
  selectedMessageId: string,
  revision: number,
): TimelineMessage[] {
  return messages.map((candidate): TimelineMessage => {
    if (
      candidate.kind !== "message"
      || candidate.agent_reply_version?.group_id !== versionGroupId
    ) return candidate;
    return {
      ...candidate,
      agent_reply_version: {
        ...candidate.agent_reply_version,
        selected: candidate.id === selectedMessageId,
        selection_revision: revision,
      },
    };
  });
}

function optimisticRoomMessage(input: {
  clientMessageId: string;
  currentUser: CurrentUser;
  markdown: string;
  occurredAt: number;
  replyToMessageIds?: string[];
  messages: TimelineMessage[];
}): Extract<TimelineMessage, { kind: "message" }> {
  return {
    id: input.clientMessageId,
    kind: "message",
    occurred_at: input.occurredAt,
    sender: {
      type: "human",
      id: input.currentUser.id,
      display_name: input.currentUser.name,
      mark: input.currentUser.mark,
      avatar_resource_id: null,
    },
    body: {
      format: "inline_markdown",
      markdown: input.markdown,
      plain_text: markdownPlainText(input.markdown),
    },
    reply_to: input.replyToMessageIds?.length
      ? {
        message_ids: input.replyToMessageIds,
        preview: replyPreview(input.replyToMessageIds, input.messages),
      }
      : null,
    interactions: [],
    thread_id: null,
    delivery: {
      state: "pending",
      client_message_id: input.clientMessageId,
    },
  };
}

function replyPreview(
  messageIds: string[],
  messages: TimelineMessage[],
): string | { key: string; values?: Record<string, string | number> } {
  if (messageIds.length > 1) {
    return message("timeline.replyToMessages", { count: messageIds.length });
  }
  const replied = messages.find((candidate) => candidate.id === messageIds[0]);
  if (replied?.kind !== "message") {
    return message("timeline.replyToMessages", { count: messageIds.length });
  }
  return message("timeline.replyTo", {
    name: replied.sender.display_name,
    message: markdownPlainText(replied.body.markdown),
  });
}

function mergeLoadedMessages(
  current: TimelineMessage[],
  loaded: TimelineMessage[],
): TimelineMessage[] {
  const byId = new Map(loaded.map((candidate) => [candidate.id, canonicalMessage(candidate)]));
  for (const candidate of current) {
    const loadedCandidate = byId.get(candidate.id);
    if (candidate.kind === "message" && candidate.delivery) {
      if (!loadedCandidate) byId.set(candidate.id, candidate);
      continue;
    }
    if (!loadedCandidate || isNewerMessage(candidate, loadedCandidate)) {
      byId.set(candidate.id, candidate);
    }
  }
  return sortTimelineMessages([...byId.values()]);
}

function isNewerMessage(candidate: TimelineMessage, loaded: TimelineMessage): boolean {
  if (candidate.kind !== "message" || loaded.kind !== "message") {
    return candidate.occurred_at > loaded.occurred_at;
  }
  const candidateRevision = candidate.revision ?? 0;
  const loadedRevision = loaded.revision ?? 0;
  if (candidateRevision !== loadedRevision) return candidateRevision > loadedRevision;
  const candidateSelectionRevision = candidate.agent_reply_version?.selection_revision ?? 0;
  const loadedSelectionRevision = loaded.agent_reply_version?.selection_revision ?? 0;
  return candidateSelectionRevision > loadedSelectionRevision;
}

function reconcileOptimisticMessage(
  messages: TimelineMessage[],
  clientMessageId: string,
  message: TimelineMessage,
): TimelineMessage[] {
  const canonical = canonicalMessage(message);
  const withoutOptimistic = messages.filter((candidate) => (
    candidate.id !== clientMessageId
    && (candidate.kind === "system" || candidate.delivery?.client_message_id !== clientMessageId)
  ));
  return upsertMessage(withoutOptimistic, canonical);
}

function markOptimisticMessageFailed(
  messages: TimelineMessage[],
  clientMessageId: string,
  error: UiMessageValue,
): TimelineMessage[] {
  return messages.map((candidate) => (
    candidate.kind === "message"
    && candidate.delivery?.client_message_id === clientMessageId
      ? {
        ...candidate,
        delivery: {
          state: "error" as const,
          client_message_id: clientMessageId,
          message: error,
        },
      }
      : candidate
  ));
}

function canonicalMessage(messageValue: TimelineMessage): TimelineMessage {
  if (messageValue.kind !== "message" || !messageValue.delivery) return messageValue;
  const result = { ...messageValue };
  delete result.delivery;
  return result;
}

function upsertMessage(
  messages: TimelineMessage[],
  messageValue: TimelineMessage,
): TimelineMessage[] {
  const index = messages.findIndex((candidate) => candidate.id === messageValue.id);
  return sortTimelineMessages(index < 0
    ? [...messages, messageValue]
    : messages.map((candidate, candidateIndex) => (
      candidateIndex === index ? messageValue : candidate
    )));
}

function sortTimelineMessages(messages: TimelineMessage[]): TimelineMessage[] {
  return [...messages].sort((left, right) => {
    if (left.sequence !== undefined && right.sequence !== undefined) {
      return left.sequence - right.sequence;
    }
    return left.occurred_at - right.occurred_at || left.id.localeCompare(right.id);
  });
}

function uiMessageMatches(messageValue: TimelineMessage, uiMessageId: string): boolean {
  return messageValue.id === uiMessageId
    || `room:message:${messageValue.id}` === uiMessageId;
}

function isTerminalAgentTurnStatus(status: string | null): boolean {
  return status === "completed"
    || status === "failed"
    || status === "declined"
    || status === "interrupted";
}

function replaceRoomStoreProjection(
  store: ConversationStoreApi,
  timelineMessages: TimelineMessage[],
  currentUserId: string,
  snapshots: Readonly<Record<string, AgentTurnSnapshot>>,
): void {
  const projected = projectRoomConversation(
    timelineMessages,
    currentUserId,
    snapshots,
  );
  const state = store.getState();
  state.replaceMessages(projected);
  const next = new Set(projected.filter((candidate) => (
    candidate.metadata?.fieldsStatus === "queued"
    || candidate.metadata?.fieldsStatus === "running"
  )).map((candidate) => candidate.id));
  for (const id of state.generatingMessageIds) {
    if (!next.has(id)) store.getState().setGenerating(id, false);
  }
  for (const id of next) {
    if (!store.getState().generatingMessageIds.includes(id)) {
      store.getState().setGenerating(id, true);
    }
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
