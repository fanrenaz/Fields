import { requireMemberWorkspace } from "../../infrastructure/filesystem/workspace.js";
import { HomeFilesystemError } from "./errors.js";
import {
  assertVisibleHomeFilesystemPath,
  HOME_FILESYSTEM_ROOT_PATH,
  isProtectedHomeFilesystemRootPath,
  joinHomeFilesystemPath,
  parentHomeFilesystemPath,
  resolveHomeFilesystemPath,
  workspaceRelativePath,
  type ResolvedHomeFilesystemPath,
} from "./paths.js";
import { AppServerCodexFilesystem, type HomeCodexFilesystem } from "./codex-fs.js";
import type {
  HomeFilesystemCreateEntryInput,
  HomeFilesystemDeleteEntryInput,
  HomeFilesystemDeleteResult,
  HomeFilesystemEntry,
  HomeFilesystemEvent,
  HomeFilesystemEventsInput,
  HomeFilesystemListDirectoryInput,
  HomeFilesystemListResult,
  HomeFilesystemRenameEntryInput,
  HomeFilesystemRequestBase,
} from "./types.js";

const FILESYSTEM_SEARCH_MAX_VISITED = 5_000;

export async function listDirectory(input: HomeFilesystemListDirectoryInput): Promise<HomeFilesystemListResult> {
  const layout = await requireMemberWorkspace(input.workdir, input.memberId);
  const codexFs = await filesystemAdapter(input);
  assertVisibleHomeFilesystemPath(input.path);
  const parentPath = resolveHomeFilesystemPath(layout.workspace, input.path);
  await assertNoSymlinkAncestors(codexFs, parentPath);

  const parentMetadata = await codexFs.getMetadata(parentPath.absolutePath);
  if (!parentMetadata.isDirectory) {
    throw new HomeFilesystemError("not_directory", "Filesystem path is not a directory.", {
      details: { path: parentPath.path },
    });
  }

  const childEntries = (await codexFs.readDirectory(parentPath.absolutePath))
    .filter((entry) => !isHiddenFilesystemName(entry.fileName));
  const children = await Promise.all(childEntries.map(async (entry) => {
    const childPath = joinHomeFilesystemPath(parentPath.path, entry.fileName);
    return entryFromResolvedPath(codexFs, layout.workspace, childPath);
  }));

  children.sort(compareHomeFilesystemEntries);

  return {
    parent: entryFromMetadata(parentPath.path, parentMetadata),
    children,
  };
}

export async function searchFilesystem(input: HomeFilesystemRequestBase & {
  searchTerm: string;
  cursor?: string | null;
  limit?: number;
}): Promise<{
  items: HomeFilesystemEntry[];
  page: { next_cursor: string | null };
}> {
  const layout = await requireMemberWorkspace(input.workdir, input.memberId);
  const codexFs = await filesystemAdapter(input);
  const query = input.searchTerm.trim().toLocaleLowerCase();
  const offset = searchOffset(input.cursor);
  const limit = Math.max(1, Math.min(input.limit ?? 20, 50));
  const queue = [HOME_FILESYSTEM_ROOT_PATH];
  const matches: HomeFilesystemEntry[] = [];
  let visited = 0;

  while (queue.length > 0 && visited < FILESYSTEM_SEARCH_MAX_VISITED) {
    const parentPath = queue.shift() as string;
    const parent = resolveHomeFilesystemPath(layout.workspace, parentPath);
    await assertNoSymlinkAncestors(codexFs, parent);
    const children = (await codexFs.readDirectory(parent.absolutePath))
      .filter((entry) => !isHiddenFilesystemName(entry.fileName))
      .sort((left, right) => left.fileName.localeCompare(right.fileName));
    for (const child of children) {
      if (visited >= FILESYSTEM_SEARCH_MAX_VISITED) break;
      visited += 1;
      const childPath = joinHomeFilesystemPath(parentPath, child.fileName);
      const entry = await entryFromResolvedPath(codexFs, layout.workspace, childPath);
      if (entry.name.toLocaleLowerCase().includes(query) || entry.path.toLocaleLowerCase().includes(query)) {
        matches.push(entry);
      }
      const metadata = await codexFs.getMetadata(resolveHomeFilesystemPath(layout.workspace, childPath).absolutePath);
      if (entry.is_folder && !metadata.isSymlink) {
        queue.push(childPath);
      }
    }
  }

  matches.sort(compareSearchEntries(query));
  const items = matches.slice(offset, offset + limit);
  return {
    items,
    page: {
      next_cursor: offset + limit < matches.length ? searchCursor(offset + limit) : null,
    },
  };
}

export async function createEntry(input: HomeFilesystemCreateEntryInput): Promise<HomeFilesystemEntry> {
  const layout = await requireMemberWorkspace(input.workdir, input.memberId);
  const codexFs = await filesystemAdapter(input);
  const targetPath = joinHomeFilesystemPath(input.parentPath, input.name);
  assertVisibleHomeFilesystemPath(targetPath);
  const target = resolveHomeFilesystemPath(layout.workspace, targetPath);
  await assertNoSymlinkAncestors(codexFs, target);
  await assertEntryDoesNotExist(codexFs, target.absolutePath, target.path);

  const parentPath = resolveHomeFilesystemPath(layout.workspace, input.parentPath);
  const parentMetadata = await codexFs.getMetadata(parentPath.absolutePath);
  if (!parentMetadata.isDirectory) {
    throw new HomeFilesystemError("not_directory", "Parent path is not a directory.", {
      details: { path: parentPath.path },
    });
  }

  if (input.kind === "file") {
    await codexFs.writeFile(target.absolutePath, "");
    return entryFromResolvedPath(codexFs, layout.workspace, target.path);
  }
  if (input.kind === "folder") {
    await codexFs.createDirectory(target.absolutePath, { recursive: false });
    return entryFromResolvedPath(codexFs, layout.workspace, target.path);
  }

  throw new HomeFilesystemError("invalid_entry_kind", "Entry kind must be either file or folder.", {
    details: { kind: input.kind },
  });
}

export async function renameEntry(input: HomeFilesystemRenameEntryInput): Promise<HomeFilesystemEntry> {
  const layout = await requireMemberWorkspace(input.workdir, input.memberId);
  const codexFs = await filesystemAdapter(input);
  const source = resolveHomeFilesystemPath(layout.workspace, input.path);
  assertVisibleHomeFilesystemPath(source.path);
  if (isProtectedHomeFilesystemRootPath(source.path)) {
    throw new HomeFilesystemError("root_operation_forbidden", "Protected actor workspace root cannot be renamed.", {
      details: { path: source.path },
    });
  }
  const targetPath = joinHomeFilesystemPath(parentHomeFilesystemPath(source.path), input.name);
  assertVisibleHomeFilesystemPath(targetPath);
  const target = resolveHomeFilesystemPath(layout.workspace, targetPath);
  await assertNoSymlinkAncestors(codexFs, source);
  const sourceMetadata = await codexFs.getMetadata(source.absolutePath);

  await assertNoSymlinkAncestors(codexFs, target);
  await assertEntryDoesNotExist(codexFs, target.absolutePath, target.path);

  await codexFs.copy({
    sourcePath: source.absolutePath,
    destinationPath: target.absolutePath,
    recursive: sourceMetadata.isDirectory,
  });
  await codexFs.remove(source.absolutePath, { recursive: sourceMetadata.isDirectory, force: false });
  return entryFromResolvedPath(codexFs, layout.workspace, target.path);
}

export async function deleteEntry(input: HomeFilesystemDeleteEntryInput): Promise<HomeFilesystemDeleteResult> {
  const layout = await requireMemberWorkspace(input.workdir, input.memberId);
  const codexFs = await filesystemAdapter(input);
  const target = resolveHomeFilesystemPath(layout.workspace, input.path);
  assertVisibleHomeFilesystemPath(target.path);
  if (isProtectedHomeFilesystemRootPath(target.path)) {
    throw new HomeFilesystemError("root_operation_forbidden", "Protected actor workspace root cannot be deleted.", {
      details: { path: target.path },
    });
  }
  await assertNoSymlinkAncestors(codexFs, target);

  const metadata = await codexFs.getMetadata(target.absolutePath);
  await codexFs.remove(target.absolutePath, { recursive: metadata.isDirectory && !metadata.isSymlink, force: false });
  return { path: target.path, deleted: true };
}

export async function* filesystemEvents(input: HomeFilesystemEventsInput): AsyncGenerator<HomeFilesystemEvent> {
  const layout = await requireMemberWorkspace(input.workdir, input.memberId);
  const codexFs = await filesystemAdapter(input);
  const watchTarget = resolveHomeFilesystemPath(layout.workspace, input.path ?? HOME_FILESYSTEM_ROOT_PATH);
  assertVisibleHomeFilesystemPath(watchTarget.path);
  for await (const event of codexFs.watch({ path: watchTarget.absolutePath, signal: input.signal })) {
    const changedPaths = uniquePaths(event.changedPaths
      .map((path) => workspacePathOrNull(layout.workspace, path))
      .filter((path): path is string => path !== null)
      .filter((path) => !isHiddenFilesystemPath(path)));
    if (changedPaths.length === 0) {
      continue;
    }
    const reloadPaths = uniquePaths(changedPaths
      .map((path) => path === HOME_FILESYSTEM_ROOT_PATH ? HOME_FILESYSTEM_ROOT_PATH : parentHomeFilesystemPath(path))
      .filter((path) => !isHiddenFilesystemPath(path)));
    if (reloadPaths.length === 0) {
      continue;
    }
    yield {
      schema_version: 1,
      type: "home.filesystem.changed",
      source: "company-runtime",
      member_id: layout.memberId,
      changed_paths: changedPaths,
      reload_paths: reloadPaths,
      occurred_at_ms: Date.now(),
    };
  }
}

async function filesystemAdapter(input: {
  memberId: string;
  runtime?: HomeFilesystemListDirectoryInput["runtime"];
  codexFs?: HomeCodexFilesystem;
  codexFilesystemFactory?: HomeFilesystemListDirectoryInput["codexFilesystemFactory"];
}): Promise<HomeCodexFilesystem> {
  if (input.codexFs) {
    return input.codexFs;
  }
  if (!input.runtime) {
    throw new HomeFilesystemError("filesystem_unavailable", "Codex filesystem adapter is unavailable.");
  }
  const socketPath = await input.runtime.memberFilesystemSocket(input.memberId);
  return input.codexFilesystemFactory?.(socketPath) ?? new AppServerCodexFilesystem(socketPath);
}

async function entryFromResolvedPath(codexFs: HomeCodexFilesystem, workspace: string, path: string): Promise<HomeFilesystemEntry> {
  const resolvedPath = resolveHomeFilesystemPath(workspace, path);
  await assertNoSymlinkAncestors(codexFs, resolvedPath);
  const metadata = await codexFs.getMetadata(resolvedPath.absolutePath);
  return entryFromMetadata(resolvedPath.path, metadata);
}

function entryFromMetadata(path: string, metadata: Awaited<ReturnType<HomeCodexFilesystem["getMetadata"]>>): HomeFilesystemEntry {
  return {
    id: path,
    path,
    name: path === HOME_FILESYSTEM_ROOT_PATH ? HOME_FILESYSTEM_ROOT_PATH : path.slice(path.lastIndexOf("/") + 1),
    is_folder: metadata.isDirectory,
    size_bytes: null,
    modified_at_ms: metadata.modifiedAtMs > 0 ? metadata.modifiedAtMs : null,
  };
}

function compareHomeFilesystemEntries(left: HomeFilesystemEntry, right: HomeFilesystemEntry): number {
  if (left.is_folder !== right.is_folder) {
    return left.is_folder ? -1 : 1;
  }
  if (left.name < right.name) {
    return -1;
  }
  if (left.name > right.name) {
    return 1;
  }
  return 0;
}

function compareSearchEntries(query: string): (left: HomeFilesystemEntry, right: HomeFilesystemEntry) => number {
  return (left, right) => {
    const leftRank = searchRank(left, query);
    const rightRank = searchRank(right, query);
    return leftRank - rightRank || left.path.localeCompare(right.path);
  };
}

function searchRank(entry: HomeFilesystemEntry, query: string): number {
  const name = entry.name.toLocaleLowerCase();
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  return 2;
}

function searchCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function searchOffset(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { offset?: unknown };
    return typeof value.offset === "number" && Number.isSafeInteger(value.offset) && value.offset >= 0
      ? value.offset
      : 0;
  } catch {
    return 0;
  }
}

function isHiddenFilesystemName(name: string): boolean {
  return name.startsWith(".");
}

function isHiddenFilesystemPath(path: string): boolean {
  if (path === HOME_FILESYSTEM_ROOT_PATH) {
    return false;
  }
  return path.split("/").some((segment) => segment.startsWith("."));
}

async function assertNoSymlinkAncestors(codexFs: HomeCodexFilesystem, resolvedPath: ResolvedHomeFilesystemPath): Promise<void> {
  if (resolvedPath.path === HOME_FILESYSTEM_ROOT_PATH) {
    return;
  }

  const segments = resolvedPath.path.split("/");
  let current = resolvedPath.workspaceRoot;
  for (const segment of segments.slice(0, -1)) {
    current = `${current}/${segment}`;
    const metadata = await codexFs.getMetadata(current);
    if (metadata.isSymlink) {
      throw new HomeFilesystemError("symlink_ancestor", "Filesystem path must not traverse a symbolic link.", {
        details: { path: resolvedPath.path, ancestor: workspaceRelativePath(resolvedPath.workspaceRoot, current) },
      });
    }
  }
}

async function assertEntryDoesNotExist(codexFs: HomeCodexFilesystem, absolutePath: string, path: string): Promise<void> {
  try {
    await codexFs.getMetadata(absolutePath);
  } catch (error) {
    if (isNotFoundError(error)) {
      return;
    }
    throw error;
  }

  throw new HomeFilesystemError("entry_already_exists", "Target entry already exists.", { details: { path } });
}

function workspacePathOrNull(workspace: string, absolutePath: string): string | null {
  try {
    const resolved = resolveHomeFilesystemPath(workspace, workspaceRelativePath(workspace, absolutePath));
    if (resolved.absolutePath !== absolutePath) {
      return null;
    }
    return resolved.path;
  } catch {
    return null;
  }
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}

function isNotFoundError(error: unknown): boolean {
  if (error instanceof Error) {
    const code = "code" in error ? (error as { code?: unknown }).code : undefined;
    return code === "ENOENT" || /not found|no such file|does not exist/i.test(error.message);
  }
  return false;
}
