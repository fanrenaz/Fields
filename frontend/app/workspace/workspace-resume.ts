import type { AssetKind, AssetLifecycle } from "@fields/contracts/public/asset";

import { desktopRuntimeInfo } from "../session/desktop-runtime";

export type WorkspaceProductDestination =
  | { page: "home"; threadId: string | null }
  | { page: "room"; roomId: string }
  | { page: "member"; actorId: string }
  | { page: "files" }
  | { page: "scheduledTasks" }
  | { page: "assets"; assetId: string | null; kind: AssetKind; lifecycle: AssetLifecycle }
  | { page: "mail"; mailboxId: string | null; folderId: string | null; messageId: string | null };

export type WorkspaceResumeView = WorkspaceProductDestination | {
  page: "settings";
  returnTo: WorkspaceProductDestination;
};

export type WorkspaceResumeRuntime = { platform: "desktop"; appVersion: string };

export type WorkspaceResumeReadResult = {
  outcome: "empty" | "restored" | "invalid" | "desktop_version_changed" | "storage_unavailable";
  view: WorkspaceResumeView | null;
};

export type WorkspaceResumeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type BrowserStorageHost = {
  localStorage: WorkspaceResumeStorage;
};

const SCHEMA_VERSION = 1;
const STORAGE_PREFIX = "fields.workspace.resume.v1";
const ASSET_KINDS = new Set<AssetKind>(["plugin", "skill", "mcp"]);
const ASSET_LIFECYCLES = new Set<AssetLifecycle>(["published", "draft", "archived"]);

export function currentWorkspaceResumeRuntime(): WorkspaceResumeRuntime {
  const desktop = desktopRuntimeInfo();
  return { platform: "desktop", appVersion: desktop.version };
}

export function workspaceResumeStorage(
  _runtime: WorkspaceResumeRuntime,
  browser: BrowserStorageHost | undefined = typeof window === "undefined" ? undefined : window,
): WorkspaceResumeStorage | null {
  if (!browser) return null;
  try {
    return browser.localStorage;
  } catch {
    return null;
  }
}

export function workspaceResumeKey(companyId: string, actorId: string): string {
  return `${STORAGE_PREFIX}:${encodeURIComponent(companyId)}:${encodeURIComponent(actorId)}`;
}

export function readWorkspaceResume(
  storage: WorkspaceResumeStorage | null,
  key: string,
  runtime: WorkspaceResumeRuntime,
): WorkspaceResumeReadResult {
  if (!storage) return { outcome: "storage_unavailable", view: null };
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { outcome: "storage_unavailable", view: null };
  }
  if (raw === null) return { outcome: "empty", view: null };

  try {
    const record = asRecord(JSON.parse(raw));
    const version = record?.schemaVersion;
    const desktopAppVersion = stringOrNull(record?.desktopAppVersion);
    if (version !== SCHEMA_VERSION) throw new Error("unsupported workspace resume schema");
    if (desktopAppVersion !== runtime.appVersion) {
      removeWorkspaceResume(storage, key);
      return { outcome: "desktop_version_changed", view: null };
    }
    const view = parseResumeView(record?.view);
    if (!view) throw new Error("invalid workspace resume view");
    return { outcome: "restored", view };
  } catch {
    removeWorkspaceResume(storage, key);
    return { outcome: "invalid", view: null };
  }
}

export function writeWorkspaceResume(
  storage: WorkspaceResumeStorage | null,
  key: string,
  runtime: WorkspaceResumeRuntime,
  view: WorkspaceResumeView,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      desktopAppVersion: runtime.appVersion,
      view,
    }));
    return true;
  } catch {
    return false;
  }
}

export function removeWorkspaceResume(storage: WorkspaceResumeStorage | null, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Navigation persistence is optional and must never block the workspace.
  }
}

function parseResumeView(value: unknown): WorkspaceResumeView | null {
  const record = asRecord(value);
  if (!record) return null;
  if (record.page === "settings") {
    const returnTo = parseProductDestination(record.returnTo);
    return returnTo ? { page: "settings", returnTo } : null;
  }
  return parseProductDestination(record);
}

function parseProductDestination(value: unknown): WorkspaceProductDestination | null {
  const record = asRecord(value);
  if (!record) return null;
  if (record.page === "home") {
    const threadId = nullableIdentifier(record.threadId);
    return threadId.valid ? { page: "home", threadId: threadId.value } : null;
  }
  if (record.page === "room") {
    const roomId = identifier(record.roomId);
    return roomId ? { page: "room", roomId } : null;
  }
  if (record.page === "member") {
    const actorId = identifier(record.actorId);
    return actorId ? { page: "member", actorId } : null;
  }
  if (record.page === "files") return { page: "files" };
  if (record.page === "scheduledTasks") return { page: "scheduledTasks" };
  if (record.page === "assets") {
    const assetId = nullableIdentifier(record.assetId);
    if (!assetId.valid || !ASSET_KINDS.has(record.kind as AssetKind) || !ASSET_LIFECYCLES.has(record.lifecycle as AssetLifecycle)) return null;
    return {
      page: "assets",
      assetId: assetId.value,
      kind: record.kind as AssetKind,
      lifecycle: record.lifecycle as AssetLifecycle,
    };
  }
  if (record.page === "mail") {
    const mailboxId = nullableIdentifier(record.mailboxId);
    const folderId = nullableIdentifier(record.folderId);
    const messageId = nullableIdentifier(record.messageId);
    if (!mailboxId.valid || !folderId.valid || !messageId.valid) return null;
    return {
      page: "mail",
      mailboxId: mailboxId.value,
      folderId: folderId.value,
      messageId: messageId.value,
    };
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function identifier(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 512 ? value : null;
}

function nullableIdentifier(value: unknown): { valid: true; value: string | null } | { valid: false } {
  if (value === null) return { valid: true, value: null };
  const parsed = identifier(value);
  return parsed ? { valid: true, value: parsed } : { valid: false };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
