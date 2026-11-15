import type {
  AgentBuilderProfile,
  AgentBuilderTopic,
} from "@fields/contracts/public/agent-builder";
import type { HomeThreadReadResult, HomeTurnSubmitResult } from "@fields/contracts/public/home";
import { and, desc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { CompanyRuntimePublicGateway } from "../../../../../application/execution/ports/index.js";
import type { MemberAssetApplication } from "../../../../../application/company/ports/company-assets.js";
import type { AgentBuilderApplication } from "../../../../../application/agent-builder/index.js";
import type { MemberMemoryApplication } from "../../../../../application/member-memory/index.js";
import { ApplicationError } from "../../../../../application/platform/errors.js";
import type { BackendDatabase } from "../../database-service.js";
import {
  agentBuilderProfiles,
  agentBuilderTopics,
} from "../../schema/company/agent-builder.js";

export const AGENT_BUILDER_TARGET_INVALID_CODE = "AGENT_BUILDER_TARGET_INVALID";
export const AGENT_BUILDER_TOPIC_NOT_FOUND_CODE = "AGENT_BUILDER_TOPIC_NOT_FOUND";
export const AGENT_BUILDER_REVISION_CONFLICT_CODE = "AGENT_BUILDER_REVISION_CONFLICT";
export const AGENT_NOT_READY_FOR_ROOM_CODE = "AGENT_NOT_READY_FOR_ROOM";

export class PostgresAgentBuilderApplication implements AgentBuilderApplication {
  constructor(
    private readonly db: BackendDatabase,
    private readonly runtime: CompanyRuntimePublicGateway,
    private readonly nowMs: () => number = Date.now,
    private readonly newTopicId: () => string = () => `agent_builder_topic_${randomUUID()}`,
    private readonly memberAssets?: MemberAssetApplication,
    private readonly memberMemory?: MemberMemoryApplication,
  ) {}

  async profile(companyId: string, humanMemberId: string, agentMemberId: string) {
    await this.requireHumanAndAgent(companyId, humanMemberId, agentMemberId);
    await this.ensureProfile(companyId, agentMemberId);
    return this.readProfile(companyId, agentMemberId);
  }

  async updateProfile(input: {
    companyId: string;
    humanMemberId: string;
    agentMemberId: string;
    description: string;
    avatar: string;
    instructions: string;
    readiness: "draft" | "ready";
    memoryEnabled: boolean;
    expectedRevision: number;
  }) {
    await this.requireHumanAndAgent(input.companyId, input.humanMemberId, input.agentMemberId);
    await this.ensureProfile(input.companyId, input.agentMemberId);
    const currentMemory = await this.requireMemberMemory().profile(input.companyId, input.agentMemberId);
    const rows = await this.db.update(agentBuilderProfiles).set({
      description: input.description.trim(),
      avatar: input.avatar.trim() || "🤖",
      instructions: input.instructions.trim(),
      readiness: input.readiness,
      revision: sql`${agentBuilderProfiles.revision} + 1`,
      updatedAtMs: this.nowMs(),
    }).where(and(
      eq(agentBuilderProfiles.companyId, input.companyId),
      eq(agentBuilderProfiles.agentMemberId, input.agentMemberId),
      eq(agentBuilderProfiles.revision, input.expectedRevision),
    )).returning();
    if (rows.length !== 1) {
      throw new ApplicationError(AGENT_BUILDER_REVISION_CONFLICT_CODE, false);
    }
    if (currentMemory.enabled !== input.memoryEnabled || currentMemory.status === "failed") {
      await this.requireMemberMemory().update({
        companyId: input.companyId,
        memberId: input.agentMemberId,
        enabled: input.memoryEnabled,
        expectedRevision: currentMemory.revision,
      });
    }
    return this.readProfile(input.companyId, input.agentMemberId);
  }

  async listTopics(companyId: string, humanMemberId: string, agentMemberId: string) {
    await this.requireHumanAndAgent(companyId, humanMemberId, agentMemberId);
    const rows = await this.db.select().from(agentBuilderTopics).where(and(
      eq(agentBuilderTopics.companyId, companyId),
      eq(agentBuilderTopics.humanMemberId, humanMemberId),
      eq(agentBuilderTopics.agentMemberId, agentMemberId),
    )).orderBy(desc(agentBuilderTopics.updatedAtMs));
    return rows.map(topicProjection);
  }

  async createTopic(
    companyId: string,
    humanMemberId: string,
    agentMemberId: string,
    title?: string,
  ) {
    await this.requireHumanAndAgent(companyId, humanMemberId, agentMemberId);
    const now = this.nowMs();
    const [row] = await this.db.insert(agentBuilderTopics).values({
      id: this.newTopicId(),
      companyId,
      humanMemberId,
      agentMemberId,
      title: title?.trim() || "New conversation",
      threadId: null,
      createdAtMs: now,
      updatedAtMs: now,
    }).returning();
    return topicProjection(row!);
  }

  async readTopic(companyId: string, humanMemberId: string, agentMemberId: string, topicId: string): Promise<{
    topic: AgentBuilderTopic;
    thread: HomeThreadReadResult | null;
  }> {
    const topic = await this.requireTopic(companyId, humanMemberId, agentMemberId, topicId);
    return {
      topic,
      thread: topic.thread_id
        ? await this.runtime.homeThreadRead(companyId, humanMemberId, { thread_id: topic.thread_id })
        : null,
    };
  }

  async submitTurn(input: {
    companyId: string;
    humanMemberId: string;
    agentMemberId: string;
    topicId: string;
    prompt: string;
    clientMessageId?: string;
    timeoutMs?: number;
  }): Promise<{ topic: AgentBuilderTopic; turn: HomeTurnSubmitResult; profile: AgentBuilderProfile }> {
    const topic = await this.requireTopic(
      input.companyId,
      input.humanMemberId,
      input.agentMemberId,
      input.topicId,
    );
    const profile = await this.profile(input.companyId, input.humanMemberId, input.agentMemberId);
    const target = await this.requireHumanAndAgent(
      input.companyId,
      input.humanMemberId,
      input.agentMemberId,
    );
    const assetContext = this.memberAssets
      ? await Promise.all([
        this.memberAssets.current(
          input.companyId,
          input.humanMemberId,
          input.agentMemberId,
        ),
        this.memberAssets.options(
          input.companyId,
          input.humanMemberId,
          input.agentMemberId,
          {},
        ),
      ]).then(([current, available]) => ({
        installed: current.installations.map((item) => (
          `${item.kind}:${item.name}@${item.version}`
        )),
        available: available.items.map((item) => (
          `${item.kind}:${item.name}@${item.version}`
        )),
      }))
      : { installed: [], available: [] };
    const turn = await this.runtime.homeTurnSubmit(input.companyId, input.humanMemberId, {
      ...(topic.thread_id ? { thread_id: topic.thread_id } : {}),
      prompt: builderPrompt(target.displayName, profile, assetContext, input.prompt),
      builder_scope: { kind: "agent", topic_id: topic.topic_id },
      developer_instructions: agentBuilderDeveloperInstructions(),
      ...(input.clientMessageId ? { client_message_id: input.clientMessageId } : {}),
      ...(input.timeoutMs ? { timeout_ms: input.timeoutMs } : {}),
    });
    const now = this.nowMs();
    const title = topic.thread_id ? topic.title : conciseTitle(input.prompt);
    const [updated] = await this.db.update(agentBuilderTopics).set({
      threadId: turn.thread_id,
      title,
      updatedAtMs: now,
    }).where(and(
      eq(agentBuilderTopics.id, topic.topic_id),
      eq(agentBuilderTopics.companyId, input.companyId),
      eq(agentBuilderTopics.humanMemberId, input.humanMemberId),
    )).returning();
    return { topic: topicProjection(updated!), turn, profile };
  }

  async threadIds(companyId: string, humanMemberId: string): Promise<Set<string>> {
    const rows = await this.db.select({ threadId: agentBuilderTopics.threadId })
      .from(agentBuilderTopics)
      .where(and(
        eq(agentBuilderTopics.companyId, companyId),
        eq(agentBuilderTopics.humanMemberId, humanMemberId),
      ));
    return new Set(rows.flatMap((row) => row.threadId ? [row.threadId] : []));
  }

  async requireRoomReady(companyId: string, memberId: string): Promise<void> {
    const result = await this.db.execute(sql<{
      type: string;
      status: string;
      readiness: string | null;
      assignment_state: string | null;
    }>`
      select actor.type, actor.status, profile.readiness,
        assignment.state as assignment_state
      from actors actor
      left join agent_builder_profiles profile
        on profile.company_id = actor.company_id
        and profile.agent_member_id = actor.id
      left join member_executor_assignments assignment
        on assignment.company_id = actor.company_id
        and assignment.member_id = actor.id
      where actor.company_id = ${companyId}
        and actor.id = ${memberId}
      limit 2
    `);
    const row = result.rows[0];
    if (!row || row.status !== "active") {
      throw new ApplicationError(AGENT_BUILDER_TARGET_INVALID_CODE, false);
    }
    if (row.type === "human") return;
    if (
      row.type !== "agent"
      || row.readiness !== "ready"
      || row.assignment_state !== "ready"
    ) {
      throw new ApplicationError(AGENT_NOT_READY_FOR_ROOM_CODE, false);
    }
  }

  private async requireTopic(
    companyId: string,
    humanMemberId: string,
    agentMemberId: string,
    topicId: string,
  ): Promise<AgentBuilderTopic> {
    await this.requireHumanAndAgent(companyId, humanMemberId, agentMemberId);
    const [row] = await this.db.select().from(agentBuilderTopics).where(and(
      eq(agentBuilderTopics.id, topicId),
      eq(agentBuilderTopics.companyId, companyId),
      eq(agentBuilderTopics.humanMemberId, humanMemberId),
      eq(agentBuilderTopics.agentMemberId, agentMemberId),
    )).limit(1);
    if (!row) throw new ApplicationError(AGENT_BUILDER_TOPIC_NOT_FOUND_CODE, false);
    return topicProjection(row);
  }

  private async requireHumanAndAgent(
    companyId: string,
    humanMemberId: string,
    agentMemberId: string,
  ): Promise<{ displayName: string }> {
    const result = await this.db.execute(sql<{
      id: string;
      type: string;
      status: string;
      display_name: string;
    }>`
      select id, type, status, display_name
      from actors
      where company_id = ${companyId}
        and id in (${humanMemberId}, ${agentMemberId})
    `);
    const rows = result.rows;
    const human = rows.find((row) => row.id === humanMemberId);
    const agent = rows.find((row) => row.id === agentMemberId);
    if (
      human?.type !== "human" || human.status !== "active"
      || agent?.type !== "agent" || agent.status !== "active"
    ) {
      throw new ApplicationError(AGENT_BUILDER_TARGET_INVALID_CODE, false);
    }
    return { displayName: String(agent.display_name) };
  }

  private async ensureProfile(companyId: string, agentMemberId: string) {
    await this.db.insert(agentBuilderProfiles).values({
      companyId,
      agentMemberId,
      updatedAtMs: this.nowMs(),
    }).onConflictDoNothing();
  }

  private async readProfile(companyId: string, agentMemberId: string) {
    const [row] = await this.db.select().from(agentBuilderProfiles).where(and(
      eq(agentBuilderProfiles.companyId, companyId),
      eq(agentBuilderProfiles.agentMemberId, agentMemberId),
    )).limit(1);
    if (!row) throw new ApplicationError(AGENT_BUILDER_TARGET_INVALID_CODE, false);
    const memory = await this.requireMemberMemory().profile(companyId, agentMemberId);
    return profileProjection(row, memory);
  }

  private requireMemberMemory(): MemberMemoryApplication {
    if (!this.memberMemory) throw new Error("Member Memory application is required.");
    return this.memberMemory;
  }
}

function profileProjection(
  row: typeof agentBuilderProfiles.$inferSelect,
  memory: AgentBuilderProfile["memory"] & { revision: number },
): AgentBuilderProfile {
  return {
    agent_member_id: row.agentMemberId,
    description: row.description,
    avatar: row.avatar,
    instructions: row.instructions,
    readiness: row.readiness === "ready" ? "ready" : "draft",
    memory: {
      enabled: memory.enabled,
      applied_enabled: memory.applied_enabled,
      status: memory.status,
      error_code: memory.error_code,
    },
    revision: Number(row.revision),
    updated_at_ms: Number(row.updatedAtMs),
  };
}

function topicProjection(row: typeof agentBuilderTopics.$inferSelect): AgentBuilderTopic {
  return {
    topic_id: row.id,
    agent_member_id: row.agentMemberId,
    title: row.title,
    thread_id: row.threadId,
    created_at_ms: Number(row.createdAtMs),
    updated_at_ms: Number(row.updatedAtMs),
  };
}

function conciseTitle(prompt: string): string {
  const oneLine = prompt.trim().replaceAll(/\s+/gu, " ");
  return oneLine.length > 48 ? `${oneLine.slice(0, 47)}…` : oneLine;
}

function builderPrompt(
  name: string,
  profile: AgentBuilderProfile,
  assetContext: { installed: string[]; available: string[] },
  userPrompt: string,
): string {
  return [
    "You are the Agent Builder. Help the human define and refine a target agent.",
    "Respond as a concise design partner. Do not claim that a profile change was saved.",
    "You may inspect published Company assets with assets.list, assets.read, and assets.content.read.",
    "Never call any asset mutation, installation, credential, lifecycle, or deletion tool.",
    "Recommend exact published asset names and versions. The human confirms installations separately.",
    `Target name: ${name}`,
    `Description: ${profile.description || "(not set)"}`,
    `Long-term instructions: ${profile.instructions || "(not set)"}`,
    `Readiness: ${profile.readiness}`,
    `Currently installed assets: ${assetContext.installed.join(", ") || "(none)"}`,
    `Available published assets: ${assetContext.available.join(", ") || "(none)"}`,
    "",
    `Human request: ${userPrompt}`,
  ].join("\n");
}

function agentBuilderDeveloperInstructions(): string {
  return [
    "You are the Fields Agent Builder.",
    "You may inspect published Company assets only with assets.list, assets.read, and assets.content.read.",
    "Do not call asset mutation, installation, credential, lifecycle, or deletion tools.",
    "Recommend exact published asset names and versions. A human confirms installations separately.",
    "Do not claim that Agent profile or asset installation changes were saved.",
  ].join("\n");
}
