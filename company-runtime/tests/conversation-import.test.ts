import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  importConversationsAtomic,
  parseConversationImport,
  readImportedConversationIndex,
  type ImportedConversation,
} from "../src/application/member-runtime/conversation-import.js";
import { provisionMemberWorkspace } from "../src/infrastructure/filesystem/workspace.js";

test("ChatGPT export parser retains every text branch and current selection", async () => {
  const bytes = Buffer.from(JSON.stringify([{
    id: "conversation-1",
    title: "Branched chat",
    create_time: 10,
    update_time: 20,
    current_node: "a2",
    mapping: {
      root: { parent: null, children: ["u1"], message: null },
      u1: { parent: "root", children: ["a1", "a2"], message: message("user", "Question", 11) },
      a1: { parent: "u1", children: [], message: message("assistant", "First answer", 12) },
      a2: { parent: "u1", children: [], message: message("assistant", "Second answer", 13) },
    },
  }]));
  const parsed = await parseConversationImport("conversations.json", bytes);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.branches.length, 2);
  assert.equal(parsed[0]?.selectedBranch, 1);
  assert.deepEqual(parsed[0]?.branches[1]?.map((entry) => entry.text), ["Question", "Second answer"]);
});

test("Codex rollout parser keeps visible messages and labels historical tool output", async () => {
  const bytes = Buffer.from([
    JSON.stringify({ type: "session_meta", timestamp: "2026-01-01T00:00:00Z", payload: { id: "session-1" } }),
    JSON.stringify({ type: "response_item", timestamp: "2026-01-01T00:00:01Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Inspect it" }] } }),
    JSON.stringify({ type: "response_item", timestamp: "2026-01-01T00:00:02Z", payload: { type: "function_call_output", call_id: "call-1", output: "tool result" } }),
    JSON.stringify({ type: "response_item", timestamp: "2026-01-01T00:00:03Z", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done" }] } }),
  ].join("\n"));
  const parsed = await parseConversationImport("rollout-session-1.jsonl", bytes);
  assert.deepEqual(parsed[0]?.branches[0]?.map((entry) => entry.text), ["Inspect it", "[Historical tool output]\ntool result", "Done"]);
});

test("atomic import creates native forks and persists only after every branch succeeds", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-conversation-import-"));
  try {
    const layout = await provisionMemberWorkspace(workdir, "member-1");
    const calls: string[] = [];
    let next = 0;
    const result = await importConversationsAtomic({
      layout,
      conversations: [branchedConversation()],
      nowMs: 1_000,
      runtime: {
        startThread: async () => { calls.push("start"); return `thread-${++next}`; },
        injectItems: async (threadId, items) => { calls.push(`inject:${threadId}:${items.length}`); },
        forkThread: async (threadId) => { calls.push(`fork:${threadId}`); return `thread-${++next}`; },
        deleteThread: async (threadId) => { calls.push(`delete:${threadId}`); },
      },
    });
    assert.equal(result.createdThreadIds.length, 2);
    assert.equal(result.index.records.length, 2);
    assert.ok(calls.includes("fork:thread-1"));
    assert.equal((await readImportedConversationIndex(layout)).records.length, 2);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("atomic import deletes every newly created thread after injection failure", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-conversation-import-rollback-"));
  try {
    const layout = await provisionMemberWorkspace(workdir, "member-1");
    const deleted: string[] = [];
    let next = 0;
    await assert.rejects(importConversationsAtomic({
      layout,
      conversations: [branchedConversation()],
      nowMs: 1_000,
      runtime: {
        startThread: async () => `thread-${++next}`,
        injectItems: async (_threadId, items) => { if (items.some((item) => JSON.stringify(item).includes("Alternative"))) throw new Error("inject failed"); },
        forkThread: async () => `thread-${++next}`,
        deleteThread: async (threadId) => { deleted.push(threadId); },
      },
    }));
    assert.deepEqual(deleted.sort(), ["thread-1", "thread-2"]);
    assert.equal((await readImportedConversationIndex(layout)).records.length, 0);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

function message(role: string, text: string, createTime: number) {
  return { author: { role }, content: { parts: [text] }, create_time: createTime };
}

function branchedConversation(): ImportedConversation {
  const user = { id: "u1", role: "user" as const, text: "Question", createdAtMs: 1 };
  const assistant = { id: "a1", role: "assistant" as const, text: "Answer", createdAtMs: 2 };
  return {
    externalId: "external-1",
    sourceDisplayName: "ChatGPT",
    title: "Imported",
    createdAtMs: 1,
    updatedAtMs: 4,
    branches: [
      [user, assistant, { id: "u2", role: "user", text: "Continue", createdAtMs: 3 }],
      [user, assistant, { id: "u3", role: "user", text: "Alternative", createdAtMs: 3 }],
    ],
    selectedBranch: 0,
    digest: "digest-1",
  };
}
