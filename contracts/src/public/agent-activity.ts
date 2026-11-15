import { z } from "zod";

export const agentTurnStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "declined",
  "interrupted",
]);
export type AgentTurnStatus = z.infer<typeof agentTurnStatusSchema>;

export const agentQuestionOptionSchema = z.strictObject({
  label: z.string().min(1),
  description: z.string(),
});
export type AgentQuestionOption = z.infer<typeof agentQuestionOptionSchema>;

export const agentQuestionSchema = z.strictObject({
  id: z.string().min(1),
  header: z.string(),
  question: z.string().min(1),
  allow_other: z.boolean(),
  secret: z.boolean(),
  options: z.array(agentQuestionOptionSchema).nullable(),
});
export type AgentQuestion = z.infer<typeof agentQuestionSchema>;

export const agentQuestionAnswerSchema = z.strictObject({
  values: z.array(z.string()),
  redacted: z.boolean(),
});
export type AgentQuestionAnswer = z.infer<typeof agentQuestionAnswerSchema>;

export const agentQuestionInteractionSchema = z.strictObject({
  id: z.string().min(1),
  item_id: z.string().min(1),
  status: z.enum(["pending", "completed"]),
  questions: z.array(agentQuestionSchema).min(1),
  answers: z.record(z.string(), agentQuestionAnswerSchema),
  resolution: z.enum(["answered", "dismissed", "timed_out"]).nullable(),
  deadline_at_ms: z.number().int().nonnegative().nullable(),
  created_at_ms: z.number().int().nonnegative(),
  completed_at_ms: z.number().int().nonnegative().nullable(),
});
export type AgentQuestionInteraction = z.infer<typeof agentQuestionInteractionSchema>;

export const agentTurnErrorSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
});
export type AgentTurnError = z.infer<typeof agentTurnErrorSchema>;

export const agentTextContentSchema = z.strictObject({
  type: z.literal("text"),
  text: z.string(),
});
export type AgentTextContent = z.infer<typeof agentTextContentSchema>;

export const agentMarkdownContentSchema = z.strictObject({
  type: z.literal("markdown"),
  markdown: z.string(),
});
export type AgentMarkdownContent = z.infer<typeof agentMarkdownContentSchema>;

export const agentResourceLinkContentSchema = z.strictObject({
  type: z.literal("resource_link"),
  uri: z.string().min(1),
  title: z.string().min(1).nullable(),
  mime_type: z.string().min(1).nullable(),
});
export type AgentResourceLinkContent = z.infer<typeof agentResourceLinkContentSchema>;

export const agentImageContentSchema = z.strictObject({
  type: z.literal("image"),
  uri: z.string().min(1),
  alt_text: z.string().nullable(),
  mime_type: z.string().min(1).nullable(),
});
export type AgentImageContent = z.infer<typeof agentImageContentSchema>;

export const agentAudioContentSchema = z.strictObject({
  type: z.literal("audio"),
  uri: z.string().min(1),
  mime_type: z.string().min(1).nullable(),
  transcript: z.string().nullable(),
});
export type AgentAudioContent = z.infer<typeof agentAudioContentSchema>;

const forbiddenAgentJsonKeys = new Set([
  "arguments",
  "codexnotification",
  "executiontoken",
  "inputarguments",
  "meta",
  "method",
  "payload",
  "provider",
  "rawresult",
  "result",
  "structuredcontent",
  "toolarguments",
]);

const agentPublicJsonValueSchema = z.json().superRefine((value, context) => {
  const visit = (current: unknown, path: PropertyKey[]): void => {
    if (Array.isArray(current)) {
      current.forEach((entry, index) => visit(entry, [...path, index]));
      return;
    }
    if (typeof current !== "object" || current === null) {
      return;
    }
    for (const [key, child] of Object.entries(current)) {
      if (forbiddenAgentJsonKeys.has(normalizeAgentJsonKey(key))) {
        context.addIssue({
          code: "custom",
          path: [...path, key],
          message: `Agent Activity JSON must not expose provider runtime field ${key}`,
        });
      }
      visit(child, [...path, key]);
    }
  };
  visit(value, []);
});

function normalizeAgentJsonKey(key: string): string {
  return key.replace(/[^a-z0-9]/giu, "").toLowerCase();
}

export const agentJsonContentSchema = z.strictObject({
  type: z.literal("json"),
  value: agentPublicJsonValueSchema,
});
export type AgentJsonContent = z.infer<typeof agentJsonContentSchema>;

export const agentContentSchema = z.discriminatedUnion("type", [
  agentTextContentSchema,
  agentMarkdownContentSchema,
  agentResourceLinkContentSchema,
  agentImageContentSchema,
  agentAudioContentSchema,
  agentJsonContentSchema,
]);
export type AgentContent = z.infer<typeof agentContentSchema>;

const agentTurnItemBaseShape = {
  id: z.string().min(1),
  status: agentTurnStatusSchema,
};

export const agentUserMessageItemSchema = z.strictObject({
  ...agentTurnItemBaseShape,
  type: z.literal("user_message"),
  content: z.array(agentContentSchema),
});
export type AgentUserMessageItem = z.infer<typeof agentUserMessageItemSchema>;

export const agentAssistantMessageItemSchema = z.strictObject({
  ...agentTurnItemBaseShape,
  type: z.literal("assistant_message"),
  phase: z.enum(["commentary", "final_answer", "unknown"]),
  content: z.array(agentContentSchema),
});
export type AgentAssistantMessageItem = z.infer<typeof agentAssistantMessageItemSchema>;

export const agentPlanItemSchema = z.strictObject({
  ...agentTurnItemBaseShape,
  type: z.literal("plan"),
  content: z.array(agentContentSchema),
});
export type AgentPlanItem = z.infer<typeof agentPlanItemSchema>;

export const agentReasoningItemSchema = z.strictObject({
  ...agentTurnItemBaseShape,
  type: z.literal("reasoning"),
  summary: z.array(agentContentSchema),
  content: z.array(agentContentSchema),
});
export type AgentReasoningItem = z.infer<typeof agentReasoningItemSchema>;

export const agentCommandActionSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("read"),
    command: z.string(),
    name: z.string().min(1),
    path: z.string().min(1),
  }),
  z.strictObject({
    type: z.literal("list"),
    command: z.string(),
    path: z.string().min(1).nullable(),
  }),
  z.strictObject({
    type: z.literal("search"),
    command: z.string(),
    query: z.string().nullable(),
    path: z.string().min(1).nullable(),
  }),
  z.strictObject({
    type: z.literal("unknown"),
    command: z.string(),
  }),
]);
export type AgentCommandAction = z.infer<typeof agentCommandActionSchema>;

export const agentCommandItemSchema = z.strictObject({
  ...agentTurnItemBaseShape,
  type: z.literal("command"),
  command: z.string(),
  cwd: z.string().min(1).nullable(),
  actions: z.array(agentCommandActionSchema),
  output: z.string().nullable(),
  exit_code: z.number().int().nullable(),
  duration_ms: z.number().int().nonnegative().nullable(),
});
export type AgentCommandItem = z.infer<typeof agentCommandItemSchema>;

export const agentFileChangeSchema = z.strictObject({
  path: z.string().min(1),
  kind: z.enum(["add", "update", "delete"]),
  diff: z.string(),
});
export type AgentFileChange = z.infer<typeof agentFileChangeSchema>;

export const agentFileChangeItemSchema = z.strictObject({
  ...agentTurnItemBaseShape,
  type: z.literal("file_change"),
  changes: z.array(agentFileChangeSchema),
});
export type AgentFileChangeItem = z.infer<typeof agentFileChangeItemSchema>;

export const agentToolCallItemSchema = z.strictObject({
  ...agentTurnItemBaseShape,
  type: z.literal("tool_call"),
  namespace: z.string().min(1).nullable(),
  name: z.string().min(1),
  display_name: z.string().min(1).nullable(),
  content: z.array(agentContentSchema),
  progress: z.array(z.string()),
  error: agentTurnErrorSchema.nullable(),
  duration_ms: z.number().int().nonnegative().nullable(),
});
export type AgentToolCallItem = z.infer<typeof agentToolCallItemSchema>;

export const agentWebSearchItemSchema = z.strictObject({
  ...agentTurnItemBaseShape,
  type: z.literal("web_search"),
  query: z.string(),
  detail: z.string().min(1),
  uri: z.string().min(1).nullable(),
});
export type AgentWebSearchItem = z.infer<typeof agentWebSearchItemSchema>;

export const agentCollaborationItemSchema = z.strictObject({
  ...agentTurnItemBaseShape,
  type: z.literal("collaboration"),
  action: z.enum(["spawn", "send_input", "resume", "close"]),
  target_count: z.number().int().nonnegative(),
  target_ids: z.array(z.string().min(1)),
  prompt: z.string().nullable(),
});
export type AgentCollaborationItem = z.infer<typeof agentCollaborationItemSchema>;

export const agentSubagentActivityItemSchema = z.strictObject({
  ...agentTurnItemBaseShape,
  type: z.literal("subagent_activity"),
  activity: z.enum(["started", "interacted", "interrupted"]),
  agent_turn_id: z.string().min(1),
  agent_label: z.string().min(1).nullable(),
});
export type AgentSubagentActivityItem = z.infer<typeof agentSubagentActivityItemSchema>;

export const agentImageViewItemSchema = z.strictObject({
  ...agentTurnItemBaseShape,
  type: z.literal("image_view"),
  images: z.array(agentImageContentSchema).min(1),
});
export type AgentImageViewItem = z.infer<typeof agentImageViewItemSchema>;

export const agentImageGenerationItemSchema = z.strictObject({
  ...agentTurnItemBaseShape,
  type: z.literal("image_generation"),
  content: z.array(agentContentSchema),
  revised_prompt: z.string().nullable(),
});
export type AgentImageGenerationItem = z.infer<typeof agentImageGenerationItemSchema>;

export const agentContextCompactionItemSchema = z.strictObject({
  ...agentTurnItemBaseShape,
  type: z.literal("context_compaction"),
});
export type AgentContextCompactionItem = z.infer<typeof agentContextCompactionItemSchema>;

export const agentNarrativeItemSchema = z.discriminatedUnion("type", [
  agentUserMessageItemSchema,
  agentAssistantMessageItemSchema,
  agentPlanItemSchema,
  agentReasoningItemSchema,
]);
export type AgentNarrativeItem = z.infer<typeof agentNarrativeItemSchema>;

export const agentActivityItemSchema = z.discriminatedUnion("type", [
  agentCommandItemSchema,
  agentFileChangeItemSchema,
  agentToolCallItemSchema,
  agentWebSearchItemSchema,
  agentCollaborationItemSchema,
  agentSubagentActivityItemSchema,
  agentImageViewItemSchema,
  agentImageGenerationItemSchema,
  agentContextCompactionItemSchema,
]);
export type AgentActivityItem = z.infer<typeof agentActivityItemSchema>;

export const agentTurnItemSchema = z.discriminatedUnion("type", [
  agentUserMessageItemSchema,
  agentAssistantMessageItemSchema,
  agentPlanItemSchema,
  agentReasoningItemSchema,
  agentCommandItemSchema,
  agentFileChangeItemSchema,
  agentToolCallItemSchema,
  agentWebSearchItemSchema,
  agentCollaborationItemSchema,
  agentSubagentActivityItemSchema,
  agentImageViewItemSchema,
  agentImageGenerationItemSchema,
  agentContextCompactionItemSchema,
]);
export type AgentTurnItem = z.infer<typeof agentTurnItemSchema>;

export const agentTurnSnapshotSchema = z.strictObject({
  turn_id: z.string().min(1).nullable(),
  status: agentTurnStatusSchema,
  started_at_ms: z.number().int().nonnegative().nullable(),
  completed_at_ms: z.number().int().nonnegative().nullable(),
  duration_ms: z.number().int().nonnegative().nullable(),
  error: agentTurnErrorSchema.nullable(),
  narrative_items: z.array(agentNarrativeItemSchema),
  activity_items: z.array(agentActivityItemSchema),
  interactions: z.array(agentQuestionInteractionSchema).optional(),
});
export type AgentTurnSnapshot = z.infer<typeof agentTurnSnapshotSchema>;

export const agentRoomTurnScopeSchema = z.strictObject({
  type: z.literal("room"),
  room_id: z.string().min(1),
  agent_member_id: z.string().min(1),
  execution_id: z.string().min(1),
});
export type AgentRoomTurnScope = z.infer<typeof agentRoomTurnScopeSchema>;

export const agentHomeTurnScopeSchema = z.strictObject({
  type: z.literal("home"),
  member_id: z.string().min(1),
  thread_id: z.string().min(1),
});
export type AgentHomeTurnScope = z.infer<typeof agentHomeTurnScopeSchema>;

export const agentTurnScopeSchema = z.discriminatedUnion("type", [
  agentRoomTurnScopeSchema,
  agentHomeTurnScopeSchema,
]);
export type AgentTurnScope = z.infer<typeof agentTurnScopeSchema>;

const agentTurnEventBaseShape = {
  schema_version: z.literal(2),
  event_id: z.string().min(1),
  source: z.literal("backend"),
  scope: agentTurnScopeSchema,
  turn_id: z.string().min(1).nullable(),
  occurred_at_ms: z.number().int().nonnegative(),
};

export const agentTurnSnapshotEventSchema = z.strictObject({
  ...agentTurnEventBaseShape,
  type: z.literal("agent_turn.snapshot"),
  snapshot: agentTurnSnapshotSchema,
});
export type AgentTurnSnapshotEvent = z.infer<typeof agentTurnSnapshotEventSchema>;

export const agentTurnStatusEventSchema = z.strictObject({
  ...agentTurnEventBaseShape,
  type: z.literal("agent_turn.status"),
  status: agentTurnStatusSchema,
  started_at_ms: z.number().int().nonnegative().nullable(),
  completed_at_ms: z.number().int().nonnegative().nullable(),
  duration_ms: z.number().int().nonnegative().nullable(),
  error: agentTurnErrorSchema.nullable(),
});
export type AgentTurnStatusEvent = z.infer<typeof agentTurnStatusEventSchema>;

export const agentTurnItemUpsertEventSchema = z.strictObject({
  ...agentTurnEventBaseShape,
  type: z.literal("agent_turn.item_upsert"),
  item: agentTurnItemSchema,
});
export type AgentTurnItemUpsertEvent = z.infer<typeof agentTurnItemUpsertEventSchema>;

export const agentTurnItemRemoveEventSchema = z.strictObject({
  ...agentTurnEventBaseShape,
  type: z.literal("agent_turn.item_remove"),
  item_id: z.string().min(1),
});
export type AgentTurnItemRemoveEvent = z.infer<typeof agentTurnItemRemoveEventSchema>;

export const agentTurnMessageDeltaEventSchema = z.strictObject({
  ...agentTurnEventBaseShape,
  type: z.literal("agent_turn.message_delta"),
  item_id: z.string().min(1),
  target: z.enum(["assistant_message", "plan"]),
  delta: z.string(),
});
export type AgentTurnMessageDeltaEvent = z.infer<typeof agentTurnMessageDeltaEventSchema>;

export const agentTurnReasoningDeltaEventSchema = z.strictObject({
  ...agentTurnEventBaseShape,
  type: z.literal("agent_turn.reasoning_delta"),
  item_id: z.string().min(1),
  target: z.enum(["summary", "content"]),
  index: z.number().int().nonnegative(),
  delta: z.string(),
});
export type AgentTurnReasoningDeltaEvent = z.infer<typeof agentTurnReasoningDeltaEventSchema>;

export const agentTurnCommandOutputDeltaEventSchema = z.strictObject({
  ...agentTurnEventBaseShape,
  type: z.literal("agent_turn.command_output_delta"),
  item_id: z.string().min(1),
  delta: z.string(),
});
export type AgentTurnCommandOutputDeltaEvent = z.infer<typeof agentTurnCommandOutputDeltaEventSchema>;

export const agentTurnToolProgressEventSchema = z.strictObject({
  ...agentTurnEventBaseShape,
  type: z.literal("agent_turn.tool_progress"),
  item_id: z.string().min(1),
  message: z.string(),
});
export type AgentTurnToolProgressEvent = z.infer<typeof agentTurnToolProgressEventSchema>;

export const agentTurnQuestionInteractionEventSchema = z.strictObject({
  ...agentTurnEventBaseShape,
  type: z.literal("agent_turn.question_interaction"),
  interaction: agentQuestionInteractionSchema,
});
export type AgentTurnQuestionInteractionEvent = z.infer<typeof agentTurnQuestionInteractionEventSchema>;

export const agentTurnEventSchema = z.discriminatedUnion("type", [
  agentTurnSnapshotEventSchema,
  agentTurnStatusEventSchema,
  agentTurnItemUpsertEventSchema,
  agentTurnItemRemoveEventSchema,
  agentTurnMessageDeltaEventSchema,
  agentTurnReasoningDeltaEventSchema,
  agentTurnCommandOutputDeltaEventSchema,
  agentTurnToolProgressEventSchema,
  agentTurnQuestionInteractionEventSchema,
]).superRefine((event, context) => {
  if (event.type === "agent_turn.snapshot" && event.turn_id !== event.snapshot.turn_id) {
    context.addIssue({
      code: "custom",
      path: ["snapshot", "turn_id"],
      message: "snapshot.turn_id must match the event turn_id",
    });
  }
});
export type AgentTurnEvent = z.infer<typeof agentTurnEventSchema>;

export const roomAgentTurnEventSchema = agentTurnEventSchema.superRefine((event, context) => {
  if (event.scope.type !== "room") {
    context.addIssue({
      code: "custom",
      path: ["scope", "type"],
      message: "Room Agent Turn events require a room scope",
    });
  }
});
export type RoomAgentTurnEvent = AgentTurnEvent & { scope: AgentRoomTurnScope };

export const homeAgentTurnEventSchema = agentTurnEventSchema.superRefine((event, context) => {
  if (event.scope.type !== "home") {
    context.addIssue({
      code: "custom",
      path: ["scope", "type"],
      message: "Home Agent Turn events require a home scope",
    });
  }
});
export type HomeAgentTurnEvent = AgentTurnEvent & { scope: AgentHomeTurnScope };

export const agentTurnEventStreamSchema = z.custom<AsyncIterable<unknown>>(isAsyncIterable).transform(async function* (iter) {
  for await (const value of iter) {
    yield agentTurnEventSchema.parse(value);
  }
});
export type AgentTurnEventStream = z.infer<typeof agentTurnEventStreamSchema>;

export const roomAgentTurnEventStreamSchema = z.custom<AsyncIterable<unknown>>(isAsyncIterable).transform(async function* (iter) {
  let first = true;
  for await (const value of iter) {
    const event = roomAgentTurnEventSchema.parse(value);
    if (first && event.type !== "agent_turn.snapshot") {
      throw new Error("Room Agent Turn event streams must start with an authoritative snapshot.");
    }
    first = false;
    yield event as RoomAgentTurnEvent;
  }
  if (first) {
    throw new Error("Room Agent Turn event streams must contain an authoritative snapshot.");
  }
});
export type RoomAgentTurnEventStream = z.infer<typeof roomAgentTurnEventStreamSchema>;

export const agentSessionSnapshotSchema = z.strictObject({
  room_thread_id: z.string().min(1).nullable(),
  selected_turn_id: z.string().min(1).nullable(),
  turns: z.array(agentTurnSnapshotSchema),
});
export type AgentSessionSnapshot = z.infer<typeof agentSessionSnapshotSchema>;

export const agentSessionSnapshotEventSchema = z.strictObject({
  schema_version: z.literal(1),
  event_id: z.string().min(1),
  type: z.literal("agent_session.snapshot"),
  source: z.literal("backend"),
  scope: agentRoomTurnScopeSchema,
  occurred_at_ms: z.number().int().nonnegative(),
  snapshot: agentSessionSnapshotSchema,
});
export type AgentSessionSnapshotEvent = z.infer<typeof agentSessionSnapshotEventSchema>;

export const roomAgentSessionEventSchema = z.union([
  agentSessionSnapshotEventSchema,
  roomAgentTurnEventSchema,
]);
export type RoomAgentSessionEvent = z.infer<typeof roomAgentSessionEventSchema>;

export const roomAgentSessionEventStreamSchema = z.custom<AsyncIterable<unknown>>(isAsyncIterable).transform(async function* (iter) {
  let first = true;
  for await (const value of iter) {
    const event = roomAgentSessionEventSchema.parse(value);
    if (first && event.type !== "agent_session.snapshot") {
      throw new Error("Room Agent Session event streams must start with an authoritative Session snapshot.");
    }
    first = false;
    yield event;
  }
  if (first) {
    throw new Error("Room Agent Session event streams must contain an authoritative Session snapshot.");
  }
});
export type RoomAgentSessionEventStream = z.infer<typeof roomAgentSessionEventStreamSchema>;

export const homeAgentTurnEventStreamSchema = z.custom<AsyncIterable<unknown>>(isAsyncIterable).transform(async function* (iter) {
  for await (const value of iter) {
    yield homeAgentTurnEventSchema.parse(value) as HomeAgentTurnEvent;
  }
});
export type HomeAgentTurnEventStream = z.infer<typeof homeAgentTurnEventStreamSchema>;

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}
