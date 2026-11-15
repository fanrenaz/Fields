import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, chmod, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CompanyFileCache } from "../src/application/company-runtime/company-file-cache.js";

test("Company File cache coalesces and verifies an immutable version", async () => {
  const root = await mkdtemp(join(tmpdir(), "fields-company-files-"));
  const bytes = Buffer.from("verified company file");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const source = {
    file: {
      file_id: "file-1",
      folder_id: null,
      name: "plan.txt",
      revision: 1,
      current_version: {
        version_id: "version-1",
        file_id: "file-1",
        version_number: 1,
        blob_sha256: sha256,
        size_bytes: bytes.byteLength,
        mime_type: "text/plain",
        original_name: "plan.txt",
        created_by_actor_id: "member-1",
        created_by: { actor_id: "member-1", display_name: "Member", actor_type: "human" as const },
        created_at_ms: 1,
      },
      created_at_ms: 1,
      updated_at_ms: 1,
    },
    version: {
      version_id: "version-1",
      file_id: "file-1",
      version_number: 1,
      blob_sha256: sha256,
      size_bytes: bytes.byteLength,
      mime_type: "text/plain",
      original_name: "plan.txt",
      created_by_actor_id: "member-1",
      created_by: { actor_id: "member-1", display_name: "Member", actor_type: "human" as const },
      created_at_ms: 1,
    },
    download_url: `data:text/plain;base64,${bytes.toString("base64")}`,
    expires_at_ms: Date.now() + 60_000,
  };
  try {
    const cache = new CompanyFileCache(root);
    const [first, second] = await Promise.all([
      cache.read("member-1", source),
      cache.read("member-1", source),
    ]);
    assert.deepEqual(first, second);
    assert.equal(await readFile(first.local_path, "utf8"), bytes.toString("utf8"));
    assert.equal((await stat(first.local_path)).mode & 0o777, 0o400);
    await access(first.local_path);
  } finally {
    await removeSealedCache(root);
  }
});

test("Company File cache rejects bytes that do not match the immutable version", async () => {
  const root = await mkdtemp(join(tmpdir(), "fields-company-files-"));
  const bytes = Buffer.from("wrong bytes");
  const cache = new CompanyFileCache(root);
  try {
    await assert.rejects(cache.read("member-1", {
      file: {
        file_id: "file-1",
        folder_id: null,
        name: "plan.pdf",
        revision: 1,
        current_version: {} as never,
        created_at_ms: 1,
        updated_at_ms: 1,
      },
      version: {
        version_id: "version-1",
        file_id: "file-1",
        version_number: 1,
        blob_sha256: "a".repeat(64),
        size_bytes: bytes.byteLength,
        mime_type: "application/pdf",
        original_name: "plan.pdf",
        created_by_actor_id: "member-1",
        created_by: { actor_id: "member-1", display_name: "Member", actor_type: "human" },
        created_at_ms: 1,
      },
      download_url: `data:application/pdf;base64,${bytes.toString("base64")}`,
      expires_at_ms: Date.now() + 60_000,
    }), /integrity/u);
  } finally {
    await removeSealedCache(root);
  }
});

async function removeSealedCache(root: string): Promise<void> {
  const visit = async (directory: string): Promise<void> => {
    await chmod(directory, 0o700).catch(() => undefined);
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => visit(join(directory, entry.name))));
  };
  await visit(root);
  await rm(root, { recursive: true, force: true });
}
