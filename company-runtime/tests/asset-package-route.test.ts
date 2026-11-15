import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Fastify from "fastify";

import { CompanyAssetStore } from "../src/application/assets/service.js";
import { registerAssetPackageRoutes } from "../src/interface/asset-package.js";
import { registerFilesystemTransferRoutes } from "../src/interface/filesystem-transfer.js";

test("internal asset package route streams above Fastify limits with auth and replay", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-assets-stream-route-"));
  const controlTokenFile = join(workdir, "control-token");
  const controlToken = "test-control-token";
  await writeFile(controlTokenFile, `${controlToken}\n`, { mode: 0o600 });
  const app = Fastify({ logger: false });
  registerFilesystemTransferRoutes(app, { workdir, controlTokenFile });
  registerAssetPackageRoutes(app, {
    assetStore: new CompanyAssetStore(workdir),
    controlTokenFile,
  });
  const packageBytes = zip([
    {
      path: "SKILL.md",
      contents: "---\nname: Route Stream Skill\ndescription: Test\n---\n",
    },
    {
      path: "payload.txt",
      contents: "r".repeat(2 * 1024 * 1024),
    },
  ]);
  const query = new URLSearchParams({
    operation_id: "route-stream-operation",
    request_fingerprint: "6".repeat(64),
    draft_id: "draft-route-stream",
    expected_content_sha256: "",
    kind: "skill",
    file_name: "route-stream.zip",
    package_sha256: createHash("sha256").update(packageBytes).digest("hex"),
    package_size_bytes: String(packageBytes.byteLength),
  });
  try {
    const send = (payload: Buffer, requestQuery: URLSearchParams = query) => app.inject({
      method: "POST",
      url: `/internal/assets/drafts/package?${requestQuery.toString()}`,
      headers: {
        authorization: `Bearer ${controlToken}`,
        "content-type": "application/octet-stream",
      },
      payload,
    });
    assert.equal((await app.inject({
      method: "POST",
      url: `/internal/assets/drafts/package?${query.toString()}`,
      headers: { "content-type": "application/octet-stream" },
      payload: packageBytes,
    })).statusCode, 401);
    const first = await send(packageBytes);
    assert.equal(first.statusCode, 200, first.body);
    const replay = await send(packageBytes);
    assert.equal(replay.statusCode, 200, replay.body);
    assert.deepEqual(replay.json(), first.json());

    const mismatch = new URLSearchParams(query);
    mismatch.set("operation_id", "route-stream-mismatch");
    mismatch.set("draft_id", "draft-route-stream-mismatch");
    mismatch.set("package_sha256", "7".repeat(64));
    const rejected = await send(packageBytes, mismatch);
    assert.equal(rejected.statusCode, 400);
    assert.equal(rejected.json().error, "asset_zip_digest_mismatch");

    const boundary = Buffer.alloc(25 * 1024 * 1024);
    const boundaryQuery = new URLSearchParams(query);
    boundaryQuery.set("operation_id", "route-stream-boundary");
    boundaryQuery.set("draft_id", "draft-route-stream-boundary");
    boundaryQuery.set(
      "package_sha256",
      createHash("sha256").update(boundary).digest("hex"),
    );
    boundaryQuery.set("package_size_bytes", String(boundary.byteLength));
    assert.notEqual((await send(boundary, boundaryQuery)).statusCode, 413);

    const oversized = Buffer.alloc(25 * 1024 * 1024 + 1);
    const oversizedQuery = new URLSearchParams(boundaryQuery);
    oversizedQuery.set("operation_id", "route-stream-oversized");
    oversizedQuery.set("draft_id", "draft-route-stream-oversized");
    oversizedQuery.set("package_size_bytes", String(oversized.byteLength));
    assert.equal((await send(oversized, oversizedQuery)).statusCode, 413);
  } finally {
    await app.close();
    await removeTestTree(workdir);
  }
});

async function removeTestTree(root: string): Promise<void> {
  await chmod(root, 0o700).catch(() => undefined);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      await removeTestTree(join(root, entry.name));
    }
  }
  await rm(root, { recursive: true, force: true });
}

function zip(entries: Array<{ path: string; contents: string }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path);
    const contents = Buffer.from(entry.contents);
    const checksum = crc32(contents);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(contents.length, 18);
    local.writeUInt32LE(contents.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, contents);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(contents.length, 20);
    central.writeUInt32LE(contents.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((0o100600 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + contents.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}
