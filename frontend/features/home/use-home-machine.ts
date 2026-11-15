import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMachine } from "@xstate/react";
import { useTranslation } from "react-i18next";
import type {
  HomeFilesystemEntry,
  HomeFilesystemEntryKind,
  HomeModelOption,
  HomeModelSelection,
  HomeMemoryProfile,
  MessageImageAttachment,
  HomeProject,
} from "@fields/contracts/public/home";
import type { UIChatMessage } from "@lobechat/types";

import { message, type UiMessageValue } from "../../shared/i18n/message";
import { desktopRuntimeConfig } from "../../shared/config/runtime";
import {
  homeMachine,
  type HomeFilesystemExplorerEntry,
  type HomeMachineContext,
  type HomeThreadViewState,
} from "./home-machine";
import { defaultHomeMachineServices, type HomeMachineServices } from "../../data/home/home-machine-services";
import type { HomeThreadListPanelItem } from "./HomeThreadListPanel";
import type { PickedFile } from "../../shared/types/upload";
import type { FilesystemUploadBatchResult } from "../../data/filesystem-transfer";
import { useHomeConversation } from "../conversation/use-home-conversation";
import type { ConversationStoreApi } from "../../vendor/lobehub/store";

const DEFAULT_TURN_TIMEOUT_MS = 180_000;
const DEFAULT_THREAD_LIST_LIMIT = 20;

export type HomeFilesystemController = {
  rootId: string;
  items: Record<string, HomeFilesystemExplorerEntry>;
  expandedIds: readonly string[];
  loading: boolean;
  error: UiMessageValue;
  mutating: boolean;
  selectedId: string | null;
  refresh: () => void;
  loadDirectory: (path: string) => void;
  setExpandedIds: (ids: readonly string[]) => void;
  createEntry: (parentPath: string, kind: HomeFilesystemEntryKind, name: string) => void;
  renameEntry: (path: string, name: string) => void;
  deleteEntry: (path: string) => void;
  uploadFiles: (
    parentPath: string,
    files: PickedFile[],
  ) => Promise<FilesystemUploadBatchResult<HomeFilesystemEntry>>;
  downloadFile: (path: string) => void;
  selectEntry: (path: string | null) => void;
};

export type HomeMachineController = {
  leftPanel: {
    isOpen: boolean;
    open: () => void;
    close: () => void;
    filesystem: HomeFilesystemController;
  };
  timeline: {
    view: HomeThreadViewState;
    activeThreadId: string | null;
    messages: UIChatMessage[];
    store: ConversationStoreApi;
    generatingMessageIds: string[];
    loading: boolean;
    error: UiMessageValue;
    onEdit: (message: UIChatMessage) => void;
    onFork: (message: UIChatMessage) => void;
    onRegenerate: (message: UIChatMessage) => void;
    onDeleteThread: () => void;
    onBranchSwitch: (messageId: string, branchIndex: number) => Promise<void>;
    onRespondToQuestion: (interactionId: string, answers: Record<string, string[]>, resolution: "answered" | "dismissed" | "timed_out") => Promise<void>;
    onSnoozeQuestion: (interactionId: string, mode: "foreground" | "background") => void;
  };
  composer: {
    draft: string;
    onDraft: (draft: string) => void;
    onSend: (markdown: string, imageAttachments?: MessageImageAttachment[]) => Promise<void>;
    sendDisabled: boolean;
    statusMessage: UiMessageValue;
    error: UiMessageValue;
    model: {
      options: readonly HomeModelOption[];
      selection: HomeModelSelection | null;
      loading: boolean;
      updating: boolean;
      error: UiMessageValue;
      selectModel: (model: string) => void;
      selectReasoningEffort: (reasoningEffort: string) => void;
    };
    memory: {
      profile: HomeMemoryProfile | null;
      loading: boolean;
      updating: boolean;
      error: UiMessageValue;
      setEnabled: (enabled: boolean) => void;
      retry: () => void;
    };
  };
  rightPanel: {
    isOpen: boolean;
    open: () => void;
    close: () => void;
    threads: {
      items: HomeThreadListPanelItem[];
      loading: boolean;
      loadingMore: boolean;
      error: UiMessageValue;
      hasMore: boolean;
      expanded: boolean;
      navigationDisabled: boolean;
      search: {
        isOpen: boolean;
        draft: string;
        open: () => void;
        close: () => void;
        setDraft: (draft: string) => void;
      };
      expand: () => void;
      refresh: () => void;
      loadMore: () => void;
      select: (threadId: string) => void;
      startNew: () => void;
    };
    projects: {
      items: readonly HomeProject[];
      selectedId: string | null;
      loading: boolean;
      error: UiMessageValue;
      select: (projectId: string | null) => void;
      create: (name: string) => Promise<void>;
      rename: (projectId: string, name: string) => Promise<void>;
      remove: (projectId: string, confirmation: string) => Promise<void>;
      moveActiveThread: (projectId: string | null) => Promise<void>;
    };
  };
};

export type UseHomeMachineOptions = {
  active: boolean;
  initialThreadId?: string | null;
  modelSourceKey?: string | null;
  timeoutMs?: number;
  threadListLimit?: number;
  services?: HomeMachineServices;
};

export function useHomeMachine(options: UseHomeMachineOptions): HomeMachineController {
  const { t } = useTranslation();
  const timeoutMs = options.timeoutMs ?? runtimePositiveInteger(desktopRuntimeConfig.homeTurnTimeoutMs, DEFAULT_TURN_TIMEOUT_MS);
  const threadListLimit = options.threadListLimit ?? DEFAULT_THREAD_LIST_LIMIT;
  const services = options.services ?? defaultHomeMachineServices;
  const [snapshot, send] = useMachine(homeMachine, {
    input: {
      active: options.active,
      initialThreadId: options.initialThreadId,
      timeoutMs,
      threadListLimit,
      services,
    },
  });
  const context = snapshot.context;
  const [projects, setProjects] = useState<HomeProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<UiMessageValue>(null);
  const modelSettings = useHomeModelSettings({
    active: options.active,
    modelSourceKey: options.modelSourceKey ?? null,
    selectedThreadId: context.threads.selectedThreadId,
    services,
  });
  const conversation = useHomeConversation({
    active: options.active,
    selectedThreadId: context.threads.selectedThreadId,
    projectId: context.projectId,
    timeoutMs,
    services,
    modelSelection: modelSettings.submitSelection,
    onThreadChanged: (threadId) => {
      send({ type: "THREAD_SELECTED", threadId });
      send({ type: "THREAD_LIST_REFRESH_REQUESTED" });
    },
    onThreadDeleted: () => send({ type: "NEW_CHAT_REQUESTED" }),
  });
  const memory = useHomeMemory({ active: options.active, services });

  useEffect(() => {
    send({ type: options.active ? "HOME_ACTIVATED" : "HOME_DEACTIVATED" });
  }, [options.active, send]);

  const refreshProjects = useCallback(async () => {
    if (!options.active) return;
    setProjectsLoading(true);
    setProjectsError(null);
    try {
      setProjects((await services.listProjects()).items);
    } catch {
      setProjectsError(message("home.projectsLoadFailed"));
    } finally {
      setProjectsLoading(false);
    }
  }, [options.active, services]);

  useEffect(() => { void refreshProjects(); }, [refreshProjects]);

  const selectProject = useCallback((projectId: string | null) => send({ type: "PROJECT_SCOPE_CHANGED", projectId }), [send]);
  const createProject = useCallback(async (name: string) => {
    try {
      setProjectsError(null);
      const project = await services.createProject({ name });
      await refreshProjects();
      send({ type: "PROJECT_SCOPE_CHANGED", projectId: project.project_id });
    } catch {
      setProjectsError(message("home.projectsMutationFailed"));
    }
  }, [refreshProjects, send, services]);
  const renameProject = useCallback(async (projectId: string, name: string) => {
    try {
      setProjectsError(null);
      await services.updateProject({ projectId, name });
      await refreshProjects();
    } catch {
      setProjectsError(message("home.projectsMutationFailed"));
    }
  }, [refreshProjects, services]);
  const removeProject = useCallback(async (projectId: string, confirmation: string) => {
    try {
      setProjectsError(null);
      await services.deleteProject({ projectId, confirmation });
      if (context.projectId === projectId) send({ type: "PROJECT_SCOPE_CHANGED", projectId: null });
      await refreshProjects();
    } catch {
      setProjectsError(message("home.projectsMutationFailed"));
    }
  }, [context.projectId, refreshProjects, send, services]);
  const moveActiveThread = useCallback(async (projectId: string | null) => {
    const threadId = conversation.activeThreadId;
    if (!threadId) return;
    try {
      setProjectsError(null);
      await services.moveThreadToProject({ threadId, projectId });
      send({ type: "PROJECT_SCOPE_CHANGED", projectId });
      await refreshProjects();
    } catch {
      setProjectsError(message("home.projectsMutationFailed"));
    }
  }, [conversation.activeThreadId, refreshProjects, send, services]);

  const startNew = useCallback(() => send({ type: "NEW_CHAT_REQUESTED" }), [send]);
  const openLeft = useCallback(() => send({ type: "LEFT_PANEL_OPENED" }), [send]);
  const closeLeft = useCallback(() => send({ type: "LEFT_PANEL_CLOSED" }), [send]);
  const openRight = useCallback(() => send({ type: "RIGHT_PANEL_OPENED" }), [send]);
  const closeRight = useCallback(() => send({ type: "RIGHT_PANEL_CLOSED" }), [send]);
  const openSearch = useCallback(() => send({ type: "THREAD_SEARCH_OPENED" }), [send]);
  const closeSearch = useCallback(() => send({ type: "THREAD_SEARCH_CLOSED" }), [send]);
  const setSearchDraft = useCallback((draft: string) => send({ type: "THREAD_SEARCH_DRAFT_CHANGED", draft }), [send]);
  const expandThreads = useCallback(() => send({ type: "THREAD_LIST_EXPANSION_TOGGLED" }), [send]);
  const refreshThreads = useCallback(() => send({ type: "THREAD_LIST_REFRESH_REQUESTED" }), [send]);
  const loadMoreThreads = useCallback(() => send({ type: "THREAD_LIST_LOAD_MORE_REQUESTED" }), [send]);
  const selectThread = useCallback((threadId: string) => send({ type: "THREAD_SELECTED", threadId }), [send]);
  const refreshFilesystem = useCallback(() => send({ type: "FILESYSTEM_REFRESH_REQUESTED" }), [send]);
  const loadFilesystemDirectory = useCallback((path: string) => send({ type: "FILESYSTEM_DIRECTORY_LOAD_REQUESTED", path }), [send]);
  const setFilesystemExpandedIds = useCallback((ids: readonly string[]) => {
    if (sameStrings(ids, snapshot.context.filesystem.expandedIds)) return;
    send({ type: "FILESYSTEM_EXPANSION_CHANGED", expandedIds: ids });
  }, [send, snapshot.context.filesystem.expandedIds]);
  const createFilesystemEntry = useCallback((parentPath: string, kind: HomeFilesystemEntryKind, name: string) => send({ type: "FILESYSTEM_ENTRY_CREATE_REQUESTED", parentPath, kind, name }), [send]);
  const renameFilesystemEntry = useCallback((path: string, name: string) => send({ type: "FILESYSTEM_ENTRY_RENAME_REQUESTED", path, name }), [send]);
  const deleteFilesystemEntry = useCallback((path: string) => send({ type: "FILESYSTEM_ENTRY_DELETE_REQUESTED", path }), [send]);
  const uploadFiles = useCallback(async (parentPath: string, files: PickedFile[]) => {
    const upload = services.uploadFilesystemFiles
      ?? defaultHomeMachineServices.uploadFilesystemFiles!;
    const result = await upload({ parentPath, files });
    send({ type: "FILESYSTEM_REFRESH_REQUESTED" });
    const selected = result.uploaded.at(-1);
    if (selected) send({ type: "FILESYSTEM_ENTRY_SELECTED", path: selected.path });
    return result;
  }, [send, services]);
  const downloadFile = useCallback((path: string) => {
    const download = services.downloadFilesystemFile
      ?? defaultHomeMachineServices.downloadFilesystemFile!;
    download({ path });
  }, [services]);
  const selectFilesystemEntry = useCallback((path: string | null) => send({ type: "FILESYSTEM_ENTRY_SELECTED", path }), [send]);

  const threadItems = useMemo(() => context.threads.items.map((thread) => {
    const active = context.threads.selectedThreadId === thread.thread_id;
    return {
      id: thread.thread_id,
      title: thread.title ?? thread.preview ?? t("workspace.newChat"),
      preview: thread.preview ?? undefined,
      timeLabel: homeThreadTimeLabel(thread.updated_at_ms ?? thread.created_at_ms),
      sourceLabel: thread.origin?.kind === "imported" ? thread.origin.display_name : undefined,
      active,
      unread: thread.unread_count > 0,
      unreadCount: thread.unread_count,
      readThrough: thread.read_through,
    };
  }), [context.threads.items, context.threads.selectedThreadId, t]);
  const filesystemItems = useMemo(() => filesystemExplorerItems(context.filesystem), [context.filesystem]);

  const homeActive = snapshot.hasTag("home-active");
  const timelineView: HomeThreadViewState = conversation.activeThreadId === null
    && conversation.messages.length === 0
    ? "empty"
    : "active_thread";
  const composerError = conversation.error;

  return {
    leftPanel: {
      isOpen: snapshot.hasTag("home-left-open"),
      open: openLeft,
      close: closeLeft,
      filesystem: {
        rootId: context.filesystem.rootPath,
        items: filesystemItems,
        expandedIds: context.filesystem.expandedIds,
        loading: Object.keys(context.filesystem.loadingPaths).length > 0,
        error: context.filesystem.error,
        mutating: context.filesystem.mutating,
        selectedId: context.filesystem.selectedPath,
        refresh: refreshFilesystem,
        loadDirectory: loadFilesystemDirectory,
        setExpandedIds: setFilesystemExpandedIds,
        createEntry: createFilesystemEntry,
        renameEntry: renameFilesystemEntry,
        deleteEntry: deleteFilesystemEntry,
        uploadFiles,
        downloadFile,
        selectEntry: selectFilesystemEntry,
      },
    },
    timeline: {
      view: timelineView,
      activeThreadId: conversation.activeThreadId,
      messages: conversation.messages,
      store: conversation.store,
      generatingMessageIds: conversation.generatingMessageIds,
      loading: conversation.loading,
      error: conversation.error,
      onEdit: conversation.onEdit,
      onFork: conversation.onFork,
      onRegenerate: conversation.onRegenerate,
      onDeleteThread: conversation.onDeleteThread,
      onBranchSwitch: conversation.onBranchSwitch,
      onRespondToQuestion: conversation.onRespondToQuestion,
      onSnoozeQuestion: conversation.onSnoozeQuestion,
    },
    composer: {
      draft: conversation.draft,
      onDraft: conversation.onDraft,
      onSend: conversation.onSend,
      sendDisabled: !homeActive
        || conversation.submitting
        || conversation.loading
        || modelSettings.updating
        || memory.updating
        || memory.profile?.status === "applying",
      statusMessage: homeStatusMessage({ submitting: conversation.submitting, responding: false, reading: conversation.loading, error: composerError }, t),
      error: composerError,
      model: {
        options: modelSettings.options,
        selection: modelSettings.selection,
        loading: modelSettings.loading,
        updating: modelSettings.updating,
        error: modelSettings.error,
        selectModel: modelSettings.selectModel,
        selectReasoningEffort: modelSettings.selectReasoningEffort,
      },
      memory,
    },
    rightPanel: {
      isOpen: snapshot.hasTag("home-right-open"),
      open: openRight,
      close: closeRight,
      threads: {
        items: threadItems,
        loading: Boolean(context.threads.request && !context.threads.request.append),
        loadingMore: Boolean(context.threads.request?.append),
        error: context.threads.error,
        hasMore: Boolean(context.threads.nextCursor),
        expanded: context.threads.expanded,
        navigationDisabled: conversation.submitting,
        search: {
          isOpen: snapshot.hasTag("home-thread-searching"),
          draft: context.threads.searchDraft,
          open: openSearch,
          close: closeSearch,
          setDraft: setSearchDraft,
        },
        expand: expandThreads,
        refresh: refreshThreads,
        loadMore: loadMoreThreads,
        select: selectThread,
        startNew,
      },
      projects: {
        items: projects,
        selectedId: context.projectId,
        loading: projectsLoading,
        error: projectsError,
        select: selectProject,
        create: createProject,
        rename: renameProject,
        remove: removeProject,
        moveActiveThread,
      },
    },
  };
}

function filesystemExplorerItems(filesystem: HomeMachineContext["filesystem"]): Record<string, HomeFilesystemExplorerEntry> {
  const root = filesystem.entries[filesystem.rootPath] ?? {
    id: filesystem.rootPath,
    path: filesystem.rootPath,
    name: filesystem.rootPath,
    is_folder: true,
    size_bytes: null,
    modified_at_ms: null,
  };
  const entries = { [filesystem.rootPath]: root, ...filesystem.entries };
  return Object.fromEntries(Object.values(entries).map((entry) => [entry.path, {
    ...entry,
    id: entry.path,
    childrenIds: filesystem.childrenByPath[entry.path] ?? [],
    childrenLoaded: filesystem.loadedPaths[entry.path] === true,
    loading: filesystem.loadingPaths[entry.path] === true,
  }]));
}

function useHomeMemory(input: { active: boolean; services: HomeMachineServices }) {
  const [profile, setProfile] = useState<HomeMemoryProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<UiMessageValue>(null);

  const refresh = useCallback((showLoading: boolean) => {
    if (showLoading) setLoading(true);
    setError(null);
    void input.services.readMemory().then((value) => {
      setProfile(value);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
      setError(message("home.memoryLoadFailed"));
    });
  }, [input.services]);

  useEffect(() => {
    if (!input.active) {
      setProfile(null);
      setLoading(false);
      setUpdating(false);
      setError(null);
      return;
    }
    refresh(true);
  }, [input.active, refresh]);

  useEffect(() => {
    if (!input.active || profile?.status !== "applying") return;
    const timer = window.setInterval(() => refresh(false), 1_000);
    return () => window.clearInterval(timer);
  }, [input.active, profile?.status, refresh]);

  const update = useCallback((enabled: boolean) => {
    if (!profile || updating || profile.status === "applying") return;
    setUpdating(true);
    setError(null);
    void input.services.updateMemory({
      enabled,
      expectedRevision: profile.revision,
    }).then((value) => {
      setProfile(value);
      setUpdating(false);
    }).catch(() => {
      setUpdating(false);
      setError(message("home.memoryUpdateFailed"));
      refresh(false);
    });
  }, [input.services, profile, refresh, updating]);

  return {
    profile,
    loading,
    updating,
    error,
    setEnabled: update,
    retry: () => {
      if (profile) update(profile.enabled);
      else refresh(true);
    },
  };
}

function useHomeModelSettings(input: {
  active: boolean;
  modelSourceKey: string | null;
  selectedThreadId: string | null;
  services: HomeMachineServices;
}) {
  const [options, setOptions] = useState<readonly HomeModelOption[]>([]);
  const [defaultSelection, setDefaultSelection] = useState<HomeModelSelection | null>(null);
  const [selection, setSelection] = useState<HomeModelSelection | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<UiMessageValue>(null);
  const [newThreadExplicit, setNewThreadExplicit] = useState(false);
  const selectedThreadRef = useRef(input.selectedThreadId);
  const defaultSelectionRef = useRef(defaultSelection);
  selectedThreadRef.current = input.selectedThreadId;
  defaultSelectionRef.current = defaultSelection;

  useEffect(() => {
    if (!input.active || !input.modelSourceKey) {
      setOptions([]);
      setDefaultSelection(null);
      setSelection(null);
      setCatalogLoading(false);
      setSettingsLoading(false);
      setUpdating(false);
      setError(null);
      setNewThreadExplicit(false);
      return;
    }
    let current = true;
    setCatalogLoading(true);
    setError(null);
    void input.services.listModelOptions().then((result) => {
      if (!current) return;
      setOptions(result.items);
      setDefaultSelection(result.new_thread_default);
      if (selectedThreadRef.current === null) {
        setSelection(result.new_thread_default);
        setNewThreadExplicit(false);
      }
      setCatalogLoading(false);
    }).catch(() => {
      if (!current) return;
      setOptions([]);
      setDefaultSelection(null);
      if (selectedThreadRef.current === null) setSelection(null);
      setCatalogLoading(false);
      setError(message("home.modelOptionsLoadFailed"));
    });
    return () => {
      current = false;
    };
  }, [input.active, input.modelSourceKey, input.services]);

  useEffect(() => {
    setNewThreadExplicit(false);
    setUpdating(false);
    setError(null);
    if (!input.active || !input.modelSourceKey) return;
    if (!input.selectedThreadId) {
      setSelection(defaultSelectionRef.current);
      setSettingsLoading(false);
      return;
    }
    let current = true;
    setSelection(null);
    setSettingsLoading(true);
    void input.services.readThreadSettings({ threadId: input.selectedThreadId }).then((result) => {
      if (!current) return;
      setSelection({
        model: result.model,
        reasoning_effort: result.reasoning_effort,
      });
      setSettingsLoading(false);
    }).catch(() => {
      if (!current) return;
      setSettingsLoading(false);
      setError(message("home.modelSettingsLoadFailed"));
    });
    return () => {
      current = false;
    };
  }, [input.active, input.modelSourceKey, input.selectedThreadId, input.services]);

  const updateSelection = useCallback((next: HomeModelSelection) => {
    if (!input.selectedThreadId) {
      setSelection(next);
      setNewThreadExplicit(true);
      setError(null);
      return;
    }
    const threadId = input.selectedThreadId;
    const previous = selection;
    setSelection(next);
    setUpdating(true);
    setError(null);
    void input.services.updateThreadSettings({
      threadId,
      model: next.model,
      reasoningEffort: next.reasoning_effort,
    }).then((result) => {
      if (selectedThreadRef.current !== threadId) return;
      setSelection({
        model: result.model,
        reasoning_effort: result.reasoning_effort,
      });
      setUpdating(false);
    }).catch(() => {
      if (selectedThreadRef.current !== threadId) return;
      setSelection(previous);
      setUpdating(false);
      setError(message("home.modelSettingsUpdateFailed"));
    });
  }, [input.selectedThreadId, input.services, selection]);

  const selectModel = useCallback((model: string) => {
    const option = options.find((item) => item.model === model);
    updateSelection({
      model,
      reasoning_effort: option?.default_reasoning_effort ?? null,
    });
  }, [options, updateSelection]);
  const selectReasoningEffort = useCallback((reasoningEffort: string) => {
    if (!selection) return;
    updateSelection({
      model: selection.model,
      reasoning_effort: reasoningEffort,
    });
  }, [selection, updateSelection]);

  return {
    options,
    selection,
    loading: catalogLoading || settingsLoading,
    updating,
    error,
    selectModel,
    selectReasoningEffort,
    submitSelection: input.selectedThreadId || newThreadExplicit ? selection : null,
  };
}

function homeThreadTimeLabel(value: number | null): string {
  return value === null ? "" : new Date(value).toISOString().slice(0, 16).replace("T", " ");
}

function homeStatusMessage(
  input: { submitting: boolean; responding: boolean; reading: boolean; error: UiMessageValue },
  t: (key: string) => string,
): UiMessageValue {
  if (input.error) return input.error;
  if (input.submitting) return t("home.sending");
  if (input.responding) return t("home.responding");
  if (input.reading) return t("home.loadingChat");
  return null;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function runtimePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
