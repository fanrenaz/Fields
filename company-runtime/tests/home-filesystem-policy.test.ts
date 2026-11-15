import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  homeFilesystemDeleteResultSchema,
  homeFilesystemListResultSchema,
} from "@fields/contracts/public/home";
import { homeFilesystemSearchResultSchema } from "@fields/contracts/public/search";

import type { HomeCodexFilesystem } from "../src/application/filesystem/codex-fs.js";
import { HomeFilesystemError } from "../src/application/filesystem/errors.js";
import {
  createEntry,
  deleteEntry,
  listDirectory,
  renameEntry,
  searchFilesystem,
} from "../src/application/filesystem/service.js";
import { provisionMemberWorkspace } from "../src/infrastructure/filesystem/workspace.js";

test("ordinary Member filesystem operations cannot address CODEX_HOME directly", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "company-runtime-home-filesystem-"));
  await provisionMemberWorkspace(workdir, "member-1");
  const codexFs = unreachableFilesystem();

  for (const operation of [
    () => listDirectory({ workdir, memberId: "member-1", path: ".codex", codexFs }),
    () => createEntry({
      workdir,
      memberId: "member-1",
      parentPath: ".codex",
      name: "user-file",
      kind: "file",
      codexFs,
    }),
    () => renameEntry({
      workdir,
      memberId: "member-1",
      path: "visible.txt",
      name: ".codex",
      codexFs,
    }),
    () => deleteEntry({
      workdir,
      memberId: "member-1",
      path: ".codex/config.toml",
      codexFs,
    }),
  ]) {
    await assert.rejects(
      operation,
      (error: unknown) => error instanceof HomeFilesystemError
        && error.code === "protected_path",
    );
  }
});

test("Home filesystem query and mutation results match their strict public contracts", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "company-runtime-home-filesystem-contract-"));
  await provisionMemberWorkspace(workdir, "member-1");
  const codexFs = emptyFilesystem();

  const listResult = await listDirectory({
    workdir,
    memberId: "member-1",
    path: ".",
    codexFs,
  });
  const searchResult = await searchFilesystem({
    workdir,
    memberId: "member-1",
    searchTerm: "missing",
    codexFs,
  });
  const deleteResult = await deleteEntry({
    workdir,
    memberId: "member-1",
    path: "visible.txt",
    codexFs,
  });

  assert.deepEqual(homeFilesystemListResultSchema.parse(listResult), listResult);
  assert.deepEqual(homeFilesystemSearchResultSchema.parse(searchResult), searchResult);
  assert.deepEqual(homeFilesystemDeleteResultSchema.parse(deleteResult), deleteResult);
  assert.equal("actor_id" in listResult, false);
  assert.equal("actor_id" in searchResult, false);
  assert.equal("actor_id" in deleteResult, false);
});

function emptyFilesystem(): HomeCodexFilesystem {
  return {
    readDirectory: async () => [],
    getMetadata: async (path) => ({
      isDirectory: !path.endsWith("/visible.txt"),
      isFile: path.endsWith("/visible.txt"),
      isSymlink: false,
      createdAtMs: 0,
      modifiedAtMs: 0,
    }),
    writeFile: async () => undefined,
    createDirectory: async () => undefined,
    remove: async () => undefined,
    copy: async () => undefined,
    watch: async function* () {
      return;
    },
  };
}

function unreachableFilesystem(): HomeCodexFilesystem {
  const fail = (): never => {
    throw new Error("CODEX_HOME policy must reject before touching the filesystem adapter.");
  };
  return {
    readDirectory: async () => fail(),
    getMetadata: async () => fail(),
    writeFile: async () => fail(),
    createDirectory: async () => fail(),
    remove: async () => fail(),
    copy: async () => fail(),
    watch: async function* () {
      fail();
    },
  };
}
