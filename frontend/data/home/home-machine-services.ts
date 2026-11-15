import type {
  HomeFilesystemDeleteResult,
  HomeFilesystemEntry,
  HomeFilesystemEntryKind,
  HomeFilesystemEvent,
  HomeFilesystemListResult,
  HomeModelOptionsResult,
  HomeMemoryProfile,
  HomeProject,
  HomeThreadDeleteResult,
  HomeThreadForkResult,
  HomeThreadListInput,
  HomeThreadListResult,
  HomeThreadReadResult,
  HomeThreadSelectResult,
  HomeThreadSearchInput,
  HomeThreadSearchResult,
  HomeThreadSettingsResult,
  HomeTurnEvent,
  HomeTurnSubmitResult,
  HomeQuestionInteractionRespondResult,
  MessageImageAttachment,
} from "@fields/contracts/public/home";
import { homeFilesystemEntrySchema } from "@fields/contracts/public/home";

import { backendTrpc } from "../boundary/backend-trpc";
import {
  downloadFilesystemFile,
  uploadFilesystemFiles,
  type FilesystemUploadBatchResult,
} from "../filesystem-transfer";
import type { PickedFile } from "../../shared/types/upload";

export type HomeTurnEventsSubscription = {
  unsubscribe: () => void;
};

export type HomeFilesystemEventsSubscription = {
  unsubscribe: () => void;
};

export type SubscribeTurnEventsHandlers = {
  onStarted?: () => void;
  onEvent: (event: HomeTurnEvent) => void;
  onError: (error: unknown) => void;
  onComplete: () => void;
};

export type SubscribeFilesystemEventsHandlers = {
  onEvent: (event: HomeFilesystemEvent) => void;
  onError: (error: unknown) => void;
  onComplete: () => void;
};

export type HomeMachineServices = {
  listProjects: () => Promise<{ items: HomeProject[] }>;
  createProject: (input: { name: string }) => Promise<HomeProject>;
  updateProject: (input: { projectId: string; name: string }) => Promise<HomeProject>;
  deleteProject: (input: { projectId: string; confirmation: string }) => Promise<{ project_id: string; deleted: true }>;
  moveThreadToProject: (input: { threadId: string; projectId: string | null }) => Promise<{ root_thread_id: string; project_id: string | null }>;
  readMemory: () => Promise<HomeMemoryProfile>;
  updateMemory: (input: {
    enabled: boolean;
    expectedRevision: number;
  }) => Promise<HomeMemoryProfile>;
  listModelOptions: () => Promise<HomeModelOptionsResult>;
  readThreadSettings: (input: {
    threadId: string;
  }) => Promise<HomeThreadSettingsResult>;
  updateThreadSettings: (input: {
    threadId: string;
    model: string;
    reasoningEffort: string | null;
  }) => Promise<HomeThreadSettingsResult>;
  listThreads: (input: {
    projectId: string | null;
    cursor: string | null;
    limit?: number;
  }) => Promise<HomeThreadListResult>;
  searchThreads: (input: {
    projectId: string | null;
    searchTerm: string;
    cursor: string | null;
    limit?: number;
  }) => Promise<HomeThreadSearchResult>;
  readThread: (input: {
    threadId: string;
  }) => Promise<HomeThreadReadResult>;
  forkThread?: (input: {
    threadId: string;
    anchorTurnId: string;
    kind: "explicit" | "edited_user_message" | "regenerated_assistant";
    prompt?: string;
    expectedRevision: number;
    idempotencyKey: string;
    timeoutMs: number;
  }) => Promise<HomeThreadForkResult>;
  selectThreadBranch?: (input: {
    rootThreadId: string;
    threadId: string;
    expectedRevision: number;
    idempotencyKey: string;
  }) => Promise<HomeThreadSelectResult>;
  deleteThread?: (input: {
    threadId: string;
    confirmation: string;
    expectedRevision: number;
    idempotencyKey: string;
  }) => Promise<HomeThreadDeleteResult>;
  submitTurn: (input: {
    threadId: string | null;
    projectId: string | null;
    prompt: string;
    clientMessageId: string;
    timeoutMs: number;
    model?: string;
    reasoningEffort?: string | null;
    imageAttachments?: MessageImageAttachment[];
  }) => Promise<HomeTurnSubmitResult>;
  respondToQuestion?: (input: {
    threadId: string;
    interactionId: string;
    answers: Record<string, string[]>;
    resolution: "answered" | "dismissed" | "timed_out";
  }) => Promise<HomeQuestionInteractionRespondResult>;
  snoozeQuestion?: (input: {
    threadId: string;
    interactionId: string;
    mode: "foreground" | "background";
  }) => Promise<number>;
  subscribeTurnEvents: (
    input: { threadId: string },
    handlers: SubscribeTurnEventsHandlers,
  ) => HomeTurnEventsSubscription;
  subscribeFilesystemEvents: (
    input: { path?: string },
    handlers: SubscribeFilesystemEventsHandlers,
  ) => HomeFilesystemEventsSubscription;
  listFilesystem: (input: {
    path: string;
  }) => Promise<HomeFilesystemListResult>;
  createFilesystemEntry: (input: {
    parentPath: string;
    name: string;
    kind: HomeFilesystemEntryKind;
  }) => Promise<HomeFilesystemEntry>;
  renameFilesystemEntry: (input: {
    path: string;
    name: string;
  }) => Promise<HomeFilesystemEntry>;
  deleteFilesystemEntry: (input: {
    path: string;
  }) => Promise<HomeFilesystemDeleteResult>;
  uploadFilesystemFiles?: (input: {
    parentPath: string;
    files: PickedFile[];
  }) => Promise<FilesystemUploadBatchResult<HomeFilesystemEntry>>;
  downloadFilesystemFile?: (input: { path: string }) => void;
};

export const defaultHomeMachineServices: HomeMachineServices = {
  async listProjects() {
    return backendTrpc.home.project.list.query({});
  },
  async createProject(input) {
    return backendTrpc.home.project.create.mutate({ name: input.name });
  },
  async updateProject(input) {
    return backendTrpc.home.project.update.mutate({ project_id: input.projectId, name: input.name });
  },
  async deleteProject(input) {
    return backendTrpc.home.project.delete.mutate({ project_id: input.projectId, confirmation: input.confirmation });
  },
  async moveThreadToProject(input) {
    return backendTrpc.home.project.thread.move.mutate({ thread_id: input.threadId, project_id: input.projectId });
  },
  async readMemory() {
    return backendTrpc.home.memory.get.query({});
  },
  async updateMemory(input) {
    return backendTrpc.home.memory.set.mutate({
      enabled: input.enabled,
      expected_revision: input.expectedRevision,
    });
  },
  async listModelOptions() {
    return backendTrpc.home.model.options.query({});
  },
  async readThreadSettings(input) {
    return backendTrpc.home.thread.settings.get.query({
      thread_id: input.threadId,
    });
  },
  async updateThreadSettings(input) {
    return backendTrpc.home.thread.settings.set.mutate({
      thread_id: input.threadId,
      model: input.model,
      reasoning_effort: input.reasoningEffort,
    });
  },
  async listThreads(input) {
    const queryInput: HomeThreadListInput = {
      ...(input.projectId ? { project_id: input.projectId } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
    };
    return backendTrpc.home.thread.list.query(queryInput);
  },
  async searchThreads(input) {
    const queryInput: HomeThreadSearchInput = {
      search_term: input.searchTerm,
      ...(input.projectId ? { project_id: input.projectId } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
    };
    return backendTrpc.home.thread.search.query(queryInput);
  },
  async readThread(input) {
    return backendTrpc.home.thread.read.query({
      thread_id: input.threadId,
    });
  },
  async forkThread(input) {
    return backendTrpc.home.thread.fork.mutate({
      thread_id: input.threadId,
      anchor_turn_id: input.anchorTurnId,
      kind: input.kind,
      ...(input.prompt ? { prompt: input.prompt } : {}),
      expected_revision: input.expectedRevision,
      idempotency_key: input.idempotencyKey,
      timeout_ms: input.timeoutMs,
    });
  },
  async selectThreadBranch(input) {
    return backendTrpc.home.thread.select.mutate({
      root_thread_id: input.rootThreadId,
      thread_id: input.threadId,
      expected_revision: input.expectedRevision,
      idempotency_key: input.idempotencyKey,
    });
  },
  async deleteThread(input) {
    return backendTrpc.home.thread.delete.mutate({
      thread_id: input.threadId,
      confirmation: input.confirmation,
      expected_revision: input.expectedRevision,
      idempotency_key: input.idempotencyKey,
    });
  },
  async submitTurn(input) {
    return backendTrpc.home.turn.submit.mutate({
      ...(input.threadId ? { thread_id: input.threadId } : {}),
      ...(input.projectId ? { project_id: input.projectId } : {}),
      prompt: input.prompt,
      client_message_id: input.clientMessageId,
      timeout_ms: input.timeoutMs,
      ...(input.model ? { model: input.model } : {}),
      ...(input.imageAttachments ? { image_attachments: input.imageAttachments } : {}),
      ...("reasoningEffort" in input ? { reasoning_effort: input.reasoningEffort } : {}),
    });
  },
  async respondToQuestion(input) {
    return backendTrpc.home.turn.respondToQuestion.mutate({
      thread_id: input.threadId,
      interaction_id: input.interactionId,
      answers: input.answers,
      resolution: input.resolution,
    });
  },
  async snoozeQuestion(input) {
    const result = await backendTrpc.home.turn.snoozeQuestion.mutate({
      thread_id: input.threadId,
      interaction_id: input.interactionId,
      mode: input.mode,
    });
    return result.deadline_at_ms;
  },
  subscribeTurnEvents(input, handlers) {
    const subscription = backendTrpc.home.turn.events.subscribe(
      {
        thread_id: input.threadId,
      },
      {
        onStarted: handlers.onStarted,
        onData: (event) => handlers.onEvent(event),
        onError: handlers.onError,
        onComplete: handlers.onComplete,
      },
    );
    return {
      unsubscribe: () => subscription.unsubscribe(),
    };
  },
  subscribeFilesystemEvents(input, handlers) {
    const subscription = backendTrpc.home.filesystem.events.subscribe(
      {
        ...(input.path ? { path: input.path } : {}),
      },
      {
        onData: (event) => handlers.onEvent(event),
        onError: handlers.onError,
        onComplete: handlers.onComplete,
      },
    );
    return {
      unsubscribe: () => subscription.unsubscribe(),
    };
  },
  async listFilesystem(input) {
    return backendTrpc.home.filesystem.list.query({
      path: input.path,
    });
  },
  async createFilesystemEntry(input) {
    return backendTrpc.home.filesystem.create.mutate({
      parent_path: input.parentPath,
      name: input.name,
      kind: input.kind,
    });
  },
  async renameFilesystemEntry(input) {
    return backendTrpc.home.filesystem.rename.mutate({
      path: input.path,
      name: input.name,
    });
  },
  async deleteFilesystemEntry(input) {
    return backendTrpc.home.filesystem.delete.mutate({
      path: input.path,
    });
  },
  uploadFilesystemFiles(input) {
    return uploadFilesystemFiles({
      endpoint: "/api/v1/files/home/upload",
      query: { parent_path: input.parentPath },
      files: input.files,
      resultSchema: homeFilesystemEntrySchema,
    });
  },
  downloadFilesystemFile(input) {
    downloadFilesystemFile("/api/v1/files/home/download", { path: input.path });
  },
};
