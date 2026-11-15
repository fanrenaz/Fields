import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { spoolAssetPackage } from "../../../src/interface/http/asset-package-spool.js";

test("asset package spool streams multi-megabyte bodies with exact size and digest", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "fields-asset-spool-test-"));
  const bytes = Buffer.alloc(2 * 1024 * 1024, 0x61);
  try {
    const spooled = await spoolAssetPackage(chunks(bytes), temporaryRoot);
    assert.equal(spooled.sizeBytes, bytes.byteLength);
    assert.equal(
      spooled.sha256,
      createHash("sha256").update(bytes).digest("hex"),
    );
    assert.deepEqual(await readFile(spooled.path), bytes);
    await rm(spooled.directory, { recursive: true, force: true });
    assert.deepEqual(await readdir(temporaryRoot), []);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("asset package spool accepts exactly 25 MiB and cleans partial disconnects", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "fields-asset-spool-limit-"));
  const boundary = Buffer.alloc(25 * 1024 * 1024);
  try {
    const spooled = await spoolAssetPackage(chunks(boundary), temporaryRoot);
    assert.equal(spooled.sizeBytes, boundary.byteLength);
    await rm(spooled.directory, { recursive: true, force: true });

    const disconnected = (async function* disconnectedBody() {
      yield Buffer.from("partial");
      throw new Error("request aborted");
    })();
    await assert.rejects(
      spoolAssetPackage(disconnected, temporaryRoot),
      /request aborted/u,
    );
    assert.deepEqual(await readdir(temporaryRoot), []);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

async function* chunks(bytes: Buffer): AsyncGenerator<Buffer> {
  for (let offset = 0; offset < bytes.byteLength; offset += 64 * 1024) {
    yield bytes.subarray(offset, offset + 64 * 1024);
  }
}
