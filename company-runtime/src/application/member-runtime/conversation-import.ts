import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import unzipper from "unzipper";

import type { HomeConversationImport, HomeThreadTurn } from "@fields/contracts/public/home";
import type { ThreadInjectItemsParams } from "../../generated/codex-app-server-protocol/v2/ThreadInjectItemsParams.js";
import type { MemberWorkspaceLayout } from "../../infrastructure/filesystem/workspace.js";

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;
const MAX_JSON_BYTES = 128 * 1024 * 1024;
const MAX_RELEVANT_BYTES = 512 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 100_000;

export type ImportedTextMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAtMs: number | null;
};

export type ImportedConversation = {
  externalId: string;
  sourceDisplayName: string;
  title: string | null;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  branches: ImportedTextMessage[][];
  selectedBranch: number;
  digest: string;
};

export type ImportedThreadIndexRecord = {
  externalKey: string;
  digest: string;
  version: number;
  threadId: string;
  rootThreadId: string;
  sourceThreadId: string | null;
  anchorTurnId: string | null;
  branchKind: "root" | "edited_user_message" | "regenerated_assistant";
  selectedThreadId: string;
  title: string | null;
  sourceDisplayName: string;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  importedAtMs: number;
  messages: ImportedTextMessage[];
};

export type ImportedConversationIndex = { records: ImportedThreadIndexRecord[] };

export type ConversationImportRuntime = {
  startThread(): Promise<string>;
  injectItems(threadId: string, items: ThreadInjectItemsParams["items"]): Promise<void>;
  forkThread(parentThreadId: string): Promise<string>;
  deleteThread(threadId: string): Promise<void>;
};

export class ConversationImportError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ConversationImportError";
  }
}

export async function collectImportBody(body: AsyncIterable<unknown>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const value of body) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
    total += chunk.byteLength;
    if (total > MAX_UPLOAD_BYTES) throw new ConversationImportError("conversation_import_too_large", "Conversation import exceeds 512 MiB.");
    chunks.push(chunk);
  }
  if (total === 0) throw new ConversationImportError("conversation_import_empty", "Conversation import is empty.");
  return Buffer.concat(chunks, total);
}

export async function parseConversationImport(name: string, bytes: Buffer): Promise<ImportedConversation[]> {
  const lower = name.toLowerCase();
  const sources: Array<{ name: string; bytes: Buffer }> = [];
  if (lower.endsWith(".zip") || isZip(bytes)) {
    const archive = await unzipper.Open.buffer(bytes);
    if (archive.files.length > MAX_ZIP_ENTRIES) throw new ConversationImportError("conversation_import_too_many_entries", "Conversation import ZIP contains too many entries.");
    let relevantBytes = 0;
    const paths = new Set<string>();
    for (const entry of archive.files) {
      if (entry.path.includes("..") || entry.path.startsWith("/") || entry.path.includes("\\") || paths.has(entry.path)) {
        throw new ConversationImportError("conversation_import_path_invalid", "Conversation import ZIP contains an unsafe or duplicate path.");
      }
      paths.add(entry.path);
      const attributes = Number((entry as unknown as { externalFileAttributes?: number }).externalFileAttributes ?? 0);
      if (((attributes >>> 16) & 0o170000) === 0o120000) throw new ConversationImportError("conversation_import_path_invalid", "Conversation import ZIP contains a symbolic link.");
      if (entry.type !== "File" || !isRelevantEntry(entry.path)) continue;
      if (entry.uncompressedSize > MAX_JSON_BYTES) throw new ConversationImportError("conversation_import_entry_too_large", "A conversation data file exceeds 128 MiB.");
      relevantBytes += entry.uncompressedSize;
      if (relevantBytes > MAX_RELEVANT_BYTES) throw new ConversationImportError("conversation_import_expanded_too_large", "Conversation data exceeds 512 MiB after expansion.");
      const entryBytes = await entry.buffer();
      if (entryBytes.byteLength > MAX_JSON_BYTES) throw new ConversationImportError("conversation_import_entry_too_large", "A conversation data file exceeds 128 MiB.");
      sources.push({ name: entry.path, bytes: entryBytes });
    }
  } else {
    if (bytes.byteLength > MAX_JSON_BYTES) throw new ConversationImportError("conversation_import_entry_too_large", "A conversation data file exceeds 128 MiB.");
    sources.push({ name, bytes });
  }
  if (sources.length === 0) throw new ConversationImportError("conversation_import_format_unsupported", "No supported conversation data was found.");
  const conversations = sources.flatMap((source) => parseSource(source.name, source.bytes));
  if (conversations.length === 0) throw new ConversationImportError("conversation_import_no_conversations", "No importable text conversations were found.");
  const seen = new Set<string>();
  return conversations.filter((conversation) => {
    const key = `${conversation.sourceDisplayName}\0${conversation.externalId}\0${conversation.digest}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function importConversationsAtomic(input: {
  layout: MemberWorkspaceLayout;
  conversations: ImportedConversation[];
  runtime: ConversationImportRuntime;
  nowMs: number;
  onProgress?: (processed: number, createdThreads: number) => Promise<void> | void;
  onRollback?: () => Promise<void> | void;
}): Promise<{ index: ImportedConversationIndex; createdThreadIds: string[]; skipped: number }> {
  const existing = await readImportedConversationIndex(input.layout);
  const records = [...existing.records];
  const createdThreadIds: string[] = [];
  let skipped = 0;
  try {
    let processed = 0;
    for (const conversation of input.conversations) {
      const externalKey = `${conversation.sourceDisplayName}:${conversation.externalId}`;
      if (records.some((record) => record.externalKey === externalKey && record.digest === conversation.digest)) {
        skipped += 1;
        processed += 1;
        await input.onProgress?.(processed, createdThreadIds.length);
        continue;
      }
      const version = 1 + Math.max(0, ...records.filter((record) => record.externalKey === externalKey).map((record) => record.version));
      const materialized = await materializeConversation(conversation, input.runtime, createdThreadIds);
      for (const leaf of materialized.leaves) {
        records.push({
          externalKey,
          digest: conversation.digest,
          version,
          threadId: leaf.threadId,
          rootThreadId: materialized.rootThreadId,
          sourceThreadId: leaf.sourceThreadId,
          anchorTurnId: leaf.anchorTurnId,
          branchKind: leaf.threadId === materialized.rootThreadId ? "root" : leaf.branchKind,
          selectedThreadId: materialized.selectedThreadId,
          title: conversation.title,
          sourceDisplayName: conversation.sourceDisplayName,
          createdAtMs: conversation.createdAtMs,
          updatedAtMs: conversation.updatedAtMs,
          importedAtMs: input.nowMs,
          messages: leaf.messages,
        });
      }
      processed += 1;
      await input.onProgress?.(processed, createdThreadIds.length);
    }
    const index = { records };
    await writeImportedConversationIndex(input.layout, index);
    return { index, createdThreadIds, skipped };
  } catch (error) {
    await input.onRollback?.();
    const rollbackFailures: string[] = [];
    for (const threadId of [...createdThreadIds].reverse()) {
      try { await input.runtime.deleteThread(threadId); } catch { rollbackFailures.push(threadId); }
    }
    if (rollbackFailures.length > 0) throw new ConversationImportError("conversation_import_rollback_pending", `Conversation import rollback could not delete ${rollbackFailures.length} thread(s).`);
    throw error;
  }
}

export async function readImportedConversationIndex(layout: MemberWorkspaceLayout): Promise<ImportedConversationIndex> {
  try {
    const value = JSON.parse(await readFile(importIndexPath(layout), "utf8")) as ImportedConversationIndex;
    return { records: Array.isArray(value.records) ? value.records : [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { records: [] };
    throw error;
  }
}

export async function removeImportedThreadFromIndex(layout: MemberWorkspaceLayout, threadId: string): Promise<void> {
  const index = await readImportedConversationIndex(layout);
  if (!index.records.some((record) => record.threadId === threadId)) return;
  await writeImportedConversationIndex(layout, {
    records: index.records.filter((record) => record.threadId !== threadId),
  });
}

export function importedTurns(record: ImportedThreadIndexRecord): HomeThreadTurn[] {
  return record.messages.map((message): HomeThreadTurn => ({
    thread_id: record.threadId,
    turn_id: `imported_${stableId(message.id)}`,
    origin: "imported",
    snapshot: {
      turn_id: `imported_${stableId(message.id)}`,
      status: "completed",
      started_at_ms: message.createdAtMs,
      completed_at_ms: message.createdAtMs,
      duration_ms: 0,
      error: null,
      narrative_items: [message.role === "user" ? {
        id: `imported_item_${stableId(message.id)}`,
        status: "completed",
        type: "user_message",
        content: [{ type: "markdown", markdown: message.text }],
      } : {
        id: `imported_item_${stableId(message.id)}`,
        status: "completed",
        type: "assistant_message",
        phase: "final_answer",
        content: [{ type: "markdown", markdown: message.text }],
      }],
      activity_items: [],
      interactions: [],
    },
  }));
}

async function materializeConversation(
  conversation: ImportedConversation,
  runtime: ConversationImportRuntime,
  createdThreadIds: string[],
): Promise<{
  rootThreadId: string;
  selectedThreadId: string;
  leaves: Array<{ threadId: string; sourceThreadId: string | null; anchorTurnId: string | null; branchKind: "edited_user_message" | "regenerated_assistant"; messages: ImportedTextMessage[] }>;
}> {
  const rootThreadId = await runtime.startThread();
  createdThreadIds.push(rootThreadId);
  const trie = buildTrie(conversation.branches, conversation.selectedBranch);
  const leaves: Array<{ threadId: string; sourceThreadId: string | null; anchorTurnId: string | null; branchKind: "edited_user_message" | "regenerated_assistant"; messages: ImportedTextMessage[]; branchIndex: number }> = [];
  const walk = async (threadId: string, node: TrieNode, path: ImportedTextMessage[], sourceThreadId: string | null, anchorTurnId: string | null, branchKind: "edited_user_message" | "regenerated_assistant") => {
    let current = node;
    let messages = [...path];
    const pending: ImportedTextMessage[] = [];
    while (current.children.length === 1) {
      const edge = current.children[0]!;
      pending.push(edge.message);
      messages.push(edge.message);
      current = edge.node;
    }
    if (pending.length > 0) await runtime.injectItems(threadId, responseItems(pending));
    if (current.children.length === 0) {
      leaves.push({ threadId, sourceThreadId, anchorTurnId, branchKind, messages, branchIndex: current.branchIndexes[0] ?? 0 });
      return;
    }
    const preferred = current.children.find((edge) => edge.node.branchIndexes.includes(conversation.selectedBranch)) ?? current.children[0]!;
    const commonAnchor = messages.at(-1)?.id ?? null;
    for (const edge of current.children) {
      if (edge === preferred) continue;
      const childThreadId = await runtime.forkThread(threadId);
      createdThreadIds.push(childThreadId);
      await runtime.injectItems(childThreadId, responseItems([edge.message]));
      await walk(childThreadId, edge.node, [...messages, edge.message], threadId, commonAnchor ? `imported_${stableId(commonAnchor)}` : null, edge.message.role === "user" ? "edited_user_message" : "regenerated_assistant");
    }
    await runtime.injectItems(threadId, responseItems([preferred.message]));
    await walk(threadId, preferred.node, [...messages, preferred.message], sourceThreadId, anchorTurnId, branchKind);
  };
  await walk(rootThreadId, trie, [], null, null, "regenerated_assistant");
  const selectedThreadId = leaves.find((leaf) => leaf.branchIndex === conversation.selectedBranch)?.threadId ?? rootThreadId;
  return { rootThreadId, selectedThreadId, leaves };
}

type TrieNode = { children: Array<{ message: ImportedTextMessage; node: TrieNode }>; branchIndexes: number[] };

function buildTrie(branches: ImportedTextMessage[][], selectedBranch: number): TrieNode {
  const root: TrieNode = { children: [], branchIndexes: [] };
  branches.forEach((branch, branchIndex) => {
    let node = root;
    node.branchIndexes.push(branchIndex);
    for (const message of branch) {
      let edge = node.children.find((candidate) => candidate.message.id === message.id && candidate.message.role === message.role && candidate.message.text === message.text);
      if (!edge) {
        edge = { message, node: { children: [], branchIndexes: [] } };
        node.children.push(edge);
      }
      node = edge.node;
      node.branchIndexes.push(branchIndex);
    }
  });
  if (!root.branchIndexes.includes(selectedBranch)) root.branchIndexes.push(selectedBranch);
  return root;
}

function responseItems(messages: ImportedTextMessage[]): ThreadInjectItemsParams["items"] {
  return messages.map((message) => ({
    type: "message" as const,
    id: `fields_import_${stableId(message.id)}`,
    role: message.role,
    content: [{ type: message.role === "user" ? "input_text" as const : "output_text" as const, text: message.text }],
  }));
}

function parseSource(name: string, bytes: Buffer): ImportedConversation[] {
  if (name.toLowerCase().endsWith(".jsonl")) return parseCodexJsonl(name, bytes.toString("utf8"));
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { throw new ConversationImportError("conversation_import_json_invalid", `Invalid JSON in ${name}.`); }
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((entry) => parseChatGptConversation(entry));
}

function parseChatGptConversation(value: unknown): ImportedConversation[] {
  const conversation = record(value);
  const mapping = record(conversation?.mapping);
  if (!conversation || !mapping) return [];
  const nodes = new Map(Object.entries(mapping).map(([id, node]) => [id, record(node)]));
  const leaves = [...nodes.entries()].filter(([, node]) => {
    const children = Array.isArray(node?.children) ? node.children.filter((child): child is string => typeof child === "string") : [];
    return children.length === 0;
  });
  const branches = leaves.map(([leafId]) => chatGptPath(leafId, nodes)).filter((path) => path.length > 0);
  if (branches.length === 0) return [];
  const currentNode = typeof conversation.current_node === "string" ? conversation.current_node : leaves[0]?.[0];
  const selectedBranch = Math.max(0, leaves.findIndex(([id]) => id === currentNode));
  return [finalizeConversation({
    externalId: stringValue(conversation.id) ?? `chatgpt_${stableId(JSON.stringify(value))}`,
    sourceDisplayName: "ChatGPT",
    title: stringValue(conversation.title),
    createdAtMs: secondsMs(conversation.create_time),
    updatedAtMs: secondsMs(conversation.update_time),
    branches,
    selectedBranch,
  })];
}

function chatGptPath(leafId: string, nodes: Map<string, Record<string, unknown> | null>): ImportedTextMessage[] {
  const path: ImportedTextMessage[] = [];
  const visited = new Set<string>();
  let id: string | null = leafId;
  while (id && !visited.has(id)) {
    visited.add(id);
    const node = nodes.get(id);
    const message = record(node?.message);
    const author = record(message?.author);
    const role = author?.role === "user" ? "user" : author?.role === "assistant" ? "assistant" : author?.role === "tool" ? "assistant" : null;
    const text = visibleChatGptText(message);
    if (role && text) path.push({ id, role, text: author?.role === "tool" ? `[Historical tool output]\n${text}` : text, createdAtMs: secondsMs(message?.create_time) });
    id = typeof node?.parent === "string" ? node.parent : null;
  }
  return path.reverse();
}

function visibleChatGptText(message: Record<string, unknown> | null): string {
  const content = record(message?.content);
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  return parts.flatMap((part) => typeof part === "string" ? [part] : stringValue(record(part)?.text) ? [stringValue(record(part)?.text)!] : []).join("\n").trim();
}

function parseCodexJsonl(name: string, text: string): ImportedConversation[] {
  let externalId: string | null = null;
  let createdAtMs: number | null = null;
  const messages: ImportedTextMessage[] = [];
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown> | null;
    try { entry = record(JSON.parse(line)); } catch { throw new ConversationImportError("conversation_import_jsonl_invalid", `Invalid JSONL in ${name}.`); }
    const payload = record(entry?.payload);
    if (entry?.type === "session_meta") {
      externalId = stringValue(payload?.id) ?? externalId;
      createdAtMs = isoMs(entry.timestamp) ?? createdAtMs;
      continue;
    }
    if (entry?.type === "response_item" && ["function_call_output", "custom_tool_call_output"].includes(String(payload?.type))) {
      const output = importedToolOutput(payload?.output);
      if (output) messages.push({
        id: stringValue(payload?.call_id) ?? stringValue(payload?.id) ?? `${name}:${index}`,
        role: "assistant",
        text: `[Historical tool output]\n${output}`,
        createdAtMs: isoMs(entry.timestamp),
      });
      continue;
    }
    if (entry?.type !== "response_item" || payload?.type !== "message") continue;
    const role = payload.role === "user" ? "user" : payload.role === "assistant" ? "assistant" : null;
    if (!role) continue;
    const content = Array.isArray(payload.content) ? payload.content : [];
    const value = content.flatMap((partValue) => {
      const part = record(partValue);
      return typeof part?.text === "string" && ["input_text", "output_text", "text"].includes(String(part.type)) ? [part.text] : [];
    }).join("\n").trim();
    if (value) messages.push({ id: stringValue(payload.id) ?? `${name}:${index}`, role, text: value, createdAtMs: isoMs(entry.timestamp) });
  }
  if (messages.length === 0) return [];
  return [finalizeConversation({
    externalId: externalId ?? `codex_${stableId(name + text)}`,
    sourceDisplayName: "Codex",
    title: messages.find((message) => message.role === "user")?.text.slice(0, 120) ?? null,
    createdAtMs,
    updatedAtMs: messages.at(-1)?.createdAtMs ?? createdAtMs,
    branches: [messages],
    selectedBranch: 0,
  })];
}

function importedToolOutput(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const text = value.flatMap((entry) => {
      const part = record(entry);
      return typeof part?.text === "string" ? [part.text] : typeof part?.content === "string" ? [part.content] : [];
    }).join("\n").trim();
    return text || null;
  }
  const output = record(value);
  return typeof output?.text === "string" && output.text.trim() ? output.text.trim() : null;
}

function finalizeConversation(input: Omit<ImportedConversation, "digest">): ImportedConversation {
  return { ...input, digest: createHash("sha256").update(JSON.stringify(input.branches)).digest("hex") };
}

async function writeImportedConversationIndex(layout: MemberWorkspaceLayout, index: ImportedConversationIndex): Promise<void> {
  const root = join(layout.memberRoot, ".runtime", "conversation-imports");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const target = importIndexPath(layout);
  const temporary = `${target}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(index)); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, target);
}

export async function writeImportJob(layout: MemberWorkspaceLayout, job: HomeConversationImport): Promise<void> {
  const root = join(layout.memberRoot, ".runtime", "conversation-imports", "jobs");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const target = join(root, `${job.import_id}.json`);
  const temporary = `${target}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(job)); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, target);
}

export async function readImportJob(layout: MemberWorkspaceLayout, importId: string): Promise<HomeConversationImport> {
  if (!/^import_[A-Za-z0-9-]+$/u.test(importId)) throw new ConversationImportError("conversation_import_not_found", "Conversation import does not exist.");
  try { return JSON.parse(await readFile(join(layout.memberRoot, ".runtime", "conversation-imports", "jobs", `${importId}.json`), "utf8")) as HomeConversationImport; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ConversationImportError("conversation_import_not_found", "Conversation import does not exist."); throw error; }
}

export async function stageImportSource(layout: MemberWorkspaceLayout, importId: string, name: string, bytes: Buffer): Promise<void> {
  if (!name || name.length > 255) throw new ConversationImportError("conversation_import_source_invalid", "Conversation import file name is invalid.");
  const root = importJobsRoot(layout);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await atomicWrite(join(root, `${importId}.source`), bytes);
  await atomicWrite(join(root, `${importId}.source.json`), Buffer.from(JSON.stringify({ name })));
}

export async function readStagedImportSource(layout: MemberWorkspaceLayout, importId: string): Promise<{ name: string; bytes: Buffer }> {
  const root = importJobsRoot(layout);
  const metadata = JSON.parse(await readFile(join(root, `${importId}.source.json`), "utf8")) as { name?: unknown };
  if (typeof metadata.name !== "string" || metadata.name.length === 0 || metadata.name.length > 255) {
    throw new ConversationImportError("conversation_import_source_invalid", "Staged conversation import metadata is invalid.");
  }
  return { name: metadata.name, bytes: await readFile(join(root, `${importId}.source`)) };
}

export async function discardStagedImport(layout: MemberWorkspaceLayout, importId: string): Promise<void> {
  const root = importJobsRoot(layout);
  await Promise.all([
    rm(join(root, `${importId}.source`), { force: true }),
    rm(join(root, `${importId}.source.json`), { force: true }),
    rm(join(root, `${importId}.journal.json`), { force: true }),
  ]);
}

export async function writeImportJournal(layout: MemberWorkspaceLayout, importId: string, threadIds: readonly string[]): Promise<void> {
  await mkdir(importJobsRoot(layout), { recursive: true, mode: 0o700 });
  await atomicWrite(join(importJobsRoot(layout), `${importId}.journal.json`), Buffer.from(JSON.stringify({ thread_ids: threadIds })));
}

export async function readImportJournal(layout: MemberWorkspaceLayout, importId: string): Promise<string[]> {
  try {
    const value = JSON.parse(await readFile(join(importJobsRoot(layout), `${importId}.journal.json`), "utf8")) as { thread_ids?: unknown };
    return Array.isArray(value.thread_ids) ? value.thread_ids.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function recoverableImportJobs(layout: MemberWorkspaceLayout): Promise<HomeConversationImport[]> {
  const entries = await readdir(importJobsRoot(layout), { withFileTypes: true }).catch(() => []);
  const jobs: HomeConversationImport[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^import_[A-Za-z0-9-]+\.json$/u.test(entry.name)) continue;
    const job = JSON.parse(await readFile(join(importJobsRoot(layout), entry.name), "utf8")) as HomeConversationImport;
    if (job.status !== "succeeded" && (job.status !== "failed" || job.error_code === "conversation_import_rollback_pending")) jobs.push(job);
  }
  return jobs.sort((left, right) => left.created_at_ms - right.created_at_ms);
}

function importIndexPath(layout: MemberWorkspaceLayout): string { return join(layout.memberRoot, ".runtime", "conversation-imports", "index.json"); }
function importJobsRoot(layout: MemberWorkspaceLayout): string { return join(layout.memberRoot, ".runtime", "conversation-imports", "jobs"); }
async function atomicWrite(target: string, bytes: Buffer): Promise<void> {
  const temporary = `${target}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, target);
}
function isZip(bytes: Buffer): boolean { return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b; }
function isRelevantEntry(path: string): boolean { const lower = path.toLowerCase(); return /(^|\/)conversations(?:-?\d+)?\.json$/u.test(lower) || lower.endsWith(".jsonl") && (lower.includes("/sessions/") || lower.includes("rollout-")); }
function record(value: unknown): Record<string, unknown> | null { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function stringValue(value: unknown): string | null { return typeof value === "string" && value.trim() ? value : null; }
function secondsMs(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value * 1_000) : null; }
function isoMs(value: unknown): number | null { if (typeof value !== "string") return null; const parsed = Date.parse(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : null; }
function stableId(value: string): string { return createHash("sha256").update(value).digest("hex").slice(0, 24); }
