import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, link, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DEFAULT_MEMBER_IDLE_TIMEOUT_MS,
  MemberRuntimeManager,
  type RuntimeExecutorTokens,
} from "../../src/application/member-runtime/manager.js";
import { memberCleanupReceiptPath } from "../../src/application/member-runtime/cleanup-receipts.js";
import {
  memberRuntimeStatePath,
  readMemberRuntimeState,
} from "../../src/application/member-runtime/state.js";
import {
  stageImportSource,
  writeImportJob,
  writeImportJournal,
} from "../../src/application/member-runtime/conversation-import.js";
import {
  provisionMemberWorkspace,
  WorkspaceLayoutError,
} from "../../src/infrastructure/filesystem/workspace.js";

test("Company Runtime provisions one Member workspace with CODEX_HOME inside it", async () => {
  const root = await temporaryRuntime();
  const member = await provisionMemberWorkspace(root, "member-1");

  assert.equal(member.workspace, join(root, "members", "member-1", "workspace"));
  assert.equal(member.codexHome, join(member.workspace, ".codex"));
  assert.equal(member.codexHome.startsWith(member.workspace), true);
});

test("Member CODEX_HOME rejects auth.json instead of treating it as runtime state", async () => {
  const root = await temporaryRuntime();
  const layout = await provisionMemberWorkspace(root, "member-1");
  await writeFile(join(layout.codexHome, "auth.json"), "{}\n", "utf8");

  await assert.rejects(
    provisionMemberWorkspace(root, "member-1"),
    (error: unknown) => error instanceof WorkspaceLayoutError && error.code === "member_codex_home_contains_auth",
  );
});

test("concurrent starts share one App Server per Member", async () => {
  const root = await temporaryRuntime();
  let starts = 0;
  const manager = managerFor(root, {
    startProcess: async (workdir) => {
      starts += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return processResult(workdir, starts);
    },
  });

  const [first, second] = await Promise.all([
    manager.ensureMemberAppServer("member-1", { executorId: "executor-1" }),
    manager.ensureMemberAppServer("member-1", { executorId: "executor-1" }),
  ]);

  assert.equal(starts, 1);
  assert.equal(first.pid, second.pid);
  assert.equal(manager.listMemberAppServers().length, 1);
});

test("Member App Server activation stops and stays unavailable when the required plugin cannot be installed", async () => {
  const root = await temporaryRuntime();
  let stops = 0;
  const manager = managerFor(root, {
    installPlugin: async () => {
      throw new Error("plugin install failed");
    },
    stopProcess: async () => {
      stops += 1;
      return { terminated: true };
    },
  });

  await assert.rejects(
    manager.ensureMemberAppServer("member-1", { executorId: "executor-1" }),
    /plugin install failed/u,
  );
  assert.equal(stops, 1);
  assert.equal(manager.memberStatus("member-1"), null);
});

test("Member App Server activation retains process evidence when plugin failure cleanup is not confirmed", async () => {
  const root = await temporaryRuntime();
  const manager = managerFor(root, {
    installPlugin: async () => {
      throw new Error("plugin install failed");
    },
    stopProcess: async () => ({ terminated: false }),
  });

  await assert.rejects(
    manager.ensureMemberAppServer("member-1", { executorId: "executor-1" }),
    (error: unknown) => (
      error instanceof Error
      && "code" in error
      && error.code === "member_app_server_activation_cleanup_failed"
    ),
  );
  const failed = manager.memberStatus("member-1");
  assert.equal(failed?.state, "failed");
  assert.equal(failed?.pid, 101);
  assert.equal(failed?.socketPath, join(root, "members", "member-1", "workspace", ".socket-101"));
  await assert.rejects(
    manager.ensureMemberAppServer("member-1", { executorId: "executor-1" }),
    (error: unknown) => (
      error instanceof Error
      && "code" in error
      && error.code === "member_app_server_cleanup_required"
    ),
  );
});

test("plugin health drift fails and stops an already running Member App Server", async () => {
  const root = await temporaryRuntime();
  let stops = 0;
  const manager = managerFor(root, {
    verifyPlugin: async () => {
      throw new Error("plugin drift");
    },
    stopProcess: async () => {
      stops += 1;
      return { terminated: true };
    },
  });

  const running = await manager.ensureMemberAppServer(
    "member-1",
    { executorId: "executor-1" },
  );
  assert.equal(running.state, "running");
  assert.equal(running.plugin?.pluginId, "fields-core@fields");

  await manager.verifyMemberPlugins();

  assert.equal(stops, 1);
  assert.equal(manager.memberStatus("member-1")?.state, "failed");
  assert.equal(manager.memberStatus("member-1")?.plugin, null);
  assert.equal(manager.memberStatus("member-1")?.socketPath, null);
});

test("plugin health drift preserves pid and socket when stopping the running Member is not confirmed", async () => {
  const root = await temporaryRuntime();
  const manager = managerFor(root, {
    verifyPlugin: async () => {
      throw new Error("plugin drift");
    },
    stopProcess: async () => ({ terminated: false }),
  });
  const running = await manager.ensureMemberAppServer(
    "member-1",
    { executorId: "executor-1" },
  );

  await assert.rejects(
    manager.verifyMemberPlugins(),
    (error: unknown) => (
      error instanceof Error
      && "code" in error
      && error.code === "member_app_server_stop_failed"
    ),
  );

  const failed = manager.memberStatus("member-1");
  assert.equal(failed?.state, "failed");
  assert.equal(failed?.pid, running.pid);
  assert.equal(failed?.socketPath, running.socketPath);
  assert.equal(failed?.plugin, null);
});

test("persisted global Room Messages enablement fails health verification and stops the Member", async () => {
  const root = await temporaryRuntime();
  let stops = 0;
  const manager = managerFor(root, {
    stopProcess: async () => {
      stops += 1;
      return { terminated: true };
    },
  });
  await manager.ensureMemberAppServer("member-1", { executorId: "executor-1" });
  const layout = await provisionMemberWorkspace(root, "member-1");
  await writeFile(join(layout.codexHome, "config.toml"), [
    '[plugins."fields-core@fields".mcp_servers.fields_room_messages]',
    "enabled = true",
    "",
  ].join("\n"), "utf8");

  await manager.verifyMemberPlugins();

  assert.equal(stops, 1);
  assert.equal(manager.memberStatus("member-1")?.state, "failed");
  assert.equal(manager.memberStatus("member-1")?.pid, null);
  assert.equal(manager.memberStatus("member-1")?.socketPath, null);
});

test("same Agent-Room Thread is serial while different Room Threads run concurrently", async () => {
  const root = await temporaryRuntime();
  const completions = new Map<string, ReturnType<typeof deferred<void>>>();
  const started: string[] = [];
  let turnSequence = 0;
  const manager = managerFor(root, {
    runTurn: async (input) => {
      started.push(input.prompt);
      const completion = deferred<void>();
      completions.set(input.prompt, completion);
      const sequence = ++turnSequence;
      return {
        threadId: input.codexThreadId ?? `thread-${sequence}`,
        turnId: `turn-${sequence}`,
        completed: completion.promise.then(() => turnResult(input.codexThreadId ?? `thread-${sequence}`, `turn-${sequence}`)),
      };
    },
  });

  const first = manager.dispatchAgentRoomExecution(execution("execution-1", "same-thread", "room-1", "first"));
  const second = manager.dispatchAgentRoomExecution(execution("execution-2", "same-thread", "room-1", "second"));
  const otherRoom = manager.dispatchAgentRoomExecution(execution("execution-3", "other-thread", "room-2", "other"));
  await eventually(() => started.length === 2);
  assert.deepEqual(started.sort(), ["first", "other"]);

  completions.get("first")!.resolve();
  await eventually(() => started.includes("second"));
  completions.get("second")!.resolve();
  completions.get("other")!.resolve();
  await Promise.all([first, second, otherRoom]);
});

test("idempotency replays a completed execution without starting another turn", async () => {
  const root = await temporaryRuntime();
  let turns = 0;
  const manager = managerFor(root, {
    runTurn: async (input) => {
      turns += 1;
      return completedStream(input.codexThreadId ?? "thread-1", `turn-${turns}`);
    },
  });
  const input = execution("execution-1", "thread-1", "room-1", "hello");

  const first = await manager.dispatchAgentRoomExecution(input);
  const replay = await manager.dispatchAgentRoomExecution({ ...input, executionId: "execution-redelivery" });

  assert.equal(turns, 1);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.codexThreadId, first.codexThreadId);
});

test("Room MCP config is thread-scoped while Home turns receive no Room identity", async () => {
  const root = await temporaryRuntime();
  const configs: unknown[] = [];
  const manager = managerFor(root, {
    runTurn: async (input) => {
      configs.push(input.threadConfig);
      return completedStream(
        input.codexThreadId ?? `thread-${configs.length}`,
        `turn-${configs.length}`,
      );
    },
  });

  await manager.dispatchAgentRoomExecution(
    execution("execution-room-config", "room-thread-config", "room-1", "room"),
  );
  await manager.submitHomeTurn({ memberId: "member-1", prompt: "home" });

  assert.deepEqual(configs, [{
    plugins: {
      "fields-core@fields": {
        mcp_servers: {
          fields_room_messages: {
            enabled: true,
          },
        },
      },
    },
  }, null]);
});

test("Home completion emits one provider-neutral terminal notification", async () => {
  const root = await temporaryRuntime();
  const notifications: unknown[] = [];
  const manager = managerFor(root, {
    publishHomeTerminalNotification: async (event) => {
      notifications.push(event);
      return { accepted: true, activity_id: "activity-one" };
    },
    nowMs: () => 123,
  });
  await manager.ensureMemberAppServer("member-1", { executorId: "executor-1" });

  await manager.submitHomeTurn({ memberId: "member-1", prompt: "Inspect image\nprivately" });

  assert.deepEqual(notifications, [{
    event_id: "home-terminal:member-1:turn-default",
    recipient_actor_id: "member-1",
    thread_id: "thread-default",
    thread_title: "Inspect image",
    status: "completed",
    preview: "done",
    occurred_at_ms: 123,
  }]);
});

test("Home interrupted turns emit terminal notification without replacing the turn error", async () => {
  const root = await temporaryRuntime();
  const notifications: unknown[] = [];
  const turnError = Object.assign(new Error("turn interrupted"), { code: "turn_cancelled" });
  const manager = managerFor(root, {
    publishHomeTerminalNotification: async (event) => {
      notifications.push(event);
      return { accepted: true, activity_id: "activity-interrupted" };
    },
    runTurn: async (input) => {
      await input.onEvent?.({
        method: "turn/completed",
        payload: { turn: { status: "interrupted" } },
        message: {},
        requestId: null,
        respond: null,
        threadId: "thread-interrupted",
        turnId: "turn-interrupted",
        itemId: null,
        occurredAtMs: 321,
      });
      return {
        threadId: "thread-interrupted",
        turnId: "turn-interrupted",
        completed: Promise.reject(turnError),
      };
    },
  });
  await manager.ensureMemberAppServer("member-1", { executorId: "executor-1" });

  await assert.rejects(
    manager.submitHomeTurn({ memberId: "member-1", prompt: "Stop this" }),
    (error: unknown) => error === turnError,
  );
  assert.equal((notifications[0] as { status: string }).status, "interrupted");
  assert.equal((notifications[0] as { event_id: string }).event_id, "home-terminal:member-1:turn-interrupted");
});

test("Home image attachments are signature-checked and forwarded as native localImage inputs", async () => {
  const root = await temporaryRuntime();
  const localImagePaths: string[][] = [];
  const manager = managerFor(root, {
    runTurn: async (input) => {
      localImagePaths.push(input.localImagePaths ?? []);
      return completedStream("thread-image", "turn-image");
    },
  });
  await manager.ensureMemberAppServer("member-1", { executorId: "executor-1" });
  const uploadDirectory = join(root, "members", "member-1", "workspace", "Uploads");
  await mkdir(uploadDirectory, { recursive: true });
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const imagePath = join(uploadDirectory, "photo.png");
  await writeFile(imagePath, bytes);

  await manager.submitHomeTurn({
    memberId: "member-1",
    prompt: "",
    imageAttachments: [{
      attachment_id: "image-one",
      kind: "image",
      storage: "member_workspace",
      name: "photo.png",
      mime_type: "image/png",
      size_bytes: bytes.length,
      path: "Uploads/photo.png",
    }],
  });

  assert.deepEqual(localImagePaths, [[imagePath]]);
});

test("Home Builder turns forward native developer instructions to Codex", async () => {
  const root = await temporaryRuntime();
  const instructions: Array<string | null | undefined> = [];
  const workspaces: Array<{ cwd: string; roots: string[] }> = [];
  const manager = managerFor(root, {
    runTurn: async (input) => {
      instructions.push(input.developerInstructions);
      workspaces.push({ cwd: input.cwd, roots: input.runtimeWorkspaceRoots });
      await input.beforeTurnStart?.({ threadId: "thread-builder", resumed: false });
      return completedStream("thread-builder", "turn-builder");
    },
  });
  await manager.ensureMemberAppServer("member-1", { executorId: "executor-1" });

  await manager.submitHomeTurn({
    memberId: "member-1",
    prompt: "build",
    builderScope: { kind: "agent", topic_id: "topic-1" },
    developerInstructions: "Read Company assets but never mutate them.",
  });

  assert.deepEqual(instructions, ["Read Company assets but never mutate them."]);
  assert.deepEqual(manager.builderScope("member-1", "thread-builder"), {
    kind: "agent",
    topic_id: "topic-1",
  });
  const expectedWorkspace = join(
    root,
    "members",
    "member-1",
    "builders",
    "agent",
    "topic-1",
    "workspace",
  );
  assert.deepEqual(workspaces, [{
    cwd: expectedWorkspace,
    roots: [expectedWorkspace, join(root, "members", "member-1", ".runtime", "company-files")],
  }]);
  assert.equal(manager.builderWorkspace("member-1", "thread-builder"), expectedWorkspace);
  await access(expectedWorkspace);
});

test("Home Projects isolate turn cwd, persist assignment, and move whole conversations", async () => {
  const root = await temporaryRuntime();
  const turns: Array<{ cwd: string; roots: string[]; instructions: string | null | undefined }> = [];
  const resumes: Array<{ threadId: string; cwd: string }> = [];
  const manager = managerFor(root, {
    runTurn: async (input) => {
      turns.push({ cwd: input.cwd, roots: input.runtimeWorkspaceRoots, instructions: input.developerInstructions });
      return completedStream(input.codexThreadId ?? "thread-project", "turn-project");
    },
    resumeThread: async (input) => {
      resumes.push({ threadId: input.threadId, cwd: input.cwd });
      return { threadId: input.threadId };
    },
  });
  await manager.ensureMemberAppServer("member-1", { executorId: "executor-1" });
  const project = await manager.createHomeProject({ memberId: "member-1", name: "Research" });
  const workspace = join(root, "members", "member-1", "workspace", "projects", project.project_id);

  const submitted = await manager.submitHomeTurn({
    memberId: "member-1",
    projectId: project.project_id,
    prompt: "project work",
  });

  assert.equal(submitted.thread_id, "thread-project");
  assert.deepEqual(turns[0]?.cwd, workspace);
  assert.deepEqual(turns[0]?.roots[0], workspace);
  assert.match(turns[0]?.instructions ?? "", /current project directory/);
  assert.equal((await readMemberRuntimeState(await provisionMemberWorkspace(root, "member-1"))).threads[0]?.homeProjectId, project.project_id);

  assert.deepEqual(await manager.moveHomeThreadToProject({
    memberId: "member-1",
    threadId: submitted.thread_id,
    projectId: null,
  }), { root_thread_id: submitted.thread_id, project_id: null });
  assert.deepEqual(resumes, [{ threadId: submitted.thread_id, cwd: join(root, "members", "member-1", "workspace") }]);

  assert.deepEqual(await manager.deleteHomeProject({
    memberId: "member-1",
    projectId: project.project_id,
    confirmationName: project.name,
  }), { deleted: true, project_id: project.project_id });
  await assert.rejects(access(workspace), { code: "ENOENT" });
});

test("Home model settings stay Member-scoped and pass explicit turn overrides to Codex", async () => {
  const root = await temporaryRuntime();
  const turns: Array<{ model?: string | null; reasoningEffort?: string | null }> = [];
  const manager = managerFor(root, {
    runTurn: async (input) => {
      turns.push({
        model: input.model,
        reasoningEffort: input.reasoningEffort,
      });
      return completedStream(input.codexThreadId ?? "thread-home-model", "turn-home-model");
    },
    listModelOptions: async () => ({
      items: [{
        model: "gpt-5.4",
        displayName: "GPT-5.4",
        isDefault: true,
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: ["low", "medium", "high"],
      }],
      newThreadDefault: {
        model: "gpt-5.4",
        reasoningEffort: "medium",
      },
    }),
    readThreadSettings: async (input) => ({
      threadId: input.threadId,
      model: "gpt-5.4",
      reasoningEffort: "medium",
    }),
    updateThreadSettings: async (input) => ({
      threadId: input.threadId,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
    }),
  });

  await manager.ensureMemberAppServer("member-1", { executorId: "executor-1" });
  assert.deepEqual(await manager.listHomeModelOptions("member-1"), {
    items: [{
      model: "gpt-5.4",
      display_name: "GPT-5.4",
      is_default: true,
      default_reasoning_effort: "medium",
      supported_reasoning_efforts: ["low", "medium", "high"],
    }],
    new_thread_default: {
      model: "gpt-5.4",
      reasoning_effort: "medium",
    },
  });
  await manager.submitHomeTurn({
    memberId: "member-1",
    prompt: "home",
    model: "gpt-5.4",
    reasoningEffort: "high",
  });
  assert.deepEqual(turns, [{ model: "gpt-5.4", reasoningEffort: "high" }]);
  assert.deepEqual(await manager.readHomeThreadSettings("member-1", "thread-home-model"), {
    thread_id: "thread-home-model",
    model: "gpt-5.4",
    reasoning_effort: "medium",
  });
  assert.deepEqual(await manager.updateHomeThreadSettings({
    memberId: "member-1",
    threadId: "thread-home-model",
    model: "gpt-5.4",
    reasoningEffort: "high",
  }), {
    thread_id: "thread-home-model",
    model: "gpt-5.4",
    reasoning_effort: "high",
  });
});

test("Home list, search, read, and submit exclude persisted Room-mapped Codex Threads", async () => {
  const root = await temporaryRuntime();
  let readCalls = 0;
  let turnCalls = 0;
  const manager = managerFor(root, {
    runTurn: async (input) => {
      turnCalls += 1;
      return completedStream(input.codexThreadId ?? "thread-room", `turn-${turnCalls}`);
    },
    listThreads: async () => ({
      threads: [
        { id: "thread-room", name: "Room", status: { type: "idle" } },
        { id: "thread-home", name: "Home", status: { type: "idle" } },
      ],
      nextCursor: null,
      backwardsCursor: null,
    }),
    searchThreads: async () => ({
      results: [
        { thread: { id: "thread-room", cwd: join(root, "members", "member-1", "workspace") } },
        { thread: { id: "thread-home", cwd: join(root, "members", "member-1", "workspace") } },
      ],
      nextCursor: null,
      backwardsCursor: null,
    }),
    readThread: async (input) => {
      readCalls += 1;
      return { threadId: input.threadId, thread: { id: input.threadId, turns: [] } };
    },
  });
  await manager.dispatchAgentRoomExecution(
    execution("execution-home-isolation", "room-thread-home-isolation", "room-1", "room"),
  );

  const listedHomeThreads = await manager.listHomeThreads({ memberId: "member-1" });
  assert.deepEqual(listedHomeThreads.items.map((item) => item.thread_id), ["thread-home"]);
  assert.equal(listedHomeThreads.items[0]?.read_through, null);
  assert.deepEqual(
    (await manager.searchHomeThreads({
      memberId: "member-1",
      searchTerm: "thread",
    })).items.map((item) => item.thread_id),
    ["thread-home"],
  );
  await assert.rejects(
    manager.readHomeThread("member-1", "thread-room"),
    (error: unknown) => (
      error instanceof Error
      && "code" in error
      && error.code === "home_thread_room_mapped"
    ),
  );
  await assert.rejects(
    manager.submitHomeTurn({
      memberId: "member-1",
      threadId: "thread-room",
      prompt: "not-home",
    }),
    (error: unknown) => (
      error instanceof Error
      && "code" in error
      && error.code === "home_thread_room_mapped"
    ),
  );
  await assert.rejects(
    manager.submitHomeTurn({
      memberId: "member-1",
      prompt: "returned-room-thread",
    }),
    (error: unknown) => (
      error instanceof Error
      && "code" in error
      && error.code === "home_thread_room_mapped"
    ),
  );
  assert.equal(readCalls, 0);
  assert.equal(turnCalls, 2);
  assert.deepEqual(
    manager.memberStatus("member-1")?.threads.map((thread) => ({
      roomId: thread.roomId,
      threadId: thread.threadId,
    })),
    [{ roomId: "room-1", threadId: "thread-room" }],
  );
});

test("Home conversation import creates an immediately resumable native Thread with imported history", async () => {
  const root = await temporaryRuntime();
  const created: string[] = [];
  const manager = managerFor(root, {
    startThread: async () => {
      const threadId = `import-thread-${created.length + 1}`;
      created.push(threadId);
      return { threadId };
    },
    injectThreadItems: async () => undefined,
    forkThread: async (input) => ({ threadId: `${input.parentThreadId}-fork`, parentThreadId: input.parentThreadId }),
    deleteThread: async (input) => ({ threadId: input.threadId, deleted: true as const }),
    listThreads: async (input) => ({
      threads: created.map((id) => ({
        id,
        cwd: input.cwd,
        name: null,
        preview: null,
        createdAt: 100,
        updatedAt: 100,
        status: { type: "idle" },
      })),
      nextCursor: null,
      backwardsCursor: null,
    }),
    readThread: async (input) => ({ threadId: input.threadId, thread: { id: input.threadId, turns: [] } }),
  });
  await manager.ensureMemberAppServer("member-1", { executorId: "executor-1" });
  const payload = Buffer.from(JSON.stringify([{
    id: "chat-1",
    title: "Imported chat",
    create_time: 10,
    update_time: 20,
    current_node: "assistant-1",
    mapping: {
      user_1: { parent: null, children: ["assistant-1"], message: { author: { role: "user" }, content: { parts: ["Hello"] }, create_time: 10 } },
      "assistant-1": { parent: "user_1", children: [], message: { author: { role: "assistant" }, content: { parts: ["Hi"] }, create_time: 11 } },
    },
  }]));
  const job = await manager.createHomeConversationImport({
    memberId: "member-1",
    name: "conversations.json",
    body: asyncBytes(payload),
  });
  let completed = await manager.readHomeConversationImport("member-1", job.import_id);
  for (let attempt = 0; attempt < 50 && completed.status !== "succeeded" && completed.status !== "failed"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    completed = await manager.readHomeConversationImport("member-1", job.import_id);
  }
  assert.equal(completed.status, "succeeded");
  const listed = await manager.listHomeThreads({ memberId: "member-1" });
  assert.equal(listed.items[0]?.origin?.kind, "imported");
  assert.equal(listed.items[0]?.title, "Imported chat");
  const read = await manager.readHomeThread("member-1", created[0]!);
  assert.deepEqual(read.turns.map((turn) => turn.snapshot.narrative_items[0]?.type), ["user_message", "assistant_message"]);
  assert.ok(read.turns.every((turn) => turn.origin === "imported"));
});

test("Runtime activation rolls back and resumes an interrupted Home conversation import", async () => {
  const root = await temporaryRuntime();
  const layout = await provisionMemberWorkspace(root, "member-1");
  const payload = Buffer.from(JSON.stringify([{
    id: "recovered-chat",
    title: "Recovered chat",
    create_time: 10,
    update_time: 20,
    current_node: "assistant-1",
    mapping: {
      user_1: { parent: null, children: ["assistant-1"], message: { author: { role: "user" }, content: { parts: ["Hello"] }, create_time: 10 } },
      "assistant-1": { parent: "user_1", children: [], message: { author: { role: "assistant" }, content: { parts: ["Hi"] }, create_time: 11 } },
    },
  }]));
  const job = {
    import_id: "import_recovery-test",
    status: "importing" as const,
    total_conversations: 1,
    processed_conversations: 0,
    skipped_conversations: 0,
    created_threads: 1,
    error_code: null,
    created_at_ms: 1,
    completed_at_ms: null,
  };
  await stageImportSource(layout, job.import_id, "conversations.json", payload);
  await writeImportJob(layout, job);
  await writeImportJournal(layout, job.import_id, ["stale-thread"]);
  const deleted: string[] = [];
  const manager = managerFor(root, {
    deleteThread: async (input) => { deleted.push(input.threadId); return { threadId: input.threadId, deleted: true as const }; },
    startThread: async () => ({ threadId: "recovered-thread" }),
    injectThreadItems: async () => undefined,
    listThreads: async (input) => ({
      threads: [{ id: "recovered-thread", cwd: input.cwd, createdAt: 100, updatedAt: 100, status: { type: "idle" } }],
      nextCursor: null,
      backwardsCursor: null,
    }),
  });

  await manager.ensureMemberAppServer("member-1", { executorId: "executor-1" });
  let recovered = await manager.readHomeConversationImport("member-1", job.import_id);
  for (let attempt = 0; attempt < 50 && recovered.status !== "succeeded" && recovered.status !== "failed"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    recovered = await manager.readHomeConversationImport("member-1", job.import_id);
  }
  assert.equal(recovered.status, "succeeded");
  assert.deepEqual(deleted, ["stale-thread"]);
  assert.equal((await manager.listHomeThreads({ memberId: "member-1" })).items[0]?.title, "Recovered chat");
});

test("Home edit, regenerate, and explicit fork use native anchors and replay one immutable branch", async () => {
  const root = await temporaryRuntime();
  const turnInputs: Array<{
    prompt: string;
    forkParentThreadId?: string | null;
    forkBeforeTurnId?: string | null;
  }> = [];
  const nativeForks: Array<{ parentThreadId: string; lastTurnId?: string | null }> = [];
  let generated = 0;
  const manager = managerFor(root, {
    runTurn: async (input) => {
      turnInputs.push({
        prompt: input.prompt,
        forkParentThreadId: input.forkParentThreadId,
        forkBeforeTurnId: input.forkBeforeTurnId,
      });
      if (!input.forkParentThreadId) {
        return completedStream("thread-root", "turn-root");
      }
      generated += 1;
      return completedStream(`thread-generated-${generated}`, `turn-generated-${generated}`);
    },
    readThread: async (input) => ({
      threadId: input.threadId,
      thread: homeCodexThread(input.threadId),
    }),
    forkThread: async (input) => {
      nativeForks.push({
        parentThreadId: input.parentThreadId,
        lastTurnId: input.lastTurnId,
      });
      return { threadId: "thread-explicit", parentThreadId: input.parentThreadId };
    },
  });

  await manager.ensureMemberAppServer("member-1", { executorId: "executor-1" });
  await manager.submitHomeTurn({ memberId: "member-1", prompt: "original" });
  const edited = await manager.forkHomeThread({
    memberId: "member-1",
    thread_id: "thread-root",
    anchor_turn_id: "turn-root",
    kind: "edited_user_message",
    prompt: "edited",
    expected_revision: 1,
    idempotency_key: "home-edit-1",
  });
  assert.deepEqual(edited, {
    submitted: true,
    root_thread_id: "thread-root",
    source_thread_id: "thread-root",
    thread_id: "thread-generated-1",
    turn_id: "turn-generated-1",
    revision: 2,
  });
  assert.deepEqual(
    await manager.forkHomeThread({
      memberId: "member-1",
      thread_id: "thread-root",
      anchor_turn_id: "turn-root",
      kind: "edited_user_message",
      prompt: "edited",
      expected_revision: 1,
      idempotency_key: "home-edit-1",
    }),
    edited,
  );
  assert.equal(generated, 1);
  await assert.rejects(
    manager.forkHomeThread({
      memberId: "member-1",
      thread_id: "thread-root",
      anchor_turn_id: "turn-root",
      kind: "edited_user_message",
      prompt: "different",
      expected_revision: 1,
      idempotency_key: "home-edit-1",
    }),
    hasRuntimeCode("home_mutation_idempotency_conflict"),
  );

  const regenerated = await manager.forkHomeThread({
    memberId: "member-1",
    thread_id: "thread-generated-1",
    anchor_turn_id: "turn-root",
    kind: "regenerated_assistant",
    expected_revision: 2,
    idempotency_key: "home-regenerate-1",
  });
  assert.equal(regenerated.thread_id, "thread-generated-2");
  assert.equal(regenerated.revision, 3);
  assert.deepEqual(turnInputs.slice(1), [
    {
      prompt: "edited",
      forkParentThreadId: "thread-root",
      forkBeforeTurnId: "turn-root",
    },
    {
      prompt: "original",
      forkParentThreadId: "thread-generated-1",
      forkBeforeTurnId: "turn-root",
    },
  ]);

  const explicit = await manager.forkHomeThread({
    memberId: "member-1",
    thread_id: "thread-generated-2",
    anchor_turn_id: "turn-root",
    kind: "explicit",
    expected_revision: 3,
    idempotency_key: "home-explicit-1",
  });
  assert.equal(explicit.thread_id, "thread-explicit");
  assert.equal(explicit.turn_id, null);
  assert.deepEqual(nativeForks, [{
    parentThreadId: "thread-generated-2",
    lastTurnId: "turn-root",
  }]);

  const read = await manager.readHomeThread("member-1", "thread-explicit");
  assert.equal(read.selected_thread_id, "thread-explicit");
  assert.equal(read.revision, 4);
  assert.deepEqual(
    read.branches.map((branch) => ({
      thread_id: branch.thread_id,
      source_thread_id: branch.source_thread_id,
      kind: branch.kind,
      selected: branch.selected,
    })),
    [
      { thread_id: "thread-root", source_thread_id: null, kind: "root", selected: false },
      { thread_id: "thread-generated-1", source_thread_id: "thread-root", kind: "edited_user_message", selected: false },
      { thread_id: "thread-generated-2", source_thread_id: "thread-generated-1", kind: "regenerated_assistant", selected: false },
      { thread_id: "thread-explicit", source_thread_id: "thread-generated-2", kind: "explicit", selected: true },
    ],
  );
  assert.deepEqual(
    [...new Set(read.turns.map((turn) => turn.thread_id))],
    ["thread-root", "thread-generated-1", "thread-generated-2", "thread-explicit"],
  );
});

test("Home root deletion replays without ghost metadata and leaves child branches selectable", async () => {
  const root = await temporaryRuntime();
  const deleted: string[] = [];
  let generated = 0;
  const manager = managerFor(root, {
    runTurn: async (input) => {
      if (!input.forkParentThreadId) return completedStream("thread-root", "turn-root");
      generated += 1;
      return completedStream(`thread-child-${generated}`, `turn-child-${generated}`);
    },
    readThread: async (input) => ({
      threadId: input.threadId,
      thread: homeCodexThread(input.threadId),
    }),
    deleteThread: async (input) => {
      deleted.push(input.threadId);
      return { threadId: input.threadId, deleted: true };
    },
  });
  await manager.ensureMemberAppServer("member-1", { executorId: "executor-1" });
  await manager.submitHomeTurn({ memberId: "member-1", prompt: "original" });
  await manager.forkHomeThread({
    memberId: "member-1",
    thread_id: "thread-root",
    anchor_turn_id: "turn-root",
    kind: "edited_user_message",
    prompt: "child",
    expected_revision: 1,
    idempotency_key: "home-child-1",
  });
  await manager.selectHomeThread({
    memberId: "member-1",
    rootThreadId: "thread-root",
    threadId: "thread-root",
    expectedRevision: 2,
    idempotencyKey: "home-select-root",
  });

  const deletion = await manager.deleteHomeThread({
    memberId: "member-1",
    threadId: "thread-root",
    confirmation: "thread-root",
    expectedRevision: 3,
    idempotencyKey: "home-delete-root",
  });
  assert.deepEqual(deletion, { thread_id: "thread-root", deleted: true });
  assert.deepEqual(
    await manager.deleteHomeThread({
      memberId: "member-1",
      threadId: "thread-root",
      confirmation: "thread-root",
      expectedRevision: 3,
      idempotencyKey: "home-delete-root",
    }),
    deletion,
  );
  assert.deepEqual(deleted, ["thread-root"]);

  const afterDelete = await manager.readHomeThread("member-1", "thread-child-1");
  assert.deepEqual(afterDelete.branches.map((branch) => branch.thread_id), ["thread-child-1"]);
  assert.equal(afterDelete.selected_thread_id, "thread-child-1");
  assert.equal(afterDelete.revision, 4);
  const selected = await manager.selectHomeThread({
    memberId: "member-1",
    rootThreadId: "thread-root",
    threadId: "thread-child-1",
    expectedRevision: 4,
    idempotencyKey: "home-select-child",
  });
  assert.equal(selected.selected_thread_id, "thread-child-1");
  assert.equal(selected.revision, 5);
  assert.deepEqual(
    manager.memberStatus("member-1")?.threads.map((thread) => thread.threadId),
    ["thread-child-1"],
  );
});

test("new Room Thread mapping is durable before the Codex Turn starts", async () => {
  const root = await temporaryRuntime();
  let turnStarted = false;
  const manager = managerFor(root, {
    runTurn: async (input) => {
      await input.beforeTurnStart?.({ threadId: "thread-durable", resumed: false });
      const layout = await provisionMemberWorkspace(root, "member-1");
      const persisted = await readMemberRuntimeState(layout);
      assert.deepEqual(persisted.threads, [{
        key: "room-thread-durable",
        roomId: "room-1",
        roomContextKind: "agent_execution",
        threadId: "thread-durable",
        workspaceRoots: [join(root, "members", "member-1", "workspace")],
      }]);
      turnStarted = true;
      return completedStream("thread-durable", "turn-durable");
    },
  });

  await manager.dispatchAgentRoomExecution(
    execution("execution-durable", "room-thread-durable", "room-1", "hello"),
  );

  assert.equal(turnStarted, true);
  assert.deepEqual(manager.resolveRoomContext("member-1", "thread-durable"), {
    accessMode: "agent_execution",
    memberId: "member-1",
    roomId: "room-1",
    threadId: "thread-durable",
  });
});

test("private Room chat uses the Human workspace and persists MCP context before the first Turn", async () => {
  const root = await temporaryRuntime();
  let observedRoots: string[] = [];
  let observedConfig: Record<string, unknown> | null | undefined;
  const manager = managerFor(root, {
    runTurn: async (input) => {
      observedRoots = input.runtimeWorkspaceRoots;
      observedConfig = input.threadConfig;
      await input.beforeTurnStart?.({ threadId: "thread-side", resumed: false });
      assert.deepEqual(manager.resolveRoomContext("member-1", "thread-side"), {
        accessMode: "human_side_chat",
        memberId: "member-1",
        roomId: "room-1",
        threadId: "thread-side",
      });
      return completedStream("thread-side", "turn-side");
    },
  });
  await manager.ensureMemberAppServer("member-1", { executorId: "executor-1" });

  const result = await manager.submitRoomSideChatTurn({
    memberId: "member-1",
    roomId: "room-1",
    prompt: "summarize",
    developerInstructions: "private Room chat",
  });

  assert.equal(result.thread_id, "thread-side");
  assert.deepEqual(observedRoots, [
    join(root, "members", "member-1", "workspace"),
    join(root, "members", "member-1", ".runtime", "company-files"),
  ]);
  assert.equal(JSON.stringify(observedConfig).includes("fields_room_messages"), true);
  const persisted = await readMemberRuntimeState(await provisionMemberWorkspace(root, "member-1"));
  assert.deepEqual(persisted.threads, [{
    key: "room-side:room-1",
    roomId: "room-1",
    roomContextKind: "human_side_chat",
    threadId: "thread-side",
    workspaceRoots: [join(root, "members", "member-1", "workspace")],
  }]);
});

test("Room Thread mapping persistence failure leaves the new Codex Thread unused", async () => {
  const root = await temporaryRuntime();
  let turnStarted = false;
  const manager = managerFor(root, {
    runTurn: async (input) => {
      await input.beforeTurnStart?.({ threadId: "thread-unused", resumed: false });
      turnStarted = true;
      return completedStream("thread-unused", "turn-unused");
    },
  });
  await manager.ensureMemberAppServer("member-1", { executorId: "executor-1" });
  const layout = await provisionMemberWorkspace(root, "member-1");
  const statePath = memberRuntimeStatePath(layout);
  await rm(statePath, { force: true });
  await mkdir(statePath);

  await assert.rejects(
    manager.dispatchAgentRoomExecution(
      execution("execution-persist-failed", "room-thread-failed", "room-1", "hello"),
    ),
    (error: unknown) => (
      error instanceof Error
      && "code" in error
      && error.code === "mcp_room_context_persist_failed"
    ),
  );
  assert.equal(turnStarted, false);
  assert.equal(manager.memberStatus("member-1")?.threads.length, 0);
});

test("Room Context resolution rejects unmapped, Home, and conflicting Thread mappings", async () => {
  const root = await temporaryRuntime();
  const manager = managerFor(root, {
    runTurn: async () => completedStream("thread-shared", "turn-shared"),
  });
  await manager.ensureMemberAppServer("member-1", { executorId: "executor-1" });
  assert.throws(
    () => manager.resolveRoomContext("member-1", "thread-unmapped"),
    (error: unknown) => (
      error instanceof Error
      && "code" in error
      && error.code === "mcp_room_context_unavailable"
    ),
  );

  await manager.submitHomeTurn({ memberId: "member-1", prompt: "home" });
  assert.throws(
    () => manager.resolveRoomContext("member-1", "thread-shared"),
    (error: unknown) => (
      error instanceof Error
      && "code" in error
      && error.code === "mcp_room_context_unavailable"
    ),
  );

  await manager.dispatchAgentRoomExecution(
    execution("execution-conflict", "room-thread-conflict", "room-1", "room"),
  );
  assert.throws(
    () => manager.resolveRoomContext("member-1", "thread-shared"),
    (error: unknown) => (
      error instanceof Error
      && "code" in error
      && error.code === "mcp_room_context_ambiguous"
    ),
  );
});

test("blank final answers complete silently without publishing markdown", async () => {
  const root = await temporaryRuntime();
  const manager = managerFor(root, {
    runTurn: async (input) => Promise.resolve({
      threadId: input.codexThreadId ?? "thread-silent",
      turnId: "turn-silent",
      completed: Promise.resolve({
        ...turnResult(input.codexThreadId ?? "thread-silent", "turn-silent"),
        agentText: " \n\t ",
      }),
    }),
  });

  const result = await manager.dispatchAgentRoomExecution({
    ...execution("execution-silent", "room-thread-silent", "room-1", "hello"),
    completion: {
      cascadeId: "cascade-silent",
      consumedThroughSequence: 1,
    },
  });

  assert.equal(result.agentText, " \n\t ");
  assert.ok(result.completion);
  assert.equal("final_answer_markdown" in result.completion, false);
});

test("idle sweep stops a Member App Server only after 30 minutes without active executions", async () => {
  const root = await temporaryRuntime();
  let now = 100;
  let stops = 0;
  const manager = managerFor(root, {
    nowMs: () => now,
    stopProcess: async () => {
      stops += 1;
      return { terminated: true };
    },
  });
  await manager.ensureMemberAppServer("member-1", { executorId: "executor-1" });

  now += DEFAULT_MEMBER_IDLE_TIMEOUT_MS - 1;
  assert.deepEqual(await manager.stopIdleMembers(), []);
  now += 1;
  assert.deepEqual(await manager.stopIdleMembers(), ["member-1"]);
  assert.equal(stops, 1);
  assert.equal(manager.memberStatus("member-1")?.state, "stopped");
});

test("first unauthorized turn marks every Member using that credential auth_required", async () => {
  const root = await temporaryRuntime();
  const unavailable: Array<{ executorId: string; credentialVersion: number }> = [];
  const manager = managerFor(root, {
    onExecutorUnauthorized: (input) => {
      unavailable.push(input);
    },
    publishAgentRoomActivity: async (event) => ({
      accepted: true,
      event_id: event.event_id,
      duplicate: false,
      interaction_id: null,
    }),
    runTurn: async (input) => {
      await input.onEvent?.({
        method: "turn/completed",
        payload: {
          turn: {
            error: { codexErrorInfo: "unauthorized" },
          },
        },
        message: {},
        requestId: null,
        respond: null,
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: null,
        occurredAtMs: 100,
      });
      return completedStream("thread-1", "turn-1");
    },
  });

  await manager.dispatchAgentRoomExecution(execution(
    "execution-unauthorized",
    "room-thread",
    "room-1",
    "hello",
  ));

  assert.equal(manager.memberStatus("member-1")?.state, "auth_required");
  assert.deepEqual(unavailable, [{ executorId: "executor-1", credentialVersion: 1 }]);
});

test("Executor switch drains, restarts, and resumes exactly the Backend-authoritative Threads", async () => {
  const root = await temporaryRuntime();
  const resumed: string[] = [];
  const resumedConfigs: unknown[] = [];
  let processSequence = 0;
  const manager = managerFor(root, {
    startProcess: async (workdir) => processResult(workdir, ++processSequence),
    runTurn: async (input) => completedStream(input.codexThreadId ?? `thread-${input.prompt}`, "turn-1"),
    resumeThread: async (input) => {
      resumed.push(input.threadId);
      resumedConfigs.push(input.threadConfig);
      return { threadId: input.threadId };
    },
  });
  await manager.dispatchAgentRoomExecution(execution("execution-1", "room-thread-1", "room-1", "one"));
  await manager.dispatchAgentRoomExecution(execution("execution-2", "room-thread-2", "room-2", "two"));

  const result = await manager.switchMemberExecutor(
    "member-1",
    { executorId: "executor-2" },
    ["thread-two"],
  );

  assert.deepEqual(result, {
    memberId: "member-1",
    previousExecutorId: "executor-1",
    targetExecutorId: "executor-2",
    switched: true,
    rolledBack: false,
    threadIdsUnchanged: true,
    resumedThreadIds: ["thread-two"],
    errorCode: null,
  });
  assert.deepEqual(resumed, ["thread-two"]);
  assert.deepEqual(resumedConfigs, [{
    plugins: {
      "fields-core@fields": {
        mcp_servers: {
          fields_room_messages: {
            enabled: true,
          },
        },
      },
    },
  }]);
  assert.equal(manager.memberStatus("member-1")?.executorId, "executor-2");
  await assert.rejects(
    manager.submitHomeTurn({
      memberId: "member-1",
      threadId: "thread-two",
      prompt: "not-home",
    }),
    (error: unknown) => (
      error instanceof Error
      && "code" in error
      && error.code === "home_thread_room_mapped"
    ),
  );
});

test("Runtime restart restores Thread mappings and completed execution idempotency from the Company volume", async () => {
  const root = await temporaryRuntime();
  let turns = 0;
  const first = managerFor(root, {
    runTurn: async (input) => {
      turns += 1;
      return completedStream(input.codexThreadId ?? "thread-persisted", "turn-persisted");
    },
  });
  const input = {
    ...execution("execution-persisted", "room-thread-persisted", "room-1", "one"),
    completion: {
      cascadeId: "cascade-1",
      consumedThroughSequence: 7,
      completedAtMs: () => 123,
    },
  };
  const completed = await first.dispatchAgentRoomExecution(input);
  assert.equal(completed.completion?.final_answer_markdown, "done");
  assert.equal(completed.completionPending, true);
  await first.shutdown();
  const persistedAfterShutdown = await readMemberRuntimeState(
    await provisionMemberWorkspace(root, "member-1"),
  );
  assert.deepEqual(
    persistedAfterShutdown.executions.map((result) => result.idempotencyKey),
    [input.idempotencyKey],
  );

  const resumed: string[] = [];
  const restarted = managerFor(root, {
    runTurn: async (turn) => {
      turns += 1;
      return completedStream(turn.codexThreadId ?? "unexpected-thread", "unexpected-turn");
    },
    resumeThread: async (thread) => {
      resumed.push(thread.threadId);
      return { threadId: thread.threadId };
    },
  });
  await restarted.ensureMemberAppServer("member-1", { executorId: "executor-1" });
  await assert.rejects(
    restarted.submitHomeTurn({
      memberId: "member-1",
      threadId: "thread-persisted",
      prompt: "not-home",
    }),
    (error: unknown) => (
      error instanceof Error
      && "code" in error
      && error.code === "home_thread_room_mapped"
    ),
  );
  const pending = await restarted.pendingAgentRoomExecutionCompletions();
  assert.equal(pending.length, 1);
  const replay = await restarted.dispatchAgentRoomExecution({
    ...input,
    executionId: "redelivered-execution",
  });

  assert.deepEqual(resumed, ["thread-persisted"]);
  assert.equal(replay.replayed, true);
  assert.equal(replay.codexThreadId, "thread-persisted");
  assert.equal(replay.completion?.final_answer_markdown, "done");
  assert.deepEqual(pending, [{
    memberId: "member-1",
    completion: replay.completion,
  }]);
  assert.equal(turns, 1);
});

test("Thread resume failure after App Server start stops the process and leaves no registered orphan", async () => {
  const root = await temporaryRuntime();
  const first = managerFor(root, {
    runTurn: async () => completedStream("thread-persisted", "turn-persisted"),
  });
  await first.dispatchAgentRoomExecution(
    execution("execution-resume-cleanup", "room-thread-resume-cleanup", "room-1", "one"),
  );
  await first.shutdown();

  let stops = 0;
  const restarted = managerFor(root, {
    resumeThread: async () => {
      const error = new Error("resume failed") as Error & { code: string };
      error.code = "thread_resume_failed";
      throw error;
    },
    stopProcess: async () => {
      stops += 1;
      return { terminated: true };
    },
  });

  await assert.rejects(
    restarted.ensureMemberAppServer("member-1", { executorId: "executor-1" }),
    (error: unknown) => (
      error instanceof Error
      && "code" in error
      && error.code === "thread_resume_failed"
    ),
  );
  assert.equal(stops, 1);
  assert.equal(restarted.memberStatus("member-1"), null);
});

test("Runtime state drops legacy execution snapshots with outputMessages", async () => {
  const root = await temporaryRuntime();
  const layout = await provisionMemberWorkspace(root, "member-1");
  await writeFile(
    join(layout.codexHome, "fields-runtime-state.json"),
    `${JSON.stringify({
      version: 1,
      threads: [],
      executions: [{
        executionId: "legacy-execution",
        idempotencyKey: "legacy-key",
        memberId: "member-1",
        roomId: "room-1",
        agentRoomThreadKey: "room-1\u0000member-1",
        codexThreadId: "thread-1",
        codexTurnId: "turn-1",
        completed: true,
        agentText: "legacy",
        outputMessages: [],
        completion: null,
        completionPending: false,
        replayed: false,
      }],
      pendingCompletions: [],
    }, null, 2)}\n`,
    "utf8",
  );

  const state = await readMemberRuntimeState(layout);
  assert.deepEqual(state.executions, []);
});

test("Executor switch after Runtime restart returns every Backend-authoritative persisted Thread id", async () => {
  const root = await temporaryRuntime();
  const first = managerFor(root, {
    runTurn: async (input) => completedStream(
      input.codexThreadId ?? `thread-${input.prompt}`,
      `turn-${input.prompt}`,
    ),
  });
  await first.dispatchAgentRoomExecution(execution("execution-restart-1", "room-thread-1", "room-1", "one"));
  await first.dispatchAgentRoomExecution(execution("execution-restart-2", "room-thread-2", "room-2", "two"));
  await first.shutdown();

  const resumed: string[] = [];
  const restarted = managerFor(root, {
    resumeThread: async (input) => {
      resumed.push(input.threadId);
      return { threadId: input.threadId };
    },
  });
  const result = await restarted.switchMemberExecutor(
    "member-1",
    { executorId: "executor-2" },
    ["thread-one", "thread-two"],
  );

  assert.equal(result.switched, true);
  assert.deepEqual(result.resumedThreadIds, ["thread-one", "thread-two"]);
  assert.deepEqual(resumed, ["thread-one", "thread-two"]);
});

test("failed Executor switch restores the previous Executor and original Threads", async () => {
  const root = await temporaryRuntime();
  const logins: string[] = [];
  const resumed: string[] = [];
  const manager = managerFor(root, {
    login: async (_socket, tokens) => {
      logins.push(tokens.executor_id);
      if (tokens.executor_id === "executor-2") {
        const error = new Error("target rejected") as Error & { code: string };
        error.code = "executor_auth_required";
        throw error;
      }
    },
    runTurn: async (input) => completedStream(input.codexThreadId ?? "thread-original", "turn-1"),
    resumeThread: async (input) => {
      resumed.push(`${input.threadId}:${manager.memberStatus("member-1")?.executorId ?? "starting"}`);
      return { threadId: input.threadId };
    },
  });
  await manager.dispatchAgentRoomExecution(execution("execution-1", "room-thread-1", "room-1", "one"));

  const result = await manager.switchMemberExecutor("member-1", { executorId: "executor-2" });

  assert.equal(result.switched, false);
  assert.equal(result.rolledBack, true);
  assert.equal(result.threadIdsUnchanged, true);
  assert.equal(result.errorCode, "executor_auth_required");
  assert.deepEqual(logins, ["executor-1", "executor-2", "executor-1"]);
  assert.equal(resumed.length, 1);
  assert.equal(manager.memberStatus("member-1")?.executorId, "executor-1");
});

test("failed target Thread resume stops the replacement App Server before rollback", async () => {
  const root = await temporaryRuntime();
  let processSequence = 0;
  let resumeCalls = 0;
  const stoppedPids: number[] = [];
  const manager = managerFor(root, {
    startProcess: async (workdir) => processResult(workdir, ++processSequence),
    stopProcess: async (_workdir, options) => {
      if (options?.expectedPid !== undefined) stoppedPids.push(options.expectedPid);
      return { terminated: true };
    },
    runTurn: async (input) => completedStream(input.codexThreadId ?? "thread-original", "turn-1"),
    resumeThread: async (input) => {
      resumeCalls += 1;
      if (resumeCalls === 1) {
        const error = new Error("target resume failed") as Error & { code: string };
        error.code = "thread_resume_failed";
        throw error;
      }
      return { threadId: input.threadId };
    },
  });
  await manager.dispatchAgentRoomExecution(execution("execution-1", "room-thread-1", "room-1", "one"));

  const result = await manager.switchMemberExecutor("member-1", { executorId: "executor-2" });

  assert.equal(result.switched, false);
  assert.equal(result.rolledBack, true);
  assert.equal(result.errorCode, "thread_resume_failed");
  assert.deepEqual(stoppedPids, [1, 2]);
  assert.equal(manager.memberStatus("member-1")?.executorId, "executor-1");
});

test("Executor switching pauses newly submitted turns until the original Threads resume", async () => {
  const root = await temporaryRuntime();
  const resumeGate = deferred<void>();
  const manager = managerFor(root, {
    runTurn: async (input) => completedStream(input.codexThreadId ?? "thread-original", "turn-1"),
    resumeThread: async (input) => {
      await resumeGate.promise;
      return { threadId: input.threadId };
    },
  });
  await manager.dispatchAgentRoomExecution(execution("execution-1", "room-thread-1", "room-1", "one"));

  const switching = manager.switchMemberExecutor("member-1", { executorId: "executor-2" });
  await eventually(() => manager.memberStatus("member-1")?.state === "stopped");
  await assert.rejects(
    manager.dispatchAgentRoomExecution(execution("execution-new", "room-thread-2", "room-2", "new")),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "member_executor_switching",
  );
  resumeGate.resolve();
  assert.equal((await switching).switched, true);
});

test("Executor switching drains turns accepted before switching and resumes their final Thread ids", async () => {
  const root = await temporaryRuntime();
  const firstTurnGate = deferred<void>();
  const started: string[] = [];
  const resumed: string[] = [];
  const manager = managerFor(root, {
    runTurn: async (input) => {
      started.push(input.prompt);
      if (input.prompt === "first") await firstTurnGate.promise;
      return completedStream(input.codexThreadId ?? `thread-${input.prompt}`, `turn-${input.prompt}`);
    },
    resumeThread: async (input) => {
      resumed.push(input.threadId);
      return { threadId: input.threadId };
    },
  });

  const first = manager.dispatchAgentRoomExecution(
    execution("execution-first", "room-thread-1", "room-1", "first"),
  );
  const queued = manager.dispatchAgentRoomExecution(
    execution("execution-queued", "room-thread-1", "room-1", "queued"),
  );
  await eventually(() => started.includes("first"));
  const switching = manager.switchMemberExecutor("member-1", { executorId: "executor-2" });
  firstTurnGate.resolve();

  await Promise.all([first, queued]);
  const result = await switching;
  assert.deepEqual(started, ["first", "queued"]);
  assert.equal(result.switched, true);
  assert.deepEqual(result.resumedThreadIds, ["thread-first"]);
  assert.deepEqual(resumed, ["thread-first"]);
});

test("Company proxy switching drains and resumes running Members with the current proxy environment", async () => {
  const root = await temporaryRuntime();
  let proxyUrl: string | undefined;
  let pid = 0;
  const starts: Array<string | undefined> = [];
  const manager = managerFor(root, {
    proxyEnv: () => ({
      HTTPS_PROXY: proxyUrl,
      NO_PROXY: "localhost,127.0.0.1,::1",
    }),
    startProcess: async (workdir, options) => {
      starts.push(options.secretEnv?.HTTPS_PROXY);
      return processResult(workdir, ++pid);
    },
    runTurn: async (input) => completedStream(
      input.codexThreadId ?? "thread-original",
      "turn-1",
    ),
  });
  await manager.dispatchAgentRoomExecution(
    execution("execution-proxy", "room-thread-1", "room-1", "one"),
  );

  await manager.prepareCompanyProxyChange();
  assert.equal(manager.memberStatus("member-1")?.state, "stopped");
  proxyUrl = "http://proxy.internal:8080";
  await manager.activateCompanyProxyChange();

  assert.deepEqual(starts, [undefined, "http://proxy.internal:8080"]);
  assert.equal(manager.memberStatus("member-1")?.state, "running");
  assert.equal(manager.memberStatus("member-1")?.threads[0]?.threadId, "thread-original");
});

test("token refreshes are mutually exclusive per Executor across Member App Servers", async () => {
  const root = await temporaryRuntime();
  const refreshGate = deferred<void>();
  let refreshCalls = 0;
  let refreshHandlers: Array<() => Promise<unknown>> = [];
  const manager = managerFor(root, {
    issueTokens: async (input) => {
      if (input.reason === "app_server_refresh") {
        refreshCalls += 1;
        await refreshGate.promise;
      }
      return tokens(input.executorId, input.previousCredentialVersion ?? 1);
    },
    runTurn: async (input) => {
      refreshHandlers.push(() => input.onChatgptAuthTokensRefresh({ reason: "unauthorized" }));
      if (refreshHandlers.length === 2) {
        const [first, second] = refreshHandlers;
        const both = Promise.all([first!(), second!()]);
        await eventually(() => refreshCalls === 1);
        refreshGate.resolve();
        await both;
      } else {
        await eventually(() => refreshHandlers.length === 2);
      }
      return completedStream(input.codexThreadId ?? "thread", "turn");
    },
  });

  await Promise.all([
    manager.dispatchAgentRoomExecution(execution("execution-1", "thread-1", "room-1", "one")),
    manager.dispatchAgentRoomExecution({
      ...execution("execution-2", "thread-2", "room-2", "two"),
      memberId: "member-2",
    }),
  ]);
  assert.equal(refreshCalls, 1);
});

test("Room activity retries one stable event, binds the returned interaction, and deduplicates its response", async () => {
  const root = await temporaryRuntime();
  const responseReceived = deferred<void>();
  const activityEvents: Array<Record<string, unknown>> = [];
  const providerResponses: Array<Record<string, unknown>> = [];
  let callbackAttempts = 0;
  const manager = managerFor(root, {
    activityRetryDelaysMs: [0],
    publishAgentRoomActivity: async (event) => {
      callbackAttempts += 1;
      activityEvents.push(event as unknown as Record<string, unknown>);
      if (callbackAttempts === 1) throw new Error("callback response lost");
      return {
        accepted: true,
        event_id: event.event_id,
        duplicate: true,
        interaction_id: "interaction-1",
      };
    },
    runTurn: async (input) => ({
      threadId: input.codexThreadId ?? "thread-1",
      turnId: "turn-1",
      completed: (async () => {
        await input.onEvent?.({
          method: "item/commandExecution/requestApproval",
          payload: {
            threadId: "thread-1",
            turnId: "turn-1",
            itemId: "item-1",
            command: "transient-raw-marker",
          },
          message: {},
          requestId: 17,
          respond: async (response) => {
            providerResponses.push(response);
            responseReceived.resolve();
          },
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "item-1",
          occurredAtMs: 100,
        });
        await responseReceived.promise;
        return turnResult("thread-1", "turn-1");
      })(),
    }),
  });

  const executionPromise = manager.dispatchAgentRoomExecution(
    execution("execution-interaction", "room-thread-1", "room-1", "one"),
  );
  await eventually(() => callbackAttempts === 2);
  assert.equal(activityEvents[0]?.event_id, activityEvents[1]?.event_id);
  assert.equal(activityEvents[1]?.type, "agent_runtime.interaction_request");
  assert.equal(activityEvents[1]?.request_id, 17);

  const dispatch = interactionResponse();
  const accepted = await manager.respondAgentRoomInteraction(dispatch);
  const duplicate = await manager.respondAgentRoomInteraction(dispatch);
  assert.deepEqual(accepted, {
    accepted: true,
    persisted_response_id: "response-1",
    idempotency_key: "interaction-response-1",
    duplicate: false,
  });
  assert.deepEqual(duplicate, { ...accepted, duplicate: true });
  assert.deepEqual(providerResponses, [{ decision: "accept" }]);
  await assert.rejects(
    manager.respondAgentRoomInteraction({ ...dispatch, response: "reject" }),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "interaction_response_idempotency_conflict",
  );
  await executionPromise;

  const state = await readFile(
    join(root, "members", "member-1", "workspace", ".codex", "fields-runtime-state.json"),
    "utf8",
  );
  assert.equal(state.includes("transient-raw-marker"), false);
  assert.equal(state.includes("\"request_id\""), false);
});

test("persisted Room interaction responses wait for the callback binding race", async () => {
  const root = await temporaryRuntime();
  const callbackObserved = deferred<void>();
  const callbackReturn = deferred<void>();
  const providerResponse = deferred<void>();
  const responses: Array<Record<string, unknown>> = [];
  const manager = managerFor(root, {
    publishAgentRoomActivity: async (event) => {
      callbackObserved.resolve();
      await callbackReturn.promise;
      return {
        accepted: true,
        event_id: event.event_id,
        duplicate: false,
        interaction_id: "interaction-race",
      };
    },
    runTurn: async (input) => ({
      threadId: "thread-race",
      turnId: "turn-race",
      completed: (async () => {
        await input.onEvent?.({
          method: "item/fileChange/requestApproval",
          payload: { threadId: "thread-race", turnId: "turn-race", itemId: "item-race" },
          message: {},
          requestId: "request-race",
          respond: async (response) => {
            responses.push(response);
            providerResponse.resolve();
          },
          threadId: "thread-race",
          turnId: "turn-race",
          itemId: "item-race",
          occurredAtMs: 100,
        });
        await providerResponse.promise;
        return turnResult("thread-race", "turn-race");
      })(),
    }),
  });
  const executionPromise = manager.dispatchAgentRoomExecution(
    execution("execution-interaction", "room-thread-race", "room-1", "one"),
  );
  await callbackObserved.promise;

  const responsePromise = manager.respondAgentRoomInteraction({
    ...interactionResponse(),
    interaction_id: "interaction-race",
  });
  callbackReturn.resolve();

  assert.equal((await responsePromise).accepted, true);
  assert.deepEqual(responses, [{ decision: "accept" }]);
  await executionPromise;
});

test("Room interaction handles are removed when their Codex turn ends", async () => {
  const root = await temporaryRuntime();
  const manager = managerFor(root, {
    publishAgentRoomActivity: async (event) => ({
      accepted: true,
      event_id: event.event_id,
      duplicate: false,
      interaction_id: "interaction-ended",
    }),
    runTurn: async (input) => ({
      threadId: "thread-ended",
      turnId: "turn-ended",
      completed: (async () => {
        await input.onEvent?.({
          method: "item/fileChange/requestApproval",
          payload: { threadId: "thread-ended", turnId: "turn-ended", itemId: "item-ended" },
          message: {},
          requestId: "request-ended",
          respond: async () => undefined,
          threadId: "thread-ended",
          turnId: "turn-ended",
          itemId: "item-ended",
          occurredAtMs: 100,
        });
        return turnResult("thread-ended", "turn-ended");
      })(),
    }),
  });

  await manager.dispatchAgentRoomExecution(
    execution("execution-ended", "room-thread-ended", "room-1", "one"),
  );
  await assert.rejects(
    manager.respondAgentRoomInteraction({
      ...interactionResponse(),
      execution_id: "execution-ended",
      interaction_id: "interaction-ended",
    }),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "interaction_not_pending",
  );
});

test("Agent-Room turns keep Member workspace as cwd without a persistent Room files root", async () => {
  const root = await temporaryRuntime();
  let captured: { cwd: string; runtimeWorkspaceRoots: string[] } | null = null;
  const manager = managerFor(root, {
    runTurn: async (input) => {
      captured = {
        cwd: input.cwd,
        runtimeWorkspaceRoots: [...input.runtimeWorkspaceRoots],
      };
      return completedStream("thread-room-root", "turn-room-root");
    },
  });

  await manager.dispatchAgentRoomExecution(
    execution("execution-room-root", "room-thread-root", "room-1", "one"),
  );

  const workspace = join(root, "members", "member-1", "workspace");
  const companyFiles = join(root, "members", "member-1", ".runtime", "company-files");
  assert.deepEqual(captured, {
    cwd: workspace,
    runtimeWorkspaceRoots: [workspace, companyFiles],
  });
});

test("Agent-Room turns materialize verified Company File snapshots read-only and remove them after the turn", async () => {
  const root = await temporaryRuntime();
  const content = Buffer.from("quarterly plan\n", "utf8");
  const sha256 = createHash("sha256").update(content).digest("hex");
  let inputRoot = "";
  const manager = managerFor(root, {
    runTurn: async (input) => {
      assert.equal(input.runtimeWorkspaceRoots.length, 3);
      inputRoot = input.runtimeWorkspaceRoots[1]!;
      const snapshot = join(inputRoot, "file-1", "plan.txt");
      assert.equal(await readFile(snapshot, "utf8"), content.toString("utf8"));
      assert.equal((await stat(snapshot)).mode & 0o777, 0o400);
      assert.equal((await stat(inputRoot)).mode & 0o777, 0o500);
      return completedStream("thread-company-file", "turn-company-file");
    },
  });

  await manager.dispatchAgentRoomExecution({
    ...execution("execution-company-file", "room-thread-company-file", "room-1", "review"),
    companyFileInputs: [{
      file_id: "file-1",
      version_id: "version-1",
      message_ids: ["message-1"],
      name: "plan.txt",
      mime_type: "text/plain",
      size_bytes: content.byteLength,
      sha256,
      download_url: `data:text/plain;base64,${content.toString("base64")}`,
      download_expires_at_ms: Date.now() + 60_000,
    }],
  });

  assert.notEqual(inputRoot, "");
  await assert.rejects(access(inputRoot));
  const workspace = join(root, "members", "member-1", "workspace");
  assert.deepEqual(
    manager.memberStatus("member-1")?.threads.map((thread) => thread.workspaceRoots),
    [[workspace]],
  );
});

test("terminal Member cleanup drains queued turns, stops once, preserves Room files, and survives Runtime restart", async () => {
  const root = await temporaryRuntime();
  const turnGates = new Map<string, ReturnType<typeof deferred<void>>>();
  const started: string[] = [];
  let stops = 0;
  const manager = managerFor(root, {
    stopProcess: async () => {
      stops += 1;
      return { terminated: true };
    },
    runTurn: async (input) => {
      started.push(input.prompt);
      const gate = deferred<void>();
      turnGates.set(input.prompt, gate);
      await gate.promise;
      return completedStream(input.codexThreadId ?? `thread-${input.prompt}`, `turn-${input.prompt}`);
    },
  });
  const first = manager.dispatchAgentRoomExecution(
    execution("execution-cleanup-first", "room-thread-cleanup", "room-1", "first"),
  );
  const queued = manager.dispatchAgentRoomExecution(
    execution("execution-cleanup-queued", "room-thread-cleanup", "room-1", "queued"),
  );
  await eventually(() => started.includes("first"));
  const roomSentinel = join(root, "rooms", "room-1", "files", "keep.txt");
  await mkdir(join(root, "rooms", "room-1", "files"), { recursive: true });
  await writeFile(roomSentinel, "keep\n", "utf8");

  const cleanup = manager.cleanupMember("cleanup-operation-1", "member-1");
  const concurrentRetry = manager.cleanupMember("cleanup-operation-1", "member-1");
  await eventuallyAsync(async () => {
    try {
      await manager.ensureMemberAppServer("member-1", { executorId: "executor-1" });
      return false;
    } catch (error) {
      return error instanceof Error && "code" in error && error.code === "member_terminal";
    }
  });
  await assert.rejects(
    manager.dispatchAgentRoomExecution(execution("execution-cleanup-new", "new-thread", "room-2", "new")),
    hasRuntimeCode("member_terminal"),
  );
  await assert.rejects(
    manager.submitHomeTurn({ memberId: "member-1", prompt: "new home" }),
    hasRuntimeCode("member_terminal"),
  );
  await assert.rejects(
    manager.switchMemberExecutor("member-1", { executorId: "executor-2" }),
    hasRuntimeCode("member_terminal"),
  );

  turnGates.get("first")?.resolve();
  await eventually(() => started.includes("queued"));
  turnGates.get("queued")?.resolve();
  await Promise.all([first, queued]);
  assert.deepEqual(await cleanup, {
    accepted: true,
    operation_id: "cleanup-operation-1",
    member_id: "member-1",
    duplicate: false,
  });
  assert.equal((await concurrentRetry).duplicate, true);
  assert.equal(stops, 1);
  await assert.rejects(access(join(root, "members", "member-1")), { code: "ENOENT" });
  assert.equal(await readFile(roomSentinel, "utf8"), "keep\n");
  assert.equal((await manager.cleanupMember("cleanup-operation-1", "member-1")).duplicate, true);

  const restarted = managerFor(root);
  assert.equal((await restarted.cleanupMember("cleanup-operation-1", "member-1")).duplicate, true);
  await assert.rejects(
    restarted.ensureMemberAppServer("member-1", { executorId: "executor-1" }),
    hasRuntimeCode("member_terminal"),
  );
  await assert.rejects(
    restarted.dispatchAgentRoomExecution(execution("execution-stale", "stale-thread", "room-1", "stale")),
    hasRuntimeCode("member_terminal"),
  );
  await assert.rejects(
    restarted.switchMemberExecutor("member-1", { executorId: "executor-2" }),
    hasRuntimeCode("member_terminal"),
  );
  await assert.rejects(access(join(root, "members", "member-1")), { code: "ENOENT" });
  await assert.rejects(
    async () => restarted.cleanupMember("cleanup-operation-1", "member-2"),
    hasRuntimeCode("member_cleanup_operation_conflict"),
  );
});

test("terminal Member cleanup drains an in-flight persisted interaction response", async () => {
  const root = await temporaryRuntime();
  const interactionReady = deferred<void>();
  const providerResponseGate = deferred<void>();
  const providerResponding = deferred<void>();
  const manager = managerFor(root, {
    publishAgentRoomActivity: async (event) => ({
      accepted: true,
      event_id: event.event_id,
      duplicate: false,
      interaction_id: "interaction-cleanup",
    }),
    runTurn: async (input) => ({
      threadId: "thread-cleanup",
      turnId: "turn-cleanup",
      completed: (async () => {
        await input.onEvent?.({
          method: "item/commandExecution/requestApproval",
          payload: { threadId: "thread-cleanup", turnId: "turn-cleanup", itemId: "item-cleanup" },
          message: {},
          requestId: "request-cleanup",
          respond: async () => {
            providerResponding.resolve();
            await providerResponseGate.promise;
          },
          threadId: "thread-cleanup",
          turnId: "turn-cleanup",
          itemId: "item-cleanup",
          occurredAtMs: 100,
        });
        interactionReady.resolve();
        await providerResponseGate.promise;
        return turnResult("thread-cleanup", "turn-cleanup");
      })(),
    }),
  });
  const executionPromise = manager.dispatchAgentRoomExecution(
    execution("execution-interaction", "room-thread-cleanup", "room-1", "one"),
  );
  await interactionReady.promise;
  const responsePromise = manager.respondAgentRoomInteraction({
    ...interactionResponse(),
    interaction_id: "interaction-cleanup",
  });
  await providerResponding.promise;
  let cleanupSettled = false;
  const cleanupPromise = manager.cleanupMember("cleanup-operation-response", "member-1")
    .finally(() => {
      cleanupSettled = true;
    });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(cleanupSettled, false);

  providerResponseGate.resolve();
  await Promise.all([responsePromise, executionPromise, cleanupPromise]);
  await assert.rejects(access(join(root, "members", "member-1")), { code: "ENOENT" });
});

test("terminal Member cleanup drains completion delivery and late delivery marking cannot recreate workspace", async () => {
  const root = await temporaryRuntime();
  const manager = managerFor(root);
  const completed = await manager.dispatchAgentRoomExecution({
    ...execution("execution-cleanup-delivery", "room-thread-cleanup", "room-1", "one"),
    completion: {
      cascadeId: "cascade-cleanup-delivery",
      consumedThroughSequence: 1,
      completedAtMs: () => 123,
    },
  });
  assert.equal(completed.completionPending, true);

  const deliveryGate = deferred<void>();
  const delivery = deliveryGate.promise.then(() => (
    manager.markAgentRoomExecutionCompletionDelivered(
      "member-1",
      completed.idempotencyKey,
    )
  ));
  manager.trackAgentRoomExecutionCompletionDelivery("member-1", delivery);

  let cleanupSettled = false;
  const cleanup = manager.cleanupMember("cleanup-operation-delivery", "member-1")
    .finally(() => {
      cleanupSettled = true;
    });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(cleanupSettled, false);

  deliveryGate.resolve();
  await Promise.all([delivery, cleanup]);
  const memberPath = join(root, "members", "member-1");
  await assert.rejects(access(memberPath), { code: "ENOENT" });

  await manager.markAgentRoomExecutionCompletionDelivered(
    "member-1",
    completed.idempotencyKey,
  );
  await assert.rejects(access(memberPath), { code: "ENOENT" });

  assert.ok(completed.completion);
  await manager.persistPendingAgentRoomExecutionCompletion(
    "member-1",
    completed.completion,
  );
  await assert.rejects(access(memberPath), { code: "ENOENT" });
});

test("terminal Member cleanup succeeds when the exact Member directory is already absent", async () => {
  const root = await temporaryRuntime();
  assert.deepEqual(
    await managerFor(root).cleanupMember("cleanup-operation-absent", "member-absent"),
    {
      accepted: true,
      operation_id: "cleanup-operation-absent",
      member_id: "member-absent",
      duplicate: false,
    },
  );
  await assert.rejects(access(join(root, "members", "member-absent")), { code: "ENOENT" });
});

test("Member cleanup rejects unsafe targets and symlinked Runtime receipt roots", async () => {
  const root = await temporaryRuntime();
  const manager = managerFor(root);
  await assert.rejects(
    async () => manager.cleanupMember("../escape", "../member"),
    (error: unknown) => error instanceof WorkspaceLayoutError && error.code === "invalid_path_component",
  );

  const symlinkRoot = await temporaryRuntime();
  const outside = await temporaryRuntime();
  await writeFile(join(outside, "sentinel"), "safe\n", "utf8");
  await symlink(outside, join(symlinkRoot, ".runtime"));
  const symlinkManager = managerFor(symlinkRoot);
  await assert.rejects(
    async () => symlinkManager.cleanupMember("cleanup-operation-symlink", "member-1"),
    /real directory/,
  );
  assert.equal((await stat(join(outside, "sentinel"))).isFile(), true);
  await assert.rejects(access(join(outside, "member-cleanup-receipts")), { code: "ENOENT" });

  const receiptSymlinkRoot = await temporaryRuntime();
  const receiptOutside = await temporaryRuntime();
  await writeFile(join(receiptOutside, "sentinel"), "receipt-safe\n", "utf8");
  await mkdir(join(receiptSymlinkRoot, ".runtime"), { mode: 0o700 });
  await symlink(receiptOutside, join(receiptSymlinkRoot, ".runtime", "member-cleanup-receipts"));
  await assert.rejects(
    async () => managerFor(receiptSymlinkRoot).cleanupMember("cleanup-operation-receipt-symlink", "member-1"),
    /real directory/,
  );
  assert.equal(await readFile(join(receiptOutside, "sentinel"), "utf8"), "receipt-safe\n");

  const receiptFileRoot = await temporaryRuntime();
  const receiptDirectory = join(receiptFileRoot, ".runtime", "member-cleanup-receipts");
  await mkdir(receiptDirectory, { recursive: true, mode: 0o700 });
  const receiptTarget = join(receiptFileRoot, "receipt-target");
  await writeFile(receiptTarget, "target-safe\n", "utf8");
  await symlink(
    receiptTarget,
    memberCleanupReceiptPath(receiptFileRoot, "cleanup-operation-receipt-file-symlink"),
  );
  await assert.rejects(
    async () => managerFor(receiptFileRoot).cleanupMember("cleanup-operation-receipt-file-symlink", "member-1"),
    /regular file/,
  );
  assert.equal(await readFile(receiptTarget, "utf8"), "target-safe\n");

  const hardlinkOperationId = "cleanup-operation-receipt-hardlink";
  await link(receiptTarget, memberCleanupReceiptPath(receiptFileRoot, hardlinkOperationId));
  await assert.rejects(
    async () => managerFor(receiptFileRoot).cleanupMember(hardlinkOperationId, "member-1"),
    /regular file/,
  );
  assert.equal(await readFile(receiptTarget, "utf8"), "target-safe\n");

  const memberSymlinkRoot = await temporaryRuntime();
  const memberOutside = await temporaryRuntime();
  await writeFile(join(memberOutside, "sentinel"), "member-safe\n", "utf8");
  await mkdir(join(memberSymlinkRoot, "members"), { mode: 0o700 });
  await symlink(memberOutside, join(memberSymlinkRoot, "members", "member-1"));
  assert.equal(
    (await managerFor(memberSymlinkRoot).cleanupMember("cleanup-operation-member-symlink", "member-1")).accepted,
    true,
  );
  assert.equal(await readFile(join(memberOutside, "sentinel"), "utf8"), "member-safe\n");
  await assert.rejects(access(join(memberSymlinkRoot, "members", "member-1")), { code: "ENOENT" });

  const membersRootSymlinkRuntime = await temporaryRuntime();
  const membersRootOutside = await temporaryRuntime();
  await writeFile(join(membersRootOutside, "sentinel"), "members-root-safe\n", "utf8");
  await symlink(membersRootOutside, join(membersRootSymlinkRuntime, "members"));
  await assert.rejects(
    async () => managerFor(membersRootSymlinkRuntime).cleanupMember(
      "cleanup-operation-members-root-symlink",
      "member-1",
    ),
    (error: unknown) => error instanceof WorkspaceLayoutError && error.code === "members_root_invalid",
  );
  assert.equal(await readFile(join(membersRootOutside, "sentinel"), "utf8"), "members-root-safe\n");
});

function managerFor(
  root: string,
  overrides: Partial<ConstructorParameters<typeof MemberRuntimeManager>[1]> = {},
): MemberRuntimeManager {
  let pid = 100;
  return new MemberRuntimeManager(root, {
    runtimeUrl: "http://127.0.0.1:4110",
    issueTokens: async (input) => tokens(input.executorId, input.previousCredentialVersion ?? 1),
    startProcess: async (workdir) => processResult(workdir, ++pid),
    stopProcess: async () => ({ terminated: true }),
    login: async () => undefined,
    preparePluginMarketplace: async () => ({
      root: join(root, ".runtime", "fields-plugin-marketplace"),
      releasePath: join(root, ".runtime", "fields-plugin-marketplace", "releases", "1.0.0-test"),
      marketplacePath: join(root, ".runtime", "fields-plugin-marketplace", "current", ".agents", "plugins", "marketplace.json"),
      pluginRoot: join(root, ".runtime", "fields-plugin-marketplace", "current", "plugins", "fields-core"),
      pluginId: "fields-core@fields",
      pluginName: "fields-core",
      version: "1.0.0",
      mcpServerNames: [
        "fields_embodiment",
        "fields_search",
        "fields_room_messages",
        "fields_assets",
        "fields_mail",
      ],
    }),
    verifyPluginMarketplace: async () => undefined,
    installPlugin: async () => pluginHealth(),
    verifyPlugin: async () => pluginHealth(),
    runTurn: async (input) => completedStream(input.codexThreadId ?? "thread-default", "turn-default"),
    resumeThread: async (input) => ({ threadId: input.threadId }),
    ...overrides,
  });
}

async function* asyncBytes(value: Buffer): AsyncGenerator<Buffer> {
  yield value;
}

function pluginHealth() {
  return {
    pluginId: "fields-core@fields" as const,
    pluginName: "fields-core" as const,
    marketplaceName: "fields" as const,
    version: "1.0.0",
    installed: true as const,
    enabled: true as const,
    mcpServerNames: [
      "fields_embodiment",
      "fields_search",
      "fields_room_messages",
      "fields_assets",
      "fields_mail",
    ] as const,
  };
}

function execution(
  executionId: string,
  agentRoomThreadKey: string,
  roomId: string,
  prompt: string,
) {
  return {
    executionId,
    idempotencyKey: `idempotency-${executionId}`,
    memberId: "member-1",
    executor: { executorId: "executor-1" },
    roomId,
    agentRoomThreadKey,
    prompt,
  };
}

function tokens(executorId: string, credentialVersion: number): RuntimeExecutorTokens {
  return {
    executor_id: executorId,
    credential_version: credentialVersion,
    credential: {
      type: "chatgpt_auth_tokens",
      access_token: `token-${executorId}`,
      account_id: `account-${executorId}`,
      plan_type: "pro",
    },
  };
}

function interactionResponse() {
  return {
    persisted_response_id: "response-1",
    idempotency_key: "interaction-response-1",
    execution_id: "execution-interaction",
    room_id: "room-1",
    agent_member_id: "member-1",
    message_id: "message-1",
    interaction_id: "interaction-1",
    responder_member_id: "human-1",
    response: "approve" as const,
    responded_at_ms: 101,
  };
}

function processResult(workdir: string, pid: number) {
  return {
    started: true,
    pid,
    status: "running",
    socketPath: join(workdir, `.socket-${pid}`),
    statePath: join(workdir, `.state-${pid}`),
    logPath: join(workdir, `.log-${pid}`),
  };
}

function completedStream(threadId: string, turnId: string) {
  return Promise.resolve({
    threadId,
    turnId,
    completed: Promise.resolve(turnResult(threadId, turnId)),
  });
}

function turnResult(threadId: string, turnId: string) {
  return {
    completed: true,
    elicitationSeen: false,
    fieldsMcpCompleted: false,
    agentText: "done",
    threadId,
    turnId,
  };
}

function homeCodexThread(threadId: string) {
  return {
    id: threadId,
    name: threadId,
    status: { type: "idle" },
    turns: [{
      id: "turn-root",
      status: "completed",
      items: [
        {
          type: "userMessage",
          id: `user-${threadId}`,
          content: [{ type: "text", text: "original" }],
        },
        {
          type: "agentMessage",
          id: `assistant-${threadId}`,
          text: `answer from ${threadId}`,
          phase: "final_answer",
        },
      ],
    }],
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail("condition was not reached");
}

async function eventuallyAsync(predicate: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail("async condition was not reached");
}

function hasRuntimeCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof Error && "code" in error && error.code === code;
}

async function temporaryRuntime(): Promise<string> {
  return mkdtemp(join(tmpdir(), "fields-company-runtime-"));
}
