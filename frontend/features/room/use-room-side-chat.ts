import type { AgentTurnEvent } from "@fields/contracts/public/agent-activity";
import type { HomeThreadReadResult } from "@fields/contracts/public/home";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ulid } from "ulid";
import { useStore } from "zustand";

import { backendTrpc } from "../../data/boundary/backend-trpc";
import { messageFromError, type UiMessageValue } from "../../shared/i18n/message";
import {
  projectHomeConversation,
  reduceHomeConversationEvent,
  type FieldsConversationProjection,
} from "../conversation/fields-conversation-adapter";
import {
  createConversationStore,
  type ConversationStoreApi,
} from "../../vendor/lobehub/store";

export function useRoomSideChat(input: {
  active: boolean;
  roomId: string | null;
}) {
  const roomId = input.roomId;
  const store = useMemo(() => createConversationStore({
    context: { surface: "home", id: roomId ?? "room-side-chat" },
  }), [roomId]);
  const messages = useStore(store, (state) => state.dbMessages);
  const generatingMessageIds = useStore(store, (state) => state.generatingMessageIds);
  const draft = useStore(store, (state) => state.inputMessage);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<UiMessageValue>(null);
  const sourceRef = useRef<HomeThreadReadResult | null>(null);
  const projectionRef = useRef<FieldsConversationProjection | null>(null);
  const requestRef = useRef(0);

  const read = useCallback(async () => {
    if (!roomId) return;
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await backendTrpc.roomSideChat.read.query({ room_id: roomId });
      if (requestRef.current !== request) return;
      sourceRef.current = result.thread;
      projectionRef.current = result.thread ? projectHomeConversation(result.thread) : null;
      replaceStoreProjection(store, projectionRef.current);
    } catch (reason) {
      if (requestRef.current === request) {
        setError(messageFromError(reason, "room.sideChatLoadFailed"));
      }
    } finally {
      if (requestRef.current === request) setLoading(false);
    }
  }, [roomId, store]);

  useEffect(() => {
    if (!input.active || !roomId) return;
    void read();
  }, [input.active, read, roomId]);

  useEffect(() => {
    if (!input.active || !roomId) return;
    const subscription = backendTrpc.roomSideChat.turn.events.subscribe(
      { room_id: roomId },
      {
        onData: (event) => {
          if (event.scope.type !== "home") return;
          const nextThreadId = event.scope.thread_id;
          let source = sourceRef.current;
          let projection = projectionRef.current;
          if (!source || !projection || source.selected_thread_id !== nextThreadId) {
            source = emptyThread(nextThreadId);
            projection = projectHomeConversation(source);
            sourceRef.current = source;
            projectionRef.current = projection;
          }
          const next = reduceHomeConversationEvent(projection, source, event as AgentTurnEvent);
          projectionRef.current = next;
          replaceStoreProjection(store, next);
        },
        onError: (reason) => setError(messageFromError(reason, "room.sideChatStreamFailed")),
        onComplete: () => {
          window.setTimeout(() => void read(), 100);
        },
      },
    );
    return () => subscription.unsubscribe();
  }, [input.active, read, roomId, store]);

  const send = useCallback(async (markdown: string) => {
    const prompt = markdown.trim();
    if (!roomId || !prompt || submitting) return;
    const previousDraft = draft;
    setSubmitting(true);
    setError(null);
    store.getState().updateInputMessage("");
    try {
      await backendTrpc.roomSideChat.turn.submit.mutate({
        room_id: roomId,
        prompt,
        client_message_id: `room-side-chat-${ulid()}`,
        timeout_ms: 900_000,
      });
      await read();
    } catch (reason) {
      store.getState().updateInputMessage(previousDraft);
      setError(messageFromError(reason, "room.sideChatSendFailed"));
    } finally {
      setSubmitting(false);
    }
  }, [draft, read, roomId, store, submitting]);

  return {
    messages,
    generatingMessageIds,
    store,
    draft,
    loading,
    submitting,
    error,
    onDraft: (value: string) => store.getState().updateInputMessage(value),
    onSend: (value: string) => void send(value),
  };
}

function emptyThread(threadId: string): HomeThreadReadResult {
  return {
    thread_id: threadId,
    root_thread_id: threadId,
    selected_thread_id: threadId,
    revision: 1,
    branches: [{
      thread_id: threadId,
      root_thread_id: threadId,
      source_thread_id: null,
      anchor_turn_id: null,
      kind: "root",
      selected: true,
      created_at_ms: null,
    }],
    turns: [],
  };
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
