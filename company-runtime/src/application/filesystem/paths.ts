import { isAbsolute, posix, relative, resolve, sep } from "node:path";

import { HomeFilesystemError } from "./errors.js";

export const HOME_FILESYSTEM_ROOT_PATH = ".";
const PROTECTED_HOME_FILESYSTEM_ROOT_PATHS = new Set([HOME_FILESYSTEM_ROOT_PATH, "local"]);

export type ResolvedHomeFilesystemPath = {
  workspaceRoot: string;
  path: string;
  absolutePath: string;
};

export function normalizeHomeFilesystemPath(inputPath: string): string {
  if (typeof inputPath !== "string" || inputPath.length === 0) {
    throw new HomeFilesystemError("invalid_path", "Filesystem path must be a non-empty string.");
  }
  if (inputPath.includes("\0")) {
    throw new HomeFilesystemError("invalid_path", "Filesystem path must not contain NUL bytes.", { details: { path: inputPath } });
  }
  if (isAbsolute(inputPath) || isWindowsAbsolutePath(inputPath)) {
    throw new HomeFilesystemError("invalid_path", "Filesystem path must be relative to the actor workspace.", {
      details: { path: inputPath },
    });
  }
  if (inputPath.includes("\\")) {
    throw new HomeFilesystemError("invalid_path", "Filesystem path must use forward slash separators.", {
      details: { path: inputPath },
    });
  }

  const segments = inputPath.split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === "..")) {
    throw new HomeFilesystemError("invalid_path", "Filesystem path must not contain traversal components.", {
      details: { path: inputPath },
    });
  }

  const normalized = posix.normalize(inputPath);
  return normalized === "" ? HOME_FILESYSTEM_ROOT_PATH : normalized;
}

export function validateHomeFilesystemName(name: string): string {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new HomeFilesystemError("invalid_name", "Entry name must be a non-empty string.");
  }
  if (name === HOME_FILESYSTEM_ROOT_PATH || name === ".." || name.includes("/") || name.includes("\\") || name.includes("\0")) {
    throw new HomeFilesystemError("invalid_name", "Entry name must be a single basename.", { details: { name } });
  }
  return name;
}

export function resolveHomeFilesystemPath(workspace: string, inputPath: string): ResolvedHomeFilesystemPath {
  const workspaceRoot = resolve(workspace);
  const path = normalizeHomeFilesystemPath(inputPath);
  const absolutePath = path === HOME_FILESYSTEM_ROOT_PATH
    ? workspaceRoot
    : resolve(workspaceRoot, ...path.split("/"));

  assertPathInsideWorkspace(workspaceRoot, absolutePath);
  return { workspaceRoot, path, absolutePath };
}

export function joinHomeFilesystemPath(parentPath: string, name: string): string {
  const parent = normalizeHomeFilesystemPath(parentPath);
  const safeName = validateHomeFilesystemName(name);
  return parent === HOME_FILESYSTEM_ROOT_PATH ? safeName : `${parent}/${safeName}`;
}

export function parentHomeFilesystemPath(path: string): string {
  const normalized = normalizeHomeFilesystemPath(path);
  const parent = posix.dirname(normalized);
  return parent === "" ? HOME_FILESYSTEM_ROOT_PATH : parent;
}

export function isProtectedHomeFilesystemRootPath(path: string): boolean {
  return PROTECTED_HOME_FILESYSTEM_ROOT_PATHS.has(normalizeHomeFilesystemPath(path));
}

export function assertVisibleHomeFilesystemPath(path: string): void {
  const normalized = normalizeHomeFilesystemPath(path);
  if (normalized.split("/").includes(".codex")) {
    throw new HomeFilesystemError(
      "protected_path",
      "Member CODEX_HOME is excluded from ordinary filesystem operations.",
      { details: { path: normalized } },
    );
  }
}

export function workspaceRelativePath(workspaceRoot: string, absolutePath: string): string {
  const relativePath = relative(workspaceRoot, absolutePath);
  if (relativePath === "") {
    return HOME_FILESYSTEM_ROOT_PATH;
  }
  return relativePath.split(sep).join("/");
}

function assertPathInsideWorkspace(workspaceRoot: string, absolutePath: string): void {
  const relativePath = relative(workspaceRoot, absolutePath);
  if (relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
    return;
  }
  throw new HomeFilesystemError("path_escape", "Resolved filesystem path escapes the actor workspace.", {
    details: { workspace: workspaceRoot, path: absolutePath },
  });
}

function isWindowsAbsolutePath(inputPath: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(inputPath) || inputPath.startsWith("\\\\");
}
