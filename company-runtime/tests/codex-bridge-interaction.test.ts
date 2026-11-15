import assert from "node:assert/strict";
import test from "node:test";

import {
  codexInteractionResponse,
} from "../src/application/member-runtime/manager.js";
import {
  CodexAppServerBridgeError,
  runFieldsPluginOperationLoop,
  runAppServerModelOptionsLoop,
  runAppServerThreadSettingsLoop,
  runAppServerThreadSettingsUpdateLoop,
  runAppServerTurnStreamLoop,
  threadResumeParams,
  threadStartParams,
  turnStartParams,
  type AppServerClient,
  type CodexAppServerRawEvent,
} from "../src/application/adapter/codex-bridge.js";

test("Codex bridge projects model defaults and supported reasoning efforts", async () => {
  const messages: Array<Record<string, unknown>> = [];
  const requests: Array<{ method: string; params: unknown }> = [];
  let requestSequence = 0;
  const client: AppServerClient = {
    readMessage: async () => messages.shift() ?? null,
    writeMessage: async () => undefined,
    sendRequest: async (method, params) => {
      const id = ++requestSequence;
      requests.push({ method, params });
      if (method === "initialize") messages.push({ id, result: {} });
      if (method === "model/list") messages.push({
        id,
        result: {
          data: [{
            model: "gpt-5.4",
            displayName: "GPT-5.4",
            isDefault: true,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [
              { reasoningEffort: "low" },
              { reasoningEffort: "medium" },
              { reasoningEffort: "high" },
            ],
          }],
          nextCursor: null,
        },
      });
      if (method === "config/read") messages.push({
        id,
        result: { config: { model: "gpt-5.4", model_reasoning_effort: "low" } },
      });
      if (method === "configRequirements/read") messages.push({
        id,
        result: {
          requirements: {
            models: {
              newThread: {
                model: "gpt-5.4",
                modelReasoningEffort: "high",
              },
            },
          },
        },
      });
      return id;
    },
    sendNotification: async () => undefined,
    sendResponse: async () => undefined,
    close: async () => undefined,
  };

  const result = await runAppServerModelOptionsLoop(client, {});

  assert.deepEqual(requests.map((request) => request.method), [
    "initialize",
    "model/list",
    "config/read",
    "configRequirements/read",
  ]);
  assert.deepEqual(result, {
    items: [{
      model: "gpt-5.4",
      displayName: "GPT-5.4",
      isDefault: true,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: ["low", "medium", "high"],
    }],
    newThreadDefault: {
      model: "gpt-5.4",
      reasoningEffort: "high",
    },
  });
});

test("Codex bridge reads and confirms current thread model settings", async () => {
  const readClient = threadSettingsClient(({ id, method }) => {
    if (method === "initialize") return [{ id, result: {} }];
    if (method === "thread/resume") return [{
      id,
      result: { model: "gpt-5.4", reasoningEffort: "medium" },
    }];
    return [];
  });
  assert.deepEqual(await runAppServerThreadSettingsLoop(readClient.client, {
    threadId: "thread-1",
    cwd: "/workspace",
    runtimeWorkspaceRoots: ["/workspace"],
  }), {
    threadId: "thread-1",
    model: "gpt-5.4",
    reasoningEffort: "medium",
  });

  const updateClient = threadSettingsClient(({ id, method }) => {
    if (method === "initialize") return [{ id, result: {} }];
    if (method === "thread/resume") return [{ id, result: { model: "gpt-5.4", reasoningEffort: "medium" } }];
    if (method === "thread/settings/update") return [
      {
        method: "thread/settings/updated",
        params: {
          threadId: "thread-1",
          threadSettings: { model: "gpt-5.4", effort: "high" },
        },
      },
      { id, result: {} },
    ];
    return [];
  });
  assert.deepEqual(await runAppServerThreadSettingsUpdateLoop(updateClient.client, {
    threadId: "thread-1",
    cwd: "/workspace",
    runtimeWorkspaceRoots: ["/workspace"],
    model: "gpt-5.4",
    reasoningEffort: "high",
  }), {
    threadId: "thread-1",
    model: "gpt-5.4",
    reasoningEffort: "high",
  });
  assert.deepEqual(updateClient.requests.find((request) => request.method === "thread/settings/update")?.params, {
    threadId: "thread-1",
    model: "gpt-5.4",
    effort: "high",
  });
});

test("turn/start carries explicit model and reasoning effort", () => {
  const params = turnStartParams("thread-1", "hello", null, {
    model: "gpt-5.4",
    reasoningEffort: "high",
  });
  assert.equal(params.model, "gpt-5.4");
  assert.equal(params.effort, "high");
});

test("turn/start carries text and ordered native localImage inputs", () => {
  assert.deepEqual(turnStartParams("thread-1", "inspect", "client-1", {
    localImagePaths: ["/workspace/one.png", "/workspace/two.webp"],
  }).input, [
    { type: "text", text: "inspect", text_elements: [] },
    { type: "localImage", path: "/workspace/one.png", detail: "auto" },
    { type: "localImage", path: "/workspace/two.webp", detail: "auto" },
  ]);
  assert.deepEqual(turnStartParams("thread-1", "", null, {
    localImagePaths: ["/workspace/only.jpg"],
  }).input, [
    { type: "localImage", path: "/workspace/only.jpg", detail: "auto" },
  ]);
});

test("Agent profile instructions are native developer instructions on new and resumed Room threads", () => {
  const developerInstructions = "Keep answers evidence-based.";
  assert.equal(
    threadStartParams({ developerInstructions }).developerInstructions,
    developerInstructions,
  );
  assert.equal(
    threadResumeParams("thread-1", { developerInstructions }).developerInstructions,
    developerInstructions,
  );
});

test("streaming Codex bridge exposes only supported approval requests as transient response handles", async () => {
  const messages: Array<Record<string, unknown>> = [];
  const responses: Array<{ id: string | number; result: unknown }> = [];
  let requestSequence = 0;
  const client: AppServerClient = {
    readMessage: async () => messages.shift() ?? null,
    writeMessage: async () => undefined,
    sendRequest: async (method) => {
      requestSequence += 1;
      if (method === "initialize") {
        messages.push({ id: requestSequence, result: {} });
      } else if (method === "thread/start") {
        messages.push({ id: requestSequence, result: { thread: { id: "thread-1" } } });
      } else if (method === "turn/start") {
        messages.push(
          { id: requestSequence, result: { turn: { id: "turn-1" } } },
          {
            id: "approval-1",
            method: "item/commandExecution/requestApproval",
            params: {
              threadId: "thread-1",
              turnId: "turn-1",
              itemId: "item-1",
              command: ["echo", "safe"],
            },
          },
        );
      }
      return requestSequence;
    },
    sendNotification: async () => undefined,
    sendResponse: async (id, result) => {
      responses.push({ id, result });
      messages.push({
        method: "turn/completed",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          turn: { id: "turn-1", status: "completed", items: [] },
        },
      });
    },
    close: async () => undefined,
  };
  const events: CodexAppServerRawEvent[] = [];

  const result = await runAppServerTurnStreamLoop("/workspace", client, {
    prompt: "hello",
    onEvent: async (event) => {
      events.push(event);
      if (event.requestId !== null) {
        assert.ok(event.respond);
        await event.respond({ decision: "accept" });
      }
    },
  });

  assert.equal(result.completed, true);
  assert.equal(result.threadId, "thread-1");
  assert.equal(result.turnId, "turn-1");
  assert.equal(events[0]?.method, "item/commandExecution/requestApproval");
  assert.equal(events[0]?.requestId, "approval-1");
  assert.deepEqual(responses, [{
    id: "approval-1",
    result: { decision: "accept" },
  }]);
});

function threadSettingsClient(
  respond: (request: { id: number; method: string; params: unknown }) => Array<Record<string, unknown>>,
) {
  const messages: Array<Record<string, unknown>> = [];
  const requests: Array<{ method: string; params: unknown }> = [];
  let requestSequence = 0;
  const client: AppServerClient = {
    readMessage: async () => messages.shift() ?? null,
    writeMessage: async () => undefined,
    sendRequest: async (method, params) => {
      const id = ++requestSequence;
      requests.push({ method, params });
      messages.push(...respond({ id, method, params }));
      return id;
    },
    sendNotification: async () => undefined,
    sendResponse: async () => undefined,
    close: async () => undefined,
  };
  return { client, requests };
}

test("streaming Codex bridge publishes only the last final answer with unphased fallback", async () => {
  assert.equal(await agentTextFrom([
    agentMessage("draft", null),
    agentMessage("commentary", "commentary"),
    agentMessage("first final", "final_answer"),
    agentMessage("last final", "final_answer"),
    agentMessage("later unphased", null),
  ]), "last final");
  assert.equal(await agentTextFrom([
    agentMessage("first unphased", null),
    agentMessage("last unphased", null),
  ]), "last unphased");
  assert.equal(await agentTextFrom([
    agentMessage("analysis only", "commentary"),
  ]), "");
  assert.equal(await agentTextFrom([]), "");
});

test("Fields Core Plugin activation installs and verifies the exact plugin identity and five MCP servers", async () => {
  const messages: Array<Record<string, unknown>> = [];
  const requests: Array<{ method: string; params: unknown }> = [];
  let requestSequence = 0;
  const client: AppServerClient = {
    readMessage: async () => messages.shift() ?? null,
    writeMessage: async () => undefined,
    sendRequest: async (method, params) => {
      requestSequence += 1;
      requests.push({ method, params });
      if (method === "initialize") {
        messages.push({ id: requestSequence, result: {} });
      } else if (method === "plugin/install") {
        messages.push({
          id: requestSequence,
          result: { authPolicy: "ON_INSTALL", appsNeedingAuth: [] },
        });
      } else if (method === "plugin/read") {
        messages.push({
          id: requestSequence,
          result: pluginReadResult(),
        });
      }
      return requestSequence;
    },
    sendNotification: async () => undefined,
    sendResponse: async () => undefined,
    close: async () => undefined,
  };

  const health = await runFieldsPluginOperationLoop(client, {
    operation: "install",
    marketplacePath: "/workdir/.runtime/fields-plugin-marketplace/current/.agents/plugins/marketplace.json",
    expectedVersion: "1.0.0",
  });

  assert.deepEqual(requests.map((request) => request.method), [
    "initialize",
    "plugin/install",
    "plugin/read",
  ]);
  assert.deepEqual(requests[1]?.params, {
    marketplacePath: "/workdir/.runtime/fields-plugin-marketplace/current/.agents/plugins/marketplace.json",
    remoteMarketplaceName: null,
    pluginName: "fields-core",
  });
  assert.deepEqual(requests[2]?.params, requests[1]?.params);
  assert.deepEqual(health, {
    pluginId: "fields-core@fields",
    pluginName: "fields-core",
    marketplaceName: "fields",
    version: "1.0.0",
    installed: true,
    enabled: true,
    mcpServerNames: [
      "fields_embodiment",
      "fields_search",
      "fields_room_messages",
      "fields_assets",
      "fields_mail",
    ],
  });
});

test("Fields Core Plugin verification rejects version or MCP drift", async () => {
  const messages: Array<Record<string, unknown>> = [];
  let requestSequence = 0;
  const client: AppServerClient = {
    readMessage: async () => messages.shift() ?? null,
    writeMessage: async () => undefined,
    sendRequest: async (method) => {
      requestSequence += 1;
      if (method === "initialize") {
        messages.push({ id: requestSequence, result: {} });
      } else if (method === "plugin/read") {
        const result = pluginReadResult();
        result.plugin.summary.localVersion = "0.9.0";
        result.plugin.mcpServers = ["fields_search"];
        result.plugin.skills = [{ name: "unexpected-skill" }];
        messages.push({ id: requestSequence, result });
      }
      return requestSequence;
    },
    sendNotification: async () => undefined,
    sendResponse: async () => undefined,
    close: async () => undefined,
  };

  await assert.rejects(
    runFieldsPluginOperationLoop(client, {
      operation: "verify",
      marketplacePath: "/marketplace.json",
      expectedVersion: "1.0.0",
    }),
    (error: unknown) => (
      error instanceof CodexAppServerBridgeError
      && error.code === "fields_plugin_health_invalid"
      && error.details.version_matches === false
      && error.details.mcp_servers_complete === false
      && error.details.unsupported_capabilities_absent === false
    ),
  );
});

test("streaming Codex bridge waits for Room mapping persistence before turn/start", async () => {
  const messages: Array<Record<string, unknown>> = [];
  const order: string[] = [];
  let requestSequence = 0;
  const client: AppServerClient = {
    readMessage: async () => messages.shift() ?? null,
    writeMessage: async () => undefined,
    sendRequest: async (method) => {
      requestSequence += 1;
      order.push(method);
      if (method === "initialize") {
        messages.push({ id: requestSequence, result: {} });
      } else if (method === "thread/start") {
        messages.push({ id: requestSequence, result: { thread: { id: "thread-room" } } });
      } else if (method === "turn/start") {
        messages.push(
          { id: requestSequence, result: { turn: { id: "turn-room" } } },
          {
            method: "turn/completed",
            params: {
              threadId: "thread-room",
              turnId: "turn-room",
              turn: { id: "turn-room", status: "completed", items: [] },
            },
          },
        );
      }
      return requestSequence;
    },
    sendNotification: async () => undefined,
    sendResponse: async () => undefined,
    close: async () => undefined,
  };

  await runAppServerTurnStreamLoop("/workspace", client, {
    prompt: "hello",
    beforeTurnStart: async ({ threadId, resumed }) => {
      order.push("persist-room-mapping");
      assert.equal(threadId, "thread-room");
      assert.equal(resumed, false);
    },
  });

  assert.deepEqual(order, [
    "initialize",
    "thread/start",
    "persist-room-mapping",
    "turn/start",
  ]);
});

test("streaming Codex bridge does not start a turn when Room mapping persistence fails", async () => {
  const messages: Array<Record<string, unknown>> = [];
  const methods: string[] = [];
  let requestSequence = 0;
  const client: AppServerClient = {
    readMessage: async () => messages.shift() ?? null,
    writeMessage: async () => undefined,
    sendRequest: async (method) => {
      requestSequence += 1;
      methods.push(method);
      if (method === "initialize") {
        messages.push({ id: requestSequence, result: {} });
      } else if (method === "thread/start") {
        messages.push({ id: requestSequence, result: { thread: { id: "thread-unused" } } });
      }
      return requestSequence;
    },
    sendNotification: async () => undefined,
    sendResponse: async () => undefined,
    close: async () => undefined,
  };

  await assert.rejects(
    runAppServerTurnStreamLoop("/workspace", client, {
      prompt: "hello",
      beforeTurnStart: async () => {
        throw new Error("persist failed");
      },
    }),
    /persist failed/u,
  );
  assert.deepEqual(methods, ["initialize", "thread/start"]);
});

test("Room approve/reject intent maps to every supported Codex approval response", () => {
  assert.deepEqual(
    codexInteractionResponse("item/tool/requestUserInput", {}, {
      answers: { environment: ["Production"] },
      resolution: "answered",
    }),
    { answers: { environment: { answers: ["Production"] } } },
  );
  assert.deepEqual(
    codexInteractionResponse("item/commandExecution/requestApproval", {}, "approve"),
    { decision: "accept" },
  );
  assert.deepEqual(
    codexInteractionResponse("item/fileChange/requestApproval", {}, "reject"),
    { decision: "decline" },
  );
  assert.deepEqual(
    codexInteractionResponse("item/permissions/requestApproval", {
      permissions: {
        network: { enabled: true },
        fileSystem: null,
      },
    }, "approve"),
    {
      permissions: { network: { enabled: true } },
      scope: "turn",
    },
  );
  assert.deepEqual(
    codexInteractionResponse("item/permissions/requestApproval", {}, "reject"),
    { permissions: {}, scope: "turn" },
  );
  for (const method of ["applyPatchApproval", "execCommandApproval"] as const) {
    assert.deepEqual(
      codexInteractionResponse(method, {}, "approve"),
      { decision: "approved" },
    );
    assert.deepEqual(
      codexInteractionResponse(method, {}, "reject"),
      {
        decision: {
          denied: {
            rejection: "Rejected through the Fields Room interaction.",
          },
        },
      },
    );
  }
});

function pluginReadResult() {
  return {
    plugin: {
      marketplaceName: "fields",
      summary: {
        id: "fields-core@fields",
        name: "fields-core",
        localVersion: "1.0.0",
        installed: true,
        enabled: true,
      },
      mcpServers: [
        "fields_embodiment",
        "fields_search",
        "fields_room_messages",
        "fields_assets",
        "fields_mail",
      ],
      skills: [] as unknown[],
      hooks: [],
      apps: [],
      appTemplates: [],
      scheduledTasks: null,
    },
  };
}

function agentMessage(text: string, phase: "commentary" | "final_answer" | null) {
  return {
    type: "agentMessage",
    id: `agent-${text}`,
    text,
    phase,
    memoryCitation: null,
  };
}

async function agentTextFrom(items: Array<Record<string, unknown>>): Promise<string> {
  const messages: Array<Record<string, unknown>> = [];
  let requestSequence = 0;
  const client: AppServerClient = {
    readMessage: async () => messages.shift() ?? null,
    writeMessage: async () => undefined,
    sendRequest: async (method, params) => {
      requestSequence += 1;
      if (method === "initialize") {
        messages.push({ id: requestSequence, result: {} });
      } else if (method === "thread/start") {
        messages.push({ id: requestSequence, result: { thread: { id: "thread-phase" } } });
      } else if (method === "turn/start") {
        assert.equal("outputSchema" in (params as Record<string, unknown>), false);
        messages.push(
          { id: requestSequence, result: { turn: { id: "turn-phase" } } },
          ...items.map((item) => ({
            method: "item/completed",
            params: { threadId: "thread-phase", turnId: "turn-phase", item },
          })),
          {
            method: "turn/completed",
            params: {
              threadId: "thread-phase",
              turnId: "turn-phase",
              turn: { id: "turn-phase", status: "completed", items: [] },
            },
          },
        );
      }
      return requestSequence;
    },
    sendNotification: async () => undefined,
    sendResponse: async () => undefined,
    close: async () => undefined,
  };
  return (await runAppServerTurnStreamLoop("/workspace", client, {
    prompt: "hello",
  })).agentText;
}
