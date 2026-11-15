import { z } from "zod";

import { assetKindSchema } from "./asset.js";
import {
  homeThreadReadResultSchema,
  homeTurnSubmitResultSchema,
} from "./home.js";

export const assetBuilderTargetSchema = z.strictObject({
  kind: assetKindSchema,
  asset_id: z.string().min(1).nullable(),
  draft_id: z.string().min(1).nullable(),
});
export type AssetBuilderTarget = z.infer<typeof assetBuilderTargetSchema>;

export const assetBuilderTopicSchema = z.strictObject({
  topic_id: z.string().min(1),
  title: z.string().min(1),
  target: assetBuilderTargetSchema,
  thread_id: z.string().min(1).nullable(),
  created_at_ms: z.number().int().nonnegative(),
  updated_at_ms: z.number().int().nonnegative(),
});
export type AssetBuilderTopic = z.infer<typeof assetBuilderTopicSchema>;

export const assetBuilderTopicListInputSchema = assetBuilderTargetSchema;
export const assetBuilderTopicListResultSchema = z.strictObject({
  items: z.array(assetBuilderTopicSchema),
});

export const assetBuilderTopicCreateInputSchema = assetBuilderTargetSchema.extend({
  title: z.string().trim().min(1).max(120).optional(),
});

export const assetBuilderTopicReadInputSchema = z.strictObject({
  topic_id: z.string().min(1),
});
export const assetBuilderTopicReadResultSchema = z.strictObject({
  topic: assetBuilderTopicSchema,
  thread: homeThreadReadResultSchema.nullable(),
});

export const assetBuilderTurnSubmitInputSchema = assetBuilderTopicReadInputSchema.extend({
  prompt: z.string().trim().min(1).max(40_000),
  client_message_id: z.string().min(1).optional(),
  timeout_ms: z.number().int().min(1_000).max(900_000).optional(),
});
export const assetBuilderTurnSubmitResultSchema = z.strictObject({
  topic: assetBuilderTopicSchema,
  turn: homeTurnSubmitResultSchema,
});
