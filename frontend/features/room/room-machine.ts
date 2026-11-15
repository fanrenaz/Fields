import { assign, enqueueActions, fromCallback, sendTo, setup } from "xstate";
import {
  defaultRoomMachineServices,
  type RoomMachineServices,
  type RoomSummary,
} from "../../data/room/room-machine-services";
import type { ComposerReferenceOption, ComposerReferenceTarget } from "../../shared/types/composer";
import { messageFromError, type UiMessageValue } from "../../shared/i18n/message";
import type { ProfileMember } from "../../shared/types/member";
import type { SourceRouteNotice, TimelineMessage } from "../../shared/types/timeline";
import { canManageRoomMembers } from "./room-member-candidates";

export type RoomLeftMode = "context" | "resources" | "memories";
export type RoomOverlay = "search" | "reference-search" | null;
export type RoomContextTab = "basis" | "changes" | "risks";

export type RoomFixtureRoom = {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  updatedAt: number;
  memberIds: string[];
  resourceIds: string[];
  memoryIds: string[];
};

export type RoomFixtureResource = {
  id: string;
  room_id: string;
  title: string;
  kind: "document" | "canvas" | "artifact" | "link";
  meta: string;
};

export type RoomFixtureMemory = {
  id: string;
  room_id: string;
  title: string;
  body: string;
  updatedAt: number;
};

export type RoomFixtureContextItem = {
  id: string;
  room_id: string;
  tab: RoomContextTab;
  title: string;
  body: string;
};

export type RoomSearchResult = {
  id: string;
  label: string;
  kind: "room" | "member" | "resource" | "memory" | "message" | "thread" | "context";
  summary: string;
  target: ComposerReferenceTarget;
};

export type RoomFixtureAgentTurn = {
  agent_member_id: string;
  trigger_message_id: string;
  message_id: string;
  snapshot: import("@fields/contracts/public/agent-activity").AgentTurnSnapshot;
};

export type RoomWorkspace = {
  room: {
    id: string;
    title: string;
    subtitle: string;
    status: string;
  };
  members: ProfileMember[];
  messages: TimelineMessage[];
  references: ComposerReferenceOption[];
  context: Array<{
    id: string;
    title: string;
    description: string;
    meta: string;
    target?: ComposerReferenceOption["target"];
  }>;
  resources: Array<{
    id: string;
    title: string;
    description: string;
    meta: string;
    target?: ComposerReferenceOption["target"];
  }>;
  memories: Array<{
    id: string;
    title: string;
    description: string;
    meta: string;
    target?: ComposerReferenceOption["target"];
  }>;
  agentTurns: RoomFixtureAgentTurn[];
};

export type RoomReplySelectionMessage = {
  id: string;
  sender: string;
  text: string;
};

export type RoomReplyAnchor = {
  messageIds: string[];
} | null;

export type RoomPendingInteraction = {
  messageId: string;
  interactionId: string;
  response: import("@fields/contracts/public/room").RoomInteractionRespondInput["response"];
};

export type RoomInteractionError = {
  roomId: string;
  messageId: string;
  interactionId: string;
  message: UiMessageValue;
};

/**
 * Optional deterministic seed data for tests and previews.
 * Conversation messages are seed input only and never copied into XState.
 */
export type RoomMachineFixture = {
  currentUser: {
    id: string;
    name: string;
    mark: string;
  };
  initialRoomId: string;
  rooms: RoomFixtureRoom[];
  membersByRoomId: Readonly<Record<string, ProfileMember[]>>;
  resourcesByRoomId: Readonly<Record<string, RoomFixtureResource[]>>;
  memoriesByRoomId: Readonly<Record<string, RoomFixtureMemory[]>>;
  contextByRoomId: Readonly<Record<string, RoomFixtureContextItem[]>>;
  conversationSeedsByRoomId: Readonly<Record<string, TimelineMessage[]>>;
  searchResults: RoomSearchResult[];
  sourceNotice: SourceRouteNotice;
};

export type RoomMachineInput = {
  fixture?: RoomMachineFixture;
  initialRoomId?: string;
  workspaces?: RoomWorkspace[];
  services?: RoomMachineServices;
  currentUser?: RoomMachineFixture["currentUser"];
};

export type RoomDraftState = {
  draft: string;
  replyAnchor: Exclude<RoomReplyAnchor, null> | null;
};

export type RoomScopedState = {
  draft: RoomDraftState;
};

export type RoomMachineContext = {
  fixture: RoomMachineFixture;
  activeRoomId: string | null;
  rooms: RoomSummary[];
  roomsLoading: boolean;
  roomsError: UiMessageValue;
  roomsNextCursor: string | null;
  roomsSearchTerm: string;
  services: RoomMachineServices;
  leftPanelLastTab: "members";
  overlay: RoomOverlay;
  draft: string;
  replyAnchor: RoomReplyAnchor;
  replySelection: {
    active: boolean;
    selectedMessages: RoomReplySelectionMessage[];
  };
  pendingInteractions: Readonly<Record<string, RoomPendingInteraction>>;
  interactionError: RoomInteractionError | null;
  membersByRoomId: Readonly<Record<string, ProfileMember[]>>;
  membersLoadingByRoomId: Readonly<Record<string, true>>;
  membersErrorByRoomId: Readonly<Record<string, UiMessageValue>>;
  highlightedMessageId: string | null;
  scrollToLatestSignal: number;
  scrollToMessageSignal: { id: string; nonce: number } | null;
};

export type RoomMachineEvent =
  | { type: "ROOM_SELECTED"; roomId: string }
  | { type: "ROOMS_REFRESH_REQUESTED" }
  | { type: "ROOMS_LOAD_MORE_REQUESTED" }
  | { type: "ROOMS_SEARCH_REQUESTED"; searchTerm: string }
  | { type: "ROOMS_LOADED"; rooms: RoomSummary[]; nextCursor: string | null; append?: boolean }
  | { type: "ROOMS_FAILED"; error: UiMessageValue }
  | { type: "LEFT_PANEL_OPENED" }
  | { type: "LEFT_PANEL_CLOSED" }
  | { type: "LEFT_PANEL_TOGGLED" }
  | { type: "RIGHT_PANEL_OPENED" }
  | { type: "RIGHT_PANEL_CLOSED" }
  | { type: "RIGHT_PANEL_TOGGLED" }
  | { type: "LEFT_PANEL_TAB_SELECTED"; tab: "members" }
  | { type: "ROOM_MEMBER_ADD_OPENED" }
  | { type: "ROOM_MEMBER_ADD_CLOSED" }
  | { type: "ROOM_MEMBERS_REFRESH_REQUESTED" }
  | { type: "ROOM_MEMBER_ADD_REQUESTED"; actorId: string; actorType?: "human" | "agent" }
  | { type: "ROOM_MEMBER_REMOVE_REQUESTED"; actorId: string }
  | { type: "ROOM_MEMBERS_LOADED"; roomId: string; members: ProfileMember[] }
  | { type: "ROOM_MEMBERS_FAILED"; roomId: string; error: UiMessageValue }
  | { type: "OVERLAY_OPENED"; overlay: Exclude<RoomOverlay, null> }
  | { type: "OVERLAY_CLOSED" }
  | { type: "DRAFT_CHANGED"; draft: string }
  | { type: "DRAFT_SENT" }
  | { type: "REPLY_ANCHOR_SET"; messageIds: string[] }
  | { type: "REPLY_ANCHOR_CLEARED" }
  | { type: "REPLY_SELECTION_ENTERED"; message: RoomReplySelectionMessage }
  | { type: "REPLY_SELECTION_TOGGLED"; message: RoomReplySelectionMessage }
  | { type: "REPLY_SELECTION_CONFIRMED" }
  | { type: "REPLY_SELECTION_CANCELLED" }
  | { type: "INTERACTION_RESPONSE_REQUESTED"; messageId: string; interactionId: string; response: import("@fields/contracts/public/room").RoomInteractionRespondInput["response"] }
  | { type: "INTERACTION_RESPONSE_SUCCEEDED"; roomId: string; messageId: string; interactionId: string }
  | { type: "INTERACTION_RESPONSE_FAILED"; roomId: string; messageId: string; interactionId: string; error: UiMessageValue }
  | { type: "TIMELINE_MESSAGE_HIGHLIGHTED"; messageId: string | null }
  | { type: "TIMELINE_MESSAGE_SCROLL_REQUESTED"; messageId: string };

type RoomEffectsEvent =
  | { type: "LOAD_ROOMS"; targetRoomId: string | null; cursor?: string | null; append?: boolean; searchTerm?: string }
  | { type: "ACTIVATE_ROOM"; roomId: string }
  | { type: "LOAD_ROOM_MEMBERS"; roomId: string }
  | { type: "ADD_ROOM_MEMBER"; roomId: string; actorId: string; actorType: "human" | "agent" }
  | { type: "REMOVE_ROOM_MEMBER"; roomId: string; actorId: string }
  | { type: "RESPOND_ROOM_INTERACTION"; roomId: string; messageId: string; interactionId: string; response: "approve" | "reject" }
  ;

const roomEffectsActor = fromCallback<
  RoomEffectsEvent,
  Pick<RoomMachineContext, "services">
>(({ input, receive, sendBack }) => {
  receive((event) => {
    if (event.type === "LOAD_ROOMS") {
      const request = event.append
        ? input.services.listRooms({ cursor: event.cursor, limit: 50, searchTerm: event.searchTerm })
        : listRoomsThroughTarget(input.services, event.targetRoomId, event.searchTerm);
      void request.then((result) => {
        sendBack({
          type: "ROOMS_LOADED",
          rooms: result.items,
          nextCursor: result.page.next_cursor,
          append: event.append,
        });
      }).catch((reason) => {
        sendBack({ type: "ROOMS_FAILED", error: messageFromError(reason, "room.roomsLoadFailed") });
      });
      return;
    }
    if (event.type === "ACTIVATE_ROOM") {
      return;
    }
    if (event.type === "LOAD_ROOM_MEMBERS") {
      void input.services.listMembers({ roomId: event.roomId }).then((result) => {
        sendBack({ type: "ROOM_MEMBERS_LOADED", roomId: event.roomId, members: result.items });
      }).catch((reason) => {
        sendBack({
          type: "ROOM_MEMBERS_FAILED",
          roomId: event.roomId,
          error: messageFromError(reason, "room.membersLoadFailed"),
        });
      });
      return;
    }
    if (event.type === "ADD_ROOM_MEMBER" || event.type === "REMOVE_ROOM_MEMBER") {
      const request = event.type === "ADD_ROOM_MEMBER"
        ? input.services.addMember({
          roomId: event.roomId,
          actorId: event.actorId,
          actorType: event.actorType,
        })
        : input.services.removeMember({
          roomId: event.roomId,
          actorId: event.actorId,
        });
      void request.then((result) => {
        sendBack({ type: "ROOM_MEMBERS_LOADED", roomId: event.roomId, members: result.items });
      }).catch((reason) => {
        sendBack({
          type: "ROOM_MEMBERS_FAILED",
          roomId: event.roomId,
          error: messageFromError(
            reason,
            event.type === "ADD_ROOM_MEMBER" ? "room.memberAddFailed" : "room.memberRemoveFailed",
          ),
        });
      });
      return;
    }
    if (event.type === "RESPOND_ROOM_INTERACTION") {
      void input.services.respondToInteraction({
        roomId: event.roomId,
        messageId: event.messageId,
        interactionId: event.interactionId,
        response: event.response,
      }).then(() => {
        sendBack({
          type: "INTERACTION_RESPONSE_SUCCEEDED",
          roomId: event.roomId,
          messageId: event.messageId,
          interactionId: event.interactionId,
        });
      }).catch((reason) => {
        sendBack({
          type: "INTERACTION_RESPONSE_FAILED",
          roomId: event.roomId,
          messageId: event.messageId,
          interactionId: event.interactionId,
          error: messageFromError(reason, "room.interactionResponseFailed"),
        });
      });
      return;
    }
  });
});

async function listRoomsThroughTarget(
  services: RoomMachineServices,
  targetRoomId: string | null,
  searchTerm?: string,
): Promise<{ items: RoomSummary[]; page: { next_cursor: string | null } }> {
  const items: RoomSummary[] = [];
  const visitedCursors = new Set<string>();
  let cursor: string | null = null;
  while (true) {
    const result = await services.listRooms({ cursor, limit: 50, searchTerm });
    items.push(...result.items);
    const nextCursor = result.page.next_cursor;
    if (!targetRoomId || items.some((room) => room.id === targetRoomId) || !nextCursor) {
      return { items, page: { next_cursor: nextCursor } };
    }
    if (visitedCursors.has(nextCursor)) {
      return { items, page: { next_cursor: null } };
    }
    visitedCursors.add(nextCursor);
    cursor = nextCursor;
  }
}

export const roomMachine = setup({
  types: {} as {
    context: RoomMachineContext;
    events: RoomMachineEvent;
    input: RoomMachineInput;
  },
  actors: {
    roomEffects: roomEffectsActor,
  },
  actions: {
    loadRooms: sendTo("roomEffects", ({ context }) => ({
      type: "LOAD_ROOMS",
      targetRoomId: context.activeRoomId,
      searchTerm: context.roomsSearchTerm || undefined,
    })),
    loadMoreRooms: sendTo("roomEffects", ({ context }) => ({
      type: "LOAD_ROOMS",
      targetRoomId: null,
      cursor: context.roomsNextCursor,
      append: true,
      searchTerm: context.roomsSearchTerm || undefined,
    })),
    selectRoom: assign({
      activeRoomId: ({ event }) => event.type === "ROOM_SELECTED" ? event.roomId : null,
      leftPanelLastTab: "members",
      overlay: null,
      draft: "",
      replyAnchor: null,
      replySelection: () => ({ active: false, selectedMessages: [] }),
      pendingInteractions: {},
      interactionError: null,
      membersLoadingByRoomId: ({ context, event }) => event.type === "ROOM_SELECTED"
        ? setRecordKey(context.membersLoadingByRoomId, event.roomId)
        : context.membersLoadingByRoomId,
      membersErrorByRoomId: ({ context, event }) => event.type === "ROOM_SELECTED"
        ? removeRecordKey(context.membersErrorByRoomId, event.roomId)
        : context.membersErrorByRoomId,
      highlightedMessageId: null,
      scrollToLatestSignal: ({ context }) => context.scrollToLatestSignal + 1,
      scrollToMessageSignal: null,
    }),
    activateRoom: sendTo("roomEffects", ({ context }) => ({
      type: "ACTIVATE_ROOM",
      roomId: context.activeRoomId ?? "",
    })),
    loadSelectedRoom: enqueueActions(({ context, enqueue }) => {
      if (!context.activeRoomId) return;
      enqueue.sendTo("roomEffects", {
        type: "LOAD_ROOM_MEMBERS",
        roomId: context.activeRoomId,
      });
    }),
    loadMembers: sendTo("roomEffects", ({ context }) => ({
      type: "LOAD_ROOM_MEMBERS",
      roomId: context.activeRoomId ?? "",
    })),
    addMember: sendTo("roomEffects", ({ context, event }) => ({
      type: "ADD_ROOM_MEMBER",
      roomId: context.activeRoomId ?? "",
      actorId: event.type === "ROOM_MEMBER_ADD_REQUESTED" ? event.actorId : "",
      actorType: event.type === "ROOM_MEMBER_ADD_REQUESTED" ? event.actorType ?? "human" : "human",
    })),
    removeMember: sendTo("roomEffects", ({ context, event }) => ({
      type: "REMOVE_ROOM_MEMBER",
      roomId: context.activeRoomId ?? "",
      actorId: event.type === "ROOM_MEMBER_REMOVE_REQUESTED" ? event.actorId : "",
    })),
    respondToInteraction: sendTo("roomEffects", ({ context, event }) => ({
      type: "RESPOND_ROOM_INTERACTION",
      roomId: context.activeRoomId ?? "",
      messageId: event.type === "INTERACTION_RESPONSE_REQUESTED" ? event.messageId : "",
      interactionId: event.type === "INTERACTION_RESPONSE_REQUESTED" ? event.interactionId : "",
      response: event.type === "INTERACTION_RESPONSE_REQUESTED" ? event.response : "reject",
    })),
  },
  guards: {
    hasActiveRoom: ({ context }) => context.activeRoomId !== null,
    canManageMembers: ({ context }) => {
      const roomId = context.activeRoomId;
      return Boolean(
        roomId
        && canManageRoomMembers(
          context.fixture.currentUser.id,
          context.membersByRoomId[roomId] ?? [],
        ),
      );
    },
  },
}).createMachine({
  id: "room",
  type: "parallel",
  context: ({ input }) => {
    const baseFixture = input.fixture
      ?? (input.workspaces ? fixtureFromLegacyWorkspaces(input.workspaces) : emptyRoomMachineFixture());
    const fixture = input.currentUser
      ? { ...baseFixture, currentUser: input.currentUser }
      : baseFixture;
    return {
      fixture,
      activeRoomId: input.initialRoomId ?? null,
      rooms: [],
      roomsLoading: true,
      roomsError: null,
      roomsNextCursor: null,
      roomsSearchTerm: "",
      services: input.services ?? defaultRoomMachineServices,
      leftPanelLastTab: "members",
      overlay: null,
      draft: "",
      replyAnchor: null,
      replySelection: { active: false, selectedMessages: [] },
      pendingInteractions: {},
      interactionError: null,
      membersByRoomId: {},
      membersLoadingByRoomId: {},
      membersErrorByRoomId: {},
      highlightedMessageId: null,
      scrollToLatestSignal: 0,
      scrollToMessageSignal: null,
    };
  },
  invoke: {
    id: "roomEffects",
    src: "roomEffects",
    input: ({ context }) => ({ services: context.services }),
  },
  entry: [
    "loadRooms",
    enqueueActions(({ context, enqueue }) => {
      if (context.activeRoomId) {
        enqueue.raise({ type: "ROOM_SELECTED", roomId: context.activeRoomId });
      }
    }),
  ],
  on: {
    OVERLAY_OPENED: {
      actions: assign({ overlay: ({ event }) => event.overlay }),
    },
    OVERLAY_CLOSED: {
      actions: assign({ overlay: null }),
    },
    ROOMS_REFRESH_REQUESTED: {
      actions: [
        assign({ roomsLoading: true, roomsError: null }),
        "loadRooms",
      ],
    },
    ROOMS_LOAD_MORE_REQUESTED: {
      guard: ({ context }) => Boolean(context.roomsNextCursor) && !context.roomsLoading,
      actions: [
        assign({ roomsLoading: true, roomsError: null }),
        "loadMoreRooms",
      ],
    },
    ROOMS_SEARCH_REQUESTED: {
      actions: [
        assign({ roomsLoading: true, roomsError: null, roomsNextCursor: null, roomsSearchTerm: ({ event }) => event.searchTerm }),
        "loadRooms",
      ],
    },
    ROOMS_LOADED: {
      actions: assign({
        rooms: ({ context, event }) => event.append
          ? mergeRooms(context.rooms, event.rooms)
          : event.rooms,
        roomsLoading: false,
        roomsError: null,
        roomsNextCursor: ({ event }) => event.nextCursor,
      }),
    },
    ROOMS_FAILED: {
      actions: assign({ roomsLoading: false, roomsError: ({ event }) => event.error }),
    },
    ROOM_MEMBERS_REFRESH_REQUESTED: {
      guard: "hasActiveRoom",
      actions: [
        assign({
          membersLoadingByRoomId: ({ context }) => setRecordKey(
            context.membersLoadingByRoomId,
            context.activeRoomId!,
          ),
          membersErrorByRoomId: ({ context }) => removeRecordKey(
            context.membersErrorByRoomId,
            context.activeRoomId!,
          ),
        }),
        "loadMembers",
      ],
    },
    ROOM_MEMBER_ADD_REQUESTED: {
      guard: "canManageMembers",
      actions: "addMember",
    },
    ROOM_MEMBER_REMOVE_REQUESTED: {
      guard: "canManageMembers",
      actions: "removeMember",
    },
    ROOM_MEMBERS_LOADED: {
      actions: assign({
        membersByRoomId: ({ context, event }) => ({
          ...context.membersByRoomId,
          [event.roomId]: event.members,
        }),
        membersLoadingByRoomId: ({ context, event }) => removeRecordKey(
          context.membersLoadingByRoomId,
          event.roomId,
        ),
        membersErrorByRoomId: ({ context, event }) => removeRecordKey(
          context.membersErrorByRoomId,
          event.roomId,
        ),
      }),
    },
    ROOM_MEMBERS_FAILED: {
      actions: assign({
        membersLoadingByRoomId: ({ context, event }) => removeRecordKey(
          context.membersLoadingByRoomId,
          event.roomId,
        ),
        membersErrorByRoomId: ({ context, event }) => ({
          ...context.membersErrorByRoomId,
          [event.roomId]: event.error,
        }),
      }),
    },
    DRAFT_CHANGED: { actions: assign({ draft: ({ event }) => event.draft }) },
    DRAFT_SENT: {
      actions: assign({
        draft: "",
        replyAnchor: null,
        replySelection: () => ({ active: false, selectedMessages: [] }),
        scrollToLatestSignal: ({ context }) => context.scrollToLatestSignal + 1,
      }),
    },
    REPLY_ANCHOR_SET: {
      actions: assign({ replyAnchor: ({ event }) => ({ messageIds: event.messageIds }) }),
    },
    REPLY_ANCHOR_CLEARED: { actions: assign({ replyAnchor: null }) },
    REPLY_SELECTION_ENTERED: {
      actions: assign({
        replySelection: ({ event }) => ({
          active: true,
          selectedMessages: [event.message],
        }),
      }),
    },
    REPLY_SELECTION_TOGGLED: {
      actions: assign({
        replySelection: ({ context, event }) => toggleReplySelection(
          context.replySelection,
          event.message,
        ),
      }),
    },
    REPLY_SELECTION_CONFIRMED: {
      actions: assign({
        replyAnchor: ({ context }) => replyAnchorFromSelection(
          context.replySelection.selectedMessages,
        ),
        replySelection: () => ({ active: false, selectedMessages: [] }),
      }),
    },
    REPLY_SELECTION_CANCELLED: {
      actions: assign({ replySelection: () => ({ active: false, selectedMessages: [] }) }),
    },
    INTERACTION_RESPONSE_REQUESTED: {
      guard: ({ context, event }) => (
        context.activeRoomId !== null
        && context.pendingInteractions[event.interactionId] === undefined
      ),
      actions: [
        assign({
          pendingInteractions: ({ context, event }) => ({
            ...context.pendingInteractions,
            [event.interactionId]: {
              messageId: event.messageId,
              interactionId: event.interactionId,
              response: event.response,
            },
          }),
          interactionError: null,
        }),
        "respondToInteraction",
      ],
    },
    INTERACTION_RESPONSE_SUCCEEDED: {
      actions: assign({
        pendingInteractions: ({ context, event }) => removeRecordKey(
          context.pendingInteractions,
          event.interactionId,
        ),
        interactionError: null,
      }),
    },
    INTERACTION_RESPONSE_FAILED: {
      actions: assign({
        pendingInteractions: ({ context, event }) => removeRecordKey(
          context.pendingInteractions,
          event.interactionId,
        ),
        interactionError: ({ event }) => ({
          roomId: event.roomId,
          messageId: event.messageId,
          interactionId: event.interactionId,
          message: event.error,
        }),
      }),
    },
    TIMELINE_MESSAGE_HIGHLIGHTED: {
      actions: assign({ highlightedMessageId: ({ event }) => event.messageId }),
    },
    TIMELINE_MESSAGE_SCROLL_REQUESTED: {
      actions: assign({
        scrollToMessageSignal: ({ context, event }) => ({
          id: event.messageId,
          nonce: (context.scrollToMessageSignal?.nonce ?? 0) + 1,
        }),
      }),
    },
  },
  states: {
    directory: {
      initial: "loading",
      states: {
        loading: {
          always: [
            { guard: ({ context }) => Boolean(context.roomsError), target: "error" },
            { guard: ({ context }) => !context.roomsLoading, target: "ready" },
          ],
        },
        ready: {
          always: [
            { guard: ({ context }) => context.roomsLoading, target: "loading" },
            { guard: ({ context }) => Boolean(context.roomsError), target: "error" },
          ],
        },
        error: {
          always: [
            { guard: ({ context }) => context.roomsLoading, target: "loading" },
            { guard: ({ context }) => !context.roomsError, target: "ready" },
          ],
        },
      },
    },
    workspace: {
      initial: "deciding",
      states: {
        deciding: {
          always: [
            { guard: "hasActiveRoom", target: "active" },
            { target: "noRoom" },
          ],
        },
        noRoom: {
          on: {
            ROOM_SELECTED: {
              target: "active",
              actions: ["selectRoom", "activateRoom", "loadSelectedRoom"],
            },
          },
        },
        active: {
          id: "roomActive",
          type: "parallel",
          on: {
            ROOM_SELECTED: {
              target: "#roomActive",
              reenter: true,
              actions: ["selectRoom", "activateRoom", "loadSelectedRoom"],
            },
          },
          states: {
            members: {
              initial: "checking",
              states: {
                checking: {
                  always: [
                    {
                      guard: ({ context }) => Boolean(
                        context.activeRoomId
                        && context.membersLoadingByRoomId[context.activeRoomId],
                      ),
                      target: "loading",
                    },
                    {
                      guard: ({ context }) => Boolean(
                        context.activeRoomId
                        && context.membersErrorByRoomId[context.activeRoomId],
                      ),
                      target: "error",
                    },
                    { target: "ready" },
                  ],
                },
                loading: {
                  always: [
                    {
                      guard: ({ context }) => Boolean(
                        context.activeRoomId
                        && context.membersErrorByRoomId[context.activeRoomId],
                      ),
                      target: "error",
                    },
                    {
                      guard: ({ context }) => Boolean(
                        !context.activeRoomId
                        || !context.membersLoadingByRoomId[context.activeRoomId],
                      ),
                      target: "ready",
                    },
                  ],
                },
                ready: {
                  always: [
                    {
                      guard: ({ context }) => Boolean(
                        context.activeRoomId
                        && context.membersLoadingByRoomId[context.activeRoomId],
                      ),
                      target: "loading",
                    },
                    {
                      guard: ({ context }) => Boolean(
                        context.activeRoomId
                        && context.membersErrorByRoomId[context.activeRoomId],
                      ),
                      target: "error",
                    },
                  ],
                },
                error: {
                  always: [
                    {
                      guard: ({ context }) => Boolean(
                        context.activeRoomId
                        && context.membersLoadingByRoomId[context.activeRoomId],
                      ),
                      target: "loading",
                    },
                    {
                      guard: ({ context }) => Boolean(
                        !context.activeRoomId
                        || !context.membersErrorByRoomId[context.activeRoomId],
                      ),
                      target: "ready",
                    },
                  ],
                },
              },
            },
            leftPanel: {
              initial: "closed",
              states: {
                closed: {
                  on: {
                    LEFT_PANEL_OPENED: "members",
                    LEFT_PANEL_TOGGLED: "members",
                    LEFT_PANEL_TAB_SELECTED: "members",
                  },
                },
                members: {
                  entry: assign({ leftPanelLastTab: "members" }),
                  initial: "browsing",
                  states: {
                    browsing: { on: { ROOM_MEMBER_ADD_OPENED: "adding" } },
                    adding: { on: { ROOM_MEMBER_ADD_CLOSED: "browsing" } },
                  },
                  on: {
                    LEFT_PANEL_CLOSED: "closed",
                    LEFT_PANEL_TOGGLED: "closed",
                  },
                },
              },
            },
            rightPanel: {
              initial: "closed",
              states: {
                closed: {
                  on: {
                    RIGHT_PANEL_OPENED: "sideChat",
                    RIGHT_PANEL_TOGGLED: "sideChat",
                  },
                },
                sideChat: {
                  on: {
                    RIGHT_PANEL_CLOSED: "closed",
                    RIGHT_PANEL_TOGGLED: "closed",
                  },
                },
              },
            },
          },
        },
      },
    },
  },
});

export function activeScopedState(context: RoomMachineContext): RoomScopedState {
  return {
    draft: {
      draft: context.draft,
      replyAnchor: context.replyAnchor,
    },
  };
}

export function roomReferenceTargetKey(target: ComposerReferenceTarget): string {
  switch (target.type) {
    case "room":
    case "member":
    case "resource":
    case "memory":
    case "file":
      return `${target.type}:${target.id}`;
    case "message":
      return `${target.type}:${target.room_id}:${target.message_id}`;
    case "thread":
      return `${target.type}:${target.room_id}:${target.thread_id}:${target.message_id ?? ""}`;
    case "context":
      return `${target.type}:${target.room_id}:${target.tab}`;
    default: {
      const unreachable: never = target;
      return unreachable;
    }
  }
}

function fixtureFromLegacyWorkspaces(workspaces: RoomWorkspace[]): RoomMachineFixture {
  const initialRoomId = workspaces[0]?.room.id ?? "";
  return {
    currentUser: { id: "member-you", name: "You", mark: "YU" },
    initialRoomId,
    rooms: workspaces.map((workspace) => ({
      id: workspace.room.id,
      name: workspace.room.title,
      subtitle: workspace.room.subtitle,
      description: workspace.room.status,
      updatedAt: 0,
      memberIds: workspace.members.map((member) => member.member_id),
      resourceIds: workspace.resources.map((resource) => resource.id),
      memoryIds: workspace.memories.map((memory) => memory.id),
    })),
    membersByRoomId: Object.fromEntries(
      workspaces.map((workspace) => [workspace.room.id, workspace.members]),
    ),
    resourcesByRoomId: Object.fromEntries(workspaces.map((workspace) => [
      workspace.room.id,
      workspace.resources.map((resource) => ({
        id: resource.id,
        room_id: workspace.room.id,
        title: resource.title,
        kind: "document" as const,
        meta: resource.meta,
      })),
    ])),
    memoriesByRoomId: Object.fromEntries(workspaces.map((workspace) => [
      workspace.room.id,
      workspace.memories.map((memory) => ({
        id: memory.id,
        room_id: workspace.room.id,
        title: memory.title,
        body: memory.description,
        updatedAt: 0,
      })),
    ])),
    contextByRoomId: Object.fromEntries(workspaces.map((workspace) => [
      workspace.room.id,
      workspace.context.map((item) => ({
        id: item.id,
        room_id: workspace.room.id,
        tab: item.target?.type === "context" ? item.target.tab : "basis",
        title: item.title,
        body: item.description,
      })),
    ])),
    conversationSeedsByRoomId: Object.fromEntries(
      workspaces.map((workspace) => [workspace.room.id, workspace.messages]),
    ),
    searchResults: workspaces.flatMap((workspace) => workspace.references.map((reference) => ({
      id: `search-${roomReferenceTargetKey(reference.target)}`,
      label: reference.label,
      kind: reference.target.type === "memory"
        ? "memory" as const
        : reference.target.type === "resource"
          ? "resource" as const
          : "context" as const,
      summary: workspace.room.title,
      target: reference.target,
    }))),
    sourceNotice: null,
  };
}

function emptyRoomMachineFixture(): RoomMachineFixture {
  return {
    currentUser: { id: "member-you", name: "You", mark: "YU" },
    initialRoomId: "",
    rooms: [],
    membersByRoomId: {},
    resourcesByRoomId: {},
    memoriesByRoomId: {},
    contextByRoomId: {},
    conversationSeedsByRoomId: {},
    searchResults: [],
    sourceNotice: null,
  };
}

function toggleReplySelection(
  selection: RoomMachineContext["replySelection"],
  message: RoomReplySelectionMessage,
): RoomMachineContext["replySelection"] {
  const selected = selection.selectedMessages.some((candidate) => candidate.id === message.id);
  return {
    active: true,
    selectedMessages: selected
      ? selection.selectedMessages.filter((candidate) => candidate.id !== message.id)
      : [...selection.selectedMessages, message],
  };
}

function replyAnchorFromSelection(messages: RoomReplySelectionMessage[]): RoomReplyAnchor {
  return messages.length === 0
    ? null
    : { messageIds: messages.map((candidate) => candidate.id) };
}

function mergeRooms(current: RoomSummary[], next: RoomSummary[]): RoomSummary[] {
  const byId = new Map(current.map((room) => [room.id, room]));
  for (const room of next) byId.set(room.id, room);
  return [...byId.values()];
}

function setRecordKey<T extends Readonly<Record<string, true>>>(
  record: T,
  key: string,
): Record<string, true> {
  return record[key] ? record : { ...record, [key]: true };
}

function removeRecordKey<T>(
  record: Readonly<Record<string, T>>,
  key: string,
): Readonly<Record<string, T>> {
  const { [key]: _removed, ...remaining } = record;
  return remaining;
}
