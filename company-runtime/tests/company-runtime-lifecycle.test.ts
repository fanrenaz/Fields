import assert from "node:assert/strict";
import test from "node:test";

import type { CompanyRuntimeInitInput } from "@fields/contracts/internal/company-runtime";

import type { MemberRuntimeManager } from "../src/application/member-runtime/manager.js";
import type { BackendRuntimeClient } from "../src/application/company-runtime/backend-client.js";
import {
  CompanyRuntimeLifecycle,
} from "../src/application/company-runtime/lifecycle.js";

const identity = {
  company_id: "company_one",
};

const input: CompanyRuntimeInitInput = {
  ...identity,
  backend_callback_url: "http://backend:4102",
  runtime_callback_token: "callback-token",
  layout: {
    members_root: "/workdir/members",
    rooms_root: "/workdir/rooms",
    executors_root: "/workdir/executors",
  },
  storage_policy: {
    member_workspace_pattern: "members/<member_id>/workspace",
    codex_home_directory: ".codex",
    room_file_inputs: "execution_scoped_company_file_snapshots",
    executor_credentials_pattern: "executors/<executor_id>/credentials",
    codex_home_auth_json: "forbidden",
    codex_home_visibility: "excluded_from_files_search_upload_export_git",
  },
  execution_policy: {
    idle_timeout_ms: 1_800_000,
    same_agent_room_thread: "serial",
    different_room_threads: "parallel",
    thread_recovery: "resume",
    executor_auth: "chatgptAuthTokens",
  },
};

test("Home terminal notifications use the initialized Runtime callback identity", async () => {
  const notifications: unknown[] = [];
  const client = {
    companyRuntime: {
      ready: { mutate: async () => undefined },
      heartbeat: { mutate: async () => undefined },
      notifications: {
        homeTerminal: {
          mutate: async (value: unknown) => {
            notifications.push(value);
            return { accepted: true as const, activity_id: "activity-one" };
          },
        },
      },
    },
  } as unknown as BackendRuntimeClient;
  const runtime = {
    start: () => undefined,
    verifyMemberPlugins: async () => undefined,
    listMemberAppServers: () => [],
  } as unknown as MemberRuntimeManager;
  const lifecycle = new CompanyRuntimeLifecycle(identity, input.layout, runtime, {
    clientFactory: () => client,
    setInterval: () => 1 as unknown as ReturnType<typeof setInterval>,
  });
  await lifecycle.initialize(input);
  const result = await lifecycle.homeTerminalNotification({
    event_id: "home-terminal:member-one:turn-one",
    recipient_actor_id: "member-one",
    thread_id: "thread-one",
    thread_title: "Thread one",
    status: "completed",
    preview: "Done",
    occurred_at_ms: 123,
  });
  assert.deepEqual(result, { accepted: true, activity_id: "activity-one" });
  assert.deepEqual(notifications, [{
    identity,
    event_id: "home-terminal:member-one:turn-one",
    recipient_actor_id: "member-one",
    thread_id: "thread-one",
    thread_title: "Thread one",
    status: "completed",
    preview: "Done",
    occurred_at_ms: 123,
  }]);
});

test("initialize retries ready callbacks after a transient Backend failure", async () => {
  let readyCalls = 0;
  let heartbeatCalls = 0;
  let runtimeStarts = 0;
  let timerStarts = 0;
  const client = {
    companyRuntime: {
      ready: {
        mutate: async () => {
          readyCalls += 1;
          if (readyCalls === 1) throw new Error("backend restarting");
        },
      },
      heartbeat: {
        mutate: async () => {
          heartbeatCalls += 1;
        },
      },
    },
  } as unknown as BackendRuntimeClient;
  const runtime = {
    start: () => {
      runtimeStarts += 1;
    },
    verifyMemberPlugins: async () => undefined,
    listMemberAppServers: () => [],
  } as unknown as MemberRuntimeManager;
  const lifecycle = new CompanyRuntimeLifecycle(identity, input.layout, runtime, {
    clientFactory: () => client,
    setInterval: () => {
      timerStarts += 1;
      return 1 as unknown as ReturnType<typeof setInterval>;
    },
  });

  await assert.rejects(() => lifecycle.initialize(input), /backend restarting/u);
  assert.equal(lifecycle.isReady(), false);

  await lifecycle.initialize(input);
  await lifecycle.initialize(input);

  assert.equal(lifecycle.isReady(), true);
  assert.equal(readyCalls, 2);
  assert.equal(heartbeatCalls, 1);
  assert.equal(runtimeStarts, 1);
  assert.equal(timerStarts, 1);
});

test("Executor authorization loss reports the request version and expired reason", async () => {
  const unavailable: unknown[] = [];
  const client = {
    companyRuntime: {
      ready: {
        mutate: async () => {
          throw new Error("backend restarting");
        },
      },
      executor: {
        unavailable: {
          mutate: async (value: unknown) => {
            unavailable.push(value);
          },
        },
      },
    },
  } as unknown as BackendRuntimeClient;
  const runtime = {
    start: () => undefined,
    verifyMemberPlugins: async () => undefined,
    listMemberAppServers: () => [],
  } as unknown as MemberRuntimeManager;
  const lifecycle = new CompanyRuntimeLifecycle(identity, input.layout, runtime, {
    clientFactory: () => client,
    nowMs: () => 200,
  });

  await assert.rejects(() => lifecycle.initialize(input), /backend restarting/u);
  await lifecycle.executorUnavailable({
    executorId: "executor-one",
    credentialVersion: 42,
    status: "expired",
    code: "EXECUTOR_AUTH_REQUIRED",
  });

  assert.deepEqual(unavailable, [{
    ...identity,
    executor_id: "executor-one",
    credential_version: 42,
    reason: "expired",
    occurred_at_ms: 200,
  }]);
});

test("heartbeat status includes verified Fields Core Plugin health for ready Members", () => {
  const runtime = {
    listMemberAppServers: () => [{
      memberId: "member-one",
      executorId: "executor-one",
      credentialVersion: 2,
      chatgptAccountId: null,
      workspace: "/workdir/members/member-one/workspace",
      codexHome: "/workdir/members/member-one/workspace/.codex",
      socketPath: "/workdir/members/member-one/workspace/.runtime/codex.sock",
      pid: 100,
      state: "running",
      lastActivityAtMs: 100,
      activeExecutionCount: 0,
      threads: [],
      plugin: {
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
      },
    }],
  } as unknown as MemberRuntimeManager;
  const lifecycle = new CompanyRuntimeLifecycle(identity, input.layout, runtime, {
    nowMs: () => 200,
  });

  assert.deepEqual(lifecycle.status().member_app_servers[0]?.plugin, {
    plugin_id: "fields-core@fields",
    plugin_name: "fields-core",
    marketplace_name: "fields",
    version: "1.0.0",
    installed: true,
    enabled: true,
    mcp_server_names: [
      "fields_embodiment",
      "fields_search",
      "fields_room_messages",
      "fields_assets",
      "fields_mail",
    ],
  });
});
