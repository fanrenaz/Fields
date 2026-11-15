import { z } from "zod";

import {
  homeFilesystemEntrySchema,
  homeThreadSummarySchema,
} from "./home.js";
import {
  assetKindSchema,
  assetNameSchema,
  assetSlugSchema,
  assetVersionSchema,
} from "./asset.js";

export const searchResultKindSchema = z.enum([
  "room",
  "member",
  "home_thread",
  "message",
  "file",
  "asset",
  "email",
]);
export type SearchResultKind = z.infer<typeof searchResultKindSchema>;

export const searchPageInputSchema = z.object({
  search_term: z.string().trim().min(1).max(200),
  cursor: z.string().min(1).nullable().optional(),
  limit: z.number().int().min(1).max(50).optional(),
}).strict();

export const homeFilesystemSearchInputSchema = searchPageInputSchema;
export type HomeFilesystemSearchInput = z.infer<typeof homeFilesystemSearchInputSchema>;

export const homeFilesystemSearchResultSchema = z.object({
  items: z.array(homeFilesystemEntrySchema),
  page: z.object({
    next_cursor: z.string().min(1).nullable(),
  }),
}).strict();
export type HomeFilesystemSearchResult = z.infer<typeof homeFilesystemSearchResultSchema>;

export const roomMessageSearchItemSchema = z.object({
  message_id: z.string().min(1),
  sequence: z.number().int().positive(),
  sender_display_name: z.string().min(1),
  body_plain_text: z.string(),
  occurred_at_ms: z.number().int().nonnegative(),
});
export type RoomMessageSearchItem = z.infer<typeof roomMessageSearchItemSchema>;

export const roomMessageSearchInputSchema = searchPageInputSchema.extend({
  room_id: z.string().min(1),
});
export type RoomMessageSearchInput = z.infer<typeof roomMessageSearchInputSchema>;

export const roomMessageSearchResultSchema = z.object({
  room_id: z.string().min(1),
  items: z.array(roomMessageSearchItemSchema),
  page: z.object({
    next_cursor: z.string().min(1).nullable(),
  }),
});
export type RoomMessageSearchResult = z.infer<typeof roomMessageSearchResultSchema>;

export const roomMessageContextInputSchema = z.object({
  room_id: z.string().min(1),
  message_id: z.string().min(1),
  limit: z.number().int().min(1).max(100).optional(),
});
export type RoomMessageContextInput = z.infer<typeof roomMessageContextInputSchema>;

export const searchRoomItemSchema = z.object({
  kind: z.literal("room"),
  room_id: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().nullable(),
  updated_at_ms: z.number().int().nonnegative(),
});

export const searchMemberItemSchema = z.object({
  kind: z.literal("member"),
  actor_id: z.string().min(1),
  display_name: z.string().min(1),
  mark: z.string().min(1),
  email: z.string().email().nullable(),
  actor_type: z.enum(["human", "agent"]),
});

export const searchHomeThreadItemSchema = homeThreadSummarySchema.extend({
  kind: z.literal("home_thread"),
});

export const searchMessageItemSchema = roomMessageSearchItemSchema.extend({
  kind: z.literal("message"),
  room_id: z.string().min(1),
  room_title: z.string().min(1),
});

export const searchFileSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("home") }).strict(),
  z.object({ type: z.literal("company") }).strict(),
]);
export type SearchFileSource = z.infer<typeof searchFileSourceSchema>;

export const searchFileItemSchema = z.object({
  kind: z.literal("file"),
  source: searchFileSourceSchema,
  file_id: z.string().min(1).nullable(),
  path: z.string().min(1),
  name: z.string().min(1),
  is_folder: z.boolean(),
  modified_at_ms: z.number().int().nonnegative().nullable(),
});

export const searchAssetItemSchema = z.strictObject({
  kind: z.literal("asset"),
  asset_id: z.string().min(1),
  asset_kind: assetKindSchema,
  name: assetNameSchema,
  slug: assetSlugSchema,
  description: z.string().max(4_000),
  current_version: assetVersionSchema,
  updated_at_ms: z.number().int().nonnegative(),
});

export const searchEmailItemSchema = z.strictObject({
  kind: z.literal("email"),
  mailbox_id: z.string().min(1),
  folder_id: z.string().min(1),
  message_id: z.string().min(1),
  subject: z.string(),
  sender_name: z.string().nullable(),
  sender_address: z.string().email().nullable(),
  occurred_at_ms: z.number().int().nonnegative().nullable(),
});

export const searchResultItemSchema = z.discriminatedUnion("kind", [
  searchRoomItemSchema,
  searchMemberItemSchema,
  searchHomeThreadItemSchema,
  searchMessageItemSchema,
  searchFileItemSchema,
  searchAssetItemSchema,
  searchEmailItemSchema,
]);
export type SearchResultItem = z.infer<typeof searchResultItemSchema>;

export const globalSearchInputSchema = searchPageInputSchema.extend({
  kind: searchResultKindSchema.optional(),
});
export type GlobalSearchInput = z.infer<typeof globalSearchInputSchema>;

export const searchResultGroupSchema = z.object({
  kind: searchResultKindSchema,
  items: z.array(searchResultItemSchema),
  page: z.object({
    next_cursor: z.string().min(1).nullable(),
  }),
});
export type SearchResultGroup = z.infer<typeof searchResultGroupSchema>;

export const searchCoverageTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("room"),
    room_id: z.string().min(1),
  }),
  z.strictObject({ kind: z.literal("member") }),
  z.strictObject({ kind: z.literal("home_thread") }),
  z.strictObject({ kind: z.literal("message") }),
  z.strictObject({ kind: z.literal("asset") }),
  z.strictObject({
    kind: z.literal("email"),
    mailbox_id: z.string().min(1).optional(),
  }),
  z.strictObject({
    kind: z.literal("file"),
    source: z.discriminatedUnion("type", [
      z.strictObject({ type: z.literal("home") }),
      z.strictObject({ type: z.literal("company") }),
    ]),
  }),
]);
export type SearchCoverageTarget = z.infer<typeof searchCoverageTargetSchema>;

export const searchCoverageFailureCodeSchema = z.enum([
  "UNAVAILABLE",
  "FORBIDDEN",
  "NOT_FOUND",
  "FAILED",
]);
export type SearchCoverageFailureCode = z.infer<typeof searchCoverageFailureCodeSchema>;

export const searchCoverageFailureSchema = z.strictObject({
  target: searchCoverageTargetSchema,
  code: searchCoverageFailureCodeSchema,
});
export type SearchCoverageFailure = z.infer<typeof searchCoverageFailureSchema>;

export const searchCoverageSchema = z.object({
  visible_room_count: z.number().int().nonnegative(),
  searched_room_count: z.number().int().nonnegative(),
  failed_sources: z.array(searchCoverageFailureSchema),
  email: z.strictObject({
    indexed_from_ms: z.number().int().nonnegative().nullable(),
    includes_remote_results: z.literal(false),
    partial: z.boolean(),
    failed_mailbox_ids: z.array(z.string().min(1)),
  }),
}).strict().superRefine((coverage, context) => {
  if (coverage.searched_room_count > coverage.visible_room_count) {
    context.addIssue({
      code: "custom",
      path: ["searched_room_count"],
      message: "Searched Room count cannot exceed visible Room count.",
    });
  }
});
export type SearchCoverage = z.infer<typeof searchCoverageSchema>;

export const globalSearchResultSchema = z.object({
  query: z.string().min(1),
  groups: z.array(searchResultGroupSchema),
  coverage: searchCoverageSchema,
});
export type GlobalSearchResult = z.infer<typeof globalSearchResultSchema>;

export const globalSearchErrorCodeSchema = z.enum([
  "SEARCH_SCOPE_FORBIDDEN",
  "MEMBER_WORKSPACE_NOT_FOUND",
  "COMPANY_FILES_NOT_FOUND",
  "COMPANY_RUNTIME_UNAVAILABLE",
  "FORBIDDEN",
]);
export type GlobalSearchErrorCode = z.infer<typeof globalSearchErrorCodeSchema>;
