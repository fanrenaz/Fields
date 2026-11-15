import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat,
  utimes,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import type { CompanyFileDownloadResult } from "@fields/contracts/public/company-file";

const CACHE_MAX_BYTES = 256 * 1024 * 1024;

export type MaterializedCompanyFile = {
  file_id: string;
  version_id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  local_path: string;
};

export class CompanyFileCache {
  private readonly flights = new Map<string, Promise<MaterializedCompanyFile>>();

  constructor(private readonly membersRoot: string) {}

  read(memberId: string, source: CompanyFileDownloadResult): Promise<MaterializedCompanyFile> {
    const key = `${memberId}\0${source.file.file_id}\0${source.version.version_id}`;
    const existing = this.flights.get(key);
    if (existing) return existing;
    const flight = this.materialize(memberId, source).finally(() => {
      if (this.flights.get(key) === flight) this.flights.delete(key);
    });
    this.flights.set(key, flight);
    return flight;
  }

  private async materialize(
    memberId: string,
    source: CompanyFileDownloadResult,
  ): Promise<MaterializedCompanyFile> {
    const member = safeSegment(memberId);
    const fileId = safeSegment(source.file.file_id);
    const versionId = safeSegment(source.version.version_id);
    const name = safeFileName(source.file.name);
    const memberRoot = join(this.membersRoot, member);
    const runtimeRoot = join(memberRoot, ".runtime");
    const root = join(runtimeRoot, "company-files");
    const target = join(root, fileId, versionId, name);
    let cacheRootSafe = false;
    try {
      await ensureSafeDirectory(memberRoot);
      await ensureSafeDirectory(runtimeRoot);
      await ensureSafeDirectory(root);
      cacheRootSafe = true;
      await makeCacheWritable(root);
      await ensureSafeDirectory(join(root, fileId));
      await ensureSafeDirectory(dirname(target));
      if (await verifiedRegularFile(target, source.version.size_bytes, source.version.blob_sha256)) {
        const now = new Date();
        await utimes(target, now, now);
        return result(source, target);
      }
      await rm(target, { force: true });
      const response = await fetch(source.download_url, { redirect: "error" });
      if (!response.ok) throw new Error(`Company File download failed with status ${response.status}.`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (
        bytes.byteLength !== source.version.size_bytes
        || createHash("sha256").update(bytes).digest("hex") !== source.version.blob_sha256
      ) {
        throw new Error("Company File cache integrity verification failed.");
      }
      const temporary = `${target}.${randomUUID()}.tmp`;
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await rename(temporary, target);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
      await chmod(target, 0o400);
      await prune(root, target);
      return result(source, target);
    } finally {
      if (cacheRootSafe) await sealCache(root);
    }
  }
}

async function ensureSafeDirectory(path: string): Promise<void> {
  const existing = await lstat(path).catch(() => null);
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw new Error("Company File cache directory is unsafe.");
    }
    await chmod(path, 0o700);
    return;
  }
  await mkdir(path, { mode: 0o700 });
}

async function makeCacheWritable(root: string): Promise<void> {
  const visit = async (directory: string): Promise<void> => {
    const metadata = await lstat(directory).catch(() => null);
    if (!metadata) return;
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("Company File cache directory is unsafe.");
    }
    await chmod(directory, 0o700);
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error("Company File cache contains a symbolic link.");
      if (entry.isDirectory()) await visit(join(directory, entry.name));
    }
  };
  await visit(root);
}

async function sealCache(root: string): Promise<void> {
  const visit = async (directory: string): Promise<void> => {
    const metadata = await lstat(directory).catch(() => null);
    if (!metadata || !metadata.isDirectory() || metadata.isSymbolicLink()) return;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) await chmod(path, 0o400).catch(() => undefined);
    }
    await chmod(directory, 0o500).catch(() => undefined);
  };
  await visit(root);
}

async function verifiedRegularFile(path: string, size: number, sha256: string): Promise<boolean> {
  const metadata = await lstat(path).catch(() => null);
  if (!metadata || !metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== size) return false;
  const handle = await open(path, "r");
  try {
    const hash = createHash("sha256");
    for await (const chunk of handle.readableWebStream()) hash.update(Buffer.from(chunk));
    return hash.digest("hex") === sha256;
  } finally {
    await handle.close();
  }
}

async function prune(root: string, retained: string): Promise<void> {
  const files = await cacheFiles(root);
  let bytes = files.reduce((sum, file) => sum + file.size, 0);
  for (const file of files.sort((left, right) => left.mtimeMs - right.mtimeMs)) {
    if (bytes <= CACHE_MAX_BYTES) break;
    if (file.path === retained) continue;
    await chmod(file.path, 0o600).catch(() => undefined);
    await rm(file.path, { force: true });
    bytes -= file.size;
  }
}

async function cacheFiles(root: string): Promise<Array<{ path: string; size: number; mtimeMs: number }>> {
  const output: Array<{ path: string; size: number; mtimeMs: number }> = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const metadata = await stat(path);
        output.push({ path, size: metadata.size, mtimeMs: metadata.mtimeMs });
      }
    }
  };
  await visit(root);
  return output;
}

function result(source: CompanyFileDownloadResult, localPath: string): MaterializedCompanyFile {
  return {
    file_id: source.file.file_id,
    version_id: source.version.version_id,
    name: source.file.name,
    mime_type: source.version.mime_type,
    size_bytes: source.version.size_bytes,
    sha256: source.version.blob_sha256,
    local_path: localPath,
  };
}

function safeSegment(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(value)) throw new Error("Company File cache identity is invalid.");
  return value;
}

function safeFileName(value: string): string {
  if (!value || value === "." || value === ".." || value.includes("/") || value.includes("\\") || value.includes("\0")) {
    throw new Error("Company File cache name is invalid.");
  }
  return value;
}
