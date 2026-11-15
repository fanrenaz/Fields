import { randomUUID } from "node:crypto";
import {
  constants,
  link,
  lstat,
  open,
  rm,
  stat,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { Readable } from "node:stream";

import type { HomeFilesystemEntry } from "@fields/contracts/public/home";

import {
  assertVisibleHomeFilesystemPath,
  joinHomeFilesystemPath,
  normalizeHomeFilesystemPath,
  resolveHomeFilesystemPath,
  validateHomeFilesystemName,
} from "./paths.js";
import { HomeFilesystemError } from "./errors.js";
import {
  requireMemberWorkspace,
  WorkspaceLayoutError,
} from "../../infrastructure/filesystem/workspace.js";

export const FILESYSTEM_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
const UPLOAD_NAME_ATTEMPTS = 10_000;

export class FilesystemTransferError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "FilesystemTransferError";
  }
}

export type FilesystemDownload = {
  name: string;
  sizeBytes: number;
  stream: Readable;
};

export async function uploadHomeFile(input: {
  workdir: string;
  memberId: string;
  parentPath: string;
  name: string;
  body: AsyncIterable<unknown>;
}): Promise<HomeFilesystemEntry> {
  try {
    const layout = await requireMemberWorkspace(input.workdir, input.memberId);
    return await uploadFile({
      root: layout.workspace,
      parentPath: input.parentPath,
      name: input.name,
      body: input.body,
      protectHomePaths: true,
    });
  } catch (error) {
    throw transferError(error);
  }
}

export async function downloadHomeFile(input: {
  workdir: string;
  memberId: string;
  path: string;
}): Promise<FilesystemDownload> {
  try {
    const layout = await requireMemberWorkspace(input.workdir, input.memberId);
    return await downloadFile(layout.workspace, input.path, true);
  } catch (error) {
    throw transferError(error);
  }
}

async function uploadFile(input: {
  root: string;
  parentPath: string;
  name: string;
  body: AsyncIterable<unknown>;
  protectHomePaths: boolean;
}): Promise<HomeFilesystemEntry> {
  const parentPath = normalizeHomeFilesystemPath(input.parentPath);
  const originalName = validateHomeFilesystemName(input.name);
  if (input.protectHomePaths) {
    assertVisibleHomeFilesystemPath(parentPath);
  }
  assertNonHiddenPath(parentPath);
  const parent = resolveHomeFilesystemPath(input.root, parentPath);
  await assertRealDirectoryPath(parent.workspaceRoot, parent.absolutePath);

  const temporaryPath = join(parent.absolutePath, `.fields-upload-${randomUUID()}`);
  let temporary: FileHandle | null = null;
  try {
    temporary = await open(
      temporaryPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    let sizeBytes = 0;
    for await (const value of input.body) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
      sizeBytes += chunk.byteLength;
      if (sizeBytes > FILESYSTEM_UPLOAD_MAX_BYTES) {
        throw new FilesystemTransferError(
          "filesystem_upload_too_large",
          "Uploaded file exceeds the 25 MB limit.",
          413,
        );
      }
      await writeAll(temporary, chunk);
    }
    await temporary.sync();
    await temporary.close();
    temporary = null;

    for (let attempt = 1; attempt <= UPLOAD_NAME_ATTEMPTS; attempt += 1) {
      const name = numberedName(originalName, attempt);
      const path = joinHomeFilesystemPath(parentPath, name);
      assertNonHiddenPath(path);
      if (input.protectHomePaths) assertVisibleHomeFilesystemPath(path);
      const target = resolveHomeFilesystemPath(input.root, path);
      try {
        await link(temporaryPath, target.absolutePath);
        await unlink(temporaryPath);
        return filesystemEntry(input.root, path);
      } catch (error) {
        if (isNodeError(error) && error.code === "EEXIST") continue;
        throw error;
      }
    }
    throw new FilesystemTransferError(
      "filesystem_upload_name_exhausted",
      "No available filename could be allocated.",
      409,
    );
  } catch (error) {
    await temporary?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw transferError(error);
  }
}

async function downloadFile(
  root: string,
  inputPath: string,
  protectHomePaths: boolean,
): Promise<FilesystemDownload> {
  const path = normalizeHomeFilesystemPath(inputPath);
  if (protectHomePaths) assertVisibleHomeFilesystemPath(path);
  assertNonHiddenPath(path);
  const target = resolveHomeFilesystemPath(root, path);
  await assertRealDirectoryPath(target.workspaceRoot, dirname(target.absolutePath));
  const metadata = await lstat(target.absolutePath).catch((error: unknown) => {
    throw transferError(error);
  });
  if (metadata.isSymbolicLink()) {
    throw new FilesystemTransferError(
      "filesystem_symlink_forbidden",
      "Symbolic links cannot be downloaded.",
      400,
    );
  }
  if (!metadata.isFile()) {
    throw new FilesystemTransferError(
      "filesystem_download_not_file",
      "Only ordinary files can be downloaded.",
      400,
    );
  }
  const handle = await open(target.absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW)
    .catch((error: unknown) => {
      throw transferError(error);
    });
  return {
    name: basename(path),
    sizeBytes: metadata.size,
    stream: handle.createReadStream({ autoClose: true }),
  };
}

async function filesystemEntry(root: string, path: string): Promise<HomeFilesystemEntry> {
  const target = resolveHomeFilesystemPath(root, path);
  const metadata = await stat(target.absolutePath);
  return {
    id: target.path,
    path: target.path,
    name: basename(target.path),
    is_folder: false,
    size_bytes: metadata.size,
    modified_at_ms: Number.isFinite(metadata.mtimeMs)
      ? Math.max(0, Math.trunc(metadata.mtimeMs))
      : null,
  };
}

async function assertRealDirectoryPath(root: string, target: string): Promise<void> {
  const relativeTarget = relative(root, target);
  if (relativeTarget.startsWith("..")) {
    throw new FilesystemTransferError(
      "filesystem_path_escape",
      "Filesystem path escapes its root.",
      400,
    );
  }
  let current = root;
  for (const segment of relativeTarget === "" ? [] : relativeTarget.split(/[\\/]/u)) {
    current = join(current, segment);
    const metadata = await lstat(current).catch((error: unknown) => {
      throw transferError(error);
    });
    if (metadata.isSymbolicLink()) {
      throw new FilesystemTransferError(
        "filesystem_symlink_forbidden",
        "Filesystem paths must not traverse symbolic links.",
        400,
      );
    }
    if (!metadata.isDirectory()) {
      throw new FilesystemTransferError(
        "filesystem_parent_not_directory",
        "Upload or download parent must be a directory.",
        400,
      );
    }
  }
}

function assertNonHiddenPath(path: string): void {
  if (path === ".") {
    return;
  }
  if (path.split("/").some((segment) => segment.startsWith("."))) {
    throw new FilesystemTransferError(
      "filesystem_hidden_path_forbidden",
      "Hidden filesystem paths are unavailable.",
      400,
    );
  }
}

async function writeAll(handle: FileHandle, chunk: Buffer): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const result = await handle.write(chunk, offset, chunk.byteLength - offset);
    offset += result.bytesWritten;
  }
}

function numberedName(name: string, attempt: number): string {
  if (attempt === 1) return name;
  const extensionIndex = name.lastIndexOf(".");
  if (extensionIndex <= 0) return `${name} (${attempt})`;
  return `${name.slice(0, extensionIndex)} (${attempt})${name.slice(extensionIndex)}`;
}

function transferError(error: unknown): FilesystemTransferError {
  if (error instanceof FilesystemTransferError) return error;
  if (error instanceof HomeFilesystemError) {
    return new FilesystemTransferError(
      `filesystem_${error.code}`,
      error.message,
      400,
    );
  }
  if (error instanceof WorkspaceLayoutError) {
    return new FilesystemTransferError(
      `filesystem_${error.code}`,
      error.message,
      error.code === "member_workspace_not_provisioned" ? 404 : 400,
    );
  }
  if (isNodeError(error) && error.code === "ENOENT") {
    return new FilesystemTransferError(
      "filesystem_entry_not_found",
      "Filesystem entry does not exist.",
      404,
    );
  }
  if (isNodeError(error) && (error.code === "EACCES" || error.code === "EPERM" || error.code === "ELOOP")) {
    return new FilesystemTransferError(
      "filesystem_access_denied",
      "Filesystem entry is not accessible.",
      403,
    );
  }
  return new FilesystemTransferError(
    "filesystem_transfer_failed",
    "Filesystem transfer failed.",
    500,
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
