import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { sql } from "drizzle-orm";

import { authorizeRuntimeEmbodimentCall } from "../src/infrastructure/persistence/postgres/embodiment/runtime-call-authorization.js";
import { createBackendDatabaseService } from "../src/infrastructure/persistence/postgres/database-service.js";

const databaseUrl = process.env.FIELDS_INTEGRATION_DATABASE_URL?.trim();
const skip = process.env.FIELDS_RUN_EMBODIMENT_INTEGRATION_TESTS === "1" && databaseUrl
  ? false
  : "Set FIELDS_RUN_EMBODIMENT_INTEGRATION_TESTS=1 and FIELDS_INTEGRATION_DATABASE_URL.";

test("real PostgreSQL authorizes the fixed Runtime token only for an active Company Member", {
  skip,
}, async () => {
  const database = createBackendDatabaseService({ databaseUrl });
  const directory = await mkdtemp(join(tmpdir(), "fields-embodiment-integration-"));
  const tokenFile = join(directory, "control-token");
  const suffix = randomUUID().replaceAll("-", "");
  const companyId = `it_company_${suffix}`;
  const memberId = `it_member_${suffix}`;
  const token = `it_token_${suffix}`;
  const now = Date.now();
  await writeFile(tokenFile, `${token}\n`, { mode: 0o600 });
  try {
    await database.db.transaction(async (transaction) => {
      await transaction.execute(sql`
        insert into companies (id, name, status, created_at_ms, updated_at_ms)
        values (${companyId}, 'Embodiment integration', 'active', ${now}, ${now})
      `);
      await transaction.execute(sql`
        insert into actors (
          id, company_id, type, display_name, mark, company_role, status,
          created_at_ms, updated_at_ms
        ) values (${memberId}, ${companyId}, 'human', 'Member', 'ME', 'owner', 'active', ${now}, ${now})
      `);
    });
    const headers = {
      memberId,
      kind: "company",
      runtimeId: companyId,
      authorization: `Bearer ${token}`,
    };
    const options = { companyId, controlTokenFile: tokenFile };
    assert.deepEqual(await authorizeRuntimeEmbodimentCall(database.db, headers, options), {
      actor_id: memberId,
      company_id: companyId,
    });
    assert.equal(await authorizeRuntimeEmbodimentCall(database.db, {
      ...headers,
      authorization: "Bearer wrong",
    }, options), null);
  } finally {
    await database.db.execute(sql`delete from actors where company_id = ${companyId}`);
    await database.db.execute(sql`delete from companies where id = ${companyId}`);
    await database.close();
    await rm(directory, { recursive: true });
  }
});
