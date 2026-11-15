import type { HomeCodexFilesystem } from "./codex-fs.js";

export type HomeFilesystemEntry = {
  id: string;
  path: string;
  name: string;
  is_folder: boolean;
  size_bytes: number | null;
  modified_at_ms: number | null;
};

export type HomeFilesystemListResult = {
  parent: HomeFilesystemEntry;
  children: HomeFilesystemEntry[];
};

export type HomeFilesystemEntryKind = "file" | "folder";

export type HomeFilesystemRequestBase = {
  workdir: string;
  memberId: string;
  runtime?: {
    memberFilesystemSocket(memberId: string): Promise<string>;
  };
  codexFs?: HomeCodexFilesystem;
  codexFilesystemFactory?: (socketPath: string) => HomeCodexFilesystem;
};

export type HomeFilesystemListDirectoryInput = HomeFilesystemRequestBase & {
  path: string;
};

export type HomeFilesystemCreateEntryInput = HomeFilesystemRequestBase & {
  parentPath: string;
  name: string;
  kind: HomeFilesystemEntryKind;
};

export type HomeFilesystemRenameEntryInput = HomeFilesystemRequestBase & {
  path: string;
  name: string;
};

export type HomeFilesystemDeleteEntryInput = HomeFilesystemRequestBase & {
  path: string;
};

export type HomeFilesystemDeleteResult = {
  path: string;
  deleted: true;
};

export type HomeFilesystemEvent = {
  schema_version: 1;
  type: "home.filesystem.changed";
  source: "company-runtime";
  member_id: string;
  changed_paths: string[];
  reload_paths: string[];
  occurred_at_ms: number;
};

export type HomeFilesystemEventsInput = HomeFilesystemRequestBase & {
  path?: string;
  signal?: AbortSignal | null;
};
