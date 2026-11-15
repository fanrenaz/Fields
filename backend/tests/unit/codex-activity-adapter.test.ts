import assert from "node:assert/strict";
import test from "node:test";

import {
  agentTurnEventSchema,
  agentTurnItemSchema,
  type AgentTurnEvent,
} from "@fields/contracts/public/agent-activity";
import type {
  CodexAgentRuntimeEvent,
  CodexAgentRuntimeSnapshot,
} from "@fields/contracts/internal/agent-runtime";
import type {
  ThreadItem,
  Turn,
} from "@fields/contracts/codex-app-server-protocol/v2";

import {
  CodexActivityAdapter,
  projectCodexThreadItem,
} from "../../src/infrastructure/runtime/codex-activity/codex-activity-adapter.js";
import {
  AgentActivityConversionError,
  type AgentRuntimeActivityAdapter,
} from "../../src/infrastructure/runtime/codex-activity/types.js";

const ROOM_SCOPE = {
  type: "room",
  room_id: "room_one",
  agent_member_id: "actor_agent",
  execution_id: "execution_one",
} as const;

test("the provider extension contract is generic over runtime snapshot and event envelopes", () => {
  type AlternateSnapshot = { id: string };
  type AlternateEvent = { sequence: number };
  const alternate: AgentRuntimeActivityAdapter<AlternateSnapshot, AlternateEvent> = {
    provider: "alternate",
    createProjection: () => ({
      scope: null,
      snapshot: {
        turn_id: null,
        status: "queued",
        started_at_ms: null,
        completed_at_ms: null,
        duration_ms: null,
        error: null,
        narrative_items: [],
        activity_items: [],
      },
    }),
    convertSnapshot: (projection, value) => ({
      schema_version: 2,
      event_id: value.id,
      source: "backend",
      scope: ROOM_SCOPE,
      turn_id: null,
      occurred_at_ms: 0,
      type: "agent_turn.snapshot",
      snapshot: projection.snapshot,
    }),
    convertEvent: (_projection, value) => value.sequence > 0 ? [] : [],
  };

  assert.equal(alternate.provider, "alternate");
  assert.equal(alternate.convertSnapshot(alternate.createProjection(), { id: "alternate-snapshot" }).event_id, "alternate-snapshot");
  assert.deepEqual(alternate.convertEvent(alternate.createProjection(), { sequence: 1 }), []);
});

test("projects every Codex ThreadItem variant or deliberately filters it", () => {
  const cases: Array<{
    name: string;
    item: ThreadItem;
    expectedType: string | null;
  }> = [
    { name: "userMessage", item: item({ type: "userMessage", id: "user", clientId: null, content: [] }), expectedType: "user_message" },
    { name: "hookPrompt", item: item({ type: "hookPrompt", id: "hook", fragments: [] }), expectedType: null },
    {
      name: "agentMessage",
      item: item({ type: "agentMessage", id: "message", text: "Answer", phase: "final_answer", memoryCitation: null }),
      expectedType: "assistant_message",
    },
    { name: "plan", item: item({ type: "plan", id: "plan", text: "1. Verify" }), expectedType: "plan" },
    {
      name: "reasoning",
      item: item({ type: "reasoning", id: "reasoning", summary: ["Summary"], content: ["Detail"] }),
      expectedType: "reasoning",
    },
    { name: "commandExecution", item: commandItem(), expectedType: "command" },
    { name: "fileChange", item: fileChangeItem(), expectedType: "file_change" },
    { name: "mcpToolCall", item: mcpToolItem(), expectedType: "tool_call" },
    { name: "dynamicToolCall", item: dynamicToolItem(), expectedType: "tool_call" },
    { name: "collabAgentToolCall", item: collaborationItem("spawnAgent"), expectedType: "collaboration" },
    { name: "collab wait", item: collaborationItem("wait"), expectedType: null },
    {
      name: "subAgentActivity",
      item: item({ type: "subAgentActivity", id: "subagent", kind: "interacted", agentThreadId: "thread_child", agentPath: "/root/research_agent" }),
      expectedType: "subagent_activity",
    },
    {
      name: "webSearch",
      item: item({ type: "webSearch", id: "search", query: "", action: { type: "search", query: null, queries: ["provider-neutral activity"] } }),
      expectedType: "web_search",
    },
    {
      name: "empty webSearch",
      item: item({ type: "webSearch", id: "empty-search", query: "", action: { type: "other" } }),
      expectedType: null,
    },
    { name: "imageView", item: item({ type: "imageView", id: "view", path: "/tmp/evidence.png" }), expectedType: "image_view" },
    { name: "sleep", item: item({ type: "sleep", id: "sleep", durationMs: 1_000 }), expectedType: null },
    {
      name: "imageGeneration",
      item: item({ type: "imageGeneration", id: "generation", status: "completed", revisedPrompt: "A precise diagram", result: "https://example.com/image.png", savedPath: "/tmp/image.png" }),
      expectedType: "image_generation",
    },
    { name: "enteredReviewMode", item: item({ type: "enteredReviewMode", id: "review-enter", review: "Review" }), expectedType: null },
    { name: "exitedReviewMode", item: item({ type: "exitedReviewMode", id: "review-exit", review: "Review" }), expectedType: null },
    { name: "contextCompaction", item: item({ type: "contextCompaction", id: "compact" }), expectedType: "context_compaction" },
  ];

  for (const fixture of cases) {
    const projected = projectCodexThreadItem(fixture.item);
    assert.equal(projected?.type ?? null, fixture.expectedType, fixture.name);
    if (projected !== null) {
      agentTurnItemSchema.parse(projected);
    }
  }
});

test("projects user messages as ordered provider-neutral content without Fields runtime metadata or local paths", () => {
  const sourceMarkdown = "@test 广东都下雨吗？\n\n- 请给出区域差异";
  const projected = projectCodexThreadItem(item({
    type: "userMessage",
    id: "user-message",
    clientId: "provider-client-id",
    content: [
      {
        type: "text",
        text: [
          "A Human mentioned this Actor in a Fields Room message.",
          "Respond to the Room only through the fields MCP tool message.send.",
          "Do not treat your normal assistant final output as a published Room message.",
          "Use this execution_token exactly: runtime-secret",
          "Source message id: source-message-secret",
          "Source sender: Yifan (actor-secret)",
          "Source message:",
          sourceMarkdown,
        ].join("\n\n"),
        text_elements: [{ type: "mention", name: "test", path: "/private/mention/path" }],
      },
      { type: "image", url: "https://images.example.com/weather.png", detail: "auto" },
      { type: "image", url: "file:///private/images/secret.png", detail: "auto" },
      { type: "image", url: "https://user:password@images.example.com/private.png", detail: "auto" },
      { type: "localImage", path: "/private/uploads/local-weather.png", detail: "auto" },
      { type: "skill", name: "weather research", path: "/private/skills/weather/SKILL.md" },
      { type: "mention", name: "analyst", path: "/root/private/agent/path" },
      {
        type: "text",
        text: "Ordinary follow-up with Source message: in the middle and execution token: follow-up-secret",
        text_elements: [],
      },
    ],
  }));

  assert.deepEqual(projected, {
    id: "user-message",
    type: "user_message",
    status: "completed",
    content: [
      { type: "markdown", markdown: sourceMarkdown },
      {
        type: "image",
        uri: "https://images.example.com/weather.png",
        alt_text: null,
        mime_type: "image/png",
      },
      { type: "text", text: "local-weather.png" },
      { type: "text", text: "weather research" },
      { type: "text", text: "@analyst" },
      {
        type: "markdown",
        markdown: "Ordinary follow-up with Source message: in the middle and execution token: [redacted]",
      },
    ],
  });
  agentTurnItemSchema.parse(projected);

  const serialized = JSON.stringify(projected);
  for (const secret of [
    "runtime-secret",
    "source-message-secret",
    "actor-secret",
    "provider-client-id",
    "/private/mention/path",
    "/private/uploads",
    "/private/skills",
    "/root/private",
    "follow-up-secret",
  ]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
});

test("uses the same user-message projection for snapshots and realtime item upserts", () => {
  const adapter = new CodexActivityAdapter({ warningSink: () => undefined });
  const userMessage = item({
    type: "userMessage",
    id: "user-realtime",
    clientId: null,
    content: [
      { type: "text", text: "First input", text_elements: [] },
      { type: "text", text: "Steered input", text_elements: [] },
    ],
  });
  const snapshotEvent = adapter.convertSnapshot(adapter.createProjection(), snapshot({
    execution: runtimeExecution("running"),
    turn: turn([userMessage]),
  }));
  assert.equal(snapshotEvent.type, "agent_turn.snapshot");
  assert.deepEqual(snapshotEvent.snapshot.narrative_items, [{
    id: "user-realtime",
    type: "user_message",
    status: "completed",
    content: [
      { type: "markdown", markdown: "First input" },
      { type: "markdown", markdown: "Steered input" },
    ],
  }]);

  const projection = adapter.createProjection();
  adapter.convertSnapshot(projection, snapshot({ execution: runtimeExecution("running"), turn: turn([]) }));
  const started = only(adapter.convertEvent(projection, runtimeEvent(
    "item/started",
    { item: userMessage },
    "user-realtime",
  )));
  assert.equal(started.type, "agent_turn.item_upsert");
  assert.deepEqual(started.item, {
    ...snapshotEvent.snapshot.narrative_items[0],
    status: "running",
  });
  const completed = only(adapter.convertEvent(projection, runtimeEvent(
    "item/completed",
    { item: userMessage },
    "user-realtime",
  )));
  assert.equal(completed.type, "agent_turn.item_upsert");
  assert.deepEqual(completed.item, snapshotEvent.snapshot.narrative_items[0]);
  agentTurnEventSchema.parse(started);
  agentTurnEventSchema.parse(completed);
});

test("preserves complete command semantics and Codex v2 structured file-change kinds", () => {
  assert.deepEqual(projectCodexThreadItem(commandItem()), {
    id: "command",
    type: "command",
    status: "declined",
    command: "rg --files src && sed -n '1,20p' src/index.ts",
    cwd: "/workspace",
    actions: [
      { type: "read", command: "sed -n '1,20p' src/index.ts", name: "index.ts", path: "src/index.ts" },
      { type: "list", command: "rg --files src", path: "src" },
      { type: "search", command: "rg activity src", query: "activity", path: "src" },
      { type: "unknown", command: "custom --flag" },
    ],
    output: "line one\nline two\n",
    exit_code: 23,
    duration_ms: 456,
  });
  assert.deepEqual(projectCodexThreadItem(fileChangeItem()), {
    id: "patch",
    type: "file_change",
    status: "completed",
    changes: [
      { path: "src/new.ts", kind: "add", diff: "+export const added = true;\n" },
      { path: "src/old.ts", kind: "delete", diff: "-export const old = true;\n" },
      { path: "src/index.ts", kind: "update", diff: "-old\n+new\n" },
    ],
  });
});

test("unifies MCP and dynamic tools, extracts semantic content, and omits provider-private envelopes", () => {
  const mcp = projectCodexThreadItem(mcpToolItem());
  const dynamic = projectCodexThreadItem(dynamicToolItem());
  assert.ok(mcp?.type === "tool_call");
  assert.ok(dynamic?.type === "tool_call");

  assert.deepEqual({
    namespace: mcp.namespace,
    name: mcp.name,
    display_name: mcp.display_name,
    status: mcp.status,
    duration_ms: mcp.duration_ms,
  }, {
    namespace: "Fields",
    name: "message.read",
    display_name: "Read messages",
    status: "completed",
    duration_ms: 321,
  });
  assert.ok(mcp.content.some((content) => content.type === "markdown" && content.markdown === "**Canonical message**"));
  assert.ok(mcp.content.some((content) => content.type === "image" && content.uri === "data:image/png;base64,aW1hZ2U="));
  assert.ok(mcp.content.some((content) => content.type === "audio" && content.uri === "data:audio/wav;base64,YXVkaW8="));
  assert.ok(mcp.content.some((content) => content.type === "resource_link" && content.uri === "fields://resource/brief"));
  assert.ok(mcp.content.some((content) => content.type === "resource_link" && content.uri === "fields://app/messages"));
  assert.ok(mcp.content.some((content) => content.type === "json" && deepHasKey(content.value, "safe")));

  assert.equal(dynamic.namespace, "workspace");
  assert.equal(dynamic.name, "inspect");
  assert.deepEqual(dynamic.content, [
    { type: "json", value: { count: 2 } },
    { type: "image", uri: "https://example.com/dynamic.png", alt_text: null, mime_type: "image/png" },
  ]);

  assertNoProviderPrivateFields(mcp);
  assertNoProviderPrivateFields(dynamic);
  const serialized = JSON.stringify([mcp, dynamic]);
  for (const secret of [
    "argument-secret",
    "execution-secret",
    "structured-secret",
    "meta-secret",
    "text-space-secret",
    "text-hyphen-secret",
    "hyphen-execution-secret",
    "space-execution-secret",
    "tool-argument-secret",
    "input-argument-secret",
  ]) {
    assert.equal(serialized.includes(secret), false, secret);
  }

  const failedMcp = projectCodexThreadItem(mcpToolItem("failed", true));
  assert.ok(failedMcp?.type === "tool_call");
  assert.deepEqual(failedMcp.error, {
    code: "AGENT_TOOL_CALL_FAILED",
    message: "Tool call failed.",
  });
  const failedMcpJson = JSON.stringify(failedMcp);
  assert.equal(failedMcpJson.includes("mcp-error-secret"), false);
  assert.equal(failedMcpJson.includes("structuredContent"), false);
  assert.equal(failedMcpJson.includes("arguments"), false);
});

test("asset MCP Activity drops bearer arguments and redacts malicious result and error secrets", () => {
  const secrets = [
    "asset-argument-secret",
    "asset-json-secret",
    "asset-authorization-secret",
    "asset-text-secret",
    "asset-scheme-secret",
    "asset-error-secret",
  ];
  const malicious = item({
    type: "mcpToolCall",
    id: "asset-mcp",
    server: "Fields",
    tool: "assets.mcp.credential.replace",
    status: "failed",
    arguments: {
      bearer_token: secrets[0],
      asset_id: "asset-one",
    },
    appContext: null,
    pluginId: null,
    mcpAppResourceUri: null,
    result: {
      content: [
        {
          type: "custom",
          safe: { asset_id: "asset-one" },
          bearer_token: secrets[1],
          nested: {
            "Author-ization": `Bearer ${secrets[2]}`,
          },
        },
        {
          type: "text",
          text: `bearer_token=${secrets[3]} Authorization: Bearer ${secrets[4]}`,
        },
      ],
      structuredContent: {
        bearerToken: "asset-structured-secret",
      },
      _meta: {
        authorization: "Bearer asset-meta-secret",
      },
    },
    error: {
      message: `Authorization: Bearer ${secrets[5]}`,
    },
    durationMs: 1,
  });
  const warnings: unknown[] = [];
  const adapter = new CodexActivityAdapter({
    warningSink: (warning) => warnings.push(warning),
  });
  const event = adapter.convertSnapshot(adapter.createProjection(), snapshot({
    execution: runtimeExecution("failed"),
    turn: turn([malicious], "failed", {
      message: `Bearer ${secrets[5]}`,
      codexErrorInfo: null,
      additionalDetails: null,
    }),
  }));
  const serialized = JSON.stringify({ event, warnings });
  for (const secret of [...secrets, "asset-structured-secret", "asset-meta-secret"]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  assert.equal(serialized.includes("bearer_token"), false);
  assert.equal(serialized.includes("Author-ization"), false);
  assert.equal(serialized.includes("[redacted]"), true);
  agentTurnEventSchema.parse(event);
});

test("normalizes turn and item statuses and sanitizes errors", () => {
  const adapter = new CodexActivityAdapter({ warningSink: () => undefined });
  const executionCases = ["queued", "running", "completed", "failed", "declined", "interrupted"] as const;
  for (const status of executionCases) {
    const projection = adapter.createProjection();
    const event = adapter.convertSnapshot(projection, snapshot({
      turnId: null,
      execution: {
        status,
        started_at_ms: status === "queued" ? null : 100,
        completed_at_ms: status === "completed" ? 250 : null,
        duration_ms: null,
        error: status === "failed"
          ? {
            code: "runtime_failed",
            message: JSON.stringify({
              provider: "codex",
              arguments: { secret: "execution-error-secret" },
              structuredContent: { raw: true },
            }),
          }
          : null,
      },
      turn: null,
    }));
    assert.equal(event.type, "agent_turn.snapshot");
    assert.equal(event.snapshot.status, status);
    if (status === "failed") {
      assert.deepEqual(event.snapshot.error, {
        code: "AGENT_RUNTIME_FAILED",
        message: "Agent turn failed.",
      });
      assert.equal(JSON.stringify(event).includes("execution-error-secret"), false);
    }
  }

  const turnCases = [
    ["inProgress", "running"],
    ["completed", "completed"],
    ["failed", "failed"],
    ["interrupted", "interrupted"],
  ] as const;
  for (const [nativeStatus, expected] of turnCases) {
    const projection = adapter.createProjection();
    const converted = adapter.convertSnapshot(projection, snapshot({
      execution: runtimeExecution("running"),
      turn: turn([], nativeStatus),
    }));
    assert.equal(converted.type, "agent_turn.snapshot");
    assert.equal(converted.snapshot.status, expected);
  }

  const lifecycleProjection = adapter.createProjection();
  adapter.convertSnapshot(lifecycleProjection, snapshot({ execution: runtimeExecution("running"), turn: turn([]) }));
  const started = only(adapter.convertEvent(lifecycleProjection, runtimeEvent(
    "item/started",
    { item: { type: "agentMessage", id: "lifecycle-message", text: "", phase: null, memoryCitation: null } },
    "lifecycle-message",
  )));
  assert.equal(started.type, "agent_turn.item_upsert");
  assert.equal(started.item.status, "running");
  const completed = only(adapter.convertEvent(lifecycleProjection, runtimeEvent(
    "item/completed",
    { item: { type: "agentMessage", id: "lifecycle-message", text: "Done", phase: null, memoryCitation: null } },
    "lifecycle-message",
  )));
  assert.equal(completed.type, "agent_turn.item_upsert");
  assert.equal(completed.item.status, "completed");

  const failedTurn = adapter.convertSnapshot(adapter.createProjection(), snapshot({
    execution: runtimeExecution("running"),
    turn: turn([], "failed", {
      message: JSON.stringify({
        provider: "codex",
        raw_result: { secret: "turn-error-secret" },
        structuredContent: { raw: true },
      }),
      codexErrorInfo: "contextWindowExceeded",
      additionalDetails: "provider-only details",
    }),
  }));
  assert.equal(failedTurn.type, "agent_turn.snapshot");
  assert.deepEqual(failedTurn.snapshot.error, {
    code: "AGENT_CONTEXT_WINDOW_EXCEEDED",
    message: "Agent turn failed.",
  });
  assert.equal(JSON.stringify(failedTurn).includes("turn-error-secret"), false);
  assert.equal(JSON.stringify(failedTurn).includes("CODEX"), false);
  assert.equal(JSON.stringify(failedTurn).includes("Codex"), false);
});

test("redacts execution tokens from provider-derived snapshot content and realtime deltas", () => {
  const adapter = new CodexActivityAdapter({ warningSink: () => undefined });
  const snapshotSecrets = [
    "snapshot-message-secret",
    "snapshot-plan-secret",
    "snapshot-summary-secret",
    "snapshot-reasoning-secret",
    "snapshot-command-secret",
    "snapshot-action-secret",
    "snapshot-output-secret",
    "snapshot-diff-secret",
    "snapshot-collab-secret",
  ];
  const projected = adapter.convertSnapshot(adapter.createProjection(), snapshot({
    execution: runtimeExecution("running"),
    turn: turn([
      item({
        type: "agentMessage",
        id: "secret-message",
        text: "execution token: snapshot-message-secret",
        phase: "commentary",
        memoryCitation: null,
      }),
      item({ type: "plan", id: "secret-plan", text: "execution-token=snapshot-plan-secret" }),
      item({
        type: "reasoning",
        id: "secret-reasoning",
        summary: ["execution_token=snapshot-summary-secret"],
        content: ["Use this execution token exactly: snapshot-reasoning-secret"],
      }),
      item({
        type: "commandExecution",
        id: "secret-command",
        command: "execute execution token: snapshot-command-secret",
        cwd: "/workspace",
        processId: null,
        source: "agent",
        status: "inProgress",
        commandActions: [{ type: "unknown", command: "execution-token=snapshot-action-secret" }],
        aggregatedOutput: "execution token: snapshot-output-secret",
        exitCode: null,
        durationMs: null,
      }),
      item({
        type: "fileChange",
        id: "secret-patch",
        changes: [{ path: "src/index.ts", kind: { type: "update", move_path: null }, diff: "+execution-token=snapshot-diff-secret" }],
        status: "inProgress",
      }),
      item({
        type: "collabAgentToolCall",
        id: "secret-collab",
        tool: "sendInput",
        status: "inProgress",
        senderThreadId: "thread_root",
        receiverThreadIds: ["thread_child"],
        prompt: "execution token: snapshot-collab-secret",
        model: null,
        reasoningEffort: null,
        agentsStates: {},
      }),
    ]),
  }));
  const snapshotJson = JSON.stringify(projected);
  for (const secret of snapshotSecrets) assert.equal(snapshotJson.includes(secret), false, secret);
  assert.ok(snapshotJson.includes("[redacted]"));
  agentTurnEventSchema.parse(projected);

  const projection = adapter.createProjection();
  adapter.convertSnapshot(projection, snapshot({ execution: runtimeExecution("running"), turn: turn([]) }));
  const deltaFixtures = [
    ["item/agentMessage/delta", "delta-message", { delta: "execution token: delta-message-secret" }],
    ["item/plan/delta", "delta-plan", { delta: "execution-token=delta-plan-secret" }],
    ["item/reasoning/summaryTextDelta", "delta-reasoning", { summaryIndex: 0, delta: "Use this execution token exactly: delta-reasoning-secret" }],
    ["item/commandExecution/outputDelta", "delta-command", { delta: "execution_token=delta-command-secret" }],
  ] as const;
  const deltaSecrets = [
    "delta-message-secret",
    "delta-plan-secret",
    "delta-reasoning-secret",
    "delta-command-secret",
  ];
  const publicDeltas = deltaFixtures.flatMap(([method, itemId, payload]) => (
    adapter.convertEvent(projection, runtimeEvent(method, payload, itemId))
  ));
  const deltaJson = JSON.stringify(publicDeltas);
  for (const secret of deltaSecrets) assert.equal(deltaJson.includes(secret), false, secret);
  assert.equal(publicDeltas.every((event) => "delta" in event && event.delta.includes("[redacted]")), true);
  for (const event of publicDeltas) agentTurnEventSchema.parse(event);
});

test("converts every supported runtime delta while maintaining transient projection state", () => {
  const adapter = new CodexActivityAdapter({ warningSink: () => undefined });
  const projection = adapter.createProjection();
  adapter.convertSnapshot(projection, snapshot({ execution: runtimeExecution("running"), turn: turn([]) }));

  const events: AgentTurnEvent[] = [];
  events.push(...adapter.convertEvent(projection, runtimeEvent("item/agentMessage/delta", { delta: "Hello " }, "assistant")));
  events.push(...adapter.convertEvent(projection, runtimeEvent("item/agentMessage/delta", { delta: "world" }, "assistant")));
  events.push(...adapter.convertEvent(projection, runtimeEvent("item/plan/delta", { delta: "Verify" }, "plan-stream")));
  events.push(...adapter.convertEvent(projection, runtimeEvent("item/reasoning/summaryPartAdded", { summaryIndex: 1 }, "reason-stream")));
  events.push(...adapter.convertEvent(projection, runtimeEvent("item/reasoning/summaryTextDelta", { summaryIndex: 1, delta: "Evidence" }, "reason-stream")));
  events.push(...adapter.convertEvent(projection, runtimeEvent("item/reasoning/textDelta", { contentIndex: 0, delta: "Detail" }, "reason-stream")));
  events.push(...adapter.convertEvent(projection, runtimeEvent("item/commandExecution/outputDelta", { delta: "first\n" }, "command-stream")));
  events.push(...adapter.convertEvent(projection, runtimeEvent("item/commandExecution/outputDelta", { delta: "second\n" }, "command-stream")));
  events.push(...adapter.convertEvent(projection, runtimeEvent("item/fileChange/patchUpdated", {
    changes: [{ path: "src/index.ts", kind: { type: "update", move_path: null }, diff: "-a\n+b\n" }],
  }, "patch-stream")));
  events.push(...adapter.convertEvent(projection, runtimeEvent("item/started", { item: mcpToolItem("inProgress") }, "mcp")));
  events.push(...adapter.convertEvent(projection, runtimeEvent("item/mcpToolCall/progress", { message: "Reading 1/2" }, "mcp")));
  events.push(...adapter.convertEvent(projection, runtimeEvent("item/mcpToolCall/progress", { message: "Reading 2/2" }, "mcp")));
  events.push(...adapter.convertEvent(projection, runtimeEvent("item/completed", { item: mcpToolItem("completed") }, "mcp")));
  events.push(...adapter.convertEvent(projection, runtimeEvent("turn/plan/updated", {
    explanation: "Current plan",
    plan: [{ step: "Inspect" }, { step: "Verify" }],
  })));
  events.push(...adapter.convertEvent(projection, runtimeEvent("thread/compacted", {})));

  for (const event of events) {
    agentTurnEventSchema.parse(event);
  }
  assert.deepEqual(events.map((event) => event.type), [
    "agent_turn.message_delta",
    "agent_turn.message_delta",
    "agent_turn.message_delta",
    "agent_turn.reasoning_delta",
    "agent_turn.reasoning_delta",
    "agent_turn.reasoning_delta",
    "agent_turn.command_output_delta",
    "agent_turn.command_output_delta",
    "agent_turn.item_upsert",
    "agent_turn.item_upsert",
    "agent_turn.tool_progress",
    "agent_turn.tool_progress",
    "agent_turn.item_upsert",
    "agent_turn.item_upsert",
    "agent_turn.item_upsert",
  ]);

  const assistant = projection.snapshot.narrative_items.find((candidate) => candidate.id === "assistant");
  assert.ok(assistant?.type === "assistant_message");
  assert.deepEqual(assistant.content, [{ type: "markdown", markdown: "Hello world" }]);
  const reasoning = projection.snapshot.narrative_items.find((candidate) => candidate.id === "reason-stream");
  assert.ok(reasoning?.type === "reasoning");
  assert.deepEqual(reasoning.summary, [
    { type: "markdown", markdown: "" },
    { type: "markdown", markdown: "Evidence" },
  ]);
  assert.deepEqual(reasoning.content, [{ type: "markdown", markdown: "Detail" }]);
  const command = projection.snapshot.activity_items.find((candidate) => candidate.id === "command-stream");
  assert.ok(command?.type === "command");
  assert.equal(command.output, "first\nsecond\n");
  const tool = projection.snapshot.activity_items.find((candidate) => candidate.id === "mcp");
  assert.ok(tool?.type === "tool_call");
  assert.deepEqual(tool.progress, ["Reading 1/2", "Reading 2/2"]);

  const removed = only(adapter.convertEvent(projection, runtimeEvent("item/removed", { itemId: "command-stream" }, "command-stream")));
  assert.equal(removed.type, "agent_turn.item_remove");
  assert.equal(projection.snapshot.activity_items.some((candidate) => candidate.id === "command-stream"), false);

  const retry = only(adapter.convertEvent(projection, runtimeEvent("error", {
    error: { message: "Temporary failure", codexErrorInfo: "serverOverloaded", additionalDetails: null },
    willRetry: true,
  })));
  assert.equal(retry.type, "agent_turn.status");
  assert.equal(retry.status, "running");
  assert.equal(retry.error?.code, "AGENT_SERVER_OVERLOADED");
  const terminal = only(adapter.convertEvent(projection, runtimeEvent("error", {
    error: { message: "Permanent failure", codexErrorInfo: "other", additionalDetails: null },
    willRetry: false,
  })));
  assert.equal(terminal.type, "agent_turn.status");
  assert.equal(terminal.status, "failed");
});

test("turn lifecycle notifications refresh the authoritative snapshot and normalize status", () => {
  const adapter = new CodexActivityAdapter({ warningSink: () => undefined });
  const projection = adapter.createProjection();
  const started = only(adapter.convertEvent(projection, runtimeEvent("turn/started", {
    turn: turn([item({ type: "agentMessage", id: "message", text: "Partial", phase: "commentary", memoryCitation: null })], "inProgress"),
  })));
  assert.equal(started.type, "agent_turn.snapshot");
  assert.equal(started.snapshot.status, "running");
  const completed = only(adapter.convertEvent(projection, runtimeEvent("turn/completed", {
    turn: turn([item({ type: "agentMessage", id: "message", text: "Final", phase: "final_answer", memoryCitation: null })], "completed"),
  })));
  assert.equal(completed.type, "agent_turn.snapshot");
  assert.equal(completed.snapshot.status, "completed");
  assert.deepEqual(completed.snapshot.narrative_items[0], {
    id: "message",
    type: "assistant_message",
    status: "completed",
    phase: "final_answer",
    content: [{ type: "markdown", markdown: "Final" }],
  });
});

test("turn completion preserves accumulated process items omitted by the lifecycle payload", () => {
  const adapter = new CodexActivityAdapter({ warningSink: () => undefined });
  const projection = adapter.createProjection();
  adapter.convertEvent(projection, runtimeEvent("turn/started", {
    turn: turn([], "inProgress"),
  }));
  adapter.convertEvent(projection, runtimeEvent("item/completed", {
    item: item({
      type: "agentMessage",
      id: "commentary",
      text: "I am checking.",
      phase: "commentary",
      memoryCitation: null,
    }),
  }, "commentary"));
  adapter.convertEvent(projection, runtimeEvent("item/completed", {
    item: commandItem(),
  }, "command"));

  const completed = only(adapter.convertEvent(projection, runtimeEvent("turn/completed", {
    turn: turn([], "completed"),
  })));

  assert.equal(completed.type, "agent_turn.snapshot");
  assert.equal(completed.snapshot.status, "completed");
  assert.equal(completed.snapshot.narrative_items.some((entry) => entry.id === "commentary"), true);
  assert.equal(completed.snapshot.activity_items.some((entry) => entry.id === "command"), true);
});

test("turn completion updates matching items and appends its final answer", () => {
  const adapter = new CodexActivityAdapter({ warningSink: () => undefined });
  const projection = adapter.createProjection();
  adapter.convertEvent(projection, runtimeEvent("turn/started", {
    turn: turn([
      item({
        type: "agentMessage",
        id: "commentary",
        text: "Checking",
        phase: "commentary",
        memoryCitation: null,
      }),
    ], "inProgress"),
  }));

  const completed = only(adapter.convertEvent(projection, runtimeEvent("turn/completed", {
    turn: turn([
      item({
        type: "agentMessage",
        id: "commentary",
        text: "Checked",
        phase: "commentary",
        memoryCitation: null,
      }),
      item({
        type: "agentMessage",
        id: "final",
        text: "Done",
        phase: "final_answer",
        memoryCitation: null,
      }),
    ], "completed"),
  })));

  assert.equal(completed.type, "agent_turn.snapshot");
  assert.deepEqual(completed.snapshot.narrative_items.map((entry) => entry.id), [
    "commentary",
    "final",
  ]);
  assert.deepEqual(completed.snapshot.narrative_items[0], {
    id: "commentary",
    type: "assistant_message",
    status: "completed",
    phase: "commentary",
    content: [{ type: "markdown", markdown: "Checked" }],
  });
});

test("rejects missing, invalid, or mismatched authoritative Turn lifecycle payloads without raw details", () => {
  const warnings: unknown[] = [];
  const adapter = new CodexActivityAdapter({ warningSink: (warning) => warnings.push(warning) });
  const cases = [
    runtimeEvent("turn/started", { provider: "codex", secret: "missing-turn-secret" }),
    runtimeEvent("turn/completed", {
      turn: { id: "turn_one", items: "invalid-item-secret", status: "completed" },
    }),
    runtimeEvent("turn/completed", {
      turn: { ...turn([], "completed"), id: "turn_secret_mismatch" },
    }),
  ];

  for (const event of cases) {
    assert.throws(
      () => adapter.convertEvent(adapter.createProjection(), event),
      (error: unknown) => {
        assert.ok(error instanceof AgentActivityConversionError);
        assert.equal(error.message, "The authoritative Turn lifecycle event could not be converted.");
        assert.equal(error.cause, undefined);
        const publicError = `${String(error)} ${JSON.stringify(error)}`;
        for (const secret of ["missing-turn-secret", "invalid-item-secret", "turn_secret_mismatch"]) {
          assert.equal(publicError.includes(secret), false);
        }
        return true;
      },
    );
  }
  assert.deepEqual(warnings, []);
});

test("filters empty lifecycle activity and records structured warnings for unknown provider events", () => {
  const warnings: unknown[] = [];
  const adapter = new CodexActivityAdapter({ warningSink: (warning) => warnings.push(warning) });
  const projection = adapter.createProjection();

  for (const filtered of [
    item({ type: "webSearch", id: "empty", query: "", action: { type: "other" } }),
    item({ type: "sleep", id: "sleep", durationMs: 10 }),
    item({ type: "enteredReviewMode", id: "review-enter", review: "review" }),
    item({ type: "exitedReviewMode", id: "review-exit", review: "review" }),
    collaborationItem("wait"),
  ]) {
    assert.deepEqual(adapter.convertEvent(projection, runtimeEvent("item/started", { item: filtered }, filtered.id)), []);
  }
  assert.deepEqual(adapter.convertEvent(projection, runtimeEvent("provider/newNotification", { private: "payload" })), []);
  assert.deepEqual(warnings, [{
    code: "AGENT_RUNTIME_EVENT_IGNORED",
    provider: "codex",
    event_id: "runtime-event",
    method: "provider/newNotification",
    scope_type: "room",
    reason: "The provider notification is not recognized by the Codex Activity adapter.",
  }]);
});

test("rejects an unconvertible authoritative snapshot without embedding its raw payload in the error", () => {
  const adapter = new CodexActivityAdapter({ warningSink: () => undefined });
  const secret = "raw-authoritative-secret";
  const invalid = snapshot({
    turnId: "turn_envelope",
    execution: runtimeExecution("running"),
    turn: { ...turn([]), id: "turn_payload", privatePayload: secret } as unknown as Turn,
  });
  assert.throws(
    () => adapter.convertSnapshot(adapter.createProjection(), invalid),
    (error: unknown) => (
      error instanceof AgentActivityConversionError
      && error.message === "The authoritative Codex Turn id did not match its runtime envelope."
      && !error.message.includes(secret)
    ),
  );
});

function commandItem(): ThreadItem {
  return item({
    type: "commandExecution",
    id: "command",
    command: "rg --files src && sed -n '1,20p' src/index.ts",
    cwd: "/workspace",
    processId: "process_one",
    source: "agent",
    status: "declined",
    commandActions: [
      { type: "read", command: "sed -n '1,20p' src/index.ts", name: "index.ts", path: "src/index.ts" },
      { type: "listFiles", command: "rg --files src", path: "src" },
      { type: "search", command: "rg activity src", query: "activity", path: "src" },
      { type: "unknown", command: "custom --flag" },
    ],
    aggregatedOutput: "line one\nline two\n",
    exitCode: 23,
    durationMs: 456,
  });
}

function fileChangeItem(): ThreadItem {
  return item({
    type: "fileChange",
    id: "patch",
    status: "completed",
    changes: [
      { path: "src/new.ts", kind: { type: "add" }, diff: "+export const added = true;\n" },
      { path: "src/old.ts", kind: { type: "delete" }, diff: "-export const old = true;\n" },
      { path: "src/index.ts", kind: { type: "update", move_path: null }, diff: "-old\n+new\n" },
    ],
  });
}

function mcpToolItem(
  status: "inProgress" | "completed" | "failed" = "completed",
  includeProviderError = false,
): ThreadItem {
  return item({
    type: "mcpToolCall",
    id: "mcp",
    server: "Fields",
    tool: "message.read",
    status,
    arguments: { execution_token: "execution-secret", filter: "argument-secret" },
    appContext: {
      connectorId: "fields",
      linkId: null,
      resourceUri: "fields://app/messages",
      appName: "Fields Messages",
      templateId: null,
      actionName: "Read messages",
    },
    pluginId: null,
    result: {
      content: [
        { type: "text", text: "plain output" },
        { type: "text", text: "execution token: text-space-secret execution-token=text-hyphen-secret" },
        { type: "text", text: JSON.stringify({ ok: true, data: { message: { body: { markdown: "**Canonical message**", plain_text: "Canonical message" } } } }) },
        { type: "text", text: JSON.stringify({ ok: true, data: { safe: { value: 2 }, provider: "codex", method: "raw/method", payload: { hidden: true } } }) },
        { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
        { type: "audio", data: "YXVkaW8=", mimeType: "audio/wav", transcript: "Audio transcript" },
        { type: "resource_link", uri: "fields://resource/brief", name: "Brief", mimeType: "text/markdown" },
        { type: "resource", resource: { uri: "fields://resource/evidence", name: "Evidence", mimeType: "text/plain", text: "evidence text" } },
        {
          type: "custom",
          safe: { value: 1 },
          arguments: { secret: "argument-secret" },
          executionToken: "execution-secret",
          nested: {
            provider: "codex",
            method: "item/private",
            payload: { private: true },
            codex_notification: { private: true },
            result: { private: true },
            raw_result: { private: true },
            structuredContent: { private: true },
            "execution-token": "hyphen-execution-secret",
            "execution token": "space-execution-secret",
            "structured-content": { private: true },
            "raw-result": { private: true },
            "codex-notification": { private: true },
            "tool-arguments": { secret: "tool-argument-secret" },
            "input arguments": { secret: "input-argument-secret" },
          },
        },
      ],
      structuredContent: { leaked: "structured-secret" },
      _meta: { leaked: "meta-secret" },
    },
    error: includeProviderError ? {
      message: JSON.stringify({
        provider: "codex",
        arguments: { secret: "mcp-error-secret" },
        structuredContent: { raw: true },
      }),
    } : null,
    durationMs: 321,
  });
}

function dynamicToolItem(): ThreadItem {
  return item({
    type: "dynamicToolCall",
    id: "dynamic",
    namespace: "workspace",
    tool: "inspect",
    arguments: { token: "argument-secret" },
    status: "completed",
    contentItems: [
      { type: "inputText", text: "{\"count\":2}" },
      { type: "inputImage", imageUrl: "https://example.com/dynamic.png" },
    ],
    success: true,
    durationMs: 25,
  });
}

function collaborationItem(tool: "spawnAgent" | "sendInput" | "resumeAgent" | "wait" | "closeAgent"): ThreadItem {
  return item({
    type: "collabAgentToolCall",
    id: `collab-${tool}`,
    tool,
    status: "completed",
    senderThreadId: "thread_root",
    receiverThreadIds: tool === "wait" ? [] : ["thread_child"],
    prompt: tool === "spawnAgent" ? "Inspect the adapter" : null,
    model: null,
    reasoningEffort: null,
    agentsStates: {},
  });
}

function item(value: Record<string, unknown>): ThreadItem {
  return value as unknown as ThreadItem;
}

function turn(
  items: ThreadItem[],
  status: Turn["status"] = "inProgress",
  error: Turn["error"] = null,
): Turn {
  return {
    id: "turn_one",
    items,
    itemsView: "full",
    status,
    error,
    startedAt: 1.5,
    completedAt: status === "inProgress" ? null : 2.25,
    durationMs: status === "inProgress" ? null : 750,
  };
}

function runtimeExecution(status: CodexAgentRuntimeSnapshot["payload"]["execution"]["status"]): CodexAgentRuntimeSnapshot["payload"]["execution"] {
  return {
    status,
    started_at_ms: status === "queued" ? null : 1_500,
    completed_at_ms: status === "completed" ? 2_250 : null,
    duration_ms: status === "completed" ? 750 : null,
    error: null,
  };
}

function snapshot(input: {
  turnId?: string | null;
  execution: CodexAgentRuntimeSnapshot["payload"]["execution"];
  turn: Turn | null;
}): CodexAgentRuntimeSnapshot {
  return {
    schema_version: 1,
    event_id: "runtime-snapshot",
    provider: "codex",
    source: "company-runtime",
    scope: ROOM_SCOPE,
    turn_id: input.turnId === undefined ? input.turn?.id ?? null : input.turnId,
    occurred_at_ms: 2_500,
    type: "agent_runtime.snapshot",
    method: "turn/snapshot",
    item_id: null,
    payload: { execution: input.execution, turn: input.turn },
  };
}

function runtimeEvent(method: string, payload: unknown, itemId: string | null = null): CodexAgentRuntimeEvent {
  return {
    schema_version: 1,
    event_id: "runtime-event",
    provider: "codex",
    source: "company-runtime",
    scope: ROOM_SCOPE,
    turn_id: "turn_one",
    occurred_at_ms: 2_600,
    type: "agent_runtime.event",
    method,
    item_id: itemId,
    payload,
  };
}

function only(events: AgentTurnEvent[]): AgentTurnEvent {
  assert.equal(events.length, 1);
  return events[0];
}

function assertNoProviderPrivateFields(value: unknown): void {
  const forbidden = new Set([
    "arguments",
    "toolarguments",
    "inputarguments",
    "executiontoken",
    "result",
    "rawresult",
    "structuredcontent",
    "meta",
    "method",
    "payload",
    "provider",
    "codexnotification",
  ]);
  visit(value, (key) => {
    assert.equal(forbidden.has(key.replace(/[^a-z0-9]/giu, "").toLowerCase()), false, `private provider field ${key}`);
  });
}

function visit(value: unknown, onKey: (key: string) => void): void {
  if (Array.isArray(value)) {
    for (const nested of value) visit(nested, onKey);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, nested] of Object.entries(value)) {
    onKey(key);
    visit(nested, onKey);
  }
}

function deepHasKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((nested) => deepHasKey(nested, key));
  if (typeof value !== "object" || value === null) return false;
  return key in value || Object.values(value).some((nested) => deepHasKey(nested, key));
}
