import assert from "node:assert/strict";
import test from "node:test";

import type { CompanyAssetApplication } from "../../src/application/company/ports/company-assets.js";
import type { CompanyRuntimePublicGateway } from "../../src/application/execution/ports/index.js";
import type { BackendDatabase } from "../../src/infrastructure/persistence/postgres/database-service.js";
import { PostgresAssetBuilderApplication } from "../../src/infrastructure/persistence/postgres/repositories/company/asset-builder-repository.js";

test("Asset Builder uses the Human Home Executor and forbids lifecycle operations in its instructions", async () => {
  const topic = {
    id: "asset-topic-1",
    companyId: "company-1",
    humanMemberId: "human-1",
    kind: "skill",
    assetId: null,
    draftId: null,
    title: "New conversation",
    threadId: null,
    createdAtMs: 100,
    updatedAtMs: 100,
  };
  const submitted: unknown[][] = [];
  const db = {
    execute: async () => ({ rows: [{ type: "human", status: "active" }] }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [topic],
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => [{ ...topic, ...values, threadId: "thread-asset-builder" }],
        }),
      }),
    }),
  } as unknown as BackendDatabase;
  const runtime = {
    homeTurnSubmit: async (...args: unknown[]) => {
      submitted.push(args);
      return {
        submitted: true,
        thread_id: "thread-asset-builder",
        turn_id: "turn-1",
      } as const;
    },
  } as unknown as CompanyRuntimePublicGateway;
  const assets = {
    list: async () => ({ items: [], page: { next_cursor: null } }),
  } as unknown as CompanyAssetApplication;
  const application = new PostgresAssetBuilderApplication(
    db,
    runtime,
    assets,
    () => 200,
  );

  await application.submitTurn({
    companyId: "company-1",
    humanMemberId: "human-1",
    topicId: "asset-topic-1",
    prompt: "Build a reusable research skill",
  });

  assert.equal(submitted[0]![0], "company-1");
  assert.equal(submitted[0]![1], "human-1");
  const prompt = (submitted[0]![2] as { prompt: string }).prompt;
  assert.match(prompt, /Asset kind: skill/u);
  assert.match(prompt, /Never publish, archive, restore, delete, install assets, or change credentials/u);
  assert.match(prompt, /Human request: Build a reusable research skill/u);
  assert.equal("executor_id" in (submitted[0]![2] as object), false);
  assert.deepEqual(
    (submitted[0]![2] as { builder_scope: unknown }).builder_scope,
    { kind: "asset", topic_id: "asset-topic-1" },
  );
  assert.match(
    (submitted[0]![2] as { developer_instructions: string }).developer_instructions,
    /Never publish, archive, restore, delete, install assets, or change credentials/u,
  );
});
