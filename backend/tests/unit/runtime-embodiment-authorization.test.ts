import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { BackendDatabase } from "../../src/infrastructure/persistence/postgres/database-service.js";
import { authorizeRuntimeEmbodimentCall } from "../../src/infrastructure/persistence/postgres/embodiment/runtime-call-authorization.js";

test("Embodiment accepts the fixed Company Runtime token and active Member", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fields-runtime-auth-"));
  const tokenFile = join(directory, "control-token");
  await writeFile(tokenFile, "runtime-callback-token\n", { mode: 0o600 });
  try {
    const database = {
      execute: async () => ({ rows: [{ company_id: "company-1" }] }),
    } as unknown as BackendDatabase;
    const identity = await authorizeRuntimeEmbodimentCall(database, {
      memberId: "member-1",
      kind: "company",
      runtimeId: "company-1",
      authorization: "Bearer runtime-callback-token",
    }, { companyId: "company-1", controlTokenFile: tokenFile });
    assert.deepEqual(identity, { actor_id: "member-1", company_id: "company-1" });
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("Embodiment rejects non-Company runtime kinds before persistence", async () => {
  let queried = false;
  const database = {
    execute: async () => {
      queried = true;
      return [];
    },
  } as unknown as BackendDatabase;
  assert.equal(await authorizeRuntimeEmbodimentCall(database, {
    memberId: "member-1",
    kind: "home",
    runtimeId: "company-1",
    authorization: "Bearer token",
  }, { companyId: "company-1", controlTokenFile: "/unused" }), null);
  assert.equal(queried, false);
});
