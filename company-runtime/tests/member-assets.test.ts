import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { RuntimeMemberAssetInstallation } from "@fields/contracts/internal/asset";

import type { CompanyAssetStore } from "../src/application/assets/service.js";
import {
  type MemberAssetCompletion,
  MemberAssetService,
} from "../src/application/member-assets/service.js";
import type { MemberRuntimeManager } from "../src/application/member-runtime/manager.js";

test("Member asset apply acknowledges immediately and persists only after restart", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-member-assets-"));
  const restarts: string[] = [];
  let finish!: (completion: MemberAssetCompletion) => void;
  const completed = new Promise<MemberAssetCompletion>((resolve) => {
    finish = resolve;
  });
  const service = new MemberAssetService(
    workdir,
    {
      restartMemberAppServer: async (memberId: string) => {
        restarts.push(memberId);
        return new Map();
      },
      runningMemberIds: () => [],
    } as unknown as MemberRuntimeManager,
    {} as CompanyAssetStore,
    async (completion) => finish(completion),
    () => 123,
  );

  try {
    const result = await service.apply({
      member_id: "agent-one",
      operation_id: "operation-one",
      requested_revision: 1,
      installations: [],
    });
    assert.equal(result.accepted, true);
    assert.equal(result.operation.status, "applying");

    const completion = await completed;
    assert.equal(completion.status, "applied");
    assert.deepEqual(restarts, ["agent-one"]);
    assert.deepEqual(
      JSON.parse(await readFile(
        join(workdir, "members", "agent-one", "member-assets.json"),
        "utf8",
      )),
      { version: 1, installations: [] },
    );
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("Member asset apply restores the previous profile when activation fails", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-member-assets-"));
  let restartCount = 0;
  let finish!: (completion: MemberAssetCompletion) => void;
  const completed = new Promise<MemberAssetCompletion>((resolve) => {
    finish = resolve;
  });
  const service = new MemberAssetService(
    workdir,
    {
      restartMemberAppServer: async () => {
        restartCount += 1;
        if (restartCount === 1) throw new Error("activation failed");
        return new Map();
      },
      runningMemberIds: () => [],
    } as unknown as MemberRuntimeManager,
    {} as CompanyAssetStore,
    async (completion) => finish(completion),
    () => 456,
  );

  try {
    await service.apply({
      member_id: "agent-one",
      operation_id: "operation-two",
      requested_revision: 1,
      installations: [],
    });
    const completion = await completed;
    assert.equal(completion.status, "failed");
    assert.equal(completion.errorCode, "member_asset_apply_failed");
    assert.equal(completion.retryable, true);
    assert.equal(restartCount, 2);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("MCP credential refresh restarts only running Agents that pin the version", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-member-assets-"));
  const installation = {
    asset_id: "asset-one",
    version_id: "version-one",
    kind: "mcp",
    name: "Company Search",
    slug: "company-search",
    version: "1.0.0",
    content_sha256: "a".repeat(64),
    source: {
      type: "mcp",
      endpoint_url: "https://mcp.example.test/service",
      authentication: "bearer",
      credential_configured: true,
    },
    capabilities: {
      entries: [{ kind: "tool", name: "search" }],
      credential_configured: true,
    },
  } satisfies RuntimeMemberAssetInstallation;
  for (const memberId of ["agent-one", "agent-two"]) {
    const root = join(workdir, "members", memberId);
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, "member-assets.json"),
      JSON.stringify({
        version: 1,
        installations: memberId === "agent-one" ? [installation] : [],
      }),
    );
  }
  const restarts: string[] = [];
  const service = new MemberAssetService(
    workdir,
    {
      restartMemberAppServer: async (memberId: string) => {
        restarts.push(memberId);
        return new Map();
      },
      runningMemberIds: () => ["agent-one", "agent-two"],
    } as unknown as MemberRuntimeManager,
    {} as CompanyAssetStore,
    async () => undefined,
  );

  try {
    await service.refreshCredential("version-one");
    assert.deepEqual(restarts, ["agent-one"]);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});
