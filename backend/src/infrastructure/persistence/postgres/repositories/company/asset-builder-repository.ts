import type {
  AssetBuilderTarget,
  AssetBuilderTopic,
} from "@fields/contracts/public/asset-builder";
import type { HomeThreadReadResult, HomeTurnSubmitResult } from "@fields/contracts/public/home";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { AssetBuilderApplication } from "../../../../../application/asset-builder/index.js";
import type { CompanyAssetApplication } from "../../../../../application/company/ports/company-assets.js";
import type { CompanyRuntimePublicGateway } from "../../../../../application/execution/ports/index.js";
import { ApplicationError } from "../../../../../application/platform/errors.js";
import type { BackendDatabase } from "../../database-service.js";
import { assetBuilderTopics } from "../../schema/company/asset-builder.js";

export const ASSET_BUILDER_TOPIC_NOT_FOUND_CODE = "ASSET_BUILDER_TOPIC_NOT_FOUND";
export const ASSET_BUILDER_TARGET_INVALID_CODE = "ASSET_BUILDER_TARGET_INVALID";

export class PostgresAssetBuilderApplication implements AssetBuilderApplication {
  constructor(
    private readonly db: BackendDatabase,
    private readonly runtime: CompanyRuntimePublicGateway,
    private readonly assets: CompanyAssetApplication,
    private readonly nowMs: () => number = Date.now,
    private readonly newTopicId: () => string = () => `asset_builder_topic_${randomUUID()}`,
  ) {}

  async listTopics(
    companyId: string,
    humanMemberId: string,
    target: AssetBuilderTarget,
  ): Promise<AssetBuilderTopic[]> {
    await this.requireHuman(companyId, humanMemberId);
    await this.validateTarget(companyId, humanMemberId, target);
    const rows = await this.db.select().from(assetBuilderTopics).where(and(
      eq(assetBuilderTopics.companyId, companyId),
      eq(assetBuilderTopics.humanMemberId, humanMemberId),
      eq(assetBuilderTopics.kind, target.kind),
      target.asset_id
        ? eq(assetBuilderTopics.assetId, target.asset_id)
        : isNull(assetBuilderTopics.assetId),
    )).orderBy(desc(assetBuilderTopics.updatedAtMs));
    return rows.map(topicProjection);
  }

  async createTopic(
    companyId: string,
    humanMemberId: string,
    target: AssetBuilderTarget,
    title?: string,
  ): Promise<AssetBuilderTopic> {
    await this.requireHuman(companyId, humanMemberId);
    await this.validateTarget(companyId, humanMemberId, target);
    const now = this.nowMs();
    const [row] = await this.db.insert(assetBuilderTopics).values({
      id: this.newTopicId(),
      companyId,
      humanMemberId,
      kind: target.kind,
      assetId: target.asset_id,
      draftId: target.draft_id,
      title: title?.trim() || "New conversation",
      threadId: null,
      createdAtMs: now,
      updatedAtMs: now,
    }).returning();
    return topicProjection(row!);
  }

  async readTopic(
    companyId: string,
    humanMemberId: string,
    topicId: string,
  ): Promise<{ topic: AssetBuilderTopic; thread: HomeThreadReadResult | null }> {
    const topic = await this.requireTopic(companyId, humanMemberId, topicId);
    return {
      topic,
      thread: topic.thread_id
        ? await this.runtime.homeThreadRead(companyId, humanMemberId, {
          thread_id: topic.thread_id,
        })
        : null,
    };
  }

  async submitTurn(input: {
    companyId: string;
    humanMemberId: string;
    topicId: string;
    prompt: string;
    clientMessageId?: string;
    timeoutMs?: number;
  }): Promise<{ topic: AssetBuilderTopic; turn: HomeTurnSubmitResult }> {
    const topic = await this.requireTopic(
      input.companyId,
      input.humanMemberId,
      input.topicId,
    );
    const startedAt = this.nowMs();
    const turn = await this.runtime.homeTurnSubmit(input.companyId, input.humanMemberId, {
      ...(topic.thread_id ? { thread_id: topic.thread_id } : {}),
      prompt: assetBuilderPrompt(topic, input.prompt),
      builder_scope: { kind: "asset", topic_id: topic.topic_id },
      developer_instructions: assetBuilderDeveloperInstructions(),
      ...(input.clientMessageId ? { client_message_id: input.clientMessageId } : {}),
      ...(input.timeoutMs ? { timeout_ms: input.timeoutMs } : {}),
    });
    const target = topic.target.asset_id
      ? await this.findUpdatedTarget(
        input.companyId,
        input.humanMemberId,
        topic.target,
        startedAt,
      ) ?? topic.target
      : await this.findCreatedTarget(
        input.companyId,
        input.humanMemberId,
        topic.target.kind,
        startedAt,
      ) ?? topic.target;
    const title = topic.thread_id ? topic.title : conciseTitle(input.prompt);
    const [updated] = await this.db.update(assetBuilderTopics).set({
      threadId: turn.thread_id,
      title,
      assetId: target.asset_id,
      draftId: target.draft_id,
      updatedAtMs: this.nowMs(),
    }).where(and(
      eq(assetBuilderTopics.id, topic.topic_id),
      eq(assetBuilderTopics.companyId, input.companyId),
      eq(assetBuilderTopics.humanMemberId, input.humanMemberId),
    )).returning();
    return { topic: topicProjection(updated!), turn };
  }

  async threadIds(companyId: string, humanMemberId: string): Promise<Set<string>> {
    const rows = await this.db.select({ threadId: assetBuilderTopics.threadId })
      .from(assetBuilderTopics)
      .where(and(
        eq(assetBuilderTopics.companyId, companyId),
        eq(assetBuilderTopics.humanMemberId, humanMemberId),
      ));
    return new Set(rows.flatMap((row) => row.threadId ? [row.threadId] : []));
  }

  private async findCreatedTarget(
    companyId: string,
    humanMemberId: string,
    kind: AssetBuilderTarget["kind"],
    startedAt: number,
  ): Promise<AssetBuilderTarget | null> {
    const list = await this.assets.list(companyId, humanMemberId, {
      kind,
      lifecycle: "draft",
      limit: 100,
    });
    const candidates = list.items
      .filter((item) => item.updated_at_ms >= startedAt)
      .sort((left, right) => right.updated_at_ms - left.updated_at_ms);
    for (const candidate of candidates) {
      const detail = await this.assets.read(companyId, humanMemberId, candidate.asset_id);
      const draft = detail.drafts
        .filter((item) => (
          item.updated_by_actor_id === humanMemberId
          && item.updated_at_ms >= startedAt
        ))
        .sort((left, right) => right.updated_at_ms - left.updated_at_ms)[0];
      if (draft) {
        return { kind, asset_id: candidate.asset_id, draft_id: draft.draft_id };
      }
    }
    return null;
  }

  private async findUpdatedTarget(
    companyId: string,
    humanMemberId: string,
    target: AssetBuilderTarget,
    startedAt: number,
  ): Promise<AssetBuilderTarget | null> {
    if (!target.asset_id) return null;
    const detail = await this.assets.read(companyId, humanMemberId, target.asset_id);
    const draft = detail.drafts
      .filter((item) => (
        item.updated_by_actor_id === humanMemberId
        && item.updated_at_ms >= startedAt
      ))
      .sort((left, right) => right.updated_at_ms - left.updated_at_ms)[0];
    return draft
      ? { kind: target.kind, asset_id: target.asset_id, draft_id: draft.draft_id }
      : null;
  }

  private async requireTopic(
    companyId: string,
    humanMemberId: string,
    topicId: string,
  ): Promise<AssetBuilderTopic> {
    await this.requireHuman(companyId, humanMemberId);
    const [row] = await this.db.select().from(assetBuilderTopics).where(and(
      eq(assetBuilderTopics.id, topicId),
      eq(assetBuilderTopics.companyId, companyId),
      eq(assetBuilderTopics.humanMemberId, humanMemberId),
    )).limit(1);
    if (!row) throw new ApplicationError(ASSET_BUILDER_TOPIC_NOT_FOUND_CODE, false);
    return topicProjection(row);
  }

  private async requireHuman(companyId: string, memberId: string): Promise<void> {
    const result = await this.db.execute(sql<{ type: string; status: string }>`
      select type, status from actors
      where company_id = ${companyId} and id = ${memberId}
      limit 1
    `);
    const row = result.rows[0];
    if (!row || row.type !== "human" || row.status !== "active") {
      throw new ApplicationError(ASSET_BUILDER_TARGET_INVALID_CODE, false);
    }
  }

  private async validateTarget(
    companyId: string,
    actorId: string,
    target: AssetBuilderTarget,
  ): Promise<void> {
    if (!target.asset_id && target.draft_id) {
      throw new ApplicationError(ASSET_BUILDER_TARGET_INVALID_CODE, false);
    }
    if (!target.asset_id) return;
    const detail = await this.assets.read(companyId, actorId, target.asset_id);
    if (detail.summary.kind !== target.kind) {
      throw new ApplicationError(ASSET_BUILDER_TARGET_INVALID_CODE, false);
    }
    if (
      target.draft_id
      && !detail.drafts.some((draft) => draft.draft_id === target.draft_id)
    ) {
      throw new ApplicationError(ASSET_BUILDER_TARGET_INVALID_CODE, false);
    }
  }
}

function topicProjection(row: typeof assetBuilderTopics.$inferSelect): AssetBuilderTopic {
  return {
    topic_id: row.id,
    title: row.title,
    target: {
      kind: row.kind === "skill" ? "skill" : row.kind === "mcp" ? "mcp" : "plugin",
      asset_id: row.assetId,
      draft_id: row.draftId,
    },
    thread_id: row.threadId,
    created_at_ms: Number(row.createdAtMs),
    updated_at_ms: Number(row.updatedAtMs),
  };
}

function conciseTitle(prompt: string): string {
  const oneLine = prompt.trim().replaceAll(/\s+/gu, " ");
  return oneLine.length > 48 ? `${oneLine.slice(0, 47)}…` : oneLine;
}

function assetBuilderPrompt(topic: AssetBuilderTopic, request: string): string {
  const target = topic.target;
  return [
    "You are the Asset Builder for Fields.",
    "Use the existing fields_assets MCP tools to inspect Company assets and create or update a recoverable draft.",
    "You may use only assets.list, assets.read, assets.content.read, assets.draft.import_git, assets.draft.import_workspace_zip, assets.draft.create_mcp, assets.draft.update, and assets.draft.validate.",
    "Never publish, archive, restore, delete, install assets, or change credentials. Never claim those actions happened.",
    "For Plugin or Skill source, work inside the current trusted workspace, create a ZIP, import it as a draft, then validate it.",
    "Never request or place secrets in chat or files. MCP Bearer credentials are configured separately by the human.",
    `Asset kind: ${target.kind}`,
    `Target asset id: ${target.asset_id ?? "(new asset)"}`,
    `Target draft id: ${target.draft_id ?? "(new draft)"}`,
    "",
    `Human request: ${request}`,
  ].join("\n");
}

function assetBuilderDeveloperInstructions(): string {
  return [
    "You are the Fields Asset Builder.",
    "You may read assets and create, import, update, or validate recoverable drafts.",
    "Never publish, archive, restore, delete, install assets, or change credentials.",
    "Never request or persist secrets. A human configures MCP credentials separately.",
    "Use the current trusted workspace for generated Plugin or Skill packages.",
  ].join("\n");
}
