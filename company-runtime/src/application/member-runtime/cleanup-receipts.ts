import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const MEMBER_CLEANUP_RECEIPTS_DIR = "member-cleanup-receipts";
const TERMINAL_MEMBERS_DIR = "terminal-members";
const RUNTIME_MANAGEMENT_DIR = ".runtime";

export type MemberCleanupReceipt = {
  operationId: string;
  memberId: string;
};

export type MemberTerminalMarker = {
  memberId: string;
  operationId: string;
  state: "cleaning" | "completed";
};

export async function readMemberCleanupReceipt(
  workdir: string,
  operationId: string,
): Promise<MemberCleanupReceipt | null> {
  const directory = await safeManagementDirectory(workdir, MEMBER_CLEANUP_RECEIPTS_DIR, false);
  if (directory === null) return null;
  const path = join(directory, cleanupReceiptFileName(operationId));
  let raw: unknown;
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
      throw new Error("Member cleanup receipt must be one regular file.");
    }
    raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
  if (
    !isRecord(raw)
    || raw.version !== 1
    || raw.state !== "completed"
    || raw.operation_id !== operationId
    || typeof raw.member_id !== "string"
    || raw.member_id.length === 0
  ) {
    throw new Error("Member cleanup receipt has an unsupported format.");
  }
  return {
    operationId: raw.operation_id,
    memberId: raw.member_id,
  };
}

export async function writeMemberCleanupReceipt(
  workdir: string,
  receipt: MemberCleanupReceipt,
): Promise<void> {
  const existing = await readMemberCleanupReceipt(workdir, receipt.operationId);
  if (existing) {
    if (existing.memberId !== receipt.memberId) {
      throw new Error("Member cleanup receipt operation id conflicts with another Member.");
    }
    return;
  }
  const directory = await safeManagementDirectory(workdir, MEMBER_CLEANUP_RECEIPTS_DIR, true);
  const path = join(directory!, cleanupReceiptFileName(receipt.operationId));
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify({
    version: 1,
    state: "completed",
    operation_id: receipt.operationId,
    member_id: receipt.memberId,
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    await link(temporaryPath, path);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") throw error;
    const concurrent = await readMemberCleanupReceipt(workdir, receipt.operationId);
    if (!concurrent || concurrent.memberId !== receipt.memberId) {
      throw new Error("Member cleanup receipt operation id conflicts with another Member.");
    }
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

export async function readMemberTerminalMarker(
  workdir: string,
  memberId: string,
): Promise<MemberTerminalMarker | null> {
  const directory = await safeManagementDirectory(workdir, TERMINAL_MEMBERS_DIR, false);
  if (directory === null) return null;
  const path = join(directory, terminalMarkerFileName(memberId));
  let raw: unknown;
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
      throw new Error("Member terminal marker must be one regular file.");
    }
    raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
  if (
    !isRecord(raw)
    || raw.version !== 1
    || raw.member_id !== memberId
    || typeof raw.operation_id !== "string"
    || raw.operation_id.length === 0
    || (raw.state !== "cleaning" && raw.state !== "completed")
  ) {
    throw new Error("Member terminal marker has an unsupported format.");
  }
  return {
    memberId: raw.member_id,
    operationId: raw.operation_id,
    state: raw.state,
  };
}

export async function writeMemberTerminalMarker(
  workdir: string,
  marker: MemberTerminalMarker,
): Promise<void> {
  const directory = await safeManagementDirectory(workdir, TERMINAL_MEMBERS_DIR, true);
  const path = join(directory!, terminalMarkerFileName(marker.memberId));
  const existingMetadata = await lstatOrNull(path);
  if (
    existingMetadata
    && (!existingMetadata.isFile() || existingMetadata.isSymbolicLink() || existingMetadata.nlink !== 1)
  ) {
    throw new Error("Member terminal marker must be one regular file.");
  }
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify({
    version: 1,
    state: marker.state,
    operation_id: marker.operationId,
    member_id: marker.memberId,
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporaryPath, path);
}

export function memberCleanupReceiptPath(workdir: string, operationId: string): string {
  return join(resolve(workdir), RUNTIME_MANAGEMENT_DIR, MEMBER_CLEANUP_RECEIPTS_DIR, cleanupReceiptFileName(operationId));
}

export function memberTerminalMarkerPath(workdir: string, memberId: string): string {
  return join(resolve(workdir), RUNTIME_MANAGEMENT_DIR, TERMINAL_MEMBERS_DIR, terminalMarkerFileName(memberId));
}

async function safeManagementDirectory(
  workdir: string,
  leaf: string,
  create: boolean,
): Promise<string | null> {
  const root = resolve(workdir);
  await assertRealDirectory(root, "Company Runtime root");
  const runtime = join(root, RUNTIME_MANAGEMENT_DIR);
  if (!await ensureRealDirectory(runtime, create)) return null;
  const directory = join(runtime, leaf);
  if (!await ensureRealDirectory(directory, create)) return null;
  return directory;
}

async function ensureRealDirectory(path: string, create: boolean): Promise<boolean> {
  let metadata = await lstatOrNull(path);
  if (metadata === null && create) {
    try {
      await mkdir(path, { mode: 0o700 });
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
    }
    metadata = await lstatOrNull(path);
  }
  if (metadata === null) return false;
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`Runtime management path must be a real directory: ${path}`);
  }
  return true;
}

async function assertRealDirectory(path: string, label: string): Promise<void> {
  const metadata = await lstatOrNull(path);
  if (metadata === null || !metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory.`);
  }
}

async function lstatOrNull(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

function cleanupReceiptFileName(operationId: string): string {
  return `${createHash("sha256").update(operationId, "utf8").digest("hex")}.json`;
}

function terminalMarkerFileName(memberId: string): string {
  return `${createHash("sha256").update(memberId, "utf8").digest("hex")}.json`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
