import type {
  AgentActivityItem,
  AgentAssistantMessageItem,
  AgentCommandAction,
  AgentCommandItem,
  AgentContent,
  AgentFileChange,
  AgentNarrativeItem,
  AgentReasoningItem,
  AgentToolCallItem,
  AgentTurnError,
  AgentTurnEvent,
  AgentTurnItem,
  AgentTurnScope,
  AgentTurnSnapshot,
  AgentTurnStatus,
} from "@fields/contracts/public/agent-activity";
import type {
  CodexAgentRuntimeEvent,
  CodexAgentRuntimeSnapshot,
} from "@fields/contracts/internal/agent-runtime";
import type { ThreadItem, Turn } from "@fields/contracts/codex-app-server-protocol/v2";
import { emitObservabilityLog } from "../../../observability/events.js";

import {
  AgentActivityConversionError,
  type AgentActivityProjection,
  type AgentActivityWarningSink,
  type AgentRuntimeActivityAdapter,
} from "./types.js";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const FILTERED_ITEM_TYPES = new Set([
  "hookPrompt",
  "sleep",
  "enteredReviewMode",
  "exitedReviewMode",
]);

const IGNORED_METHODS = new Set([
  "thread/started",
  "thread/status/changed",
  "thread/archived",
  "thread/deleted",
  "thread/unarchived",
  "thread/closed",
  "thread/name/updated",
  "thread/goal/updated",
  "thread/goal/cleared",
  "thread/settings/updated",
  "thread/tokenUsage/updated",
  "turn/diff/updated",
  "item/autoApprovalReview/started",
  "item/autoApprovalReview/completed",
  "rawResponseItem/completed",
  "command/exec/outputDelta",
  "process/outputDelta",
  "process/exited",
  "item/commandExecution/terminalInteraction",
  "item/fileChange/outputDelta",
  "serverRequest/resolved",
  "hook/started",
  "hook/completed",
  "mcpServer/oauthLogin/completed",
  "mcpServer/startupStatus/updated",
  "account/updated",
  "account/rateLimits/updated",
  "account/login/completed",
  "app/list/updated",
  "remoteControl/status/changed",
  "externalAgentConfig/import/progress",
  "externalAgentConfig/import/completed",
  "fs/changed",
  "skills/changed",
  "model/rerouted",
  "model/verification",
  "turn/moderationMetadata",
  "model/safetyBuffering/updated",
  "warning",
  "guardianWarning",
  "deprecationNotice",
  "configWarning",
  "fuzzyFileSearch/sessionUpdated",
  "fuzzyFileSearch/sessionCompleted",
  "thread/realtime/started",
  "thread/realtime/itemAdded",
  "thread/realtime/transcript/delta",
  "thread/realtime/transcript/done",
  "thread/realtime/outputAudio/delta",
  "thread/realtime/sdp",
  "thread/realtime/error",
  "thread/realtime/closed",
  "windows/worldWritableWarning",
  "windowsSandbox/setupCompleted",
]);

const defaultWarningSink: AgentActivityWarningSink = (warning) => {
  emitObservabilityLog("codex.activity.warning", {
    code: warning.code,
    retryable: false,
  });
};

export class CodexActivityAdapter implements AgentRuntimeActivityAdapter<
  CodexAgentRuntimeSnapshot,
  CodexAgentRuntimeEvent
> {
  readonly provider = "codex";
  private readonly warningSink: AgentActivityWarningSink;

  constructor(input: { warningSink?: AgentActivityWarningSink } = {}) {
    this.warningSink = input.warningSink ?? defaultWarningSink;
  }

  createProjection(): AgentActivityProjection {
    return {
      scope: null,
      snapshot: emptySnapshot(),
    };
  }

  convertSnapshot(
    projection: AgentActivityProjection,
    event: CodexAgentRuntimeSnapshot,
  ): AgentTurnEvent {
    try {
      const snapshot = projectRuntimeSnapshot(event);
      if (!bindScope(projection, event.scope)) {
        throw new AgentActivityConversionError("The runtime snapshot scope changed within one subscription.");
      }
      projection.snapshot = snapshot;
      return snapshotEvent(event, snapshot);
    } catch (error) {
      if (error instanceof AgentActivityConversionError) {
        throw error;
      }
      throw new AgentActivityConversionError("The authoritative Codex Turn snapshot could not be converted.", {
        cause: error,
      });
    }
  }

  convertEvent(
    projection: AgentActivityProjection,
    event: CodexAgentRuntimeEvent,
  ): AgentTurnEvent[] {
    if (!bindScope(projection, event.scope)) {
      throw new AgentActivityConversionError("The runtime event scope changed within one subscription.");
    }

    switch (event.method) {
      case "turn/started":
      case "turn/completed":
        return this.convertTurnLifecycle(projection, event);
      case "error":
        return [this.convertTurnError(projection, event)];
      case "item/started":
      case "item/completed":
        return this.convertItemLifecycle(projection, event);
      case "item/removed":
        return this.convertItemRemoval(projection, event);
      case "item/agentMessage/delta":
        return [this.convertMessageDelta(projection, event, "assistant_message")];
      case "item/plan/delta":
        return [this.convertMessageDelta(projection, event, "plan")];
      case "item/reasoning/summaryPartAdded":
        return [this.convertReasoningDelta(projection, event, "summary", "")];
      case "item/reasoning/summaryTextDelta":
        return [this.convertReasoningDelta(projection, event, "summary")];
      case "item/reasoning/textDelta":
        return [this.convertReasoningDelta(projection, event, "content")];
      case "item/commandExecution/outputDelta":
        return [this.convertCommandOutputDelta(projection, event)];
      case "item/fileChange/patchUpdated":
        return this.convertFileChangePatch(projection, event);
      case "item/mcpToolCall/progress":
        return [this.convertToolProgress(projection, event)];
      case "turn/plan/updated":
        return this.convertTurnPlan(projection, event);
      case "thread/compacted":
        return [this.convertContextCompaction(projection, event)];
      default:
        if (!IGNORED_METHODS.has(event.method)) {
          this.warn(event, "The provider notification is not recognized by the Codex Activity adapter.");
        }
        return [];
    }
  }

  private convertTurnLifecycle(
    projection: AgentActivityProjection,
    event: CodexAgentRuntimeEvent,
  ): AgentTurnEvent[] {
    const turn = asRecord(asRecord(event.payload)?.turn);
    if (turn === null) {
      throw invalidAuthoritativeTurnLifecycle();
    }
    try {
      const authoritative = projectTurn(turn as unknown as Turn);
      if (event.turn_id !== null && authoritative.turn_id !== event.turn_id) {
        throw invalidAuthoritativeTurnLifecycle();
      }
      const next = event.method === "turn/completed"
        ? mergeCompletedTurnSnapshot(projection.snapshot, authoritative)
        : authoritative;
      projection.snapshot = next;
      return [snapshotEvent(event, next)];
    } catch {
      throw invalidAuthoritativeTurnLifecycle();
    }
  }

  private convertTurnError(
    projection: AgentActivityProjection,
    event: CodexAgentRuntimeEvent,
  ): AgentTurnEvent {
    const payload = asRecord(event.payload);
    const error = projectError(payload?.error, "AGENT_TURN_FAILED", "Agent turn failed.");
    const willRetry = payload?.willRetry === true;
    projection.snapshot = {
      ...projection.snapshot,
      turn_id: event.turn_id ?? projection.snapshot.turn_id,
      status: willRetry ? "running" : "failed",
      error,
    };
    return statusEvent(event, projection.snapshot);
  }

  private convertItemLifecycle(
    projection: AgentActivityProjection,
    event: CodexAgentRuntimeEvent,
  ): AgentTurnEvent[] {
    const itemValue = asRecord(asRecord(event.payload)?.item);
    if (itemValue === null) {
      this.warn(event, "The item lifecycle notification did not contain an item.");
      return [];
    }
    let item: AgentTurnItem | null;
    try {
      item = projectItem(itemValue as unknown as ThreadItem);
    } catch {
      this.warn(event, `The Codex item type ${String(itemValue.type ?? "unknown")} is not supported.`);
      return [];
    }
    if (item === null) {
      return [];
    }
    item = withLifecycleStatus(item, event.method);
    const existing = findItem(projection.snapshot, item.id);
    if (item.type === "tool_call" && existing?.type === "tool_call" && item.progress.length === 0) {
      item = { ...item, progress: existing.progress };
    }
    projection.snapshot = upsertItem(projection.snapshot, item);
    return [itemUpsertEvent(event, item)];
  }

  private convertItemRemoval(
    projection: AgentActivityProjection,
    event: CodexAgentRuntimeEvent,
  ): AgentTurnEvent[] {
    const itemId = event.item_id ?? stringValue(asRecord(event.payload)?.itemId);
    if (itemId === null) {
      this.warn(event, "The item removal notification did not contain an item id.");
      return [];
    }
    projection.snapshot = removeItem(projection.snapshot, itemId);
    return [{ ...eventBase(event), type: "agent_turn.item_remove", item_id: itemId }];
  }

  private convertMessageDelta(
    projection: AgentActivityProjection,
    event: CodexAgentRuntimeEvent,
    target: "assistant_message" | "plan",
  ): AgentTurnEvent {
    const itemId = requiredItemId(event);
    const delta = redactSensitiveText(stringValue(asRecord(event.payload)?.delta) ?? "");
    const existing = findItem(projection.snapshot, itemId);
    const item = target === "assistant_message"
      ? appendAssistantDelta(existing, itemId, delta)
      : appendPlanDelta(existing, itemId, delta);
    projection.snapshot = upsertItem(projection.snapshot, item);
    return {
      ...eventBase(event),
      type: "agent_turn.message_delta",
      item_id: itemId,
      target,
      delta,
    };
  }

  private convertReasoningDelta(
    projection: AgentActivityProjection,
    event: CodexAgentRuntimeEvent,
    target: "summary" | "content",
    forcedDelta?: string,
  ): AgentTurnEvent {
    const payload = asRecord(event.payload);
    const itemId = requiredItemId(event);
    const indexField = target === "summary" ? payload?.summaryIndex : payload?.contentIndex;
    const index = nonnegativeInteger(indexField) ?? 0;
    const delta = redactSensitiveText(forcedDelta ?? stringValue(payload?.delta) ?? "");
    const item = appendReasoningDelta(findItem(projection.snapshot, itemId), itemId, target, index, delta);
    projection.snapshot = upsertItem(projection.snapshot, item);
    return {
      ...eventBase(event),
      type: "agent_turn.reasoning_delta",
      item_id: itemId,
      target,
      index,
      delta,
    };
  }

  private convertCommandOutputDelta(
    projection: AgentActivityProjection,
    event: CodexAgentRuntimeEvent,
  ): AgentTurnEvent {
    const itemId = requiredItemId(event);
    const delta = redactSensitiveText(stringValue(asRecord(event.payload)?.delta) ?? "");
    const existing = findItem(projection.snapshot, itemId);
    const item: AgentCommandItem = existing?.type === "command"
      ? { ...existing, output: (existing.output ?? "") + delta }
      : {
        id: itemId,
        type: "command",
        status: "running",
        command: "",
        cwd: null,
        actions: [],
        output: delta,
        exit_code: null,
        duration_ms: null,
      };
    projection.snapshot = upsertItem(projection.snapshot, item);
    return {
      ...eventBase(event),
      type: "agent_turn.command_output_delta",
      item_id: itemId,
      delta,
    };
  }

  private convertFileChangePatch(
    projection: AgentActivityProjection,
    event: CodexAgentRuntimeEvent,
  ): AgentTurnEvent[] {
    const itemId = requiredItemId(event);
    const values = asRecord(event.payload)?.changes;
    if (!Array.isArray(values)) {
      this.warn(event, "The file-change notification did not contain changes.");
      return [];
    }
    const changes = values.map(projectFileChange).filter((value): value is AgentFileChange => value !== null);
    const existing = findItem(projection.snapshot, itemId);
    const item: AgentActivityItem = {
      id: itemId,
      type: "file_change",
      status: existing?.type === "file_change" ? existing.status : "running",
      changes,
    };
    projection.snapshot = upsertItem(projection.snapshot, item);
    return [itemUpsertEvent(event, item)];
  }

  private convertToolProgress(
    projection: AgentActivityProjection,
    event: CodexAgentRuntimeEvent,
  ): AgentTurnEvent {
    const itemId = requiredItemId(event);
    const message = redactSensitiveText(stringValue(asRecord(event.payload)?.message) ?? "");
    const existing = findItem(projection.snapshot, itemId);
    if (existing?.type === "tool_call") {
      projection.snapshot = upsertItem(projection.snapshot, {
        ...existing,
        progress: [...existing.progress, message],
      });
    }
    return {
      ...eventBase(event),
      type: "agent_turn.tool_progress",
      item_id: itemId,
      message,
    };
  }

  private convertTurnPlan(
    projection: AgentActivityProjection,
    event: CodexAgentRuntimeEvent,
  ): AgentTurnEvent[] {
    const payload = asRecord(event.payload);
    const plan = Array.isArray(payload?.plan) ? payload.plan : [];
    const lines = plan.flatMap((value) => {
      const step = asRecord(value);
      const text = stringValue(step?.step);
      return text === null ? [] : [text];
    });
    const explanation = stringValue(payload?.explanation);
    const markdown = [explanation, lines.length > 0 ? lines.map((line) => `- ${line}`).join("\n") : null]
      .filter((value): value is string => value !== null)
      .join("\n\n");
    if (markdown.length === 0) {
      return [];
    }
    const item: AgentNarrativeItem = {
      id: `${event.turn_id ?? "turn"}:plan`,
      type: "plan",
      status: "running",
      content: [{ type: "markdown", markdown: redactSensitiveText(markdown) }],
    };
    projection.snapshot = upsertItem(projection.snapshot, item);
    return [itemUpsertEvent(event, item)];
  }

  private convertContextCompaction(
    projection: AgentActivityProjection,
    event: CodexAgentRuntimeEvent,
  ): AgentTurnEvent {
    const item: AgentActivityItem = {
      id: event.item_id ?? `${event.turn_id ?? "turn"}:context-compaction:${event.event_id}`,
      type: "context_compaction",
      status: "completed",
    };
    projection.snapshot = upsertItem(projection.snapshot, item);
    return itemUpsertEvent(event, item);
  }

  private warn(event: CodexAgentRuntimeEvent, reason: string): void {
    this.warningSink({
      code: "AGENT_RUNTIME_EVENT_IGNORED",
      provider: this.provider,
      event_id: event.event_id,
      method: event.method,
      scope_type: event.scope.type,
      reason,
    });
  }
}

function invalidAuthoritativeTurnLifecycle(): AgentActivityConversionError {
  return new AgentActivityConversionError("The authoritative Turn lifecycle event could not be converted.");
}

function mergeCompletedTurnSnapshot(
  accumulated: AgentTurnSnapshot,
  completed: AgentTurnSnapshot,
): AgentTurnSnapshot {
  if (accumulated.turn_id !== completed.turn_id) return completed;
  return {
    ...completed,
    narrative_items: mergeTurnItems(
      accumulated.narrative_items,
      completed.narrative_items,
    ),
    activity_items: mergeTurnItems(
      accumulated.activity_items,
      completed.activity_items,
    ),
  };
}

function mergeTurnItems<T extends AgentTurnItem>(
  accumulated: readonly T[],
  authoritative: readonly T[],
): T[] {
  const authoritativeById = new Map(authoritative.map((item) => [item.id, item]));
  const merged = accumulated.map((item) => authoritativeById.get(item.id) ?? item);
  const accumulatedIds = new Set(accumulated.map((item) => item.id));
  for (const item of authoritative) {
    if (!accumulatedIds.has(item.id)) merged.push(item);
  }
  return merged;
}

function projectRuntimeSnapshot(event: CodexAgentRuntimeSnapshot): AgentTurnSnapshot {
  const execution = event.payload.execution;
  if (event.payload.turn === null) {
    return {
      turn_id: event.turn_id,
      status: execution.status,
      started_at_ms: execution.started_at_ms,
      completed_at_ms: execution.completed_at_ms,
      duration_ms: execution.duration_ms ?? durationBetween(execution.started_at_ms, execution.completed_at_ms),
      error: sanitizeProjectedError(execution.error),
      narrative_items: [],
      activity_items: [],
    };
  }

  const turn = projectTurn(event.payload.turn);
  if (event.turn_id !== turn.turn_id) {
    throw new AgentActivityConversionError("The authoritative Codex Turn id did not match its runtime envelope.");
  }
  const executionOverridesTurn = execution.status === "failed" || execution.status === "declined" || execution.status === "interrupted";
  return {
    ...turn,
    status: executionOverridesTurn ? execution.status : turn.status,
    started_at_ms: turn.started_at_ms ?? execution.started_at_ms,
    completed_at_ms: turn.completed_at_ms ?? execution.completed_at_ms,
    duration_ms: turn.duration_ms
      ?? execution.duration_ms
      ?? durationBetween(turn.started_at_ms ?? execution.started_at_ms, turn.completed_at_ms ?? execution.completed_at_ms),
    error: sanitizeProjectedError(execution.error) ?? turn.error,
  };
}

function projectTurn(turn: Turn): AgentTurnSnapshot {
  if (typeof turn.id !== "string" || turn.id.length === 0 || !Array.isArray(turn.items)) {
    throw new AgentActivityConversionError("Codex returned an invalid authoritative Turn.");
  }
  const status = mapStatus(turn.status, true);
  const items = turn.items.flatMap((item) => {
    const projected = projectItem(item);
    return projected === null ? [] : [projected];
  });
  const startedAtMs = secondsToMs(turn.startedAt);
  const completedAtMs = secondsToMs(turn.completedAt);
  return {
    turn_id: turn.id,
    status,
    started_at_ms: startedAtMs,
    completed_at_ms: completedAtMs,
    duration_ms: nonnegativeInteger(turn.durationMs) ?? durationBetween(startedAtMs, completedAtMs),
    error: projectError(turn.error, "AGENT_TURN_FAILED", "Agent turn failed."),
    narrative_items: items.filter(isNarrativeItem),
    activity_items: items.filter(isActivityItem),
  };
}

export function projectCodexThreadItem(item: ThreadItem): AgentTurnItem | null {
  return projectItem(item);
}

function projectItem(item: ThreadItem): AgentTurnItem | null {
  const value = item as ThreadItem & Record<string, unknown>;
  switch (item.type) {
    case "userMessage":
      return {
        id: item.id,
        type: "user_message",
        status: "completed",
        content: projectUserMessageContent(item.content),
      };
    case "hookPrompt":
    case "sleep":
    case "enteredReviewMode":
    case "exitedReviewMode":
      return null;
    case "agentMessage":
      return {
        id: item.id,
        type: "assistant_message",
        status: "completed",
        phase: item.phase === "commentary" || item.phase === "final_answer" ? item.phase : "unknown",
        content: [{ type: "markdown", markdown: redactSensitiveText(item.text) }],
      };
    case "plan":
      return {
        id: item.id,
        type: "plan",
        status: "completed",
        content: [{ type: "markdown", markdown: redactSensitiveText(item.text) }],
      };
    case "reasoning":
      return {
        id: item.id,
        type: "reasoning",
        status: "completed",
        summary: item.summary.map((markdown) => ({ type: "markdown" as const, markdown: redactSensitiveText(markdown) })),
        content: item.content.map((markdown) => ({ type: "markdown" as const, markdown: redactSensitiveText(markdown) })),
      };
    case "commandExecution":
      return {
        id: item.id,
        type: "command",
        status: mapStatus(item.status),
        command: redactSensitiveText(item.command),
        cwd: redactNullableText(stringValue(item.cwd)),
        actions: item.commandActions.map(projectCommandAction),
        output: redactNullableText(nullableString(item.aggregatedOutput)),
        exit_code: integerOrNull(item.exitCode),
        duration_ms: nonnegativeInteger(item.durationMs),
      };
    case "fileChange":
      return {
        id: item.id,
        type: "file_change",
        status: mapStatus(item.status),
        changes: item.changes.map(projectFileChange).filter((change): change is AgentFileChange => change !== null),
      };
    case "mcpToolCall":
      return projectMcpToolCall(item);
    case "dynamicToolCall":
      return projectDynamicToolCall(item);
    case "collabAgentToolCall":
      if (item.tool === "wait") {
        return null;
      }
      return {
        id: item.id,
        type: "collaboration",
        status: mapStatus(item.status),
        action: collaborationAction(item.tool),
        target_count: item.receiverThreadIds.length,
        target_ids: [...item.receiverThreadIds],
        prompt: redactNullableText(nullableString(item.prompt)),
      };
    case "subAgentActivity":
      return {
        id: item.id,
        type: "subagent_activity",
        status: item.kind === "interrupted" ? "interrupted" : "running",
        activity: item.kind,
        agent_turn_id: item.agentThreadId,
        agent_label: redactNullableText(agentLabel(item.agentPath)),
      };
    case "webSearch":
      return projectWebSearch(item);
    case "imageView":
      return {
        id: item.id,
        type: "image_view",
        status: "completed",
        images: [{
          type: "image",
          uri: redactSensitiveText(String(item.path)),
          alt_text: null,
          mime_type: imageMimeType(String(item.path)),
        }],
      };
    case "imageGeneration":
      return projectImageGeneration(value);
    case "contextCompaction":
      return { id: item.id, type: "context_compaction", status: "completed" };
    default: {
      const type = stringValue(value.type);
      if (type !== null && FILTERED_ITEM_TYPES.has(type)) {
        return null;
      }
      throw new AgentActivityConversionError(`Unsupported Codex ThreadItem type: ${type ?? "unknown"}.`);
    }
  }
}

function projectMcpToolCall(item: Extract<ThreadItem, { type: "mcpToolCall" }>): AgentToolCallItem {
  const content = projectToolContent(item.result?.content ?? []);
  const appContext = asRecord(item.appContext);
  const resourceUri = stringValue(appContext?.resourceUri) ?? stringValue(item.mcpAppResourceUri);
  const projectedResourceUri = redactNullableText(resourceUri);
  if (projectedResourceUri !== null && !content.some((value) => value.type === "resource_link" && value.uri === projectedResourceUri)) {
    content.push({
      type: "resource_link",
      uri: projectedResourceUri,
      title: redactNullableText(stringValue(appContext?.appName)),
      mime_type: null,
    });
  }
  return {
    id: item.id,
    type: "tool_call",
    status: mapStatus(item.status),
    namespace: redactSensitiveText(item.server),
    name: redactSensitiveText(item.tool),
    display_name: redactNullableText(stringValue(appContext?.actionName) ?? stringValue(appContext?.appName)),
    content,
    progress: [],
    error: item.error ? { code: "AGENT_TOOL_CALL_FAILED", message: "Tool call failed." } : null,
    duration_ms: nonnegativeInteger(item.durationMs),
  };
}

function projectDynamicToolCall(item: Extract<ThreadItem, { type: "dynamicToolCall" }>): AgentToolCallItem {
  return {
    id: item.id,
    type: "tool_call",
    status: item.success === false ? "failed" : mapStatus(item.status),
    namespace: redactNullableText(nullableString(item.namespace)),
    name: redactSensitiveText(item.tool),
    display_name: null,
    content: projectToolContent(item.contentItems ?? []),
    progress: [],
    error: item.success === false ? { code: "AGENT_TOOL_CALL_FAILED", message: "Tool call failed." } : null,
    duration_ms: nonnegativeInteger(item.durationMs),
  };
}

function projectWebSearch(item: Extract<ThreadItem, { type: "webSearch" }>): AgentActivityItem | null {
  const action = asRecord(item.action);
  let query = item.query.trim();
  let detail = query;
  let uri: string | null = null;
  const actionType = stringValue(action?.type);
  if (actionType === "search") {
    const queries = Array.isArray(action?.queries)
      ? action.queries.map(stringValue).filter((value): value is string => value !== null)
      : [];
    query = stringValue(action?.query) ?? queries[0] ?? query;
    detail = query;
  } else if (actionType === "openPage" || actionType === "open_page") {
    uri = stringValue(action?.url);
    detail = uri ?? detail;
  } else if (actionType === "findInPage" || actionType === "find_in_page") {
    uri = stringValue(action?.url);
    const pattern = stringValue(action?.pattern);
    detail = pattern && uri ? `${pattern} in ${uri}` : pattern ?? uri ?? detail;
  }
  if (detail.trim().length === 0) {
    return null;
  }
  return {
    id: item.id,
    type: "web_search",
    status: "completed",
    query: redactSensitiveText(query),
    detail: redactSensitiveText(detail),
    uri: redactNullableText(uri),
  };
}

function projectImageGeneration(item: Record<string, unknown>): AgentActivityItem {
  const content: AgentContent[] = [];
  const savedPath = redactNullableText(stringValue(item.savedPath));
  if (savedPath !== null) {
    content.push({
      type: "image",
      uri: savedPath,
      alt_text: null,
      mime_type: imageMimeType(savedPath),
    });
  }
  const result = redactNullableText(stringValue(item.result));
  if (result !== null && result !== savedPath) {
    if (looksLikeImageUri(result)) {
      content.push({ type: "image", uri: result, alt_text: null, mime_type: imageMimeType(result) });
    } else {
      content.push({ type: "text", text: result });
    }
  }
  return {
    id: requiredString(item.id, "Image generation item id"),
    type: "image_generation",
    status: mapStatus(item.status),
    content,
    revised_prompt: redactNullableText(nullableString(item.revisedPrompt)),
  };
}

function projectCommandAction(value: unknown): AgentCommandAction {
  const action = asRecord(value) ?? {};
  const command = redactSensitiveText(typeof action.command === "string" ? action.command : "");
  if (action.type === "read") {
    const name = redactSensitiveText(stringValue(action.name) ?? stringValue(action.path) ?? "file");
    const path = redactSensitiveText(stringValue(action.path) ?? stringValue(action.name) ?? "file");
    return {
      type: "read",
      command,
      name,
      path,
    };
  }
  if (action.type === "listFiles") {
    return { type: "list", command, path: redactNullableText(nullableString(action.path)) };
  }
  if (action.type === "search") {
    return {
      type: "search",
      command,
      query: redactNullableText(nullableString(action.query)),
      path: redactNullableText(nullableString(action.path)),
    };
  }
  return { type: "unknown", command };
}

function projectFileChange(value: unknown): AgentFileChange | null {
  const change = asRecord(value);
  const path = stringValue(change?.path);
  if (path === null) {
    return null;
  }
  const kindValue = asRecord(change?.kind)?.type ?? change?.kind;
  return {
    path: redactSensitiveText(path),
    kind: kindValue === "add" || kindValue === "delete" ? kindValue : "update",
    diff: redactSensitiveText(typeof change?.diff === "string" ? change.diff : ""),
  };
}

function projectUserMessageContent(
  inputs: Extract<ThreadItem, { type: "userMessage" }>["content"],
): AgentContent[] {
  return inputs.flatMap((input): AgentContent[] => {
    switch (input.type) {
      case "text": {
        const markdown = redactSensitiveText(extractFieldsSourceMessage(input.text));
        return markdown.length === 0 ? [] : [{ type: "markdown" as const, markdown }];
      }
      case "image": {
        const uri = safeRemoteImageUri(input.url);
        return uri === null ? [] : [{
          type: "image" as const,
          uri,
          alt_text: null,
          mime_type: imageMimeType(uri),
        }];
      }
      case "localImage": {
        const name = safePathLeaf(input.path);
        return name === null ? [] : [{ type: "text" as const, text: name }];
      }
      case "skill": {
        const name = safeDisplayName(input.name);
        return name === null ? [] : [{ type: "text" as const, text: name }];
      }
      case "mention": {
        const name = safeDisplayName(input.name);
        return name === null ? [] : [{ type: "text" as const, text: `@${name.replace(/^@+/u, "")}` }];
      }
    }
  });
}

function extractFieldsSourceMessage(text: string): string {
  const header = "A Human mentioned this Actor in a Fields Room message.";
  if ((text.split(/\r?\n/u, 1)[0] ?? "") !== header) {
    return text;
  }
  const marker = /(?:^|(?:\r?\n){1,2})Source message:(?:\r?\n){1,2}/u;
  const match = marker.exec(text);
  if (match === null) {
    return "";
  }
  return text.slice(match.index + match[0].length);
}

function safeRemoteImageUri(value: string): string | null {
  if (value.startsWith("data:image/")) {
    return redactSensitiveText(value);
  }
  try {
    const uri = new URL(value);
    if ((uri.protocol !== "https:" && uri.protocol !== "http:") || uri.username || uri.password) {
      return null;
    }
    return redactSensitiveText(uri.toString());
  } catch {
    return null;
  }
}

function safePathLeaf(value: string): string | null {
  const leaf = value.split(/[\\/]/u).at(-1) ?? "";
  return safeDisplayName(leaf);
}

function safeDisplayName(value: string): string | null {
  const leaf = value.split(/[\\/]/u).at(-1) ?? "";
  const name = redactSensitiveText(leaf)
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .trim();
  return name.length === 0 || name === "." || name === ".." ? null : name;
}

function projectToolContent(values: readonly unknown[]): AgentContent[] {
  return values.flatMap(projectToolContentValue);
}

function projectToolContentValue(value: unknown): AgentContent[] {
  if (typeof value === "string") {
    return projectToolText(value);
  }
  const record = asRecord(value);
  if (record === null) {
    return [{ type: "json", value: sanitizeJsonValue(value) }];
  }
  const type = stringValue(record.type);
  if (type === "text" || type === "inputText" || type === "input_text" || type === "output_text") {
    return projectToolText(typeof record.text === "string" ? record.text : "");
  }
  if (type === "image" || type === "inputImage" || type === "input_image") {
    const mimeType = nullableString(record.mimeType) ?? nullableString(record.mime_type);
    const uri = stringValue(record.uri)
      ?? stringValue(record.imageUrl)
      ?? stringValue(record.image_url)
      ?? dataUri(record.data, mimeType ?? "image/png");
    return uri === null ? [] : [{
      type: "image",
      uri: redactSensitiveText(uri),
      alt_text: redactNullableText(nullableString(record.altText) ?? nullableString(record.alt_text)),
      mime_type: redactNullableText(mimeType ?? imageMimeType(uri)),
    }];
  }
  if (type === "audio") {
    const mimeType = nullableString(record.mimeType) ?? nullableString(record.mime_type);
    const uri = stringValue(record.uri)
      ?? stringValue(record.audioUrl)
      ?? dataUri(record.data, mimeType ?? "audio/mpeg");
    return uri === null ? [] : [{
      type: "audio",
      uri: redactSensitiveText(uri),
      mime_type: redactNullableText(mimeType),
      transcript: redactNullableText(nullableString(record.transcript)),
    }];
  }
  if (type === "resource_link") {
    const uri = stringValue(record.uri);
    return uri === null ? [] : [{
      type: "resource_link",
      uri: redactSensitiveText(uri),
      title: redactNullableText(stringValue(record.title) ?? stringValue(record.name)),
      mime_type: redactNullableText(nullableString(record.mimeType) ?? nullableString(record.mime_type)),
    }];
  }
  if (type === "embedded_resource" || type === "resource") {
    const resource = asRecord(record.resource) ?? record;
    const uri = stringValue(resource.uri);
    const projected: AgentContent[] = [];
    const text = stringValue(resource.text);
    if (text !== null) {
      projected.push({ type: "text", text: redactSensitiveText(text) });
    }
    if (uri !== null) {
      projected.push({
        type: "resource_link",
        uri: redactSensitiveText(uri),
        title: redactNullableText(stringValue(resource.title) ?? stringValue(resource.name)),
        mime_type: redactNullableText(nullableString(resource.mimeType) ?? nullableString(resource.mime_type)),
      });
    }
    return projected;
  }
  return [{ type: "json", value: sanitizeJsonValue(record) }];
}

function projectToolText(text: string): AgentContent[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    const markdown = fieldsMessageMarkdown(parsed);
    if (markdown.length > 0) {
      return markdown.map((value) => ({
        type: "markdown" as const,
        markdown: redactSensitiveText(value),
      }));
    }
    return [{ type: "json", value: sanitizeJsonValue(unwrapKnownToolEnvelope(parsed)) }];
  } catch {
    // Plain provider output is already semantic text.
  }
  const redacted = redactSensitiveText(text);
  return redacted.length === 0 ? [] : [{ type: "text", text: redacted }];
}

function fieldsMessageMarkdown(value: unknown): string[] {
  const envelope = asRecord(value);
  if (envelope === null) {
    return [];
  }
  const candidate = envelope.ok === true && "data" in envelope ? envelope.data : value;
  const values = Array.isArray(candidate) ? candidate : [candidate];
  return values.flatMap((entry) => {
    const record = asRecord(entry);
    const message = asRecord(record?.message) ?? (record?.body ? record : null);
    const body = asRecord(message?.body);
    const markdown = stringValue(body?.markdown) ?? stringValue(body?.plain_text);
    return markdown === null ? [] : [markdown];
  });
}

function unwrapKnownToolEnvelope(value: unknown): unknown {
  const envelope = asRecord(value);
  return envelope?.ok === true && "data" in envelope ? envelope.data : value;
}

function sanitizeJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return typeof value === "string" ? redactSensitiveText(value) : value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeJsonValue);
  }
  const record = asRecord(value);
  if (record === null) {
    return String(value);
  }
  const sanitized: Record<string, JsonValue> = {};
  for (const [key, nested] of Object.entries(record)) {
    const normalized = key.replace(/[^a-z0-9]/giu, "").toLowerCase();
    if (
      normalized === "executiontoken"
      || normalized === "bearertoken"
      || normalized === "authorization"
      || normalized === "authorizationheader"
      || normalized === "httpauthorization"
      || normalized === "arguments"
      || normalized === "toolarguments"
      || normalized === "inputarguments"
      || normalized === "structuredcontent"
      || normalized === "meta"
      || normalized === "method"
      || normalized === "payload"
      || normalized === "provider"
      || normalized === "codexnotification"
      || normalized === "result"
      || normalized === "rawresult"
    ) {
      continue;
    }
    sanitized[key] = sanitizeJsonValue(nested);
  }
  return sanitized;
}

function appendAssistantDelta(existing: AgentTurnItem | null, id: string, delta: string): AgentAssistantMessageItem {
  const current = existing?.type === "assistant_message" ? existing : {
    id,
    type: "assistant_message" as const,
    status: "running" as const,
    phase: "unknown" as const,
    content: [],
  };
  return { ...current, status: "running", content: appendContentText(current.content, delta, "markdown") };
}

function withLifecycleStatus(
  item: AgentTurnItem,
  method: string,
): AgentTurnItem {
  if (method === "item/started") {
    return { ...item, status: "running" };
  }
  if (item.status === "queued" || item.status === "running") {
    return { ...item, status: "completed" };
  }
  return item;
}

function appendPlanDelta(existing: AgentTurnItem | null, id: string, delta: string): AgentNarrativeItem {
  const current = existing?.type === "plan" ? existing : {
    id,
    type: "plan" as const,
    status: "running" as const,
    content: [],
  };
  return { ...current, status: "running", content: appendContentText(current.content, delta, "markdown") };
}

function appendReasoningDelta(
  existing: AgentTurnItem | null,
  id: string,
  target: "summary" | "content",
  index: number,
  delta: string,
): AgentReasoningItem {
  const current: AgentReasoningItem = existing?.type === "reasoning" ? existing : {
    id,
    type: "reasoning",
    status: "running",
    summary: [],
    content: [],
  };
  const values = [...current[target]];
  while (values.length <= index) {
    values.push({ type: "markdown", markdown: "" });
  }
  const slot = values[index];
  const markdown = slot?.type === "markdown"
    ? slot.markdown + delta
    : contentText(slot) + delta;
  values[index] = { type: "markdown", markdown };
  return { ...current, status: "running", [target]: values };
}

function appendContentText(
  content: AgentContent[],
  delta: string,
  type: "text" | "markdown",
): AgentContent[] {
  const next = [...content];
  const last = next.at(-1);
  if (type === "markdown" && last?.type === "markdown") {
    next[next.length - 1] = { ...last, markdown: last.markdown + delta };
  } else if (type === "text" && last?.type === "text") {
    next[next.length - 1] = { ...last, text: last.text + delta };
  } else {
    next.push(type === "markdown" ? { type, markdown: delta } : { type, text: delta });
  }
  return next;
}

function emptySnapshot(): AgentTurnSnapshot {
  return {
    turn_id: null,
    status: "queued",
    started_at_ms: null,
    completed_at_ms: null,
    duration_ms: null,
    error: null,
    narrative_items: [],
    activity_items: [],
  };
}

function bindScope(projection: AgentActivityProjection, scope: AgentTurnScope): boolean {
  if (projection.scope === null) {
    projection.scope = scope;
    return true;
  }
  return scopeKey(projection.scope) === scopeKey(scope);
}

function scopeKey(scope: AgentTurnScope): string {
  return scope.type === "room"
    ? `room\u0000${scope.room_id}\u0000${scope.agent_member_id}\u0000${scope.execution_id}`
    : `home\u0000${scope.member_id}\u0000${scope.thread_id}`;
}

function snapshotEvent(
  event: CodexAgentRuntimeSnapshot | CodexAgentRuntimeEvent,
  snapshot: AgentTurnSnapshot,
): AgentTurnEvent {
  return {
    ...eventBase(event, snapshot.turn_id),
    type: "agent_turn.snapshot",
    snapshot,
  };
}

function statusEvent(event: CodexAgentRuntimeEvent, snapshot: AgentTurnSnapshot): AgentTurnEvent {
  return {
    ...eventBase(event, snapshot.turn_id),
    type: "agent_turn.status",
    status: snapshot.status,
    started_at_ms: snapshot.started_at_ms,
    completed_at_ms: snapshot.completed_at_ms,
    duration_ms: snapshot.duration_ms,
    error: snapshot.error,
  };
}

function itemUpsertEvent(event: CodexAgentRuntimeEvent, item: AgentTurnItem): AgentTurnEvent {
  return { ...eventBase(event), type: "agent_turn.item_upsert", item };
}

function eventBase(
  event: CodexAgentRuntimeSnapshot | CodexAgentRuntimeEvent,
  turnId: string | null = event.turn_id,
) {
  return {
    schema_version: 2 as const,
    event_id: event.event_id,
    source: "backend" as const,
    scope: event.scope,
    turn_id: turnId,
    occurred_at_ms: event.occurred_at_ms,
  };
}

function upsertItem(snapshot: AgentTurnSnapshot, item: AgentTurnItem): AgentTurnSnapshot {
  if (isNarrativeItem(item)) {
    const index = snapshot.narrative_items.findIndex((candidate) => candidate.id === item.id);
    const narrativeItems = [...snapshot.narrative_items];
    if (index === -1) narrativeItems.push(item);
    else narrativeItems[index] = item;
    return { ...snapshot, narrative_items: narrativeItems };
  }
  const index = snapshot.activity_items.findIndex((candidate) => candidate.id === item.id);
  const activityItems = [...snapshot.activity_items];
  if (index === -1) activityItems.push(item);
  else activityItems[index] = item;
  return { ...snapshot, activity_items: activityItems };
}

function removeItem(snapshot: AgentTurnSnapshot, itemId: string): AgentTurnSnapshot {
  return {
    ...snapshot,
    narrative_items: snapshot.narrative_items.filter((item) => item.id !== itemId),
    activity_items: snapshot.activity_items.filter((item) => item.id !== itemId),
  };
}

function findItem(snapshot: AgentTurnSnapshot, itemId: string): AgentTurnItem | null {
  return snapshot.narrative_items.find((item) => item.id === itemId)
    ?? snapshot.activity_items.find((item) => item.id === itemId)
    ?? null;
}

function isNarrativeItem(item: AgentTurnItem): item is AgentNarrativeItem {
  return item.type === "user_message"
    || item.type === "assistant_message"
    || item.type === "plan"
    || item.type === "reasoning";
}

function isActivityItem(item: AgentTurnItem): item is AgentActivityItem {
  return !isNarrativeItem(item);
}

function mapStatus(value: unknown, strict = false): AgentTurnStatus {
  if (value === "queued") return "queued";
  if (value === "inProgress" || value === "running" || value === "pending") return "running";
  if (value === "completed" || value === "success" || value === "succeeded") return "completed";
  if (value === "failed" || value === "error") return "failed";
  if (value === "declined" || value === "denied") return "declined";
  if (value === "interrupted" || value === "cancelled" || value === "canceled") return "interrupted";
  if (strict) {
    throw new AgentActivityConversionError(`Unsupported Codex status: ${String(value)}.`);
  }
  return "running";
}

function collaborationAction(value: string): "spawn" | "send_input" | "resume" | "close" {
  if (value === "spawnAgent") return "spawn";
  if (value === "sendInput") return "send_input";
  if (value === "resumeAgent") return "resume";
  return "close";
}

function projectError(value: unknown, fallbackCode: string, fallbackMessage: string): AgentTurnError | null {
  const error = asRecord(value);
  if (error === null) {
    return null;
  }
  return {
    code: codexErrorCode(error.codexErrorInfo) ?? normalizeAgentErrorCode(fallbackCode),
    message: fallbackMessage,
  };
}

function sanitizeProjectedError(error: AgentTurnError | null): AgentTurnError | null {
  return error === null ? null : {
    code: normalizeAgentErrorCode(error.code),
    message: "Agent turn failed.",
  };
}

function codexErrorCode(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return normalizeAgentErrorCode(value);
  }
  const record = asRecord(value);
  const variant = record === null ? undefined : Object.keys(record)[0];
  return variant ? normalizeAgentErrorCode(variant) : null;
}

function normalizeAgentErrorCode(value: string): string {
  const normalized = upperSnakeCase(value)
    .replace(/^CODEX_/, "")
    .replace(/^AGENT_/, "");
  return `AGENT_${normalized || "TURN_FAILED"}`;
}

function upperSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/(["']?execution[_\s-]?token["']?\s*[:=]\s*)["']?[^\s,"'}]+["']?/giu, "$1[redacted]")
    .replace(/(Use this execution[_\s-]?token exactly:\s*)\S+/giu, "$1[redacted]")
    .replace(/["']?bearer[_\s-]?token["']?\s*[:=]\s*["']?[^\s,"'}]+["']?/giu, "[redacted]")
    .replace(/(["']?authorization["']?\s*[:=]\s*["']?Bearer\s+)[^\s,"'}]+/giu, "$1[redacted]")
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/-]{4,}/giu, "$1 [redacted]");
}

function redactNullableText(value: string | null): string | null {
  return value === null ? null : redactSensitiveText(value);
}

function agentLabel(path: string): string | null {
  const part = path.split("/").map((value) => value.trim()).filter((value) => value && value !== "root").at(-1);
  if (!part) return null;
  const words = part.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return words.length > 0 ? words[0].toUpperCase() + words.slice(1) : null;
}

function imageMimeType(uri: string): string | null {
  if (uri.startsWith("data:")) {
    return /^data:([^;,]+)/.exec(uri)?.[1] ?? null;
  }
  const path = uri.split(/[?#]/, 1)[0]?.toLowerCase() ?? "";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".svg")) return "image/svg+xml";
  return null;
}

function looksLikeImageUri(value: string): boolean {
  return value.startsWith("data:image/") || /\.(?:png|jpe?g|gif|webp|svg)(?:[?#].*)?$/iu.test(value);
}

function dataUri(value: unknown, mimeType: string): string | null {
  const data = stringValue(value);
  if (data === null) return null;
  return data.startsWith("data:") ? data : `data:${mimeType};base64,${data}`;
}

function contentText(content: AgentContent | undefined): string {
  if (content?.type === "markdown") return content.markdown;
  if (content?.type === "text") return content.text;
  return "";
}

function requiredItemId(event: CodexAgentRuntimeEvent): string {
  const itemId = event.item_id ?? stringValue(asRecord(event.payload)?.itemId);
  if (itemId === null) {
    throw new AgentActivityConversionError(`Codex ${event.method} did not contain an item id.`);
  }
  return itemId;
}

function requiredString(value: unknown, label: string): string {
  const parsed = stringValue(value);
  if (parsed === null) throw new AgentActivityConversionError(`${label} must be a non-empty string.`);
  return parsed;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function integerOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function nonnegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function secondsToMs(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value * 1_000)
    : null;
}

function durationBetween(startedAtMs: number | null, completedAtMs: number | null): number | null {
  return startedAtMs !== null && completedAtMs !== null && completedAtMs >= startedAtMs
    ? completedAtMs - startedAtMs
    : null;
}
