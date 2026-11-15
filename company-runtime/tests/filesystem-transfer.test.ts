import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  downloadHomeFile,
  uploadHomeFile,
} from "../src/application/filesystem/transfer.js";
import {
  ensureCompanyRuntimeLayout,
  provisionMemberWorkspace,
  removeLegacySharedDirectories,
} from "../src/infrastructure/filesystem/workspace.js";

test("Home uploads stream bytes, allocate duplicate names, and download exact content", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-home-transfer-"));
  try {
    await provisionMemberWorkspace(workdir, "member-1");
    const first = await uploadHomeFile({
      workdir,
      memberId: "member-1",
      parentPath: ".",
      name: "report.bin",
      body: chunks(Buffer.from([0, 1, 2, 255])),
    });
    const second = await uploadHomeFile({
      workdir,
      memberId: "member-1",
      parentPath: ".",
      name: "report.bin",
      body: chunks(Buffer.from("second")),
    });

    assert.equal(first.path, "report.bin");
    assert.equal(second.path, "report (2).bin");
    assert.equal(first.size_bytes, 4);
    const download = await downloadHomeFile({
      workdir,
      memberId: "member-1",
      path: first.path,
    });
    assert.deepEqual(await streamBytes(download.stream), Buffer.from([0, 1, 2, 255]));
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("legacy shared cleanup removes approved children at all known scopes and preserves other data", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-legacy-shared-"));
  try {
    await ensureCompanyRuntimeLayout(workdir);
    const sharedRoots = [
      join(workdir, "shared"),
      join(workdir, "members", "member-1", "workspace", "shared"),
      join(workdir, "rooms", "room-1", "shared"),
    ];
    for (const shared of sharedRoots) {
      for (const child of ["memories", "resources", "context"]) {
        await mkdir(join(shared, child), { recursive: true });
        await writeFile(join(shared, child, "legacy.json"), "legacy");
      }
      await writeFile(join(shared, "keep.txt"), "keep");
    }

    const removed = await removeLegacySharedDirectories(workdir);
    assert.equal(removed.length, 9);
    await removeLegacySharedDirectories(workdir);
    for (const shared of sharedRoots) {
      assert.equal(await readFile(join(shared, "keep.txt"), "utf8"), "keep");
      for (const child of ["memories", "resources", "context"]) {
        await assert.rejects(() => lstat(join(shared, child)), { code: "ENOENT" });
      }
    }
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("legacy shared cleanup refuses symbolic-link targets", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-legacy-shared-link-"));
  try {
    await ensureCompanyRuntimeLayout(workdir);
    const outside = join(workdir, "outside");
    await mkdir(outside);
    await mkdir(join(workdir, "shared"));
    await symlink(outside, join(workdir, "shared", "memories"));
    await assert.rejects(
      () => removeLegacySharedDirectories(workdir),
      /must not follow a symbolic link/u,
    );
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

async function* chunks(value: Buffer): AsyncGenerator<Buffer> {
  const split = Math.max(1, Math.floor(value.length / 2));
  yield value.subarray(0, split);
  if (split < value.length) yield value.subarray(split);
}

async function streamBytes(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const values: Buffer[] = [];
  for await (const value of stream) values.push(Buffer.from(value));
  return Buffer.concat(values);
}
