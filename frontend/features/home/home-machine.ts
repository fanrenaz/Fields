import { assign, fromCallback, sendTo, setup } from "xstate";
import type {
  HomeFilesystemEntry,
  HomeFilesystemEntryKind,
  HomeFilesystemEvent,
  HomeFilesystemListResult,
  HomeThreadListResult,
  HomeThreadSearchResult,
  HomeThreadSummary,
} from "@fields/contracts/public/home";

import type {
  HomeFilesystemEventsSubscription,
  HomeMachineServices,
} from "../../data/home/home-machine-services";
import { message, messageFromError, type UiMessageValue } from "../../shared/i18n/message";

export type HomeThreadViewState = "empty" | "active_thread";
export type HomeThreadPanelRecord = HomeThreadSummary;
export type HomeFilesystemExplorerEntry = HomeFilesystemEntry & {
  childrenIds: string[];
  childrenLoaded: boolean;
  loading: boolean;
};

const HOME_FILESYSTEM_ROOT_PATH = ".";

export type HomeMachineInput = {
  active: boolean;
  initialThreadId?: string | null;
  timeoutMs: number;
  threadListLimit?: number;
  services: HomeMachineServices;
};

type ThreadRequest = {
  requestId: number;
  append: boolean;
  searchTerm: string | null;
};

export type HomeMachineContext = {
  projectId: string | null;
  initiallyActive: boolean;
  timeoutMs: number;
  threadListLimit?: number;
  services: HomeMachineServices;
  threads: {
    items: HomeThreadPanelRecord[];
    nextCursor: string | null;
    selectedThreadId: string | null;
    request: ThreadRequest | null;
    error: UiMessageValue;
    searchDraft: string;
    searchTerm: string | null;
    expanded: boolean;
  };
  filesystem: {
    rootPath: string;
    entries: Readonly<Record<string, HomeFilesystemEntry>>;
    childrenByPath: Readonly<Record<string, string[]>>;
    loadedPaths: Readonly<Record<string, true>>;
    loadingPaths: Readonly<Record<string, true>>;
    requestIdsByPath: Readonly<Record<string, number>>;
    expandedIds: readonly string[];
    selectedPath: string | null;
    error: UiMessageValue;
    mutating: boolean;
    mutationRequestId: number | null;
    dirty: boolean;
  };
};

export type HomeMachineEvent =
  | { type: "HOME_ACTIVATED" }
  | { type: "HOME_DEACTIVATED" }
  | { type: "LEFT_PANEL_OPENED" }
  | { type: "LEFT_PANEL_CLOSED" }
  | { type: "RIGHT_PANEL_OPENED" }
  | { type: "RIGHT_PANEL_CLOSED" }
  | { type: "THREAD_LIST_REFRESH_REQUESTED" }
  | { type: "THREAD_LIST_LOAD_MORE_REQUESTED" }
  | { type: "THREAD_LIST_EXPANSION_TOGGLED" }
  | { type: "THREAD_SEARCH_OPENED" }
  | { type: "THREAD_SEARCH_CLOSED" }
  | { type: "THREAD_SEARCH_DRAFT_CHANGED"; draft: string }
  | { type: "THREAD_LIST_REQUEST_STARTED"; requestId: number; append: boolean; searchTerm: string | null }
  | { type: "THREAD_LIST_LOADED"; requestId: number; result: HomeThreadListResult | HomeThreadSearchResult; append: boolean; searchTerm: string | null }
  | { type: "THREAD_LIST_FAILED"; requestId: number; error: UiMessageValue; append: boolean; searchTerm: string | null }
  | { type: "NEW_CHAT_REQUESTED" }
  | { type: "PROJECT_SCOPE_CHANGED"; projectId: string | null }
  | { type: "THREAD_SELECTED"; threadId: string }
  | { type: "FILESYSTEM_DIRECTORY_LOAD_REQUESTED"; path: string }
  | { type: "FILESYSTEM_REFRESH_REQUESTED" }
  | { type: "FILESYSTEM_EXPANSION_CHANGED"; expandedIds: readonly string[] }
  | { type: "FILESYSTEM_DIRECTORY_REQUEST_STARTED"; path: string; requestId: number }
  | { type: "FILESYSTEM_DIRECTORY_LOADED"; path: string; requestId: number; result: HomeFilesystemListResult }
  | { type: "FILESYSTEM_DIRECTORY_FAILED"; path: string; requestId: number; error: UiMessageValue }
  | { type: "FILESYSTEM_ENTRY_CREATE_REQUESTED"; parentPath: string; name: string; kind: HomeFilesystemEntryKind }
  | { type: "FILESYSTEM_ENTRY_RENAME_REQUESTED"; path: string; name: string }
  | { type: "FILESYSTEM_ENTRY_DELETE_REQUESTED"; path: string }
  | { type: "FILESYSTEM_MUTATION_REQUEST_STARTED"; requestId: number }
  | { type: "FILESYSTEM_MUTATION_RELOADED"; requestId: number; parentPath: string; selectedPath: string | null; result: HomeFilesystemListResult }
  | { type: "FILESYSTEM_MUTATION_FAILED"; requestId: number; error: UiMessageValue }
  | { type: "FILESYSTEM_EVENT_RECEIVED"; event: HomeFilesystemEvent }
  | { type: "FILESYSTEM_WATCH_FAILED"; path: string; error: UiMessageValue }
  | { type: "FILESYSTEM_ENTRY_SELECTED"; path: string | null };

type EffectsEvent =
  | { type: "LIST_THREADS"; projectId: string | null; cursor: string | null; append: boolean; searchTerm: string | null }
  | { type: "LIST_FILESYSTEM"; paths: string[] }
  | { type: "CREATE_FILESYSTEM"; parentPath: string; name: string; kind: HomeFilesystemEntryKind }
  | { type: "RENAME_FILESYSTEM"; path: string; parentPath: string; name: string }
  | { type: "DELETE_FILESYSTEM"; path: string; parentPath: string }
  | { type: "SYNC_FILESYSTEM_WATCHES"; paths: string[] };

type EffectsInput = Pick<HomeMachineContext, "threadListLimit" | "services">;

const effectsActor = fromCallback<EffectsEvent, EffectsInput>(({ input, receive, sendBack }) => {
  let sequence = 0;
  const pathRequests = new Map<string, number>();
  const watches = new Map<string, HomeFilesystemEventsSubscription>();
  const nextRequestId = () => ++sequence;

  const listPath = (rawPath: string) => {
    const path = normalizeFilesystemPath(rawPath);
    const requestId = nextRequestId();
    pathRequests.set(path, requestId);
    sendBack({ type: "FILESYSTEM_DIRECTORY_REQUEST_STARTED", path, requestId });
    void input.services.listFilesystem({ path }).then((result) => {
      if (pathRequests.get(path) === requestId) {
        sendBack({ type: "FILESYSTEM_DIRECTORY_LOADED", path, requestId, result });
      }
    }).catch((reason) => {
      if (pathRequests.get(path) === requestId) {
        sendBack({
          type: "FILESYSTEM_DIRECTORY_FAILED",
          path,
          requestId,
          error: messageFromError(reason, "home.filesLoadFailed"),
        });
      }
    });
  };

  const syncWatches = (paths: string[]) => {
    const desired = new Set(paths.map(normalizeFilesystemPath));
    for (const [path, subscription] of watches) {
      if (desired.has(path)) continue;
      subscription.unsubscribe();
      watches.delete(path);
    }
    for (const path of desired) {
      if (watches.has(path)) continue;
      watches.set(path, input.services.subscribeFilesystemEvents(
        { path },
        {
          onEvent: (event) => sendBack({ type: "FILESYSTEM_EVENT_RECEIVED", event }),
          onError: (reason) => {
            watches.delete(path);
            sendBack({ type: "FILESYSTEM_WATCH_FAILED", path, error: messageFromError(reason, "home.filesystemWatchDisconnected") });
          },
          onComplete: () => {
            watches.delete(path);
            sendBack({ type: "FILESYSTEM_WATCH_FAILED", path, error: message("home.filesystemWatchDisconnected") });
          },
        },
      ));
    }
  };

  receive((event) => {
    if (event.type === "LIST_THREADS") {
      const requestId = nextRequestId();
      sendBack({ type: "THREAD_LIST_REQUEST_STARTED", requestId, append: event.append, searchTerm: event.searchTerm });
      const request = event.searchTerm
        ? input.services.searchThreads({ projectId: event.projectId, searchTerm: event.searchTerm, cursor: event.cursor, limit: input.threadListLimit })
        : input.services.listThreads({ projectId: event.projectId, cursor: event.cursor, limit: input.threadListLimit });
      void request.then((result) => {
        sendBack({ type: "THREAD_LIST_LOADED", requestId, result, append: event.append, searchTerm: event.searchTerm });
      }).catch((reason) => {
        sendBack({ type: "THREAD_LIST_FAILED", requestId, append: event.append, searchTerm: event.searchTerm, error: messageFromError(reason, "home.threadsLoadFailed") });
      });
      return;
    }
    if (event.type === "LIST_FILESYSTEM") {
      for (const path of unique(event.paths.map(normalizeFilesystemPath))) listPath(path);
      return;
    }
    if (event.type === "SYNC_FILESYSTEM_WATCHES") {
      syncWatches(event.paths);
      return;
    }
    const requestId = nextRequestId();
    sendBack({ type: "FILESYSTEM_MUTATION_REQUEST_STARTED", requestId });
    const mutation = event.type === "CREATE_FILESYSTEM"
      ? input.services.createFilesystemEntry({ parentPath: event.parentPath, name: event.name, kind: event.kind })
      : event.type === "RENAME_FILESYSTEM"
        ? input.services.renameFilesystemEntry({ path: event.path, name: event.name })
        : input.services.deleteFilesystemEntry({ path: event.path });
    const parentPath = event.parentPath;
    void mutation.then(async (result) => {
      const listed = await input.services.listFilesystem({ path: parentPath });
      sendBack({
        type: "FILESYSTEM_MUTATION_RELOADED",
        requestId,
        parentPath,
        selectedPath: event.type === "DELETE_FILESYSTEM"
          ? null
          : "path" in result ? result.path : null,
        result: listed,
      });
    }).catch((reason) => {
      sendBack({ type: "FILESYSTEM_MUTATION_FAILED", requestId, error: messageFromError(reason, "home.filesMutationFailed") });
    });
  });
  return () => {
    for (const subscription of watches.values()) subscription.unsubscribe();
    watches.clear();
  };
});

export const homeMachine = setup({
  types: {
    context: {} as HomeMachineContext,
    events: {} as HomeMachineEvent,
    input: {} as HomeMachineInput,
  },
  actors: { effects: effectsActor },
  actions: {
    listThreads: sendTo("effects", ({ context }) => ({
      type: "LIST_THREADS",
      projectId: context.projectId,
      cursor: null,
      append: false,
      searchTerm: context.threads.searchTerm,
    })),
    listMoreThreads: sendTo("effects", ({ context }) => ({
      type: "LIST_THREADS",
      projectId: context.projectId,
      cursor: context.threads.nextCursor,
      append: true,
      searchTerm: context.threads.searchTerm,
    })),
    listFilesystem: sendTo("effects", ({ context, event }) => ({
      type: "LIST_FILESYSTEM",
      paths: event.type === "FILESYSTEM_DIRECTORY_LOAD_REQUESTED"
        ? [event.path]
        : [context.filesystem.rootPath, ...context.filesystem.expandedIds],
    })),
    syncFilesystemWatches: sendTo("effects", ({ context }) => ({
      type: "SYNC_FILESYSTEM_WATCHES",
      paths: [context.filesystem.rootPath, ...context.filesystem.expandedIds],
    })),
    stopFilesystemWatches: sendTo("effects", () => ({ type: "SYNC_FILESYSTEM_WATCHES", paths: [] })),
    createFilesystem: sendTo("effects", ({ event }) => ({
      type: "CREATE_FILESYSTEM",
      parentPath: event.type === "FILESYSTEM_ENTRY_CREATE_REQUESTED" ? event.parentPath : ".",
      name: event.type === "FILESYSTEM_ENTRY_CREATE_REQUESTED" ? event.name : "",
      kind: event.type === "FILESYSTEM_ENTRY_CREATE_REQUESTED" ? event.kind : "file",
    })),
    renameFilesystem: sendTo("effects", ({ event }) => ({
      type: "RENAME_FILESYSTEM",
      path: event.type === "FILESYSTEM_ENTRY_RENAME_REQUESTED" ? event.path : "",
      parentPath: event.type === "FILESYSTEM_ENTRY_RENAME_REQUESTED" ? parentFilesystemPath(event.path) : ".",
      name: event.type === "FILESYSTEM_ENTRY_RENAME_REQUESTED" ? event.name : "",
    })),
    deleteFilesystem: sendTo("effects", ({ event }) => ({
      type: "DELETE_FILESYSTEM",
      path: event.type === "FILESYSTEM_ENTRY_DELETE_REQUESTED" ? event.path : "",
      parentPath: event.type === "FILESYSTEM_ENTRY_DELETE_REQUESTED" ? parentFilesystemPath(event.path) : ".",
    })),
  },
}).createMachine({
  id: "home",
  type: "parallel",
  context: ({ input }) => ({
    projectId: null,
    initiallyActive: input.active,
    timeoutMs: input.timeoutMs,
    threadListLimit: input.threadListLimit,
    services: input.services,
    threads: {
      items: [],
      nextCursor: null,
      selectedThreadId: input.initialThreadId ?? null,
      request: null,
      error: null,
      searchDraft: "",
      searchTerm: null,
      expanded: false,
    },
    filesystem: {
      rootPath: HOME_FILESYSTEM_ROOT_PATH,
      entries: {},
      childrenByPath: {},
      loadedPaths: {},
      loadingPaths: {},
      requestIdsByPath: {},
      expandedIds: [],
      selectedPath: null,
      error: null,
      mutating: false,
      mutationRequestId: null,
      dirty: false,
    },
  }),
  invoke: { id: "effects", src: "effects", input: ({ context }) => context },
  on: {
    PROJECT_SCOPE_CHANGED: {
      actions: [
        assign(({ context, event }) => ({
          projectId: event.projectId,
          threads: { ...context.threads, items: [], nextCursor: null, selectedThreadId: null, request: null, error: null },
          filesystem: {
            ...context.filesystem,
            rootPath: event.projectId ? `projects/${event.projectId}` : HOME_FILESYSTEM_ROOT_PATH,
            entries: {}, childrenByPath: {}, loadedPaths: {}, loadingPaths: {}, requestIdsByPath: {},
            expandedIds: [], selectedPath: null, error: null,
          },
        })),
        "listThreads",
        "listFilesystem",
        "syncFilesystemWatches",
      ],
    },
    THREAD_LIST_REFRESH_REQUESTED: { actions: "listThreads" },
    THREAD_LIST_LOAD_MORE_REQUESTED: { actions: "listMoreThreads" },
    THREAD_LIST_EXPANSION_TOGGLED: {
      actions: assign({ threads: ({ context }) => ({ ...context.threads, expanded: !context.threads.expanded }) }),
    },
    THREAD_SEARCH_DRAFT_CHANGED: {
      actions: [
        assign({ threads: ({ context, event }) => ({
          ...context.threads,
          searchDraft: event.draft,
          searchTerm: event.draft.trim() || null,
          expanded: false,
        }) }),
        "listThreads",
      ],
    },
    THREAD_LIST_REQUEST_STARTED: {
      actions: assign({ threads: ({ context, event }) => ({
        ...context.threads,
        request: { requestId: event.requestId, append: event.append, searchTerm: event.searchTerm },
        error: null,
      }) }),
    },
    THREAD_LIST_LOADED: {
      actions: assign({ threads: ({ context, event }) => {
        if (context.threads.request?.requestId !== event.requestId) return context.threads;
        const items = event.append
          ? mergeThreads(context.threads.items, event.result.items)
          : event.result.items;
        return {
          ...context.threads,
          items,
          nextCursor: event.result.page.next_cursor,
          request: null,
          error: null,
        };
      } }),
    },
    THREAD_LIST_FAILED: {
      actions: assign({ threads: ({ context, event }) => (
        context.threads.request?.requestId === event.requestId
          ? { ...context.threads, request: null, error: event.error }
          : context.threads
      ) }),
    },
    THREAD_SELECTED: {
      actions: assign({ threads: ({ context, event }) => ({
        ...context.threads,
        selectedThreadId: event.threadId,
      }) }),
    },
    NEW_CHAT_REQUESTED: {
      actions: assign({ threads: ({ context }) => ({
        ...context.threads,
        selectedThreadId: null,
      }) }),
    },
    FILESYSTEM_DIRECTORY_LOAD_REQUESTED: { actions: "listFilesystem" },
    FILESYSTEM_REFRESH_REQUESTED: { actions: "listFilesystem" },
    FILESYSTEM_EXPANSION_CHANGED: {
      actions: [
        assign({ filesystem: ({ context, event }) => ({
          ...context.filesystem,
          expandedIds: [...event.expandedIds],
        }) }),
        "listFilesystem",
        "syncFilesystemWatches",
      ],
    },
    FILESYSTEM_DIRECTORY_REQUEST_STARTED: {
      actions: assign({ filesystem: ({ context, event }) => ({
        ...context.filesystem,
        loadingPaths: { ...context.filesystem.loadingPaths, [event.path]: true },
        requestIdsByPath: { ...context.filesystem.requestIdsByPath, [event.path]: event.requestId },
        error: null,
      }) }),
    },
    FILESYSTEM_DIRECTORY_LOADED: {
      actions: assign({ filesystem: ({ context, event }) => (
        context.filesystem.requestIdsByPath[event.path] !== event.requestId
          ? context.filesystem
          : applyFilesystemList(context.filesystem, event.path, event.result)
      ) }),
    },
    FILESYSTEM_DIRECTORY_FAILED: {
      actions: assign({ filesystem: ({ context, event }) => ({
        ...context.filesystem,
        loadingPaths: omitKey(context.filesystem.loadingPaths, event.path),
        error: event.error,
      }) }),
    },
    FILESYSTEM_ENTRY_CREATE_REQUESTED: { actions: "createFilesystem" },
    FILESYSTEM_ENTRY_RENAME_REQUESTED: { actions: "renameFilesystem" },
    FILESYSTEM_ENTRY_DELETE_REQUESTED: { actions: "deleteFilesystem" },
    FILESYSTEM_MUTATION_REQUEST_STARTED: {
      actions: assign({ filesystem: ({ context, event }) => ({
        ...context.filesystem,
        mutating: true,
        mutationRequestId: event.requestId,
        error: null,
      }) }),
    },
    FILESYSTEM_MUTATION_RELOADED: {
      actions: assign({ filesystem: ({ context, event }) => {
        if (context.filesystem.mutationRequestId !== event.requestId) return context.filesystem;
        return {
          ...applyFilesystemList(context.filesystem, event.parentPath, event.result),
          mutating: false,
          mutationRequestId: null,
          selectedPath: event.selectedPath,
        };
      } }),
    },
    FILESYSTEM_MUTATION_FAILED: {
      actions: assign({ filesystem: ({ context, event }) => (
        context.filesystem.mutationRequestId === event.requestId
          ? { ...context.filesystem, mutating: false, mutationRequestId: null, error: event.error }
          : context.filesystem
      ) }),
    },
    FILESYSTEM_EVENT_RECEIVED: {
      actions: ["listFilesystem"],
    },
    FILESYSTEM_WATCH_FAILED: {
      actions: assign({ filesystem: ({ context, event }) => ({ ...context.filesystem, error: event.error, dirty: true }) }),
    },
    FILESYSTEM_ENTRY_SELECTED: {
      actions: assign({ filesystem: ({ context, event }) => ({ ...context.filesystem, selectedPath: event.path }) }),
    },
  },
  states: {
    lifecycle: {
      initial: "inactive",
      states: {
        inactive: {
          on: {
            HOME_ACTIVATED: {
              target: "active",
              actions: ["listThreads", "listFilesystem", "syncFilesystemWatches"],
            },
          },
        },
        active: {
          tags: "home-active",
          on: {
            HOME_ACTIVATED: {
              actions: ["listThreads", "listFilesystem", "syncFilesystemWatches"],
            },
            HOME_DEACTIVATED: {
              target: "inactive",
              actions: "stopFilesystemWatches",
            },
          },
        },
      },
    },
    leftPanel: {
      initial: "closed",
      states: {
        closed: { on: { LEFT_PANEL_OPENED: "open" } },
        open: { tags: "home-left-open", on: { LEFT_PANEL_CLOSED: "closed" } },
      },
    },
    rightPanel: {
      initial: "open",
      states: {
        closed: { on: { RIGHT_PANEL_OPENED: "open" } },
        open: {
          tags: "home-right-open",
          initial: "browsing",
          states: {
            browsing: { on: { THREAD_SEARCH_OPENED: "searching" } },
            searching: { tags: "home-thread-searching", on: { THREAD_SEARCH_CLOSED: "browsing" } },
          },
          on: { RIGHT_PANEL_CLOSED: "closed" },
        },
      },
    },
  },
});

function applyFilesystemList(
  state: HomeMachineContext["filesystem"],
  path: string,
  result: HomeFilesystemListResult,
): HomeMachineContext["filesystem"] {
  const entries = { ...state.entries, [result.parent.path]: result.parent };
  for (const child of result.children) entries[child.path] = child;
  return {
    ...state,
    entries,
    childrenByPath: {
      ...state.childrenByPath,
      [path]: result.children.map((child) => child.path),
    },
    loadedPaths: { ...state.loadedPaths, [path]: true },
    loadingPaths: omitKey(state.loadingPaths, path),
    error: null,
    dirty: false,
  };
}

function mergeThreads(current: HomeThreadSummary[], incoming: HomeThreadSummary[]): HomeThreadSummary[] {
  const byId = new Map(current.map((thread) => [thread.thread_id, thread]));
  for (const thread of incoming) byId.set(thread.thread_id, thread);
  return [...byId.values()];
}

function normalizeFilesystemPath(path: string): string {
  const trimmed = path.trim().replace(/^\/+/u, "").replace(/\/+$/u, "");
  return trimmed && trimmed !== "." ? trimmed : ".";
}

function parentFilesystemPath(path: string): string {
  const normalized = normalizeFilesystemPath(path);
  const index = normalized.lastIndexOf("/");
  return index < 0 ? "." : normalized.slice(0, index) || ".";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function omitKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([candidate]) => candidate !== key));
}
