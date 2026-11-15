import { useCallback, useEffect, useMemo, useState } from "react";
import { useMachine } from "@xstate/react";
import { useTranslation } from "react-i18next";
import { ulid } from "ulid";
import type { UIChatMessage } from "@lobechat/types";
import type { RoomMessageImageAttachment } from "@fields/contracts/public/room";
import type { SearchResultItem } from "@fields/contracts/public/search";
import type { UiMessageValue } from "../../shared/i18n/message";

import { memberToMention } from "../../shared/ui/semantic-text";
import type { ComposerMention } from "../conversation/Composer";
import type { ComposerReferenceOption } from "../../shared/types/composer";
import type { ProfileMember } from "../../shared/types/member";
import type { SourceRouteNotice, TimelineMessage } from "../../shared/types/timeline";
import {
  activeScopedState,
  roomMachine,
  roomReferenceTargetKey,
  type RoomFixtureContextItem,
  type RoomFixtureMemory,
  type RoomFixtureResource,
  type RoomMachineFixture,
  type RoomOverlay,
  type RoomReplySelectionMessage,
  type RoomWorkspace,
} from "./room-machine";
import {
  defaultRoomMachineServices,
  type RoomMachineServices,
  type RoomSummary,
} from "../../data/room/room-machine-services";
import { useRoomConversation } from "../conversation/use-room-conversation";
import { markdownPlainText } from "../conversation/markdown-plain-text";
import { parseComposerReferenceLink } from "../conversation/editor-markdown";
import { canManageRoomMembers } from "./room-member-candidates";
import { roomMessageReferences } from "./room-mention-references";
import type { ConversationStoreApi } from "../../vendor/lobehub/store";
import { backendTrpc } from "../../data/boundary/backend-trpc";

export type RoomRecord = {
  id: string;
  title: string;
  subtitle: string;
  status: string;
  updatedAtMs: number;
  unreadCount: number;
  readThrough: string | null;
};

export type RoomLeftPanelTab = "members";
export type RoomRightPanelTab = "sideChat";

type RoomPanelTabItem = {
  value: RoomLeftPanelTab;
  label: string;
  disabled?: boolean;
};

type RoomPanelTabsController = {
  value: RoomLeftPanelTab;
  items: RoomPanelTabItem[];
  onValueChange: (value: string) => void;
};

type RoomRightPanelTabsController = {
  value: RoomRightPanelTab;
  items: Array<{ value: RoomRightPanelTab; label: string }>;
  onValueChange: (value: string) => void;
};

export type RoomController = {
  rooms: {
    activeId: string | null;
    hasMore: boolean;
    items: Array<RoomRecord & { active: boolean }>;
    loading: boolean;
    error: UiMessageValue;
    select: (roomId: string) => void;
    refresh: () => void;
    loadMore: () => void;
    search: (searchTerm: string) => void;
  };
  leftPanel: {
    isOpen: boolean;
    open: () => void;
    close: () => void;
    tabs: RoomPanelTabsController;
    members: {
      roomId: string | null;
      items: ProfileMember[];
      loading: boolean;
      error: UiMessageValue;
      canManage: boolean;
      adding: boolean;
      refresh: () => void;
      add: (actorId: string, actorType: "human" | "agent") => void;
      remove: (member: ProfileMember) => void;
      openAdd: () => void;
      closeAdd: () => void;
    };
  };
  timeline: {
    messages: TimelineMessage[];
    conversationMessages: UIChatMessage[];
    conversationStore: ConversationStoreApi;
    conversationGeneratingMessageIds: string[];
    currentUser: { name: string; mark: string };
    mentions: ComposerMention[];
    profileMemberForIdentity: (identity: { id: string; name: string; mark: string; kind?: "human" | "agent" }) => ProfileMember;
    scrollToLatestSignal: number;
    scrollToMessageSignal: { id: string; nonce: number } | null;
    highlighted: string | null;
    sourceNotice: SourceRouteNotice;
    onOpenDrawer: (messageId: string) => void;
    onInlineLink: (url: string) => void;
    onOpenProfile: (member: ProfileMember) => void;
    onReply: (messageIds: string[]) => void;
    replySelectionMode: boolean;
    selectedReplyIds: string[];
    onEnterReplySelection: (message: RoomReplySelectionMessage) => void;
    onToggleReplySelection: (message: RoomReplySelectionMessage) => void;
    onConfirmReplySelection: () => void;
    onCancelReplySelection: () => void;
    onRespondToInteraction: (messageId: string, interactionId: string, response: import("@fields/contracts/public/room").RoomInteractionRespondInput["response"]) => void;
    onRespondToQuestion: (messageId: string, interactionId: string, answers: Record<string, string[]>, resolution: "answered" | "dismissed" | "timed_out") => Promise<void>;
    onSnoozeInteraction: (messageId: string, interactionId: string) => void;
    interactionDisabled: boolean;
    pendingInteractionIds: string[];
    interactionError: UiMessageValue;
    loading: boolean;
    error: UiMessageValue;
    repairing: boolean;
    onRetry: () => void;
    openSearchMessage: (roomId: string, messageId: string) => Promise<void>;
    onConversationEdit: (message: UIChatMessage) => void;
    onConversationDelete: (message: UIChatMessage) => void;
    onConversationRegenerate: (message: UIChatMessage) => void;
    onConversationBranchSwitch: (messageId: string, branchIndex: number) => Promise<void>;
  };
  composer: {
    roomId: string | null;
    draft: string;
    replyAnchor: string | null;
    referenceOptions: ComposerReferenceOption[];
    mentionOptions: ComposerMention[];
    pendingReferenceInsertion: { id: number; reference: ComposerReferenceOption } | null;
    onDraft: (draft: string) => void;
    onClearReply: () => void;
    onSearch: () => void;
    canAddSearchResult: (item: SearchResultItem) => boolean;
    onAddSearchResult: (item: SearchResultItem) => boolean;
    onReferenceInserted: (id: number) => void;
    onSend: (markdown: string, imageAttachments?: RoomMessageImageAttachment[]) => boolean;
    sendDisabled: boolean;
    showMentionButton: boolean;
    statusMessage: string | null;
    error: UiMessageValue;
    referencesForDraft: (markdown: string) => ReturnType<typeof roomMessageReferences>;
    replyToMessageIds: string[];
  };
  rightPanel: {
    isOpen: boolean;
    open: () => void;
    close: () => void;
    tabs: RoomRightPanelTabsController;
  };
  overlay: {
    kind: RoomOverlay;
    openSearch: () => void;
    openReferenceSearch: () => void;
    close: () => void;
  };
};

export type UseRoomMachineOptions = {
  actorId: string;
  displayName: string;
  fixture?: RoomMachineFixture;
  initialRoomId?: string;
  services?: RoomMachineServices;
  workspaces?: RoomWorkspace[];
};

export function useRoomMachine(options: UseRoomMachineOptions): RoomController {
  const { t } = useTranslation();
  const currentUser = useMemo(
    () => currentUserFromSession(options.actorId, options.displayName),
    [options.actorId, options.displayName],
  );
  const [snapshot, send] = useMachine(roomMachine, {
    input: {
      fixture: options.fixture,
      initialRoomId: options.initialRoomId,
      services: options.services,
      currentUser,
      workspaces: options.workspaces,
    },
  });
  const context = snapshot.context;
  const [pendingReferenceInsertion, setPendingReferenceInsertion] = useState<{
    id: number;
    reference: ComposerReferenceOption;
  } | null>(null);
  const fixture = context.fixture;
  const scopedState = activeScopedState(context);
  const scopedDraft = scopedState.draft;
  const activeRoomKey = context.activeRoomId ?? "";
  const leftPanelMembersActive = snapshot.matches({ workspace: { active: { leftPanel: "members" } } });
  const leftPanelOpen = leftPanelMembersActive;
  const leftPanelTab: RoomLeftPanelTab = "members";
  const rightPanelOpen = snapshot.matches({ workspace: { active: { rightPanel: "sideChat" } } });
  const rightPanelTab: RoomRightPanelTab = "sideChat";
  const addingMembers = snapshot.matches({ workspace: { active: { leftPanel: { members: "adding" } } } });
  const activeDirectoryRoom = context.activeRoomId
    ? context.rooms.find((room) => room.id === context.activeRoomId) ?? null
    : null;
  const activeRoom = activeDirectoryRoom ? roomRecord(activeDirectoryRoom) : emptyRoomRecord();
  const members = context.membersByRoomId[activeRoomKey] ?? [];
  const membersLoading = snapshot.matches({ workspace: { active: { members: "loading" } } });
  const membersError = context.membersErrorByRoomId[activeRoomKey] ?? null;
  const canManageMembers = canManageRoomMembers(options.actorId, members);
  const resources: RoomFixtureResource[] = [];
  const memories: RoomFixtureMemory[] = [];
  const contextItems: RoomFixtureContextItem[] = [];
  const [companyFileOptions, setCompanyFileOptions] = useState<ComposerReferenceOption[]>([]);
  useEffect(() => {
    const roomId = context.activeRoomId;
    if (!roomId) {
      setCompanyFileOptions([]);
      return;
    }
    let cancelled = false;
    void backendTrpc.company.files.list.query({ folder_id: null, recursive: true }).then((root) => {
      if (cancelled) return;
      setCompanyFileOptions(root.files.map((file) => ({
        label: file.name,
        target: {
          type: "file" as const,
          id: file.file_id,
          version_id: file.current_version.version_id,
          room_id: roomId,
        },
      })));
    }).catch(() => {
      if (!cancelled) setCompanyFileOptions([]);
    });
    return () => {
      cancelled = true;
    };
  }, [context.activeRoomId]);
  const initialConversationMessages = useMemo(
    () => context.activeRoomId
      ? fixture.conversationSeedsByRoomId[context.activeRoomId] ?? []
      : [],
    [context.activeRoomId, fixture.conversationSeedsByRoomId],
  );
  const roomConversation = useRoomConversation({
    roomId: context.activeRoomId,
    currentUser,
    initialMessages: initialConversationMessages,
    services: context.services,
  });
  const messages = roomConversation.timelineMessages;
  const conversationMessages = roomConversation.messages;
  const messagesLoading = roomConversation.loading;
  const messagesError = roomConversation.error;
  const composerSendDisabled = roomConversation.submitting
    || messagesLoading
    || Boolean(messagesError);
  const references = useMemo(
    () => [
      ...roomReferenceOptions(context.activeRoomId ?? activeRoom.id, activeRoom, members, resources, memories, contextItems),
      ...companyFileOptions,
    ],
    [activeRoom, companyFileOptions, context.activeRoomId, contextItems, memories, members, resources],
  );
  const replySelectionMode = context.replySelection.active;
  const selectedReplyIds = context.replySelection.selectedMessages.map((message) => message.id);
  const mentions = useMemo(() => members.map(memberToMention), [members]);
  const rooms: Array<RoomRecord & { active: boolean }> = context.rooms.map((room) => ({
    ...roomRecord(room),
    active: room.id === context.activeRoomId,
  }));
  const selectRoom = useCallback((roomId: string) => send({ type: "ROOM_SELECTED", roomId }), [send]);
  const refreshRooms = useCallback(() => send({ type: "ROOMS_REFRESH_REQUESTED" }), [send]);
  const loadMoreRooms = useCallback(() => send({ type: "ROOMS_LOAD_MORE_REQUESTED" }), [send]);
  const searchRooms = useCallback((searchTerm: string) => send({ type: "ROOMS_SEARCH_REQUESTED", searchTerm }), [send]);
  const openLeft = useCallback(() => send({ type: "LEFT_PANEL_OPENED" }), [send]);
  const closeLeft = useCallback(() => send({ type: "LEFT_PANEL_CLOSED" }), [send]);
  const openRight = useCallback(() => send({ type: "RIGHT_PANEL_OPENED" }), [send]);
  const closeRight = useCallback(() => send({ type: "RIGHT_PANEL_CLOSED" }), [send]);
  const openSearch = useCallback(() => send({ type: "OVERLAY_OPENED", overlay: "search" }), [send]);
  const openReferenceSearch = useCallback(
    () => send({ type: "OVERLAY_OPENED", overlay: "reference-search" }),
    [send],
  );
  const closeOverlay = useCallback(() => send({ type: "OVERLAY_CLOSED" }), [send]);
  const setDraft = useCallback((draft: string) => send({ type: "DRAFT_CHANGED", draft }), [send]);
  const sendDraft = useCallback((markdown: string, imageAttachments: RoomMessageImageAttachment[] = []) => {
    if (!markdown.trim() && imageAttachments.length === 0) return false;
    const roomId = context.activeRoomId ?? activeRoom.id;
    const accepted = roomConversation.sendMessage({
      markdown,
      replyToMessageIds: scopedDraft.replyAnchor?.messageIds,
      branchMessageId: latestSelectedRoomBranchMessageId(messages),
      references: roomMessageReferences({
        markdown,
        memberIds: members.map((member) => member.member_id),
        roomId,
      }),
      imageAttachments,
    });
    if (accepted) send({ type: "DRAFT_SENT" });
    return accepted;
  }, [
    activeRoom.id,
    context.activeRoomId,
    members,
    messages,
    roomConversation,
    scopedDraft.replyAnchor?.messageIds,
    send,
  ]);
  const clearReply = useCallback(() => send({ type: "REPLY_ANCHOR_CLEARED" }), [send]);
  const queueReferenceInsertion = useCallback((reference: ComposerReferenceOption) => {
    setPendingReferenceInsertion((current) => ({
      id: (current?.id ?? 0) + 1,
      reference,
    }));
  }, []);
  const searchResultReference = useCallback((item: SearchResultItem) => (
    composerReferenceForSearchResult(item, references, context.activeRoomId)
  ), [context.activeRoomId, references]);
  const canAddSearchResult = useCallback(
    (item: SearchResultItem) => searchResultReference(item) !== null,
    [searchResultReference],
  );
  const addSearchResult = useCallback((item: SearchResultItem) => {
    const reference = searchResultReference(item);
    if (!reference) return false;
    queueReferenceInsertion(reference);
    return true;
  }, [queueReferenceInsertion, searchResultReference]);
  const referenceInserted = useCallback((id: number) => {
    setPendingReferenceInsertion((current) => current?.id === id ? null : current);
  }, []);
  const openSearchMessage = useCallback(async (roomId: string, messageId: string) => {
    const readMessageContext = context.services.readMessageContext
      ?? defaultRoomMachineServices.readMessageContext;
    if (!readMessageContext) return;
    try {
      const result = await readMessageContext({ roomId, messageId });
      roomConversation.mergeMessageContext(result.items);
      send({ type: "TIMELINE_MESSAGE_HIGHLIGHTED", messageId });
      send({ type: "TIMELINE_MESSAGE_SCROLL_REQUESTED", messageId });
    } catch {
      // A stale search hit must not make the selected Room unusable.
    }
  }, [context.services, roomConversation, send]);
  const addMember = useCallback((actorId: string, actorType: "human" | "agent") => {
    const trimmed = actorId.trim();
    if (trimmed && context.activeRoomId) send({
      type: "ROOM_MEMBER_ADD_REQUESTED",
      actorId: trimmed,
      actorType,
    });
  }, [context.activeRoomId, send]);
  const removeMember = useCallback((member: ProfileMember) => {
    if (member.member_id && context.activeRoomId) send({ type: "ROOM_MEMBER_REMOVE_REQUESTED", actorId: member.member_id });
  }, [context.activeRoomId, send]);
  const refreshMembers = useCallback(() => {
    if (context.activeRoomId) send({ type: "ROOM_MEMBERS_REFRESH_REQUESTED" });
  }, [context.activeRoomId, send]);
  const openAddMembers = useCallback(() => send({ type: "ROOM_MEMBER_ADD_OPENED" }), [send]);
  const closeAddMembers = useCallback(() => send({ type: "ROOM_MEMBER_ADD_CLOSED" }), [send]);
  const selectLeftPanelTab = useCallback((value: string) => {
    if (!isRoomLeftPanelTab(value)) return;
    send({ type: "LEFT_PANEL_TAB_SELECTED", tab: value });
  }, [send]);
  const leftPanelTabs = useMemo<RoomPanelTabsController>(() => ({
    value: leftPanelTab,
    items: [{ value: "members", label: t("shell.members") }],
    onValueChange: selectLeftPanelTab,
  }), [leftPanelTab, selectLeftPanelTab, t]);
  const rightPanelTabs = useMemo<RoomRightPanelTabsController>(() => ({
    value: rightPanelTab,
    items: [{ value: "sideChat", label: t("room.sideChat") }],
    onValueChange: () => undefined,
  }), [rightPanelTab, t]);
  const noop = useCallback(() => undefined, []);
  const replyTo = useCallback((messageIds: string[]) => {
    send({ type: "REPLY_ANCHOR_SET", messageIds });
    const draftWithMention = replySenderMentionDraft(
      scopedDraft.draft,
      messageIds,
      messages,
      members,
    );
    if (draftWithMention !== null) {
      send({ type: "DRAFT_CHANGED", draft: draftWithMention });
    }
  }, [members, messages, scopedDraft.draft, send]);
  const enterReplySelection = useCallback((message: RoomReplySelectionMessage) => {
    send({ type: "REPLY_SELECTION_ENTERED", message });
  }, [send]);
  const toggleReplySelection = useCallback((message: RoomReplySelectionMessage) => {
    send({ type: "REPLY_SELECTION_TOGGLED", message });
  }, [send]);
  const confirmReplySelection = useCallback(() => {
    send({ type: "REPLY_SELECTION_CONFIRMED" });
    const draftWithMention = replySenderMentionDraft(
      scopedDraft.draft,
      selectedReplyIds,
      messages,
      members,
    );
    if (draftWithMention !== null) {
      send({ type: "DRAFT_CHANGED", draft: draftWithMention });
    }
  }, [members, messages, scopedDraft.draft, selectedReplyIds, send]);
  const cancelReplySelection = useCallback(() => send({ type: "REPLY_SELECTION_CANCELLED" }), [send]);
  const respondToInteraction = useCallback((messageId: string, interactionId: string, response: import("@fields/contracts/public/room").RoomInteractionRespondInput["response"]) => {
    send({ type: "INTERACTION_RESPONSE_REQUESTED", messageId, interactionId, response });
  }, [send]);
  const snoozeInteraction = useCallback((messageId: string, interactionId: string) => {
    if (!context.activeRoomId) return;
    const request = context.services.snoozeInteraction?.({
      roomId: context.activeRoomId,
      messageId,
      interactionId,
    });
    if (request) void request.catch(() => undefined);
  }, [context.activeRoomId, context.services]);
  const respondToQuestion = useCallback(async (
    messageId: string,
    interactionId: string,
    answers: Record<string, string[]>,
    resolution: "answered" | "dismissed" | "timed_out",
  ) => {
    if (!context.activeRoomId) throw new Error("Room is unavailable.");
    const result = await context.services.respondToInteraction({
      roomId: context.activeRoomId,
      messageId,
      interactionId,
      response: { answers, resolution },
      clientResponseId: `room-question-${ulid()}`,
    });
    roomConversation.mergeMessageContext([result.message]);
  }, [context.activeRoomId, context.services, roomConversation]);
  const retryMessages = useCallback(() => {
    roomConversation.refresh();
  }, [roomConversation]);
  const editConversationMessage = useCallback((selected: UIChatMessage) => {
    const roomId = context.activeRoomId;
    const original = roomMessageForUi(messages, selected);
    if (
      !roomId
      || original?.kind !== "message"
      || original.sender.id !== options.actorId
      || typeof original.revision !== "number"
    ) return;
    const markdown = window.prompt(t("common.edit"), original.body.markdown);
    if (markdown === null || !markdown.trim() || markdown === original.body.markdown) return;
    void roomConversation.editMessage({
      messageId: original.id,
      markdown: markdown.trim(),
      expectedRevision: original.revision,
    });
  }, [context.activeRoomId, messages, options.actorId, roomConversation, t]);
  const deleteConversationMessage = useCallback((selected: UIChatMessage) => {
    const roomId = context.activeRoomId;
    const original = roomMessageForUi(messages, selected);
    if (
      !roomId
      || original?.kind !== "message"
      || original.sender.id !== options.actorId
      || typeof original.revision !== "number"
      || !window.confirm(t("common.delete"))
    ) return;
    void roomConversation.deleteMessage({
      messageId: original.id,
      expectedRevision: original.revision,
    });
  }, [context.activeRoomId, messages, options.actorId, roomConversation, t]);
  const regenerateConversationMessage = useCallback((selected: UIChatMessage) => {
    const roomId = context.activeRoomId;
    const original = roomMessageForUi(messages, selected);
    if (
      !roomId
      || original?.kind !== "message"
      || original.sender.type !== "agent"
      || typeof original.revision !== "number"
    ) return;
    void roomConversation.regenerateAgentReply({
      messageId: original.id,
      expectedRevision: original.revision,
    });
  }, [context.activeRoomId, messages, roomConversation]);
  const switchConversationBranch = useCallback(async (messageId: string, branchIndex: number) => {
    await roomConversation.switchBranch(messageId, branchIndex);
  }, [roomConversation]);
  const openInlineLink = useCallback((url: string) => {
    if (url.startsWith("fields://member/")) {
      return;
    }
    const parsed = parseComposerReferenceLink("", url);
    const reference = parsed
      ? references.find((candidate) => (
        roomReferenceTargetKey(candidate.target) === roomReferenceTargetKey(parsed.target)
      ))
      : null;
    if (reference) {
      queueReferenceInsertion(reference);
      return;
    }
    const legacyResourceId = url.replace("fields://resource/", "");
    const legacyResource = resources.find((item) => item.id === legacyResourceId);
    if (legacyResource) queueReferenceInsertion(resourceReference(legacyResource));
  }, [queueReferenceInsertion, references, resources]);

  return {
    rooms: {
      activeId: context.activeRoomId,
      hasMore: context.roomsNextCursor !== null,
      items: rooms,
      loading: context.roomsLoading,
      error: context.roomsError,
      select: selectRoom,
      refresh: refreshRooms,
      loadMore: loadMoreRooms,
      search: searchRooms,
    },
    overlay: {
      kind: context.overlay,
      openSearch,
      openReferenceSearch,
      close: closeOverlay,
    },
    leftPanel: {
      isOpen: leftPanelOpen,
      open: openLeft,
      close: closeLeft,
      tabs: leftPanelTabs,
      members: {
        roomId: context.activeRoomId,
        items: members,
        loading: membersLoading,
        error: membersError,
        canManage: canManageMembers,
        adding: addingMembers,
        refresh: refreshMembers,
        add: addMember,
        remove: removeMember,
        openAdd: openAddMembers,
        closeAdd: closeAddMembers,
      },
    },
    timeline: {
      messages,
      conversationMessages,
      conversationStore: roomConversation.store,
      conversationGeneratingMessageIds: roomConversation.generatingMessageIds,
      currentUser,
      mentions,
      profileMemberForIdentity: (identity) => memberByIdOrMark(members, identity.id) ?? {
        member_id: identity.id,
        name: identity.name,
        mark: identity.mark,
        role: identity.kind === "agent" ? t("timeline.agent") : t("account.member"),
        meta: activeRoom.title,
        joined_at_ms: 0,
        actor_type: identity.kind === "agent" ? "agent" : "human",
        membership_version: 0,
        agent: identity.kind === "agent",
      },
      scrollToLatestSignal: context.scrollToLatestSignal,
      scrollToMessageSignal: context.scrollToMessageSignal,
      highlighted: context.highlightedMessageId,
      sourceNotice: fixture.sourceNotice,
      onOpenDrawer: noop,
      onInlineLink: openInlineLink,
      onOpenProfile: noop,
      onReply: replyTo,
      replySelectionMode,
      selectedReplyIds,
      onEnterReplySelection: enterReplySelection,
      onToggleReplySelection: toggleReplySelection,
      onConfirmReplySelection: confirmReplySelection,
      onCancelReplySelection: cancelReplySelection,
      onRespondToInteraction: respondToInteraction,
      onRespondToQuestion: respondToQuestion,
      onSnoozeInteraction: snoozeInteraction,
      interactionDisabled: false,
      pendingInteractionIds: Object.keys(context.pendingInteractions),
      interactionError: context.interactionError?.message ?? null,
      loading: messagesLoading,
      error: messagesError,
      repairing: false,
      onRetry: retryMessages,
      openSearchMessage,
      onConversationEdit: editConversationMessage,
      onConversationDelete: deleteConversationMessage,
      onConversationRegenerate: regenerateConversationMessage,
      onConversationBranchSwitch: switchConversationBranch,
    },
    composer: {
      roomId: context.activeRoomId,
      draft: scopedDraft.draft,
      replyAnchor: replyAnchorLabel(scopedDraft.replyAnchor?.messageIds ?? [], messages, t),
      referenceOptions: references,
      mentionOptions: mentions,
      pendingReferenceInsertion,
      onDraft: setDraft,
      onClearReply: clearReply,
      onSearch: openReferenceSearch,
      canAddSearchResult,
      onAddSearchResult: addSearchResult,
      onReferenceInserted: referenceInserted,
      onSend: sendDraft,
      sendDisabled: composerSendDisabled,
      showMentionButton: true,
      statusMessage: null,
      error: messagesError,
      referencesForDraft: (markdown) => roomMessageReferences({
        markdown,
        memberIds: members.map((member) => member.member_id),
        roomId: context.activeRoomId ?? activeRoom.id,
      }),
      replyToMessageIds: scopedDraft.replyAnchor?.messageIds ?? [],
    },
    rightPanel: {
      isOpen: rightPanelOpen,
      open: openRight,
      close: closeRight,
      tabs: rightPanelTabs,
    },
  };
}

export function composerReferenceForSearchResult(
  item: SearchResultItem,
  availableReferences: readonly ComposerReferenceOption[],
  activeRoomId: string | null,
): ComposerReferenceOption | null {
  if (!activeRoomId) return null;
  if (item.kind === "room") {
    return { label: item.title, target: { type: "room", id: item.room_id } };
  }
  if (item.kind === "message") {
    return {
      label: `${item.sender_display_name} · ${item.room_title}`,
      target: { type: "message", room_id: item.room_id, message_id: item.message_id },
    };
  }
  if (item.kind === "member") {
    return availableReferences.find((reference) => (
      reference.target.type === "member" && reference.target.id === item.actor_id
    )) ?? null;
  }
  if (item.kind === "file" && item.source.type === "company" && !item.is_folder && item.file_id) {
    return availableReferences.find((reference) => (
      reference.target.type === "file" && reference.target.id === item.file_id
    )) ?? null;
  }
  return null;
}

function replyAnchorLabel(
  messageIds: readonly string[],
  messages: readonly TimelineMessage[],
  t: (key: string, options?: Record<string, string | number>) => string,
): string | null {
  if (messageIds.length === 0) return null;
  if (messageIds.length > 1) return t("timeline.replyToMessages", { count: messageIds.length });
  const message = messages.find((candidate) => candidate.id === messageIds[0]);
  if (message?.kind !== "message") return t("timeline.replyToMessages", { count: messageIds.length });
  return t("timeline.replyTo", {
    name: message.sender.display_name,
    message: markdownPlainText(message.body.markdown),
  });
}

function roomRecord(room: RoomSummary): RoomRecord {
  return {
    id: room.id,
    title: room.title,
    subtitle: room.subtitle ?? "",
    status: room.status,
    updatedAtMs: room.updatedAtMs ?? 0,
    unreadCount: room.unreadCount ?? 0,
    readThrough: room.readThrough ?? null,
  };
}

function emptyRoomRecord(): RoomRecord {
  return {
    id: "",
    title: "",
    subtitle: "",
    status: "",
    updatedAtMs: 0,
    unreadCount: 0,
    readThrough: null,
  };
}

function currentUserFromSession(actorId: string, displayName: string): { id: string; name: string; mark: string } {
  return {
    id: actorId,
    name: displayName,
    mark: shortActorMark(displayName || actorId),
  };
}

function shortActorMark(actorId: string): string {
  const parts = actorId
    .split(/[^A-Za-z0-9]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const mark = parts.length > 1
    ? parts.slice(0, 2).map((part) => part[0]).join("")
    : (parts[0] ?? actorId).replace(/[^A-Za-z0-9]/g, "").slice(0, 2);
  return mark.length > 0 ? mark.toUpperCase() : actorHashMark(actorId);
}

function actorHashMark(actorId: string): string {
  let hash = 0;
  for (const char of actorId) {
    hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36).toUpperCase().slice(0, 2) || "0";
}

function roomReferenceOptions(
  roomId: string,
  activeRoom: RoomRecord,
  members: ProfileMember[],
  resources: RoomFixtureResource[],
  memories: RoomFixtureMemory[],
  contextItems: RoomFixtureContextItem[],
): ComposerReferenceOption[] {
  return [
    { label: activeRoom.title, target: { type: "room", id: activeRoom.id } },
    ...members.map((member) => ({ label: member.name, target: { type: "member" as const, id: member.member_id, room_id: roomId } })),
    ...resources.map(resourceReference),
    ...memories.map((memory) => ({ label: memory.title, target: { type: "memory" as const, id: memory.id, room_id: memory.room_id } })),
    ...contextItems.map((item) => ({ label: item.title, target: { type: "context" as const, room_id: item.room_id, tab: item.tab } })),
  ];
}

function resourceReference(resource: RoomFixtureResource): ComposerReferenceOption {
  return {
    label: resource.title,
    target: { type: "resource", id: resource.id, room_id: resource.room_id },
  };
}

function memberByIdOrMark(members: ProfileMember[], idOrMark: string | null): ProfileMember | null {
  if (!idOrMark) return null;
  return members.find((member) => member.member_id === idOrMark || member.mark === idOrMark || member.name === idOrMark) ?? null;
}

function replySenderMentionDraft(
  draft: string,
  messageIds: string[],
  messages: TimelineMessage[],
  members: ProfileMember[],
): string | null {
  if (messageIds.length !== 1) return null;
  const message = messages.find((item) => item.id === messageIds[0]);
  if (!message || message.kind !== "message") return null;

  const sender = memberByIdOrMark(members, message.sender.id)
    ?? memberByIdOrMark(members, message.sender.mark)
    ?? memberByIdOrMark(members, message.sender.display_name);
  if (!sender?.member_id) return null;

  const mentionUrl = `fields://member/${sender.member_id}`;
  if (draft.includes(`](${mentionUrl})`)) return null;

  const mention = memberToMention(sender);
  const mentionMarkdown = `[@${mention.label}](${mentionUrl})`;
  return draft.length > 0 ? `${mentionMarkdown} ${draft}` : `${mentionMarkdown} `;
}

function isRoomLeftPanelTab(value: string): value is RoomLeftPanelTab {
  return value === "members";
}

function latestSelectedRoomBranchMessageId(messages: readonly TimelineMessage[]): string | undefined {
  return [...messages].reverse().find((message) => (
    message.kind === "message"
    && message.sender.type === "agent"
    && message.agent_reply_version?.selected === true
  ))?.id;
}

function roomMessageForUi(
  messages: readonly TimelineMessage[],
  selected: UIChatMessage | undefined,
): TimelineMessage | undefined {
  const metadataId = selected?.metadata?.fieldsRoomMessageId;
  const messageId = typeof metadataId === "string"
    ? metadataId
    : selected?.id.replace(/^room:message:/u, "");
  return messages.find((message) => message.id === messageId);
}
