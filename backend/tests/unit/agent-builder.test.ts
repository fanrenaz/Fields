import assert from "node:assert/strict";
import test from "node:test";

import type { CompanyRuntimePublicGateway } from "../../src/application/execution/ports/index.js";
import type { MemberAssetApplication } from "../../src/application/company/ports/company-assets.js";
import type { MemberMemoryApplication } from "../../src/application/member-memory/index.js";
import type { BackendDatabase } from "../../src/infrastructure/persistence/postgres/database-service.js";
import {
  AGENT_NOT_READY_FOR_ROOM_CODE,
  PostgresAgentBuilderApplication,
} from "../../src/infrastructure/persistence/postgres/repositories/company/agent-builder-repository.js";

test("Agent Builder submits through the current Human Home Runtime identity", async () => {
  const topic = {
    id: "topic-1",
    companyId: "company-1",
    humanMemberId: "human-1",
    agentMemberId: "agent-1",
    title: "New conversation",
    threadId: null,
    createdAtMs: 100,
    updatedAtMs: 100,
  };
  const profile = {
    companyId: "company-1",
    agentMemberId: "agent-1",
    description: "Helps the team",
    avatar: "🤖",
    instructions: "Be precise.",
    readiness: "draft",
    memoryEnabled: true,
    memoryAppliedEnabled: true,
    memoryStatus: "ready",
    memoryErrorCode: null,
    memoryOperationId: null,
    revision: 0,
    updatedAtMs: 100,
  };
  let selectCount = 0;
  const submitted: unknown[][] = [];
  const db = {
    execute: async () => ({
      rows: [
        { id: "human-1", type: "human", status: "active", display_name: "Human" },
        { id: "agent-1", type: "agent", status: "active", display_name: "Research Agent" },
      ],
    }),
    insert: () => ({
      values: () => ({ onConflictDoNothing: async () => undefined }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [selectCount++ === 0 ? topic : profile],
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => [{ ...topic, ...values, threadId: "thread-builder-1" }],
        }),
      }),
    }),
  } as unknown as BackendDatabase;
  const runtime = {
    homeTurnSubmit: async (...args: unknown[]) => {
      submitted.push(args);
      return { submitted: true, thread_id: "thread-builder-1", turn_id: "turn-1" } as const;
    },
  } as unknown as CompanyRuntimePublicGateway;
  const memberAssets = {
    current: async () => ({
      member_id: "agent-1",
      revision: 1,
      installations: [{
        asset_id: "asset-1",
        version_id: "version-1",
        kind: "skill",
        name: "Research",
        slug: "research",
        version: "1.2.3",
        health: "ready",
        issue_code: null,
      }],
      operation: null,
    }),
    options: async () => ({
      member_id: "agent-1",
      items: [{
        asset_id: "asset-1",
        version_id: "version-1",
        kind: "skill",
        name: "Research",
        slug: "research",
        version: "1.2.3",
      }],
    }),
  } as unknown as MemberAssetApplication;
  const application = new PostgresAgentBuilderApplication(
    db,
    runtime,
    () => 200,
    undefined,
    memberAssets,
    readyMemory(),
  );

  await application.submitTurn({
    companyId: "company-1",
    humanMemberId: "human-1",
    agentMemberId: "agent-1",
    topicId: "topic-1",
    prompt: "Define its scope",
  });

  assert.equal(submitted.length, 1);
  assert.equal(submitted[0]![0], "company-1");
  assert.equal(submitted[0]![1], "human-1");
  assert.match(
    (submitted[0]![2] as { prompt: string }).prompt,
    /Target name: Research Agent[\s\S]*Human request: Define its scope/u,
  );
  assert.match(
    (submitted[0]![2] as { prompt: string }).prompt,
    /Currently installed assets: skill:Research@1\.2\.3[\s\S]*Available published assets: skill:Research@1\.2\.3/u,
  );
  assert.match(
    (submitted[0]![2] as { prompt: string }).prompt,
    /Never call any asset mutation/u,
  );
  assert.equal("executor_id" in (submitted[0]![2] as object), false);
  assert.deepEqual(
    (submitted[0]![2] as { builder_scope: unknown }).builder_scope,
    { kind: "agent", topic_id: "topic-1" },
  );
  assert.match(
    (submitted[0]![2] as { developer_instructions: string }).developer_instructions,
    /inspect published Company assets only/u,
  );
});

test("Room admission keeps Agent profile readiness and Room Executor readiness separate", async () => {
  let row = {
    type: "agent",
    status: "active",
    readiness: "draft",
    assignment_state: "ready",
  };
  const db = {
    execute: async () => ({ rows: [row] }),
  } as unknown as BackendDatabase;
  const application = new PostgresAgentBuilderApplication(
    db,
    {} as CompanyRuntimePublicGateway,
  );

  await assert.rejects(
    application.requireRoomReady("company-1", "agent-1"),
    (error: unknown) => (
      error instanceof Error
      && "code" in error
      && error.code === AGENT_NOT_READY_FOR_ROOM_CODE
    ),
  );

  row = { ...row, readiness: "ready", assignment_state: "pending" };
  await assert.rejects(
    application.requireRoomReady("company-1", "agent-1"),
    (error: unknown) => (
      error instanceof Error
      && "code" in error
      && error.code === AGENT_NOT_READY_FOR_ROOM_CODE
    ),
  );

  row = { ...row, assignment_state: "ready" };
  await application.requireRoomReady("company-1", "agent-1");
});

test("Agent profile delegates Memory changes to the shared Member Memory application", async () => {
  let row = {
    companyId: "company-1",
    agentMemberId: "agent-1",
    description: "",
    avatar: "🤖",
    instructions: "",
    readiness: "ready",
    revision: 3,
    updatedAtMs: 100,
  };
  const db = {
    execute: async () => ({
      rows: [
        { id: "human-1", type: "human", status: "active", display_name: "Human" },
        { id: "agent-1", type: "agent", status: "active", display_name: "Agent" },
      ],
    }),
    insert: () => ({ values: () => ({ onConflictDoNothing: async () => undefined }) }),
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [row] }) }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          row = {
            ...row,
            ...values,
            revision: "revision" in values ? row.revision + 1 : row.revision,
          } as typeof row;
          return { returning: async () => [row] };
        },
      }),
    }),
  } as unknown as BackendDatabase;
  let memory = {
    enabled: true,
    applied_enabled: true,
    status: "ready" as "ready" | "applying" | "failed",
    error_code: null as string | null,
    revision: 7,
  };
  let updateInput: unknown;
  const memberMemory: MemberMemoryApplication = {
    profile: async () => memory,
    update: async (input) => {
      updateInput = input;
      memory = { ...memory, enabled: input.enabled, status: "applying", revision: memory.revision + 1 };
      return memory;
    },
    complete: async () => undefined,
  };
  const application = new PostgresAgentBuilderApplication(
    db,
    {} as CompanyRuntimePublicGateway,
    () => 200,
    undefined,
    undefined,
    memberMemory,
  );

  const applying = await application.updateProfile({
    companyId: "company-1",
    humanMemberId: "human-1",
    agentMemberId: "agent-1",
    description: "",
    avatar: "🤖",
    instructions: "",
    readiness: "ready",
    memoryEnabled: false,
    expectedRevision: 3,
  });

  assert.equal(applying.memory.enabled, false);
  assert.equal(applying.memory.applied_enabled, true);
  assert.equal(applying.memory.status, "applying");
  assert.deepEqual(updateInput, {
    companyId: "company-1",
    memberId: "agent-1",
    enabled: false,
    expectedRevision: 7,
  });
});

function readyMemory(): MemberMemoryApplication {
  return {
    profile: async () => ({
      enabled: true,
      applied_enabled: true,
      status: "ready",
      error_code: null,
      revision: 0,
    }),
    update: async (input) => ({
      enabled: input.enabled,
      applied_enabled: input.enabled,
      status: "ready",
      error_code: null,
      revision: input.expectedRevision + 1,
    }),
    complete: async () => undefined,
  };
}
