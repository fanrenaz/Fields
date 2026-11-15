import { open, type FileHandle } from "node:fs/promises";

import type { ClientRequest } from "../../generated/codex-app-server-protocol/ClientRequest.js";
import type { InitializeParams } from "../../generated/codex-app-server-protocol/InitializeParams.js";
import type { RequestId } from "../../generated/codex-app-server-protocol/RequestId.js";
import type { ThreadForkParams } from "../../generated/codex-app-server-protocol/v2/ThreadForkParams.js";
import type { ThreadDeleteParams } from "../../generated/codex-app-server-protocol/v2/ThreadDeleteParams.js";
import type { ThreadInjectItemsParams } from "../../generated/codex-app-server-protocol/v2/ThreadInjectItemsParams.js";
import type { ThreadListParams } from "../../generated/codex-app-server-protocol/v2/ThreadListParams.js";
import type { ThreadReadParams } from "../../generated/codex-app-server-protocol/v2/ThreadReadParams.js";
import type { ThreadResumeParams } from "../../generated/codex-app-server-protocol/v2/ThreadResumeParams.js";
import type { ThreadSearchParams } from "../../generated/codex-app-server-protocol/v2/ThreadSearchParams.js";
import type { ThreadStartParams } from "../../generated/codex-app-server-protocol/v2/ThreadStartParams.js";
import type { TurnStartParams } from "../../generated/codex-app-server-protocol/v2/TurnStartParams.js";
import type { PluginInstallParams } from "../../generated/codex-app-server-protocol/v2/PluginInstallParams.js";
import type { PluginReadParams } from "../../generated/codex-app-server-protocol/v2/PluginReadParams.js";
import type { PluginReadResponse } from "../../generated/codex-app-server-protocol/v2/PluginReadResponse.js";
import type { ChatgptAuthTokensRefreshParams } from "../../generated/codex-app-server-protocol/v2/ChatgptAuthTokensRefreshParams.js";
import type { ChatgptAuthTokensRefreshResponse } from "../../generated/codex-app-server-protocol/v2/ChatgptAuthTokensRefreshResponse.js";
import type { JsonValue } from "../../generated/codex-app-server-protocol/serde_json/JsonValue.js";
import { CodexAppServerClient, type AppServerClient } from "./codex-app-server-client.js";
import {
  FIELDS_CORE_MCP_SERVER_NAMES,
  FIELDS_CORE_PLUGIN_ID,
  FIELDS_CORE_PLUGIN_NAME,
  FIELDS_PLUGIN_MARKETPLACE_NAME,
} from "../codex/fields-plugin.js";
import { recordPluginOperation } from "../../observability/events.js";

export type { AppServerClient } from "./codex-app-server-client.js";

export const MCP_ELICITATION_METHOD = "mcpServer/elicitation/request";
export const CHATGPT_AUTH_TOKENS_REFRESH_METHOD = "account/chatgptAuthTokens/refresh";
export const FIELDS_MCP_SERVER_NAME = "fields_embodiment";
export const DEFAULT_APP_SERVER_COMMAND = ["codex", "--enable", "default_mode_request_user_input", "app-server", "--stdio"] as const;
export const NATIVE_APPROVAL_METHODS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "applyPatchApproval",
  "execCommandApproval",
]);
export const REQUEST_USER_INPUT_METHOD = "item/tool/requestUserInput";

export type CodexAppServerTurnResult = {
  completed: boolean;
  elicitationSeen: boolean;
  fieldsMcpCompleted: boolean;
  agentText: string;
  threadId: string | null;
  turnId: string | null;
};

export type CodexAppServerRawEvent = {
  method: string;
  payload: unknown;
  message: Record<string, unknown>;
  requestId: RequestId | null;
  respond: ((response: Record<string, unknown>) => Promise<void>) | null;
  threadId: string | null;
  turnId: string | null;
  itemId: string | null;
  occurredAtMs: number;
};

export type CodexAppServerTurnStreamResult = {
  threadId: string;
  turnId: string;
  completed: Promise<CodexAppServerTurnResult>;
};

export type FieldsCorePluginHealth = {
  pluginId: typeof FIELDS_CORE_PLUGIN_ID;
  pluginName: typeof FIELDS_CORE_PLUGIN_NAME;
  marketplaceName: typeof FIELDS_PLUGIN_MARKETPLACE_NAME;
  version: string;
  installed: true;
  enabled: true;
  mcpServerNames: readonly [...typeof FIELDS_CORE_MCP_SERVER_NAMES];
};

export type CodexAppServerRawEventHandler = (event: CodexAppServerRawEvent) => Promise<void> | void;
export type ChatgptAuthTokensRefreshHandler = (
  input: ChatgptAuthTokensRefreshParams,
) => Promise<ChatgptAuthTokensRefreshResponse> | ChatgptAuthTokensRefreshResponse;

export type CodexAppServerThreadResult = {
  threadId: string;
};

export type CodexAppServerThreadForkResult = {
  threadId: string;
  parentThreadId: string;
};

export type CodexAppServerThreadReadResult = {
  threadId: string;
  thread: unknown;
};

export type CodexAppServerModelOption = {
  model: string;
  displayName: string;
  isDefault: boolean;
  defaultReasoningEffort: string | null;
  supportedReasoningEfforts: string[];
};

export type CodexAppServerModelOptionsResult = {
  items: CodexAppServerModelOption[];
  newThreadDefault: {
    model: string;
    reasoningEffort: string | null;
  } | null;
};

export type CodexAppServerThreadSettingsResult = {
  threadId: string;
  model: string;
  reasoningEffort: string | null;
};

export type CodexAppServerThreadListInput = {
  cwd: string;
  cursor?: string | null;
  limit?: number | null;
  searchTerm?: string | null;
  archived?: boolean | null;
  timeoutMs?: number;
};

export type CodexAppServerThreadListResult = {
  threads: unknown[];
  nextCursor: string | null;
  backwardsCursor: string | null;
};

export type CodexAppServerThreadSearchInput = {
  cursor?: string | null;
  limit?: number | null;
  searchTerm: string;
  archived?: boolean | null;
  timeoutMs?: number;
};

export type CodexAppServerThreadSearchResult = {
  results: unknown[];
  nextCursor: string | null;
  backwardsCursor: string | null;
};

export class CodexAppServerBridgeError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, options: { details?: Record<string, unknown> } = {}) {
    super(message);
    this.name = "CodexAppServerBridgeError";
    this.code = code;
    this.details = options.details ?? {};
  }
}

export async function runAppServerTurn(input: {
  workdir: string;
  prompt: string;
  codexThreadId?: string | null;
  forkParentThreadId?: string | null;
  forkBeforeTurnId?: string | null;
  threadSource?: string | null;
  outputPath?: string | null;
  command?: readonly string[];
  timeoutMs?: number;
  expectedMcpServer?: string;
  expectedMcpTool?: string | null;
  expectedAgentText?: string | null;
  requireElicitation?: boolean;
}): Promise<CodexAppServerTurnResult> {
  const client = CodexAppServerClient.fromProcess(input.command ?? DEFAULT_APP_SERVER_COMMAND, { workdir: input.workdir });
  try {
    return await runAppServerTurnLoop(input.workdir, client, input);
  } finally {
    await client.close();
  }
}

export async function runAppServerUnixTurn(input: {
  workdir: string;
  socketPath: string;
  prompt: string;
  codexThreadId?: string | null;
  forkParentThreadId?: string | null;
  forkBeforeTurnId?: string | null;
  threadSource?: string | null;
  outputPath?: string | null;
  timeoutMs?: number;
  expectedMcpServer?: string;
  expectedMcpTool?: string | null;
  expectedAgentText?: string | null;
  requireElicitation?: boolean;
}): Promise<CodexAppServerTurnResult> {
  const client = CodexAppServerClient.fromUnixSocket(input.socketPath);
  try {
    return await runAppServerTurnLoop(input.workdir, client, input);
  } finally {
    await client.close();
  }
}

export async function runAppServerUnixTurnStream(input: {
  workdir: string;
  socketPath: string;
  prompt: string;
  localImagePaths?: string[];
  codexThreadId?: string | null;
  forkParentThreadId?: string | null;
  forkBeforeTurnId?: string | null;
  cwd?: string | null;
  runtimeWorkspaceRoots?: string[] | null;
  clientUserMessageId?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
  developerInstructions?: string | null;
  threadConfig?: Record<string, JsonValue> | null;
  timeoutMs?: number;
  beforeTurnStart?: (input: { threadId: string; resumed: boolean }) => Promise<void> | void;
  onEvent?: CodexAppServerRawEventHandler;
  onChatgptAuthTokensRefresh?: ChatgptAuthTokensRefreshHandler;
}): Promise<CodexAppServerTurnStreamResult> {
  const client = CodexAppServerClient.fromUnixSocket(input.socketPath);
  let started = false;
  let resolveStarted: ((value: { threadId: string; turnId: string }) => void) | null = null;
  let rejectStarted: ((error: unknown) => void) | null = null;
  const startedPromise = new Promise<{ threadId: string; turnId: string }>((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });
  const completed = runAppServerTurnStreamLoop(input.workdir, client, {
    prompt: input.prompt,
    localImagePaths: input.localImagePaths ?? [],
    codexThreadId: input.codexThreadId ?? null,
    forkParentThreadId: input.forkParentThreadId ?? null,
    forkBeforeTurnId: input.forkBeforeTurnId ?? null,
    cwd: input.cwd ?? input.workdir,
    runtimeWorkspaceRoots: input.runtimeWorkspaceRoots ?? null,
    clientUserMessageId: input.clientUserMessageId ?? null,
    model: input.model ?? null,
    reasoningEffort: input.reasoningEffort ?? null,
    developerInstructions: input.developerInstructions ?? null,
    threadConfig: input.threadConfig ?? null,
    timeoutMs: input.timeoutMs,
    beforeTurnStart: input.beforeTurnStart,
    onEvent: input.onEvent,
    onChatgptAuthTokensRefresh: input.onChatgptAuthTokensRefresh,
    onStarted: (value) => {
      started = true;
      resolveStarted?.(value);
    },
  }).finally(async () => {
    await client.close();
  });
  completed.catch((error) => {
    if (!started) {
      rejectStarted?.(error);
    }
  });
  const start = await startedPromise;
  return {
    ...start,
    completed,
  };
}

export async function runAppServerUnixModelOptions(input: {
  socketPath: string;
  timeoutMs?: number;
}): Promise<CodexAppServerModelOptionsResult> {
  const client = CodexAppServerClient.fromUnixSocket(input.socketPath);
  try {
    return await runAppServerModelOptionsLoop(client, input);
  } finally {
    await client.close();
  }
}

export async function runAppServerModelOptionsLoop(
  client: AppServerClient,
  input: { timeoutMs?: number },
): Promise<CodexAppServerModelOptionsResult> {
  const deadlineMs = Date.now() + (input.timeoutMs ?? 60_000);
  const initializeId = await sendRequest(client, "initialize", initializeParams({ suppressDeltas: false }));
  let pendingInitialize: RequestId | null = initializeId;
  let pendingModels: RequestId | null = null;
  let pendingConfig: RequestId | null = null;
  let pendingRequirements: RequestId | null = null;
  let cursor: string | null = null;
  const seenCursors = new Set<string>();
  const models: CodexAppServerModelOption[] = [];
  let configModel: string | null = null;
  let configEffort: string | null = null;
  let managedModel: string | null = null;
  let managedEffort: string | null = null;
  while (Date.now() < deadlineMs) {
    const message = await client.readMessage(deadlineMs);
    if (message === null) break;
    if (message.id === pendingInitialize && "result" in message) {
      pendingInitialize = null;
      await sendNotification(client, "initialized");
      pendingModels = await sendRequest(client, "model/list", {
        cursor,
        limit: 100,
        includeHidden: false,
      });
      continue;
    }
    if (isErrorResponse(message, pendingModels)) {
      throw appServerResponseError(message, "model_list_failed", "Codex app-server failed to list models.");
    }
    if (pendingModels !== null && message.id === pendingModels && "result" in message) {
      pendingModels = null;
      const result = asRecord(message.result);
      const data = Array.isArray(result?.data) ? result.data : [];
      models.push(...data.map(projectModelOption).filter((value): value is CodexAppServerModelOption => value !== null));
      const nextCursor = stringOrNull(result?.nextCursor);
      if (nextCursor !== null) {
        if (seenCursors.has(nextCursor)) {
          throw new CodexAppServerBridgeError("invalid_app_server_response", "Codex model catalog repeated a pagination cursor.");
        }
        seenCursors.add(nextCursor);
        cursor = nextCursor;
        pendingModels = await sendRequest(client, "model/list", {
          cursor,
          limit: 100,
          includeHidden: false,
        });
      } else {
        pendingConfig = await sendRequest(client, "config/read", {
          cwd: null,
          includeLayers: false,
        });
      }
      continue;
    }
    if (isErrorResponse(message, pendingConfig)) {
      throw appServerResponseError(message, "config_read_failed", "Codex app-server failed to read model defaults.");
    }
    if (pendingConfig !== null && message.id === pendingConfig && "result" in message) {
      pendingConfig = null;
      const config = asRecord(asRecord(message.result)?.config);
      configModel = stringOrNull(config?.model);
      configEffort = stringOrNull(config?.model_reasoning_effort);
      pendingRequirements = await sendRequest(client, "configRequirements/read", undefined);
      continue;
    }
    if (isErrorResponse(message, pendingRequirements)) {
      throw appServerResponseError(message, "config_requirements_read_failed", "Codex app-server failed to read managed model defaults.");
    }
    if (pendingRequirements !== null && message.id === pendingRequirements && "result" in message) {
      const requirements = asRecord(asRecord(message.result)?.requirements);
      const modelRequirements = asRecord(requirements?.models);
      const newThread = asRecord(modelRequirements?.newThread);
      managedModel = stringOrNull(newThread?.model);
      managedEffort = stringOrNull(newThread?.modelReasoningEffort);
      return {
        items: models,
        newThreadDefault: resolveNewThreadDefault(models, {
          model: managedModel ?? configModel,
          reasoningEffort: managedEffort ?? configEffort,
        }),
      };
    }
  }
  throw new CodexAppServerBridgeError("app_server_timeout", "Codex app-server did not return model options before timeout.");
}

export async function runAppServerUnixThreadSettings(input: {
  socketPath: string;
  threadId: string;
  cwd: string;
  runtimeWorkspaceRoots: string[];
  timeoutMs?: number;
}): Promise<CodexAppServerThreadSettingsResult> {
  const client = CodexAppServerClient.fromUnixSocket(input.socketPath);
  try {
    return await runAppServerThreadSettingsLoop(client, input);
  } finally {
    await client.close();
  }
}

export async function runAppServerUnixThreadSettingsUpdate(input: {
  socketPath: string;
  threadId: string;
  cwd: string;
  runtimeWorkspaceRoots: string[];
  model: string;
  reasoningEffort: string | null;
  timeoutMs?: number;
}): Promise<CodexAppServerThreadSettingsResult> {
  const client = CodexAppServerClient.fromUnixSocket(input.socketPath);
  try {
    return await runAppServerThreadSettingsUpdateLoop(client, input);
  } finally {
    await client.close();
  }
}

export async function runAppServerThreadSettingsUpdateLoop(
  client: AppServerClient,
  input: {
    threadId: string;
    cwd: string;
    runtimeWorkspaceRoots: string[];
    model: string;
    reasoningEffort: string | null;
    timeoutMs?: number;
  },
): Promise<CodexAppServerThreadSettingsResult> {
  const deadlineMs = Date.now() + (input.timeoutMs ?? 60_000);
  const initializeId = await sendRequest(client, "initialize", initializeParams({ suppressDeltas: false }));
  let pendingInitialize: RequestId | null = initializeId;
  let pendingResume: RequestId | null = null;
  let pendingUpdate: RequestId | null = null;
  let updateAcknowledged = false;
  let confirmed: CodexAppServerThreadSettingsResult | null = null;
  while (Date.now() < deadlineMs) {
    const message = await client.readMessage(deadlineMs);
    if (message === null) break;
    if (message.id === pendingInitialize && "result" in message) {
      pendingInitialize = null;
      await sendNotification(client, "initialized");
      pendingResume = await sendRequest(client, "thread/resume", threadResumeParams(input.threadId, {
        cwd: input.cwd,
        runtimeWorkspaceRoots: input.runtimeWorkspaceRoots,
      }));
      continue;
    }
    if (isErrorResponse(message, pendingResume)) {
      throw appServerResponseError(message, "thread_resume_failed", "Codex app-server failed to resume a thread.");
    }
    if (pendingResume !== null && message.id === pendingResume && "result" in message) {
      pendingResume = null;
      pendingUpdate = await sendRequest(client, "thread/settings/update", {
        threadId: input.threadId,
        model: input.model,
        effort: input.reasoningEffort,
      });
      continue;
    }
    if (isErrorResponse(message, pendingUpdate)) {
      throw appServerResponseError(message, "thread_settings_update_failed", "Codex app-server failed to update thread settings.");
    }
    if (pendingUpdate !== null && message.id === pendingUpdate && "result" in message) {
      pendingUpdate = null;
      updateAcknowledged = true;
      if (confirmed !== null) return confirmed;
      continue;
    }
    if (message.method === "thread/settings/updated") {
      const params = asRecord(message.params);
      if (stringOrNull(params?.threadId) !== input.threadId) continue;
      confirmed = projectThreadSettings(input.threadId, params?.threadSettings);
      if (updateAcknowledged) return confirmed;
    }
  }
  throw new CodexAppServerBridgeError("app_server_timeout", "Codex app-server did not confirm thread settings before timeout.");
}

export async function runAppServerUnixFirstSubmitTurnStream(input: {
  workdir: string;
  socketPath: string;
  prompt: string;
  clientUserMessageId?: string | null;
  timeoutMs?: number;
  onEvent?: CodexAppServerRawEventHandler;
}): Promise<CodexAppServerTurnStreamResult> {
  return runAppServerUnixTurnStream({
    ...input,
    codexThreadId: null,
  });
}

export async function runAppServerUnixResumedSubmitTurnStream(input: {
  workdir: string;
  socketPath: string;
  prompt: string;
  codexThreadId: string;
  clientUserMessageId?: string | null;
  timeoutMs?: number;
  onEvent?: CodexAppServerRawEventHandler;
}): Promise<CodexAppServerTurnStreamResult> {
  return runAppServerUnixTurnStream(input);
}

export async function runAppServerUnixThreadRead(input: {
  socketPath: string;
  threadId: string;
  timeoutMs?: number;
}): Promise<CodexAppServerThreadReadResult> {
  const client = CodexAppServerClient.fromUnixSocket(input.socketPath);
  try {
    return await runAppServerThreadReadLoop(client, {
      threadId: input.threadId,
      timeoutMs: input.timeoutMs ?? 60_000,
    });
  } finally {
    await client.close();
  }
}

export async function runAppServerUnixThreadList(input: {
  socketPath: string;
} & CodexAppServerThreadListInput): Promise<CodexAppServerThreadListResult> {
  const client = CodexAppServerClient.fromUnixSocket(input.socketPath);
  try {
    return await runAppServerThreadListLoop(client, input);
  } finally {
    await client.close();
  }
}

export async function runAppServerUnixThreadSearch(input: {
  socketPath: string;
} & CodexAppServerThreadSearchInput): Promise<CodexAppServerThreadSearchResult> {
  const client = CodexAppServerClient.fromUnixSocket(input.socketPath);
  try {
    return await runAppServerThreadSearchLoop(client, input);
  } finally {
    await client.close();
  }
}

export async function runAppServerUnixThreadStart(input: {
  socketPath: string;
  threadSource?: string | null;
  cwd?: string | null;
  runtimeWorkspaceRoots?: string[] | null;
  injectAnchor?: boolean;
  timeoutMs?: number;
}): Promise<CodexAppServerThreadResult> {
  const client = CodexAppServerClient.fromUnixSocket(input.socketPath);
  try {
    return await runAppServerThreadStartLoop(client, {
      threadSource: input.threadSource ?? null,
      cwd: input.cwd ?? null,
      runtimeWorkspaceRoots: input.runtimeWorkspaceRoots ?? null,
      injectAnchor: input.injectAnchor ?? false,
      timeoutMs: input.timeoutMs ?? 60_000,
    });
  } finally {
    await client.close();
  }
}

export async function runAppServerUnixThreadInjectItems(input: {
  socketPath: string;
  threadId: string;
  items: ThreadInjectItemsParams["items"];
  timeoutMs?: number;
}): Promise<void> {
  const client = CodexAppServerClient.fromUnixSocket(input.socketPath);
  try {
    const initializeId = await sendRequest(client, "initialize", initializeParams({ suppressDeltas: false }));
    let pendingInitialize: RequestId | null = initializeId;
    let pendingInject: RequestId | null = null;
    const deadlineMs = Date.now() + (input.timeoutMs ?? 60_000);
    while (Date.now() < deadlineMs) {
      const message = await client.readMessage(deadlineMs);
      if (message === null) break;
      if (message.id === pendingInitialize && "result" in message) {
        pendingInitialize = null;
        await sendNotification(client, "initialized");
        pendingInject = await sendRequest(client, "thread/inject_items", {
          threadId: input.threadId,
          items: input.items,
        });
        continue;
      }
      if (isErrorResponse(message, pendingInject)) {
        throw appServerResponseError(message, "thread_inject_items_failed", "Codex app-server failed to inject imported history.");
      }
      if (pendingInject !== null && message.id === pendingInject && "result" in message) return;
    }
    throw new CodexAppServerBridgeError("app_server_timeout", "Timed out waiting for imported history injection.");
  } finally {
    await client.close();
  }
}

export async function runAppServerUnixThreadResume(input: {
  socketPath: string;
  threadId: string;
  cwd: string;
  runtimeWorkspaceRoots: string[];
  threadConfig?: Record<string, JsonValue> | null;
  timeoutMs?: number;
}): Promise<CodexAppServerThreadResult> {
  const client = CodexAppServerClient.fromUnixSocket(input.socketPath);
  const deadlineMs = Date.now() + (input.timeoutMs ?? 60_000);
  const initializeId = await sendRequest(client, "initialize", initializeParams({ suppressDeltas: false }));
  let pendingInitialize: RequestId | null = initializeId;
  let pendingResume: RequestId | null = null;
  try {
    while (Date.now() < deadlineMs) {
      const message = await client.readMessage(deadlineMs);
      if (message === null) break;
      if (message.id === pendingInitialize && "result" in message) {
        pendingInitialize = null;
        await sendNotification(client, "initialized");
        pendingResume = await sendRequest(client, "thread/resume", threadResumeParams(input.threadId, {
          cwd: input.cwd,
          runtimeWorkspaceRoots: input.runtimeWorkspaceRoots,
          config: input.threadConfig ?? null,
        }));
        continue;
      }
      if (isErrorResponse(message, pendingResume)) {
        throw appServerResponseError(message, "thread_resume_failed", "Codex app-server failed to resume a thread.");
      }
      if (pendingResume !== null && message.id === pendingResume && "result" in message) {
        return { threadId: threadIdFromThreadResponse(message) };
      }
    }
    throw new CodexAppServerBridgeError("app_server_timeout", "Codex app-server did not resume the thread before timeout.");
  } finally {
    await client.close();
  }
}

export async function runAppServerUnixThreadFork(input: {
  socketPath: string;
  parentThreadId: string;
  beforeTurnId?: string | null;
  lastTurnId?: string | null;
  threadSource?: string | null;
  timeoutMs?: number;
}): Promise<CodexAppServerThreadForkResult> {
  const client = CodexAppServerClient.fromUnixSocket(input.socketPath);
  try {
    return await runAppServerThreadForkLoop(client, {
      parentThreadId: input.parentThreadId,
      beforeTurnId: input.beforeTurnId ?? null,
      lastTurnId: input.lastTurnId ?? null,
      threadSource: input.threadSource ?? null,
      timeoutMs: input.timeoutMs ?? 60_000,
    });
  } finally {
    await client.close();
  }
}

export async function runAppServerUnixThreadDelete(input: {
  socketPath: string;
  threadId: string;
  timeoutMs?: number;
}): Promise<{ threadId: string; deleted: true }> {
  const client = CodexAppServerClient.fromUnixSocket(input.socketPath);
  try {
    const initializeId = await sendRequest(client, "initialize", initializeParams({ suppressDeltas: false }));
    let pendingInitialize: RequestId | null = initializeId;
    let pendingDelete: RequestId | null = null;
    const deadlineMs = Date.now() + (input.timeoutMs ?? 60_000);
    while (Date.now() < deadlineMs) {
      const message = await client.readMessage(deadlineMs);
      if (message === null) break;
      if (message.id === pendingInitialize && "result" in message) {
        pendingInitialize = null;
        await sendNotification(client, "initialized");
        const params: ThreadDeleteParams = { threadId: input.threadId };
        pendingDelete = await sendRequest(client, "thread/delete", params);
        continue;
      }
      if (isErrorResponse(message, pendingDelete)) {
        throw appServerResponseError(message, "thread_delete_failed", "Codex app-server failed to delete the thread.");
      }
      if (pendingDelete !== null && message.id === pendingDelete && "result" in message) {
        return { threadId: input.threadId, deleted: true };
      }
    }
    throw new CodexAppServerBridgeError("app_server_timeout", "Timed out waiting for Codex thread deletion.");
  } finally {
    await client.close();
  }
}

export async function installFieldsCorePlugin(input: {
  socketPath: string;
  marketplacePath: string;
  expectedVersion: string;
  timeoutMs?: number;
  nowMs?: () => number;
}): Promise<FieldsCorePluginHealth> {
  return runFieldsPluginOperation("install", input);
}

export async function verifyFieldsCorePlugin(input: {
  socketPath: string;
  marketplacePath: string;
  expectedVersion: string;
  timeoutMs?: number;
  nowMs?: () => number;
}): Promise<FieldsCorePluginHealth> {
  return runFieldsPluginOperation("verify", input);
}

async function runFieldsPluginOperation(
  operation: "install" | "verify",
  input: {
    socketPath: string;
    marketplacePath: string;
    expectedVersion: string;
    timeoutMs?: number;
    nowMs?: () => number;
  },
): Promise<FieldsCorePluginHealth> {
  const startedAt = input.nowMs?.() ?? Date.now();
  const client = CodexAppServerClient.fromUnixSocket(input.socketPath);
  try {
    const health = await runFieldsPluginOperationLoop(client, {
      operation,
      marketplacePath: input.marketplacePath,
      expectedVersion: input.expectedVersion,
      timeoutMs: input.timeoutMs,
    });
    recordPluginOperation({
      operation,
      result: "succeeded",
      durationMs: (input.nowMs?.() ?? Date.now()) - startedAt,
      version: input.expectedVersion,
    });
    return health;
  } catch (error) {
    const code = error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : `fields_plugin_${operation}_failed`;
    recordPluginOperation({
      operation,
      result: "failed",
      durationMs: (input.nowMs?.() ?? Date.now()) - startedAt,
      version: input.expectedVersion,
      code,
    });
    throw error;
  } finally {
    await client.close();
  }
}

export async function runFieldsPluginOperationLoop(
  client: AppServerClient,
  input: {
    operation: "install" | "verify";
    marketplacePath: string;
    expectedVersion: string;
    timeoutMs?: number;
  },
): Promise<FieldsCorePluginHealth> {
  const initializeId = await sendRequest(client, "initialize", initializeParams({ suppressDeltas: false }));
  let pendingInitialize: RequestId | null = initializeId;
  let pendingInstall: RequestId | null = null;
  let pendingRead: RequestId | null = null;
  const deadlineMs = Date.now() + (input.timeoutMs ?? 60_000);

  while (Date.now() < deadlineMs) {
    const message = await client.readMessage(deadlineMs);
    if (message === null) break;
    if (message.id === pendingInitialize && "result" in message) {
      pendingInitialize = null;
      await sendNotification(client, "initialized");
      if (input.operation === "install") {
        const params: PluginInstallParams = {
          marketplacePath: input.marketplacePath,
          remoteMarketplaceName: null,
          pluginName: FIELDS_CORE_PLUGIN_NAME,
        };
        pendingInstall = await sendRequest(client, "plugin/install", params);
      } else {
        pendingRead = await sendFieldsPluginRead(client, input.marketplacePath);
      }
      continue;
    }
    if (isErrorResponse(message, pendingInstall)) {
      throw appServerResponseError(
        message,
        "fields_plugin_install_failed",
        "Codex app-server failed to install the required Fields Core Plugin.",
      );
    }
    if (isErrorResponse(message, pendingRead)) {
      throw appServerResponseError(
        message,
        "fields_plugin_verify_failed",
        "Codex app-server failed to read the required Fields Core Plugin.",
      );
    }
    if (pendingInstall !== null && message.id === pendingInstall && "result" in message) {
      pendingInstall = null;
      pendingRead = await sendFieldsPluginRead(client, input.marketplacePath);
      continue;
    }
    if (pendingRead !== null && message.id === pendingRead && "result" in message) {
      return fieldsPluginHealth(message.result, input.expectedVersion);
    }
  }
  throw new CodexAppServerBridgeError(
    `fields_plugin_${input.operation}_timeout`,
    `Codex app-server did not ${input.operation} the required Fields Core Plugin before timeout.`,
  );
}

async function sendFieldsPluginRead(
  client: AppServerClient,
  marketplacePath: string,
): Promise<RequestId> {
  const params: PluginReadParams = {
    marketplacePath,
    remoteMarketplaceName: null,
    pluginName: FIELDS_CORE_PLUGIN_NAME,
  };
  return sendRequest(client, "plugin/read", params);
}

function fieldsPluginHealth(
  value: unknown,
  expectedVersion: string,
): FieldsCorePluginHealth {
  const response = asRecord(value) as PluginReadResponse | null;
  const plugin = response && asRecord(response.plugin);
  const summary = plugin && asRecord(plugin.summary);
  const mcpServers = plugin && Array.isArray(plugin.mcpServers)
    ? plugin.mcpServers.filter((name): name is string => typeof name === "string")
    : [];
  const containsUnsupportedCapabilities = plugin === null
    || !emptyArray(plugin.skills)
    || !emptyArray(plugin.hooks)
    || !emptyArray(plugin.apps)
    || !emptyArray(plugin.appTemplates)
    || !(plugin.scheduledTasks === null || emptyArray(plugin.scheduledTasks));
  if (
    plugin?.marketplaceName !== FIELDS_PLUGIN_MARKETPLACE_NAME
    || summary?.id !== FIELDS_CORE_PLUGIN_ID
    || summary.name !== FIELDS_CORE_PLUGIN_NAME
    || summary.localVersion !== expectedVersion
    || summary.installed !== true
    || summary.enabled !== true
    || !sameStringSet(mcpServers, FIELDS_CORE_MCP_SERVER_NAMES)
    || containsUnsupportedCapabilities
  ) {
    throw new CodexAppServerBridgeError(
      "fields_plugin_health_invalid",
      "Codex app-server reported a missing or drifted Fields Core Plugin.",
      {
        details: {
          plugin_id_matches: summary?.id === FIELDS_CORE_PLUGIN_ID,
          plugin_name_matches: summary?.name === FIELDS_CORE_PLUGIN_NAME,
          marketplace_matches: plugin?.marketplaceName === FIELDS_PLUGIN_MARKETPLACE_NAME,
          version_matches: summary?.localVersion === expectedVersion,
          installed: summary?.installed === true,
          enabled: summary?.enabled === true,
          mcp_servers_complete: sameStringSet(mcpServers, FIELDS_CORE_MCP_SERVER_NAMES),
          unsupported_capabilities_absent: !containsUnsupportedCapabilities,
        },
      },
    );
  }
  return {
    pluginId: FIELDS_CORE_PLUGIN_ID,
    pluginName: FIELDS_CORE_PLUGIN_NAME,
    marketplaceName: FIELDS_PLUGIN_MARKETPLACE_NAME,
    version: expectedVersion,
    installed: true,
    enabled: true,
    mcpServerNames: FIELDS_CORE_MCP_SERVER_NAMES,
  };
}

function emptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

export async function runAppServerTurnStreamLoop(
  workdir: string,
  client: AppServerClient,
  input: {
    prompt: string;
    localImagePaths?: string[];
    codexThreadId?: string | null;
    forkParentThreadId?: string | null;
    forkBeforeTurnId?: string | null;
    cwd?: string | null;
    runtimeWorkspaceRoots?: string[] | null;
    clientUserMessageId?: string | null;
    model?: string | null;
    reasoningEffort?: string | null;
    developerInstructions?: string | null;
    threadConfig?: Record<string, JsonValue> | null;
    timeoutMs?: number;
    beforeTurnStart?: (input: { threadId: string; resumed: boolean }) => Promise<void> | void;
    onEvent?: CodexAppServerRawEventHandler;
    onStarted?: (value: { threadId: string; turnId: string }) => void;
    onChatgptAuthTokensRefresh?: ChatgptAuthTokensRefreshHandler;
  },
): Promise<CodexAppServerTurnResult> {
  const initializeId = await sendRequest(client, "initialize", initializeParams({ suppressDeltas: false }));
  let threadId: string | null = input.codexThreadId ?? null;
  let turnId: string | null = null;
  let turnCompleted = false;
  let elicitationSeen = false;
  let mcpCompleted = false;
  let finalAgentText: string | null = null;
  let unphasedAgentText: string | null = null;
  let pendingInitialize: RequestId | null = initializeId;
  let pendingThreadResume: RequestId | null = null;
  let pendingThreadStart: RequestId | null = null;
  let pendingThreadFork: RequestId | null = null;
  let pendingParentInject: RequestId | null = null;
  let pendingTurnStart: RequestId | null = null;
  let forkParentInjected = false;
  const deadlineMs = Date.now() + (input.timeoutMs ?? 180_000);

  while (Date.now() < deadlineMs) {
    const message = await client.readMessage(deadlineMs);
    if (message === null) {
      break;
    }
    const event = codexRawEvent(message, client);
    if (event !== null) {
      await input.onEvent?.(event);
    }
    if (message.id === pendingInitialize && "result" in message) {
      pendingInitialize = null;
      await sendNotification(client, "initialized");
      if (input.codexThreadId) {
        pendingThreadResume = await sendRequest(client, "thread/resume", threadResumeParams(input.codexThreadId, {
          cwd: input.cwd ?? workdir,
          runtimeWorkspaceRoots: input.runtimeWorkspaceRoots ?? null,
          config: input.threadConfig ?? null,
          developerInstructions: input.developerInstructions ?? null,
        }));
      } else if (input.forkParentThreadId) {
        pendingThreadFork = await sendRequest(
          client,
          "thread/fork",
          threadForkParams(input.forkParentThreadId, {
            beforeTurnId: input.forkBeforeTurnId ?? null,
            threadSource: null,
            developerInstructions: input.developerInstructions ?? null,
          }),
        );
      } else {
        pendingThreadStart = await sendRequest(client, "thread/start", threadStartParams({
          threadSource: null,
          cwd: input.cwd ?? workdir,
          runtimeWorkspaceRoots: input.runtimeWorkspaceRoots ?? null,
          config: input.threadConfig ?? null,
          developerInstructions: input.developerInstructions ?? null,
        }));
      }
      continue;
    }
    if (isErrorResponse(message, pendingThreadResume)) {
      throw appServerResponseError(message, "thread_resume_failed", "Codex app-server failed to resume a thread.");
    }
    if (isErrorResponse(message, pendingThreadFork)) {
      const errorMessage = appServerErrorMessage(message);
      if (input.forkParentThreadId && !forkParentInjected && errorMessage.includes("no rollout found")) {
        forkParentInjected = true;
        pendingThreadFork = null;
        pendingParentInject = await sendRequest(
          client,
          "thread/inject_items",
          threadInjectItemsParams(input.forkParentThreadId),
        );
        continue;
      }
      throw appServerResponseError(message, "thread_fork_failed", "Codex app-server failed to fork a thread.");
    }
    if (isErrorResponse(message, pendingParentInject)) {
      throw appServerResponseError(
        message,
        "thread_parent_inject_failed",
        "Codex app-server failed to prepare the parent thread for fork.",
      );
    }
    if (isErrorResponse(message, pendingThreadStart)) {
      throw appServerResponseError(message, "thread_start_failed", "Codex app-server failed to start a thread.");
    }
    if (isErrorResponse(message, pendingTurnStart)) {
      throw appServerResponseError(message, "turn_start_failed", "Codex app-server failed to start a turn.");
    }
    if (pendingParentInject !== null && message.id === pendingParentInject && "result" in message) {
      pendingParentInject = null;
      if (!input.forkParentThreadId) {
        throw new CodexAppServerBridgeError("invalid_app_server_response", "parent injection completed without parent thread id.");
      }
      pendingThreadFork = await sendRequest(
        client,
        "thread/fork",
        threadForkParams(input.forkParentThreadId, {
          beforeTurnId: input.forkBeforeTurnId ?? null,
          threadSource: null,
          developerInstructions: input.developerInstructions ?? null,
        }),
      );
      continue;
    }
    if (pendingThreadResume !== null && message.id === pendingThreadResume && "result" in message) {
      pendingThreadResume = null;
      threadId = threadIdFromThreadResponse(message);
      await input.beforeTurnStart?.({ threadId, resumed: true });
      pendingTurnStart = await sendRequest(client, "turn/start", turnStartParams(
        threadId,
        input.prompt,
        input.clientUserMessageId ?? null,
        {
          cwd: input.cwd ?? workdir,
          runtimeWorkspaceRoots: input.runtimeWorkspaceRoots ?? null,
          model: input.model ?? null,
          reasoningEffort: input.reasoningEffort ?? null,
          localImagePaths: input.localImagePaths ?? [],
        },
      ));
      continue;
    }
    if (pendingThreadStart !== null && message.id === pendingThreadStart && "result" in message) {
      pendingThreadStart = null;
      threadId = threadIdFromThreadResponse(message);
      await input.beforeTurnStart?.({ threadId, resumed: false });
      pendingTurnStart = await sendRequest(client, "turn/start", turnStartParams(
        threadId,
        input.prompt,
        input.clientUserMessageId ?? null,
        {
          cwd: input.cwd ?? workdir,
          runtimeWorkspaceRoots: input.runtimeWorkspaceRoots ?? null,
          model: input.model ?? null,
          reasoningEffort: input.reasoningEffort ?? null,
          localImagePaths: input.localImagePaths ?? [],
        },
      ));
      continue;
    }
    if (pendingThreadFork !== null && message.id === pendingThreadFork && "result" in message) {
      pendingThreadFork = null;
      threadId = threadIdFromThreadResponse(message);
      await input.beforeTurnStart?.({ threadId, resumed: false });
      pendingTurnStart = await sendRequest(client, "turn/start", turnStartParams(
        threadId,
        input.prompt,
        input.clientUserMessageId ?? null,
        {
          cwd: input.cwd ?? workdir,
          runtimeWorkspaceRoots: input.runtimeWorkspaceRoots ?? null,
          model: input.model ?? null,
          reasoningEffort: input.reasoningEffort ?? null,
          localImagePaths: input.localImagePaths ?? [],
        },
      ));
      continue;
    }
    if (pendingTurnStart !== null && message.id === pendingTurnStart && "result" in message) {
      turnId = turnIdFromStartResponse(message);
      if (turnId === null || threadId === null) {
        throw new CodexAppServerBridgeError("invalid_app_server_response", "turn/start result is missing turn id.");
      }
      input.onStarted?.({ threadId, turnId });
      continue;
    }
    if (
      message.method === CHATGPT_AUTH_TOKENS_REFRESH_METHOD &&
      "id" in message &&
      input.onChatgptAuthTokensRefresh
    ) {
      const response = await input.onChatgptAuthTokensRefresh(chatgptAuthTokensRefreshParams(message.params));
      await client.sendResponse(message.id as RequestId, response);
      continue;
    }
    if (message.method === MCP_ELICITATION_METHOD && "id" in message) {
      elicitationSeen = true;
      const response = (await handleAppServerRequest(workdir, message)) ?? { action: "decline", content: null };
      await client.sendResponse(message.id as RequestId, response);
      continue;
    }
    if (message.method === "item/completed") {
      const item = completedItem(message);
      if (isExpectedMcpCall(item, FIELDS_MCP_SERVER_NAME, null) && item.status === "completed") {
        mcpCompleted = true;
      }
      if (item.type === "agentMessage" && typeof item.text === "string") {
        if (item.phase === "final_answer") finalAgentText = item.text;
        if (item.phase === null) unphasedAgentText = item.text;
      }
    }
    if (message.method === "turn/completed") {
      turnCompleted = true;
      break;
    }
  }
  const result = {
    completed: turnCompleted,
    elicitationSeen,
    fieldsMcpCompleted: mcpCompleted,
    agentText: finalAgentText ?? unphasedAgentText ?? "",
    threadId,
    turnId,
  };
  validateTurnResult(result, {
    expectedMcpTool: null,
    expectedAgentText: null,
    requireElicitation: false,
  });
  return result;
}

export async function runAppServerThreadForkLoop(
  client: AppServerClient,
  input: {
    parentThreadId: string;
    beforeTurnId?: string | null;
    lastTurnId?: string | null;
    threadSource?: string | null;
    timeoutMs?: number;
  },
): Promise<CodexAppServerThreadForkResult> {
  const initializeId = await sendRequest(client, "initialize", initializeParams({ suppressDeltas: false }));
  let pendingInitialize: RequestId | null = initializeId;
  let pendingThreadFork: RequestId | null = null;
  let pendingParentInject: RequestId | null = null;
  let parentInjected = false;
  const deadlineMs = Date.now() + (input.timeoutMs ?? 60_000);

  while (Date.now() < deadlineMs) {
    const message = await client.readMessage(deadlineMs);
    if (message === null) {
      break;
    }
    if (message.id === pendingInitialize && "result" in message) {
      pendingInitialize = null;
      await sendNotification(client, "initialized");
      pendingThreadFork = await sendRequest(
        client,
        "thread/fork",
        threadForkParams(input.parentThreadId, {
          beforeTurnId: input.beforeTurnId ?? null,
          lastTurnId: input.lastTurnId ?? null,
          threadSource: input.threadSource ?? null,
        }),
      );
      continue;
    }
    if (isErrorResponse(message, pendingThreadFork)) {
      const errorMessage = appServerErrorMessage(message);
      if (!parentInjected && errorMessage.includes("no rollout found")) {
        parentInjected = true;
        pendingThreadFork = null;
        pendingParentInject = await sendRequest(client, "thread/inject_items", threadInjectItemsParams(input.parentThreadId));
        continue;
      }
      throw appServerResponseError(message, "thread_fork_failed", "Codex app-server failed to fork a thread.");
    }
    if (isErrorResponse(message, pendingParentInject)) {
      throw appServerResponseError(
        message,
        "thread_parent_inject_failed",
        "Codex app-server failed to prepare the parent thread for fork.",
      );
    }
    if (pendingParentInject !== null && message.id === pendingParentInject && "result" in message) {
      pendingParentInject = null;
      pendingThreadFork = await sendRequest(
        client,
        "thread/fork",
        threadForkParams(input.parentThreadId, {
          beforeTurnId: input.beforeTurnId ?? null,
          lastTurnId: input.lastTurnId ?? null,
          threadSource: input.threadSource ?? null,
        }),
      );
      continue;
    }
    if (pendingThreadFork !== null && message.id === pendingThreadFork && "result" in message) {
      return {
        threadId: threadIdFromThreadResponse(message),
        parentThreadId: input.parentThreadId,
      };
    }
  }
  throw new CodexAppServerBridgeError("app_server_timeout", "Timed out waiting for Codex thread fork.");
}

export async function runAppServerThreadReadLoop(
  client: AppServerClient,
  input: { threadId: string; timeoutMs?: number },
): Promise<CodexAppServerThreadReadResult> {
  const initializeId = await sendRequest(client, "initialize", initializeParams({ suppressDeltas: false }));
  let pendingInitialize: RequestId | null = initializeId;
  let pendingThreadRead: RequestId | null = null;
  const deadlineMs = Date.now() + (input.timeoutMs ?? 60_000);

  while (Date.now() < deadlineMs) {
    const message = await client.readMessage(deadlineMs);
    if (message === null) {
      break;
    }
    if (message.id === pendingInitialize && "result" in message) {
      pendingInitialize = null;
      await sendNotification(client, "initialized");
      pendingThreadRead = await sendRequest(client, "thread/read", threadReadParams(input.threadId));
      continue;
    }
    if (isErrorResponse(message, pendingThreadRead)) {
      throw appServerResponseError(message, "thread_read_failed", "Codex app-server failed to read a thread.");
    }
    if (pendingThreadRead !== null && message.id === pendingThreadRead && "result" in message) {
      const result = asRecord(message.result);
      const thread = result?.thread;
      const threadId = threadIdFromThreadResponse(message);
      return { threadId, thread };
    }
  }
  throw new CodexAppServerBridgeError("app_server_timeout", "Timed out waiting for Codex thread read.");
}

export async function runAppServerThreadSettingsLoop(
  client: AppServerClient,
  input: {
    threadId: string;
    cwd: string;
    runtimeWorkspaceRoots: string[];
    timeoutMs?: number;
  },
): Promise<CodexAppServerThreadSettingsResult> {
  const initializeId = await sendRequest(client, "initialize", initializeParams({ suppressDeltas: false }));
  let pendingInitialize: RequestId | null = initializeId;
  let pendingResume: RequestId | null = null;
  const deadlineMs = Date.now() + (input.timeoutMs ?? 60_000);
  while (Date.now() < deadlineMs) {
    const message = await client.readMessage(deadlineMs);
    if (message === null) break;
    if (message.id === pendingInitialize && "result" in message) {
      pendingInitialize = null;
      await sendNotification(client, "initialized");
      pendingResume = await sendRequest(client, "thread/resume", threadResumeParams(input.threadId, {
        cwd: input.cwd,
        runtimeWorkspaceRoots: input.runtimeWorkspaceRoots,
      }));
      continue;
    }
    if (isErrorResponse(message, pendingResume)) {
      throw appServerResponseError(message, "thread_resume_failed", "Codex app-server failed to resume a thread.");
    }
    if (pendingResume !== null && message.id === pendingResume && "result" in message) {
      return projectThreadSettings(input.threadId, message.result);
    }
  }
  throw new CodexAppServerBridgeError("app_server_timeout", "Codex app-server did not return thread settings before timeout.");
}

export async function runAppServerThreadListLoop(
  client: AppServerClient,
  input: CodexAppServerThreadListInput,
): Promise<CodexAppServerThreadListResult> {
  const initializeId = await sendRequest(client, "initialize", initializeParams({ suppressDeltas: false }));
  let pendingInitialize: RequestId | null = initializeId;
  let pendingThreadList: RequestId | null = null;
  const deadlineMs = Date.now() + (input.timeoutMs ?? 60_000);

  while (Date.now() < deadlineMs) {
    const message = await client.readMessage(deadlineMs);
    if (message === null) {
      break;
    }
    if (message.id === pendingInitialize && "result" in message) {
      pendingInitialize = null;
      await sendNotification(client, "initialized");
      pendingThreadList = await sendRequest(client, "thread/list", threadListParams(input));
      continue;
    }
    if (isErrorResponse(message, pendingThreadList)) {
      throw appServerResponseError(message, "thread_list_failed", "Codex app-server failed to list threads.");
    }
    if (pendingThreadList !== null && message.id === pendingThreadList && "result" in message) {
      const result = asRecord(message.result);
      if (result === null || !Array.isArray(result.data)) {
        throw new CodexAppServerBridgeError("invalid_app_server_response", "thread/list result is missing thread data.");
      }
      return {
        threads: result.data,
        nextCursor: stringOrNull(result.nextCursor),
        backwardsCursor: stringOrNull(result.backwardsCursor),
      };
    }
  }
  throw new CodexAppServerBridgeError("app_server_timeout", "Timed out waiting for Codex thread list.");
}

export async function runAppServerThreadSearchLoop(
  client: AppServerClient,
  input: CodexAppServerThreadSearchInput,
): Promise<CodexAppServerThreadSearchResult> {
  const initializeId = await sendRequest(client, "initialize", initializeParams({ suppressDeltas: false }));
  let pendingInitialize: RequestId | null = initializeId;
  let pendingThreadSearch: RequestId | null = null;
  const deadlineMs = Date.now() + (input.timeoutMs ?? 60_000);

  while (Date.now() < deadlineMs) {
    const message = await client.readMessage(deadlineMs);
    if (message === null) {
      break;
    }
    if (message.id === pendingInitialize && "result" in message) {
      pendingInitialize = null;
      await sendNotification(client, "initialized");
      pendingThreadSearch = await sendRequest(client, "thread/search", threadSearchParams(input));
      continue;
    }
    if (isErrorResponse(message, pendingThreadSearch)) {
      throw appServerResponseError(message, "thread_search_failed", "Codex app-server failed to search threads.");
    }
    if (pendingThreadSearch !== null && message.id === pendingThreadSearch && "result" in message) {
      const result = asRecord(message.result);
      if (result === null || !Array.isArray(result.data)) {
        throw new CodexAppServerBridgeError("invalid_app_server_response", "thread/search result is missing search data.");
      }
      return {
        results: result.data,
        nextCursor: stringOrNull(result.nextCursor),
        backwardsCursor: stringOrNull(result.backwardsCursor),
      };
    }
  }
  throw new CodexAppServerBridgeError("app_server_timeout", "Timed out waiting for Codex thread search.");
}

export async function runAppServerThreadStartLoop(
  client: AppServerClient,
  input: {
    threadSource?: string | null;
    cwd?: string | null;
    runtimeWorkspaceRoots?: string[] | null;
    injectAnchor?: boolean;
    timeoutMs?: number;
  },
): Promise<CodexAppServerThreadResult> {
  const initializeId = await sendRequest(client, "initialize", initializeParams({ suppressDeltas: false }));
  let pendingInitialize: RequestId | null = initializeId;
  let pendingThreadStart: RequestId | null = null;
  let pendingParentInject: RequestId | null = null;
  let threadId: string | null = null;
  const deadlineMs = Date.now() + (input.timeoutMs ?? 60_000);

  while (Date.now() < deadlineMs) {
    const message = await client.readMessage(deadlineMs);
    if (message === null) {
      break;
    }
    if (message.id === pendingInitialize && "result" in message) {
      pendingInitialize = null;
      await sendNotification(client, "initialized");
      pendingThreadStart = await sendRequest(client, "thread/start", threadStartParams({
        threadSource: input.threadSource ?? null,
        cwd: input.cwd ?? null,
        runtimeWorkspaceRoots: input.runtimeWorkspaceRoots ?? null,
      }));
      continue;
    }
    if (isErrorResponse(message, pendingThreadStart)) {
      throw appServerResponseError(message, "thread_start_failed", "Codex app-server failed to start a thread.");
    }
    if (isErrorResponse(message, pendingParentInject)) {
      throw appServerResponseError(
        message,
        "thread_parent_inject_failed",
        "Codex app-server failed to prepare the parent thread for fork.",
      );
    }
    if (pendingThreadStart !== null && message.id === pendingThreadStart && "result" in message) {
      threadId = threadIdFromThreadResponse(message);
      if (!(input.injectAnchor ?? false)) {
        return { threadId };
      }
      pendingThreadStart = null;
      pendingParentInject = await sendRequest(client, "thread/inject_items", threadInjectItemsParams(threadId));
      continue;
    }
    if (pendingParentInject !== null && message.id === pendingParentInject && "result" in message) {
      if (threadId === null) {
        throw new CodexAppServerBridgeError("invalid_app_server_response", "thread setup completed without thread id.");
      }
      return { threadId };
    }
  }
  throw new CodexAppServerBridgeError("app_server_timeout", "Timed out waiting for Codex thread setup.");
}

export async function runAppServerTurnLoop(
  workdir: string,
  client: AppServerClient,
  input: {
    prompt: string;
    codexThreadId?: string | null;
    forkParentThreadId?: string | null;
    forkBeforeTurnId?: string | null;
    threadSource?: string | null;
    outputPath?: string | null;
    timeoutMs?: number;
    expectedMcpServer?: string;
    expectedMcpTool?: string | null;
    expectedAgentText?: string | null;
    requireElicitation?: boolean;
  },
): Promise<CodexAppServerTurnResult> {
  const initializeId = await sendRequest(client, "initialize", initializeParams({ suppressDeltas: true }));
  let threadId: string | null = null;
  let turnId: string | null = null;
  let turnCompleted = false;
  let elicitationSeen = false;
  let mcpCompleted = false;
  let finalAgentText: string | null = null;
  let unphasedAgentText: string | null = null;
  let pendingInitialize: RequestId | null = initializeId;
  let pendingThreadResume: RequestId | null = null;
  let pendingThreadStart: RequestId | null = null;
  let pendingThreadFork: RequestId | null = null;
  let pendingParentInject: RequestId | null = null;
  let pendingTurnStart: RequestId | null = null;
  const pendingToolOutputInjections = new Set<RequestId>();
  let forkParentInjected = false;
  const seenAppServerRequests: Array<Record<string, unknown>> = [];
  let lastThreadStatus: unknown = null;
  const deadlineMs = Date.now() + (input.timeoutMs ?? 180_000);
  const output = input.outputPath ? await open(input.outputPath, "w") : null;

  try {
    while (Date.now() < deadlineMs) {
      const message = await client.readMessage(deadlineMs);
      if (message === null) {
        break;
      }
      if (output !== null) {
        await output.write(`${JSON.stringify(message)}\n`);
      }
      if (message.method === "thread/status/changed") {
        lastThreadStatus = asRecord(message.params)?.status ?? null;
      }
      const request = appServerRequestDiagnostic(message);
      if (request !== null) {
        seenAppServerRequests.push(request);
        if (request.method !== MCP_ELICITATION_METHOD) {
          await writeBridgeDiagnostic(output, "codex.bridge.unhandled_app_server_request", {
            request,
            native_approval: typeof request.method === "string" && NATIVE_APPROVAL_METHODS.has(request.method),
          });
        }
      }

      if (message.id === pendingInitialize && "result" in message) {
        pendingInitialize = null;
        await sendNotification(client, "initialized");
        if (input.codexThreadId) {
          threadId = input.codexThreadId;
          pendingThreadResume = await sendRequest(client, "thread/resume", threadResumeParams(threadId));
        } else if (input.forkParentThreadId) {
          pendingThreadFork = await sendRequest(
            client,
            "thread/fork",
            threadForkParams(input.forkParentThreadId, {
              beforeTurnId: input.forkBeforeTurnId ?? null,
              threadSource: input.threadSource ?? null,
            }),
          );
        } else {
          pendingThreadStart = await sendRequest(client, "thread/start", threadStartParams({ threadSource: input.threadSource ?? null }));
        }
        continue;
      }

      if (isErrorResponse(message, pendingThreadFork)) {
        const errorMessage = appServerErrorMessage(message);
        if (input.forkParentThreadId && !forkParentInjected && errorMessage.includes("no rollout found")) {
          forkParentInjected = true;
          pendingThreadFork = null;
          pendingParentInject = await sendRequest(client, "thread/inject_items", threadInjectItemsParams(input.forkParentThreadId));
          continue;
        }
        throw appServerResponseError(message, "thread_fork_failed", "Codex app-server failed to fork a thread.");
      }
      if (isErrorResponse(message, pendingParentInject)) {
        throw appServerResponseError(
          message,
          "thread_parent_inject_failed",
          "Codex app-server failed to prepare the parent thread for fork.",
        );
      }
      if (isErrorResponse(message, pendingThreadStart)) {
        throw appServerResponseError(message, "thread_start_failed", "Codex app-server failed to start a thread.");
      }
      if (isErrorResponse(message, pendingThreadResume)) {
        throw appServerResponseError(message, "thread_resume_failed", "Codex app-server failed to resume a thread.");
      }
      if (isErrorResponse(message, pendingTurnStart)) {
        throw appServerResponseError(message, "turn_start_failed", "Codex app-server failed to start a turn.");
      }
      for (const requestId of pendingToolOutputInjections) {
        if (isErrorResponse(message, requestId)) {
          throw appServerResponseError(message, "tool_output_inject_failed", "Codex app-server failed to inject tool output.");
        }
      }

      if (pendingParentInject !== null && message.id === pendingParentInject && "result" in message) {
        pendingParentInject = null;
        if (!input.forkParentThreadId) {
          throw new CodexAppServerBridgeError("invalid_app_server_response", "parent injection completed without parent thread id.");
        }
        pendingThreadFork = await sendRequest(
          client,
          "thread/fork",
          threadForkParams(input.forkParentThreadId, {
            beforeTurnId: input.forkBeforeTurnId ?? null,
            threadSource: input.threadSource ?? null,
          }),
        );
        continue;
      }
      if (pendingThreadResume !== null && message.id === pendingThreadResume && "result" in message) {
        pendingThreadResume = null;
        threadId = threadIdFromThreadResponse(message);
        pendingTurnStart = await sendRequest(client, "turn/start", turnStartParams(threadId, input.prompt));
        continue;
      }
      if (pendingThreadStart !== null && message.id === pendingThreadStart && "result" in message) {
        threadId = threadIdFromThreadResponse(message);
        pendingTurnStart = await sendRequest(client, "turn/start", turnStartParams(threadId, input.prompt));
        continue;
      }
      if (pendingThreadFork !== null && message.id === pendingThreadFork && "result" in message) {
        threadId = threadIdFromThreadResponse(message);
        pendingTurnStart = await sendRequest(client, "turn/start", turnStartParams(threadId, input.prompt));
        continue;
      }
      if (pendingTurnStart !== null && message.id === pendingTurnStart && "result" in message) {
        turnId = turnIdFromStartResponse(message);
        continue;
      }
      if (pendingToolOutputInjections.has(message.id as RequestId) && "result" in message) {
        pendingToolOutputInjections.delete(message.id as RequestId);
        mcpCompleted = true;
        continue;
      }
      if (message.method === MCP_ELICITATION_METHOD && "id" in message) {
        elicitationSeen = true;
        const response = (await handleAppServerRequest(workdir, message)) ?? { action: "decline", content: null };
        await client.sendResponse(message.id as RequestId, response);
        continue;
      }
      if (message.method === "item/completed") {
        const item = completedItem(message);
        if (isExpectedMcpCall(item, input.expectedMcpServer ?? FIELDS_MCP_SERVER_NAME, input.expectedMcpTool ?? null)) {
          if (item.status === "completed") {
            mcpCompleted = true;
          } else if (item.status === "failed") {
            throw new CodexAppServerBridgeError("mcp_tool_failed", "Fields MCP tool call failed.", {
              details: { error: item.error },
            });
          }
        }
        if (item.type === "agentMessage" && typeof item.text === "string") {
          if (item.phase === "final_answer") finalAgentText = item.text;
          if (item.phase === null) unphasedAgentText = item.text;
        }
      }
      if (message.method === "turn/completed") {
        turnCompleted = true;
        break;
      }
    }
    if (!turnCompleted) {
      await writeBridgeDiagnostic(output, "codex.bridge.timeout_summary", {
        pending: {
          initialize: pendingInitialize,
          thread_resume: pendingThreadResume,
          thread_start: pendingThreadStart,
          thread_fork: pendingThreadFork,
          parent_inject: pendingParentInject,
          turn_start: pendingTurnStart,
          tool_output_injections: [...pendingToolOutputInjections],
        },
        thread_id: threadId,
        turn_id: turnId,
        last_thread_status: lastThreadStatus,
        seen_app_server_requests: seenAppServerRequests.map((request) => ({
          id: request.id,
          method: request.method,
          native_approval: typeof request.method === "string" && NATIVE_APPROVAL_METHODS.has(request.method),
        })),
      });
    }

    const result = {
      completed: turnCompleted,
      elicitationSeen,
      fieldsMcpCompleted: mcpCompleted,
      agentText: finalAgentText ?? unphasedAgentText ?? "",
      threadId,
      turnId,
    };
    validateTurnResult(result, {
      expectedMcpTool: input.expectedMcpTool ?? null,
      expectedAgentText: input.expectedAgentText ?? null,
      requireElicitation: input.requireElicitation ?? true,
    });
    return result;
  } finally {
    await output?.close();
  }
}

export async function handleAppServerRequest(
  workdir: string,
  request: Record<string, unknown>,
  options: { timeoutMs?: number } = {},
): Promise<Record<string, unknown> | null> {
  if (request.method !== MCP_ELICITATION_METHOD) {
    return null;
  }
  const params = asRecord(request.params);
  if (params === null) {
    throw new CodexAppServerBridgeError("invalid_app_server_request", "Codex app-server MCP elicitation request is missing params.", {
      details: { request },
    });
  }
  if (params.serverName !== FIELDS_MCP_SERVER_NAME) {
    return declineResponse("Only Fields MCP elicitations are handled by the Fields Codex bridge.");
  }
  return mcpElicitationDecision(workdir, request, options);
}

export async function mcpElicitationDecision(
  workdir: string,
  request: Record<string, unknown>,
  _options: { timeoutMs?: number } = {},
): Promise<Record<string, unknown>> {
  const params = asRecord(request.params);
  if (params === null) {
    throw new CodexAppServerBridgeError("invalid_app_server_request", "Codex app-server MCP elicitation request is missing params.", {
      details: { request },
    });
  }
  void workdir;
  void request;
  return { action: "accept", content: {} };
}

export async function sendRequest(
  client: AppServerClient,
  method: ClientRequest["method"],
  params: ClientRequest["params"],
): Promise<RequestId> {
  return client.sendRequest(method, params);
}

export async function sendNotification(client: AppServerClient, method: "initialized"): Promise<void> {
  await client.sendNotification({ method });
}

export function threadStartParams(input: {
  threadSource?: string | null;
  cwd?: string | null;
  runtimeWorkspaceRoots?: string[] | null;
  config?: Record<string, JsonValue> | null;
  developerInstructions?: string | null;
} = {}): ThreadStartParams {
  return {
    model: null,
    modelProvider: null,
    cwd: input.cwd ?? null,
    runtimeWorkspaceRoots: input.runtimeWorkspaceRoots ?? null,
    approvalPolicy: null,
    approvalsReviewer: null,
    sandbox: null,
    permissions: null,
    config: input.config ?? null,
    serviceName: null,
    baseInstructions: null,
    developerInstructions: input.developerInstructions ?? null,
    personality: null,
    ephemeral: null,
    sessionStartSource: null,
    threadSource: input.threadSource ?? null,
    environments: null,
    dynamicTools: null,
    selectedCapabilityRoots: null,
    mockExperimentalField: null,
  };
}

export function threadReadParams(threadId: string): ThreadReadParams {
  return {
    threadId,
    includeTurns: true,
  };
}

export function threadListParams(input: CodexAppServerThreadListInput): ThreadListParams {
  const params: ThreadListParams = {
    cwd: input.cwd,
  };
  if (input.cursor !== undefined) {
    params.cursor = input.cursor;
  }
  if (input.limit !== undefined) {
    params.limit = input.limit;
  }
  if (input.searchTerm !== undefined) {
    params.searchTerm = input.searchTerm;
  }
  if (input.archived !== undefined) {
    params.archived = input.archived;
  }
  return params;
}

export function threadSearchParams(input: CodexAppServerThreadSearchInput): ThreadSearchParams {
  const params: ThreadSearchParams = {
    searchTerm: input.searchTerm,
  };
  if (input.cursor !== undefined) {
    params.cursor = input.cursor;
  }
  if (input.limit !== undefined) {
    params.limit = input.limit;
  }
  if (input.archived !== undefined) {
    params.archived = input.archived;
  }
  return params;
}

export function threadResumeParams(
  threadId: string,
  input: {
    cwd?: string | null;
    runtimeWorkspaceRoots?: string[] | null;
    config?: Record<string, JsonValue> | null;
    developerInstructions?: string | null;
  } = {},
): ThreadResumeParams {
  return {
    threadId,
    cwd: input.cwd ?? null,
    runtimeWorkspaceRoots: input.runtimeWorkspaceRoots ?? null,
    config: input.config ?? null,
    developerInstructions: input.developerInstructions ?? null,
    excludeTurns: true,
  };
}

export function threadForkParams(
  parentThreadId: string,
  input: {
    beforeTurnId?: string | null;
    lastTurnId?: string | null;
    threadSource?: string | null;
    developerInstructions?: string | null;
  } = {},
): ThreadForkParams {
  return {
    threadId: parentThreadId,
    beforeTurnId: input.beforeTurnId ?? null,
    lastTurnId: input.lastTurnId ?? null,
    model: null,
    modelProvider: null,
    serviceTier: null,
    cwd: null,
    approvalPolicy: null,
    approvalsReviewer: null,
    sandbox: null,
    config: null,
    baseInstructions: null,
    developerInstructions: input.developerInstructions ?? null,
    ephemeral: false,
    threadSource: input.threadSource ?? null,
  };
}

export function threadInjectItemsParams(parentThreadId: string): ThreadInjectItemsParams {
  return {
    threadId: parentThreadId,
    items: [
      {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Fields Home main stream runtime anchor for future Codex thread forks.",
          },
        ],
      },
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "Runtime anchor recorded.",
          },
        ],
      },
    ],
  };
}

export function turnStartParams(
  threadId: string,
  prompt: string,
  clientUserMessageId: string | null = null,
  input: {
    cwd?: string | null;
    runtimeWorkspaceRoots?: string[] | null;
    model?: string | null;
    reasoningEffort?: string | null;
    localImagePaths?: string[];
  } = {},
): TurnStartParams {
  const userInput: TurnStartParams["input"] = [];
  if (prompt.length > 0) {
    userInput.push({ type: "text", text: prompt, text_elements: [] });
  }
  for (const path of input.localImagePaths ?? []) {
    userInput.push({ type: "localImage", path, detail: "auto" });
  }
  return {
    threadId,
    clientUserMessageId,
    input: userInput,
    responsesapiClientMetadata: null,
    additionalContext: null,
    environments: null,
    cwd: input.cwd ?? null,
    runtimeWorkspaceRoots: input.runtimeWorkspaceRoots ?? null,
    approvalPolicy: null,
    approvalsReviewer: null,
    sandboxPolicy: null,
    permissions: null,
    model: input.model ?? null,
    effort: input.reasoningEffort ?? null,
    summary: null,
    personality: null,
    collaborationMode: null,
  };
}

function chatgptAuthTokensRefreshParams(value: unknown): ChatgptAuthTokensRefreshParams {
  const params = asRecord(value);
  if (params?.reason !== "unauthorized") {
    throw new CodexAppServerBridgeError(
      "invalid_app_server_request",
      "Codex app-server token refresh request has an unsupported reason.",
    );
  }
  const previousAccountId = params.previousAccountId;
  if (previousAccountId !== undefined && previousAccountId !== null && typeof previousAccountId !== "string") {
    throw new CodexAppServerBridgeError(
      "invalid_app_server_request",
      "Codex app-server token refresh request has an invalid previous account ID.",
    );
  }
  return {
    reason: "unauthorized",
    previousAccountId: typeof previousAccountId === "string" ? previousAccountId : null,
  };
}

function initializeParams(input: { suppressDeltas: boolean }): InitializeParams {
  return {
    clientInfo: {
      name: "fields-codex-bridge",
      title: "Fields Codex Bridge",
      version: "0.1.3",
    },
    capabilities: {
      experimentalApi: true,
      requestAttestation: false,
      optOutNotificationMethods: input.suppressDeltas
        ? [
          "command/exec/outputDelta",
          "item/agentMessage/delta",
          "item/plan/delta",
          "item/fileChange/outputDelta",
          "item/reasoning/summaryTextDelta",
          "item/reasoning/textDelta",
        ]
        : [],
    },
  };
}

function declineResponse(message: string): Record<string, unknown> {
  return {
    action: "decline",
    content: null,
    _meta: {
      reason: message,
    },
  };
}

async function writeBridgeDiagnostic(output: FileHandle | null, event: string, payload: Record<string, unknown>): Promise<void> {
  if (output === null) {
    return;
  }
  await output.write(
    `${JSON.stringify({
      type: event,
      occurred_at: Date.now(),
      payload,
    })}\n`,
  );
}

function appServerRequestDiagnostic(message: Record<string, unknown>): Record<string, unknown> | null {
  if (!("id" in message) || typeof message.method !== "string" || !("params" in message)) {
    return null;
  }
  return {
    id: message.id,
    method: message.method,
    params: message.params,
  };
}

function threadIdFromThreadResponse(message: Record<string, unknown>): string {
  const result = asRecord(message.result);
  if (result === null) {
    throw new CodexAppServerBridgeError("invalid_app_server_response", "thread/start result is not an object.");
  }
  const thread = asRecord(result.thread);
  if (thread === null || typeof thread.id !== "string") {
    throw new CodexAppServerBridgeError("invalid_app_server_response", "thread/start result is missing thread id.");
  }
  return thread.id;
}

function turnIdFromStartResponse(message: Record<string, unknown>): string | null {
  const result = asRecord(message.result);
  const turn = asRecord(result?.turn);
  return typeof turn?.id === "string" ? turn.id : null;
}

function projectModelOption(value: unknown): CodexAppServerModelOption | null {
  const model = asRecord(value);
  const modelId = stringOrNull(model?.model);
  const displayName = stringOrNull(model?.displayName);
  if (modelId === null || displayName === null) return null;
  const efforts = Array.isArray(model?.supportedReasoningEfforts)
    ? model.supportedReasoningEfforts.flatMap((candidate) => {
      const effort = stringOrNull(asRecord(candidate)?.reasoningEffort);
      return effort === null ? [] : [effort];
    })
    : [];
  return {
    model: modelId,
    displayName,
    isDefault: model?.isDefault === true,
    defaultReasoningEffort: stringOrNull(model?.defaultReasoningEffort),
    supportedReasoningEfforts: [...new Set(efforts)],
  };
}

function resolveNewThreadDefault(
  models: readonly CodexAppServerModelOption[],
  configured: { model: string | null; reasoningEffort: string | null },
): CodexAppServerModelOptionsResult["newThreadDefault"] {
  const fallback = models.find((model) => model.isDefault) ?? models[0] ?? null;
  const modelId = configured.model ?? fallback?.model ?? null;
  if (modelId === null) return null;
  const selectedModel = models.find((model) => model.model === modelId) ?? null;
  const configuredEffort = configured.reasoningEffort;
  const supportedEffort = configuredEffort !== null
    && (selectedModel === null || selectedModel.supportedReasoningEfforts.includes(configuredEffort))
    ? configuredEffort
    : null;
  return {
    model: modelId,
    reasoningEffort: supportedEffort ?? selectedModel?.defaultReasoningEffort ?? null,
  };
}

function projectThreadSettings(threadId: string, value: unknown): CodexAppServerThreadSettingsResult {
  const settings = asRecord(value);
  const model = stringOrNull(settings?.model);
  if (model === null) {
    throw new CodexAppServerBridgeError("invalid_app_server_response", "Codex thread settings are missing the model.");
  }
  return {
    threadId,
    model,
    reasoningEffort: stringOrNull(settings?.reasoningEffort) ?? stringOrNull(settings?.effort),
  };
}

function completedItem(message: Record<string, unknown>): Record<string, unknown> {
  const params = asRecord(message.params);
  return asRecord(params?.item) ?? {};
}

function codexRawEvent(
  message: Record<string, unknown>,
  client: AppServerClient,
): CodexAppServerRawEvent | null {
  if (typeof message.method !== "string") {
    return null;
  }
  const requestId = interactiveRequestId(message);
  if ("id" in message && requestId === null) return null;
  const params = asRecord(message.params);
  const item = asRecord(params?.item);
  const turn = asRecord(params?.turn);
  return {
    method: message.method,
    payload: "params" in message ? message.params : null,
    message,
    requestId,
    respond: requestId === null
      ? null
      : (response) => client.sendResponse(requestId, response),
    threadId: stringOrNull(params?.threadId),
    turnId: stringOrNull(params?.turnId) ?? stringOrNull(turn?.id),
    itemId: stringOrNull(params?.itemId) ?? stringOrNull(item?.id),
    occurredAtMs: Date.now(),
  };
}

const INTERACTIVE_REQUEST_METHODS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "applyPatchApproval",
  "execCommandApproval",
  REQUEST_USER_INPUT_METHOD,
]);

function interactiveRequestId(message: Record<string, unknown>): RequestId | null {
  if (
    !("id" in message)
    || (typeof message.id !== "string" && typeof message.id !== "number")
    || typeof message.method !== "string"
    || !INTERACTIVE_REQUEST_METHODS.has(message.method)
  ) {
    return null;
  }
  return message.id;
}

function isExpectedMcpCall(item: Record<string, unknown>, expectedServer: string, expectedTool: string | null): boolean {
  if (item.type !== "mcpToolCall" || item.server !== expectedServer) {
    return false;
  }
  return expectedTool === null || item.tool === expectedTool;
}

function validateTurnResult(
  result: CodexAppServerTurnResult,
  input: { expectedMcpTool: string | null; expectedAgentText: string | null; requireElicitation: boolean },
): void {
  if (!result.completed) {
    throw new CodexAppServerBridgeError("app_server_timeout", "Timed out waiting for turn/completed.");
  }
  if (input.expectedMcpTool !== null && input.requireElicitation && !result.elicitationSeen) {
    throw new CodexAppServerBridgeError(
      "mcp_elicitation_missing",
      "Codex app-server did not emit mcpServer/elicitation/request.",
    );
  }
  if (input.expectedMcpTool !== null && !result.fieldsMcpCompleted) {
    throw new CodexAppServerBridgeError("mcp_tool_missing", "Fields MCP tool call did not complete.");
  }
  if (input.expectedAgentText !== null && !result.agentText.includes(input.expectedAgentText)) {
    throw new CodexAppServerBridgeError("agent_response_mismatch", "Codex app-server turn did not produce the expected agent text.", {
      details: { expected: input.expectedAgentText, agent_text: result.agentText },
    });
  }
}

function isErrorResponse(message: Record<string, unknown>, requestId: RequestId | null): boolean {
  return requestId !== null && message.id === requestId && asRecord(message.error) !== null;
}

function appServerErrorMessage(message: Record<string, unknown>): string {
  const error = asRecord(message.error);
  return typeof error?.message === "string" ? error.message : "";
}

function appServerResponseError(message: Record<string, unknown>, code: string, defaultMessage: string): CodexAppServerBridgeError {
  const error = asRecord(message.error);
  if (error === null) {
    return new CodexAppServerBridgeError(code, defaultMessage, { details: { response: message } });
  }
  return new CodexAppServerBridgeError(code, String(error.message || defaultMessage), { details: { app_server_error: error } });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function sameStringSet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length
    && expected.every((value) => actual.includes(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
