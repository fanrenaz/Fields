import { z } from "zod";

import {
  agentTurnSnapshotSchema,
  homeAgentTurnEventSchema,
  homeAgentTurnEventStreamSchema,
  type HomeAgentTurnEvent,
} from "./agent-activity.js";
import {
  messageImageAttachmentsSchemaFor,
  messageImageMetadataSchema,
} from "./message-attachment.js";

export const homeQuestionInteractionRespondInputSchema = z.strictObject({
  thread_id: z.string().min(1),
  interaction_id: z.string().min(1),
  answers: z.record(z.string(), z.array(z.string())),
  resolution: z.enum(["answered", "dismissed", "timed_out"]),
});
export type HomeQuestionInteractionRespondInput = z.infer<typeof homeQuestionInteractionRespondInputSchema>;

export const homeQuestionInteractionRespondResultSchema = z.strictObject({
  accepted: z.literal(true),
  interaction_id: z.string().min(1),
});
export type HomeQuestionInteractionRespondResult = z.infer<typeof homeQuestionInteractionRespondResultSchema>;

export const homeQuestionInteractionSnoozeInputSchema = z.strictObject({
  thread_id: z.string().min(1),
  interaction_id: z.string().min(1),
  mode: z.enum(["foreground", "background"]),
});
export type HomeQuestionInteractionSnoozeInput = z.infer<typeof homeQuestionInteractionSnoozeInputSchema>;
export const homeQuestionInteractionSnoozeResultSchema = z.strictObject({
  accepted: z.literal(true),
  deadline_at_ms: z.number().int().nonnegative(),
});
export type HomeQuestionInteractionSnoozeResult = z.infer<typeof homeQuestionInteractionSnoozeResultSchema>;

export const homeModelSelectionSchema = z.strictObject({
  model: z.string().min(1),
  reasoning_effort: z.string().min(1).nullable(),
});
export type HomeModelSelection = z.infer<typeof homeModelSelectionSchema>;

export const homeModelOptionSchema = z.strictObject({
  model: z.string().min(1),
  display_name: z.string().min(1),
  is_default: z.boolean(),
  default_reasoning_effort: z.string().min(1).nullable(),
  supported_reasoning_efforts: z.array(z.string().min(1)),
});
export type HomeModelOption = z.infer<typeof homeModelOptionSchema>;

export const homeModelOptionsInputSchema = z.object({}).strict();
export type HomeModelOptionsInput = z.infer<typeof homeModelOptionsInputSchema>;

export const homeModelOptionsResultSchema = z.strictObject({
  items: z.array(homeModelOptionSchema),
  new_thread_default: homeModelSelectionSchema.nullable(),
});
export type HomeModelOptionsResult = z.infer<typeof homeModelOptionsResultSchema>;

export const messageImageAttachmentSchema = messageImageMetadataSchema.extend({
  storage: z.literal("member_workspace"),
  path: z.string().min(1).max(4_096),
});
export type MessageImageAttachment = z.infer<typeof messageImageAttachmentSchema>;
export const messageImageAttachmentsSchema = messageImageAttachmentsSchemaFor(messageImageAttachmentSchema);

export const homeMemoryStatusSchema = z.enum(["ready", "applying", "failed"]);
export type HomeMemoryStatus = z.infer<typeof homeMemoryStatusSchema>;

export const homeMemoryProfileSchema = z.strictObject({
  enabled: z.boolean(),
  applied_enabled: z.boolean(),
  status: homeMemoryStatusSchema,
  error_code: z.string().min(1).nullable(),
  revision: z.number().int().nonnegative(),
});
export type HomeMemoryProfile = z.infer<typeof homeMemoryProfileSchema>;

export const homeMemoryInputSchema = z.object({}).strict();
export const homeMemoryUpdateInputSchema = z.strictObject({
  enabled: z.boolean(),
  expected_revision: z.number().int().nonnegative(),
});

export const homeThreadSettingsInputSchema = z.strictObject({
  thread_id: z.string().min(1),
});
export type HomeThreadSettingsInput = z.infer<typeof homeThreadSettingsInputSchema>;

export const homeThreadSettingsSetInputSchema = homeThreadSettingsInputSchema.extend({
  model: z.string().min(1),
  reasoning_effort: z.string().min(1).nullable(),
});
export type HomeThreadSettingsSetInput = z.infer<typeof homeThreadSettingsSetInputSchema>;

export const homeThreadSettingsResultSchema = homeThreadSettingsSetInputSchema;
export type HomeThreadSettingsResult = z.infer<typeof homeThreadSettingsResultSchema>;

export const homeTurnSubmitInputSchema = z.object({
  thread_id: z.string().min(1).optional(),
  project_id: z.string().min(1).optional(),
  prompt: z.string(),
  image_attachments: messageImageAttachmentsSchema.optional(),
  client_message_id: z.string().min(1).optional(),
  timeout_ms: z.number().int().min(1_000).max(900_000).optional(),
  model: z.string().min(1).optional(),
  reasoning_effort: z.string().min(1).nullable().optional(),
}).strict().superRefine((input, context) => {
  if (input.prompt.trim().length === 0 && (input.image_attachments?.length ?? 0) === 0) {
    context.addIssue({ code: "custom", path: ["prompt"], message: "A Home turn requires text or an image." });
  }
});
export type HomeTurnSubmitInput = z.infer<typeof homeTurnSubmitInputSchema>;

export const homeTurnSubmitResultSchema = z.strictObject({
  submitted: z.literal(true),
  thread_id: z.string().min(1),
  turn_id: z.string().min(1),
});
export type HomeTurnSubmitResult = z.infer<typeof homeTurnSubmitResultSchema>;

export const homeTurnEventsInputSchema = z.object({
  thread_id: z.string().min(1),
}).strict();
export type HomeTurnEventsInput = z.infer<typeof homeTurnEventsInputSchema>;

export const homeThreadReadInputSchema = z.object({
  thread_id: z.string().min(1),
}).strict();
export type HomeThreadReadInput = z.infer<typeof homeThreadReadInputSchema>;

export const homeThreadListInputSchema = z.object({
  cursor: z.string().min(1).nullable().optional(),
  limit: z.number().int().min(1).optional(),
  archived: z.boolean().optional(),
  project_id: z.string().min(1).nullable().optional(),
}).strict();
export type HomeThreadListInput = z.infer<typeof homeThreadListInputSchema>;

export const homeThreadSearchInputSchema = z.object({
  search_term: z.string().min(1),
  cursor: z.string().min(1).nullable().optional(),
  limit: z.number().int().min(1).optional(),
  archived: z.boolean().optional(),
  project_id: z.string().min(1).nullable().optional(),
}).strict();
export type HomeThreadSearchInput = z.infer<typeof homeThreadSearchInputSchema>;

export const homeThreadBranchKindSchema = z.enum([
  "root",
  "explicit",
  "edited_user_message",
  "regenerated_assistant",
]);
export type HomeThreadBranchKind = z.infer<typeof homeThreadBranchKindSchema>;

export const homeThreadBranchSchema = z.strictObject({
  thread_id: z.string().min(1),
  root_thread_id: z.string().min(1),
  source_thread_id: z.string().min(1).nullable(),
  anchor_turn_id: z.string().min(1).nullable(),
  kind: homeThreadBranchKindSchema,
  selected: z.boolean(),
  created_at_ms: z.number().int().nonnegative().nullable(),
});
export type HomeThreadBranch = z.infer<typeof homeThreadBranchSchema>;

export const homeThreadTurnSchema = z.strictObject({
  thread_id: z.string().min(1),
  turn_id: z.string().min(1),
  origin: z.enum(["native", "imported"]).optional(),
  snapshot: agentTurnSnapshotSchema,
});
export type HomeThreadTurn = z.infer<typeof homeThreadTurnSchema>;

export const homeThreadReadResultSchema = z.strictObject({
  thread_id: z.string().min(1),
  root_thread_id: z.string().min(1),
  selected_thread_id: z.string().min(1),
  revision: z.number().int().positive(),
  branches: z.array(homeThreadBranchSchema).min(1),
  turns: z.array(homeThreadTurnSchema),
});
export type HomeThreadReadResult = z.infer<typeof homeThreadReadResultSchema>;

export const homeThreadForkInputSchema = z.strictObject({
  thread_id: z.string().min(1),
  anchor_turn_id: z.string().min(1),
  kind: z.enum(["explicit", "edited_user_message", "regenerated_assistant"]),
  prompt: z.string().min(1).optional(),
  expected_revision: z.number().int().positive(),
  idempotency_key: z.string().min(1).max(255),
  timeout_ms: z.number().int().min(1_000).max(900_000).optional(),
}).superRefine((input, context) => {
  if (input.kind === "edited_user_message" && !input.prompt) {
    context.addIssue({
      code: "custom",
      path: ["prompt"],
      message: "Editing a Home user message requires replacement prompt text.",
    });
  }
  if (input.kind !== "edited_user_message" && input.prompt !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["prompt"],
      message: "Only an edited Home user message accepts replacement prompt text.",
    });
  }
});
export type HomeThreadForkInput = z.infer<typeof homeThreadForkInputSchema>;

export const homeThreadForkResultSchema = z.strictObject({
  submitted: z.literal(true),
  root_thread_id: z.string().min(1),
  source_thread_id: z.string().min(1),
  thread_id: z.string().min(1),
  turn_id: z.string().min(1).nullable(),
  revision: z.number().int().positive(),
});
export type HomeThreadForkResult = z.infer<typeof homeThreadForkResultSchema>;

export const homeThreadSelectInputSchema = z.strictObject({
  root_thread_id: z.string().min(1),
  thread_id: z.string().min(1),
  expected_revision: z.number().int().positive(),
  idempotency_key: z.string().min(1).max(255),
});
export type HomeThreadSelectInput = z.infer<typeof homeThreadSelectInputSchema>;

export const homeThreadSelectResultSchema = z.strictObject({
  root_thread_id: z.string().min(1),
  selected_thread_id: z.string().min(1),
  revision: z.number().int().positive(),
});
export type HomeThreadSelectResult = z.infer<typeof homeThreadSelectResultSchema>;

export const homeThreadDeleteInputSchema = z.strictObject({
  thread_id: z.string().min(1),
  confirmation: z.string().min(1),
  expected_revision: z.number().int().positive(),
  idempotency_key: z.string().min(1).max(255),
});
export type HomeThreadDeleteInput = z.infer<typeof homeThreadDeleteInputSchema>;

export const homeThreadDeleteResultSchema = z.strictObject({
  thread_id: z.string().min(1),
  deleted: z.literal(true),
});
export type HomeThreadDeleteResult = z.infer<typeof homeThreadDeleteResultSchema>;

export const homeThreadStatusSchema = z.enum(["idle", "active", "error", "unknown"]);
export type HomeThreadStatus = z.infer<typeof homeThreadStatusSchema>;

export const homeThreadOriginSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("native") }),
  z.strictObject({
    kind: z.literal("imported"),
    display_name: z.string().min(1),
    imported_at_ms: z.number().int().nonnegative(),
  }),
]);
export type HomeThreadOrigin = z.infer<typeof homeThreadOriginSchema>;

export const homeThreadSummarySchema = z.strictObject({
  thread_id: z.string().min(1),
  title: z.string().nullable(),
  preview: z.string().nullable(),
  created_at_ms: z.number().int().nonnegative().nullable(),
  updated_at_ms: z.number().int().nonnegative().nullable(),
  status: homeThreadStatusSchema,
  unread_count: z.number().int().nonnegative().default(0),
  read_through: z.string().min(1).nullable().default(null),
  origin: homeThreadOriginSchema.optional(),
});
export type HomeThreadSummary = z.infer<typeof homeThreadSummarySchema>;

export const homeThreadListResultSchema = z.strictObject({
  items: z.array(homeThreadSummarySchema),
  page: z.strictObject({
    next_cursor: z.string().min(1).nullable(),
    backwards_cursor: z.string().min(1).nullable(),
  }),
});
export type HomeThreadListResult = z.infer<typeof homeThreadListResultSchema>;

export const homeThreadSearchResultSchema = z.strictObject({
  items: z.array(homeThreadSummarySchema),
  page: z.strictObject({
    next_cursor: z.string().min(1).nullable(),
    backwards_cursor: z.string().min(1).nullable(),
  }),
});
export type HomeThreadSearchResult = z.infer<typeof homeThreadSearchResultSchema>;

export const homeProjectSchema = z.strictObject({
  project_id: z.string().min(1),
  name: z.string().min(1).max(80),
  created_at_ms: z.number().int().nonnegative(),
  updated_at_ms: z.number().int().nonnegative(),
});
export type HomeProject = z.infer<typeof homeProjectSchema>;

export const homeProjectListInputSchema = z.object({}).strict();
export type HomeProjectListInput = z.infer<typeof homeProjectListInputSchema>;
export const homeProjectListResultSchema = z.strictObject({
  items: z.array(homeProjectSchema),
});
export type HomeProjectListResult = z.infer<typeof homeProjectListResultSchema>;

export const homeProjectCreateInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
});
export type HomeProjectCreateInput = z.infer<typeof homeProjectCreateInputSchema>;
export const homeProjectUpdateInputSchema = z.strictObject({
  project_id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
});
export type HomeProjectUpdateInput = z.infer<typeof homeProjectUpdateInputSchema>;
export const homeProjectDeleteInputSchema = z.strictObject({
  project_id: z.string().min(1),
  confirmation: z.string().min(1),
});
export type HomeProjectDeleteInput = z.infer<typeof homeProjectDeleteInputSchema>;
export const homeProjectDeleteResultSchema = z.strictObject({
  project_id: z.string().min(1),
  deleted: z.literal(true),
});
export type HomeProjectDeleteResult = z.infer<typeof homeProjectDeleteResultSchema>;

export const homeProjectThreadMoveInputSchema = z.strictObject({
  thread_id: z.string().min(1),
  project_id: z.string().min(1).nullable(),
});
export type HomeProjectThreadMoveInput = z.infer<typeof homeProjectThreadMoveInputSchema>;
export const homeProjectThreadMoveResultSchema = z.strictObject({
  root_thread_id: z.string().min(1),
  project_id: z.string().min(1).nullable(),
});
export type HomeProjectThreadMoveResult = z.infer<typeof homeProjectThreadMoveResultSchema>;

export const homeConversationImportStatusSchema = z.enum([
  "queued",
  "validating",
  "importing",
  "rolling_back",
  "succeeded",
  "failed",
]);
export type HomeConversationImportStatus = z.infer<typeof homeConversationImportStatusSchema>;

export const homeConversationImportSchema = z.strictObject({
  import_id: z.string().min(1),
  status: homeConversationImportStatusSchema,
  total_conversations: z.number().int().nonnegative(),
  processed_conversations: z.number().int().nonnegative(),
  skipped_conversations: z.number().int().nonnegative(),
  created_threads: z.number().int().nonnegative(),
  error_code: z.string().min(1).nullable(),
  created_at_ms: z.number().int().nonnegative(),
  completed_at_ms: z.number().int().nonnegative().nullable(),
});
export type HomeConversationImport = z.infer<typeof homeConversationImportSchema>;

export const homeConversationImportReadInputSchema = z.strictObject({
  import_id: z.string().min(1),
});
export type HomeConversationImportReadInput = z.infer<typeof homeConversationImportReadInputSchema>;

export const homeFilesystemEntryKindSchema = z.enum(["file", "folder"]);
export type HomeFilesystemEntryKind = z.infer<typeof homeFilesystemEntryKindSchema>;

export const homeFilesystemEntrySchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  name: z.string().min(1),
  is_folder: z.boolean(),
  size_bytes: z.number().int().nonnegative().nullable(),
  modified_at_ms: z.number().nonnegative().nullable(),
}).passthrough();
export type HomeFilesystemEntry = z.infer<typeof homeFilesystemEntrySchema>;

export const homeFilesystemListInputSchema = z.object({
  path: z.string().min(1),
}).strict();
export type HomeFilesystemListInput = z.infer<typeof homeFilesystemListInputSchema>;

export const homeFilesystemCreateInputSchema = z.object({
  parent_path: z.string().min(1),
  name: z.string().min(1),
  kind: homeFilesystemEntryKindSchema,
}).strict();
export type HomeFilesystemCreateInput = z.infer<typeof homeFilesystemCreateInputSchema>;

export const homeFilesystemUploadInputSchema = z.object({
  parent_path: z.string().min(1),
  name: z.string().min(1),
}).strict();
export type HomeFilesystemUploadInput = z.infer<typeof homeFilesystemUploadInputSchema>;

export const homeFilesystemDownloadInputSchema = z.object({
  path: z.string().min(1),
  disposition: z.enum(["attachment", "inline"]).optional(),
}).strict();
export type HomeFilesystemDownloadInput = z.infer<typeof homeFilesystemDownloadInputSchema>;

export const homeFilesystemRenameInputSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
}).strict();
export type HomeFilesystemRenameInput = z.infer<typeof homeFilesystemRenameInputSchema>;

export const homeFilesystemDeleteInputSchema = z.object({
  path: z.string().min(1),
}).strict();
export type HomeFilesystemDeleteInput = z.infer<typeof homeFilesystemDeleteInputSchema>;

export const homeFilesystemListResultSchema = z.object({
  parent: homeFilesystemEntrySchema,
  children: z.array(homeFilesystemEntrySchema),
}).strict();
export type HomeFilesystemListResult = z.infer<typeof homeFilesystemListResultSchema>;

export const homeFilesystemDeleteResultSchema = z.object({
  path: z.string().min(1),
  deleted: z.literal(true),
}).strict();
export type HomeFilesystemDeleteResult = z.infer<typeof homeFilesystemDeleteResultSchema>;

export const homeFilesystemEventsInputSchema = z.object({
  path: z.string().min(1).optional(),
}).strict();
export type HomeFilesystemEventsInput = z.infer<typeof homeFilesystemEventsInputSchema>;

export const homeFilesystemEventSchema = z.object({
  schema_version: z.literal(1),
  type: z.literal("home.filesystem.changed"),
  source: z.literal("company-runtime"),
  member_id: z.string().min(1),
  changed_paths: z.array(z.string().min(1)),
  reload_paths: z.array(z.string().min(1)),
  occurred_at_ms: z.number().int().nonnegative(),
}).passthrough();
export type HomeFilesystemEvent = z.infer<typeof homeFilesystemEventSchema>;

export const homeFilesystemEventStreamSchema = z.custom<AsyncIterable<unknown>>(isAsyncIterable).transform(async function* (iter) {
  for await (const value of iter) {
    yield homeFilesystemEventSchema.parse(value);
  }
});
export type HomeFilesystemEventStream = z.infer<typeof homeFilesystemEventStreamSchema>;

export const homeTurnEventSchema = homeAgentTurnEventSchema;
export type HomeTurnEvent = HomeAgentTurnEvent;

export const homeTurnEventStreamSchema = homeAgentTurnEventStreamSchema;
export type HomeTurnEventStream = z.infer<typeof homeTurnEventStreamSchema>;
function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}
