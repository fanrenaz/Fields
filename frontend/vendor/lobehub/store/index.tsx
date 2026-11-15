import { parse } from '@lobechat/conversation-flow';
import type { UIChatMessage } from '@lobechat/types';
import { createContext, type ReactNode, useContext, useRef } from 'react';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';

export type ConversationContext = {
  surface: 'home' | 'room';
  id: string;
};

export type ConversationStore = {
  context: ConversationContext;
  dbMessages: UIChatMessage[];
  displayMessages: UIChatMessage[];
  inputMessage: string;
  generatingMessageIds: string[];
  editingMessageId: string | null;
  replaceMessages: (messages: UIChatMessage[]) => void;
  upsertMessage: (message: UIChatMessage) => void;
  removeMessage: (messageId: string) => void;
  appendMessageText: (messageId: string, delta: string) => void;
  setGenerating: (messageId: string, generating: boolean) => void;
  setEditingMessage: (messageId: string | null) => void;
  updateInputMessage: (value: string) => void;
  setBranchSwitchHandler: (
    handler: ConversationStoreOptions['onBranchSwitch'],
  ) => void;
  switchMessageBranch: (messageId: string, branchIndex: number) => Promise<void>;
};

export type ConversationStoreApi = StoreApi<ConversationStore>;

export type ConversationStoreOptions = {
  context: ConversationContext;
  initialMessages?: UIChatMessage[];
  onBranchSwitch?: (messageId: string, branchIndex: number) => Promise<void> | void;
};

function parsed(messages: UIChatMessage[]): UIChatMessage[] {
  return parse(messages).flatList;
}

export function createConversationStore(
  options: ConversationStoreOptions,
): StoreApi<ConversationStore> {
  const initialMessages = options.initialMessages ?? [];
  let onBranchSwitch = options.onBranchSwitch;
  return createStore<ConversationStore>((set, get) => ({
    context: options.context,
    dbMessages: initialMessages,
    displayMessages: parsed(initialMessages),
    inputMessage: '',
    generatingMessageIds: [],
    editingMessageId: null,
    replaceMessages: (messages) => set((state) => ({
      dbMessages: messages,
      displayMessages: parsed(messages),
      editingMessageId: messages.some((message) => message.id === state.editingMessageId)
        ? state.editingMessageId
        : null,
    })),
    upsertMessage: (message) => {
      const current = get().dbMessages;
      const index = current.findIndex((candidate) => candidate.id === message.id);
      const next = index < 0
        ? [...current, message]
        : current.map((candidate, candidateIndex) => (
          candidateIndex === index ? message : candidate
        ));
      set({ dbMessages: next, displayMessages: parsed(next) });
    },
    removeMessage: (messageId) => {
      const next = get().dbMessages.filter((message) => message.id !== messageId);
      set((state) => ({
        dbMessages: next,
        displayMessages: parsed(next),
        editingMessageId: state.editingMessageId === messageId
          ? null
          : state.editingMessageId,
      }));
    },
    appendMessageText: (messageId, delta) => {
      const next = get().dbMessages.map((message) => (
        message.id === messageId
          ? { ...message, content: message.content + delta, updatedAt: Date.now() }
          : message
      ));
      set({ dbMessages: next, displayMessages: parsed(next) });
    },
    setGenerating: (messageId, generating) => set((state) => ({
      generatingMessageIds: generating
        ? [...new Set([...state.generatingMessageIds, messageId])]
        : state.generatingMessageIds.filter((id) => id !== messageId),
    })),
    setEditingMessage: (editingMessageId) => set({ editingMessageId }),
    updateInputMessage: (inputMessage) => set({ inputMessage }),
    setBranchSwitchHandler: (handler) => {
      onBranchSwitch = handler;
    },
    switchMessageBranch: async (messageId, branchIndex) => {
      await onBranchSwitch?.(messageId, branchIndex);
      const current = get().dbMessages;
      const message = current.find((candidate) => candidate.id === messageId);
      if (!message?.parentId) return;
      const next = current.map((candidate) => (
        candidate.id === message.parentId
          ? {
            ...candidate,
            metadata: { ...candidate.metadata, activeBranchIndex: branchIndex },
            updatedAt: Date.now(),
          }
          : candidate
      ));
      set({ dbMessages: next, displayMessages: parsed(next) });
    },
  }));
}

const ConversationStoreContext = createContext<StoreApi<ConversationStore> | null>(null);

export function ConversationProvider({
  children,
  options,
  store,
}: {
  children: ReactNode;
  options: ConversationStoreOptions;
  store?: ConversationStoreApi;
}) {
  const storeRef = useRef<StoreApi<ConversationStore> | null>(null);
  if (storeRef.current === null) {
    storeRef.current = createConversationStore(options);
  }
  return (
    <ConversationStoreContext.Provider value={store ?? storeRef.current}>
      {children}
    </ConversationStoreContext.Provider>
  );
}

export function useConversationStore<T>(
  selector: (state: ConversationStore) => T,
): T {
  const store = useContext(ConversationStoreContext);
  if (!store) throw new Error('ConversationProvider is missing.');
  return useStore(store, selector);
}

export function useConversationStoreApi(): StoreApi<ConversationStore> {
  const store = useContext(ConversationStoreContext);
  if (!store) throw new Error('ConversationProvider is missing.');
  return store;
}
