import assert from "node:assert/strict";
import test from "node:test";

import { ApplicationError } from "../../src/application/platform/errors.js";
import { TrpcCompanyRuntimeGateway } from "../../src/infrastructure/runtime/company-runtime/trpc-company-runtime-gateway.js";

test("every first non-streaming Home request starts the Member App Server", async () => {
  const gateway = Object.create(
    TrpcCompanyRuntimeGateway.prototype,
  ) as TrpcCompanyRuntimeGateway;
  let startCalls = 0;
  let requestCalls = 0;
  const operation = () => ({
    query: async () => {
      requestCalls += 1;
      return {};
    },
    mutate: async () => {
      requestCalls += 1;
      return {};
    },
  });
  const client = {
    home: {
      thread: {
        list: operation(),
        search: operation(),
        read: operation(),
      },
      filesystem: {
        list: operation(),
        search: operation(),
        create: operation(),
        rename: operation(),
        delete: operation(),
      },
    },
  };
  Object.defineProperties(gateway, {
    startMemberAppServer: {
      value: async () => {
        startCalls += 1;
      },
    },
    client: {
      value: async () => client,
    },
  });

  await gateway.homeThreadList("company-1", "member-1", {} as never);
  await gateway.homeThreadSearch("company-1", "member-1", {} as never);
  await gateway.homeThreadRead("company-1", "member-1", {} as never);
  await gateway.homeFilesystemList("company-1", "member-1", {} as never);
  await gateway.homeFilesystemSearch("company-1", "member-1", {} as never);
  await gateway.homeFilesystemCreate("company-1", "member-1", {} as never);
  await gateway.homeFilesystemRename("company-1", "member-1", {} as never);
  await gateway.homeFilesystemDelete("company-1", "member-1", {} as never);

  assert.equal(startCalls, 8);
  assert.equal(requestCalls, 8);
});

test("new Home turns inherit the Executor defaults", async () => {
  const gateway = Object.create(TrpcCompanyRuntimeGateway.prototype) as TrpcCompanyRuntimeGateway;
  const submissions: Record<string, unknown>[] = [];
  Object.defineProperties(gateway, {
    startMemberAppServer: { value: async () => undefined },
    memberExecutors: { value: { readRuntimeStartFacts: async () => policy() } },
    client: { value: async () => ({
      home: {
        thread: { settings: { get: { query: async () => assert.fail("new turns have no existing settings") } } },
        turn: { submit: { mutate: async (input: Record<string, unknown>) => {
          submissions.push(input);
          return { submitted: true, thread_id: "thread-1", turn_id: "turn-1" };
        } } },
      },
    }) },
  });

  await gateway.homeTurnSubmit("company-1", "member-1", { prompt: "hello" });

  assert.equal(submissions[0]?.model, "gpt-5.3-codex");
  assert.equal(submissions[0]?.reasoning_effort, "high");
});

test("an existing Home thread with a removed model must be changed before its next turn", async () => {
  const gateway = Object.create(TrpcCompanyRuntimeGateway.prototype) as TrpcCompanyRuntimeGateway;
  Object.defineProperties(gateway, {
    startMemberAppServer: { value: async () => undefined },
    memberExecutors: { value: { readRuntimeStartFacts: async () => policy() } },
    client: { value: async () => ({
      home: {
        thread: { settings: { get: { query: async () => ({
          thread_id: "thread-old",
          model: "removed-model",
          reasoning_effort: "medium",
        }) } } },
        turn: { submit: { mutate: async () => assert.fail("invalid old thread must not submit") } },
      },
    }) },
  });

  await assert.rejects(
    gateway.homeTurnSubmit("company-1", "member-1", { thread_id: "thread-old", prompt: "hello" }),
    (error: unknown) => error instanceof ApplicationError
      && error.code === "EXECUTOR_THREAD_MODEL_SELECTION_REQUIRED"
      && error.retryable === false,
  );
});

test("private Room side-chat turns always move to the Executor defaults", async () => {
  const gateway = Object.create(TrpcCompanyRuntimeGateway.prototype) as TrpcCompanyRuntimeGateway;
  const submissions: Record<string, unknown>[] = [];
  Object.defineProperties(gateway, {
    startMemberAppServer: { value: async () => undefined },
    memberExecutors: { value: { readRuntimeStartFacts: async () => policy() } },
    client: { value: async () => ({
      roomSideChat: { turn: { submit: { mutate: async (input: Record<string, unknown>) => {
        submissions.push(input);
        return { submitted: true, thread_id: "thread-room-side", turn_id: "turn-1" };
      } } } },
    }) },
  });

  await gateway.roomSideChatTurnSubmit("company-1", "member-1", {
    room_id: "room-1",
    thread_id: "thread-old",
    prompt: "hello",
    developer_instructions: "Room context",
  });

  assert.equal(submissions[0]?.model, "gpt-5.3-codex");
  assert.equal(submissions[0]?.reasoning_effort, "high");
});

function policy() {
  return {
    executorId: "executor-1",
    credentialVersion: 1,
    allowedModels: ["gpt-5.3-codex"],
    modelReasoningEfforts: { "gpt-5.3-codex": ["medium", "high"] },
    allowedReasoningEfforts: ["medium", "high"],
    defaultModel: "gpt-5.3-codex",
    defaultReasoningEffort: "high",
  };
}
