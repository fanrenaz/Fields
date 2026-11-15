import assert from "node:assert/strict";
import test from "node:test";
import { createActor } from "xstate";

import { homeMachine } from "../../../../features/home/home-machine";
import type { HomeMachineServices } from "../../../../data/home/home-machine-services";

test("Home XState owns thread navigation but no conversation messages", async () => {
  const services = fakeServices();
  const actor = createActor(homeMachine, {
    input: {
      active: false,
      timeoutMs: 1_000,
      threadListLimit: 20,
      services,
    },
  }).start();
  assert.equal("chat" in actor.getSnapshot().context, false);

  actor.send({ type: "HOME_ACTIVATED" });
  await settle();
  assert.equal(actor.getSnapshot().hasTag("home-active"), true);
  assert.deepEqual(
    actor.getSnapshot().context.threads.items.map((thread) => thread.thread_id),
    ["thread-1"],
  );

  actor.send({ type: "THREAD_SELECTED", threadId: "thread-1" });
  assert.equal(actor.getSnapshot().context.threads.selectedThreadId, "thread-1");
  actor.send({ type: "NEW_CHAT_REQUESTED" });
  assert.equal(actor.getSnapshot().context.threads.selectedThreadId, null);
  actor.stop();
});

test("Home starts from a restored stable thread target", () => {
  const actor = createActor(homeMachine, {
    input: {
      active: false,
      initialThreadId: "thread-restored",
      timeoutMs: 1_000,
      threadListLimit: 20,
      services: fakeServices(),
    },
  }).start();

  assert.equal(actor.getSnapshot().context.threads.selectedThreadId, "thread-restored");
  actor.stop();
});

test("Home filesystem state remains domain-owned and loads expanded directories", async () => {
  const services = fakeServices();
  const actor = createActor(homeMachine, {
    input: {
      active: false,
      timeoutMs: 1_000,
      threadListLimit: 20,
      services,
    },
  }).start();
  actor.send({ type: "HOME_ACTIVATED" });
  await settle();
  assert.equal(actor.getSnapshot().context.filesystem.loadedPaths["."], true);
  actor.send({ type: "FILESYSTEM_EXPANSION_CHANGED", expandedIds: ["docs"] });
  await settle();
  assert.equal(actor.getSnapshot().context.filesystem.loadedPaths.docs, true);
  actor.stop();
});

test("Home Project scope switches both thread filtering and filesystem root", async () => {
  const projectIds: Array<string | null> = [];
  const services = fakeServices();
  services.listThreads = async ({ projectId }) => {
    projectIds.push(projectId);
    return { items: [], page: { next_cursor: null, backwards_cursor: null } };
  };
  const actor = createActor(homeMachine, {
    input: { active: false, timeoutMs: 1_000, threadListLimit: 20, services },
  }).start();
  actor.send({ type: "HOME_ACTIVATED" });
  await settle();
  actor.send({ type: "PROJECT_SCOPE_CHANGED", projectId: "project-1" });
  await settle();

  assert.equal(actor.getSnapshot().context.projectId, "project-1");
  assert.equal(actor.getSnapshot().context.filesystem.rootPath, "projects/project-1");
  assert.equal(projectIds.at(-1), "project-1");
  actor.stop();
});

function fakeServices(): HomeMachineServices {
  return {
    listProjects: async () => ({ items: [] }),
    createProject: async ({ name }) => ({ project_id: "project-test", name, created_at_ms: 1, updated_at_ms: 1 }),
    updateProject: async ({ projectId, name }) => ({ project_id: projectId, name, created_at_ms: 1, updated_at_ms: 2 }),
    deleteProject: async ({ projectId }) => ({ project_id: projectId, deleted: true }),
    moveThreadToProject: async ({ threadId, projectId }) => ({ root_thread_id: threadId, project_id: projectId }),
    readMemory: async () => ({
      enabled: true,
      applied_enabled: true,
      status: "ready",
      error_code: null,
      revision: 0,
    }),
    updateMemory: async ({ enabled, expectedRevision }) => ({
      enabled,
      applied_enabled: enabled,
      status: "ready",
      error_code: null,
      revision: expectedRevision + 1,
    }),
    listModelOptions: async () => ({ items: [], new_thread_default: null }),
    readThreadSettings: async ({ threadId }) => ({ thread_id: threadId, model: "model", reasoning_effort: null }),
    updateThreadSettings: async ({ threadId, model, reasoningEffort }) => ({ thread_id: threadId, model, reasoning_effort: reasoningEffort }),
    listThreads: async () => ({
      items: [{
        thread_id: "thread-1",
        title: "Thread",
        preview: null,
        created_at_ms: 1,
        updated_at_ms: 1,
        status: "idle",
        unread_count: 0,
        read_through: null,
      }],
      page: { next_cursor: null, backwards_cursor: null },
    }),
    searchThreads: async () => ({ items: [], page: { next_cursor: null, backwards_cursor: null } }),
    readThread: async ({ threadId }) => ({
      thread_id: threadId,
      root_thread_id: threadId,
      selected_thread_id: threadId,
      revision: 1,
      branches: [{
        thread_id: threadId,
        root_thread_id: threadId,
        source_thread_id: null,
        anchor_turn_id: null,
        kind: "root",
        selected: true,
        created_at_ms: 1,
      }],
      turns: [],
    }),
    submitTurn: async ({ threadId }) => ({ submitted: true, thread_id: threadId ?? "thread-1", turn_id: "turn-1" }),
    subscribeTurnEvents: () => ({ unsubscribe: () => undefined }),
    subscribeFilesystemEvents: () => ({ unsubscribe: () => undefined }),
    listFilesystem: async ({ path }) => ({
      parent: entry(path, true),
      children: path === "." ? [entry("docs", true)] : [],
    }),
    createFilesystemEntry: async ({ parentPath, name, kind }) => entry(`${parentPath}/${name}`, kind === "folder"),
    renameFilesystemEntry: async ({ path, name }) => entry(`${path}/${name}`, false),
    deleteFilesystemEntry: async ({ path }) => ({ path, deleted: true }),
  };
}

function entry(path: string, folder: boolean) {
  return {
    id: path,
    path,
    name: path,
    is_folder: folder,
    size_bytes: null,
    modified_at_ms: null,
  };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
