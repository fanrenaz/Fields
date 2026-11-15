import assert from "node:assert/strict";
import test from "node:test";

import {
  MemberExecutorAssignmentService,
  type MemberExecutorAssignment,
  type PostgresMemberExecutorAssignmentRepository,
} from "../../src/infrastructure/persistence/postgres/repositories/index.js";

const switchingAssignment: MemberExecutorAssignment = {
  companyId: "company-1",
  memberId: "agent-1",
  executor: {
    executorId: "executor-old",
    ownerMemberId: "owner-1",
    ownerDisplayName: "Owner",
    name: "Old",
    sharingState: "company_shared",
    availability: "available",
    executorType: "codex",
    configurationStatus: "ready",
    configurationRevision: 1,
    allowedModels: [{ model: "gpt-5", display_name: "GPT-5", source: "catalog", supported_reasoning_efforts: ["medium"], validation_status: "available", last_validated_at_ms: 1 }],
    allowedReasoningEfforts: ["medium"],
    defaultModel: "gpt-5",
    defaultReasoningEffort: "medium",
    catalogCheckedAtMs: 1,
    configurationUpdatedAtMs: 1,
    authorization: { method: "chatgpt", planType: "team" },
  },
  assignmentVersion: 2,
  state: "switching",
  pendingExecutorId: "executor-new",
  switchOperationId: "switch-1",
  lastErrorCode: null,
  lastErrorRetryable: null,
  updatedAtMs: 10,
};

test("Executor switch forwards authoritative persisted Codex Thread ids", async () => {
  let runtimeInput: Record<string, unknown> | null = null;
  const committed: MemberExecutorAssignment = {
    ...switchingAssignment,
    executor: { ...switchingAssignment.executor, executorId: "executor-new", name: "New" },
    state: "ready",
    pendingExecutorId: null,
    switchOperationId: null,
  };
  const repository = {
    beginSwitch: async () => ({
      kind: "switching" as const,
      assignment: switchingAssignment,
      previousExecutorId: "executor-old",
      targetExecutorId: "executor-new",
      operationId: "switch-1",
    }),
    readRuntimeSwitchFacts: async () => ({
      credentialVersion: 7,
      codexThreadIds: ["thread-room-a", "thread-room-b"],
    }),
    commitSwitch: async () => committed,
    rollbackSwitch: async () => {
      throw new Error("rollback must not run");
    },
  } as unknown as PostgresMemberExecutorAssignmentRepository;
  const service = new MemberExecutorAssignmentService(
    repository,
    {
      stopMemberAppServer: async () => {
        throw new Error("stop must not run");
      },
      switchExecutor: async (_companyId, input) => {
        runtimeInput = input;
        return {
          member_id: input.member_id,
          assignment_version: input.assignment_version,
          outcome: "switched",
          session_state: "ready",
          executor_id: input.target_executor_id,
          resumed_codex_thread_ids: [...input.codex_thread_ids],
          error: null,
        };
      },
    },
    () => 20,
    () => "switch-1",
  );

  const result = await service.set({
    companyId: "company-1",
    memberId: "agent-1",
    executorId: "executor-new",
    authority: { kind: "company_owner", requestedByMemberId: "owner-1" },
  });

  assert.deepEqual(
    (runtimeInput as { codex_thread_ids?: unknown } | null)?.codex_thread_ids,
    ["thread-room-a", "thread-room-b"],
  );
  assert.equal(result.executor.executorId, "executor-new");
  assert.equal(result.state, "ready");
});

test("Executor switch rolls the Backend assignment back when Runtime loses a Thread", async () => {
  let rollbackError: { code: string; retryable: boolean } | null = null;
  const repository = {
    beginSwitch: async () => ({
      kind: "switching" as const,
      assignment: switchingAssignment,
      previousExecutorId: "executor-old",
      targetExecutorId: "executor-new",
      operationId: "switch-1",
    }),
    readRuntimeSwitchFacts: async () => ({
      credentialVersion: 7,
      codexThreadIds: ["thread-room-a", "thread-room-b"],
    }),
    commitSwitch: async () => {
      throw new Error("commit must not run");
    },
    rollbackSwitch: async (input: { errorCode: string; retryable: boolean }) => {
      rollbackError = { code: input.errorCode, retryable: input.retryable };
      return {
        ...switchingAssignment,
        state: "failed" as const,
        pendingExecutorId: null,
        switchOperationId: null,
      };
    },
    failSwitch: async () => {
      throw new Error("failSwitch must not run");
    },
  } as unknown as PostgresMemberExecutorAssignmentRepository;
  const service = new MemberExecutorAssignmentService(
    repository,
    {
      stopMemberAppServer: async () => {
        throw new Error("stop must not run");
      },
      switchExecutor: async (_companyId, input) => {
        const compensation = input.target_executor_id === "executor-old";
        return {
          member_id: input.member_id,
          assignment_version: input.assignment_version,
          outcome: "switched",
          session_state: "ready",
          executor_id: input.target_executor_id,
          resumed_codex_thread_ids: compensation
            ? [...input.codex_thread_ids]
            : ["thread-room-a"],
          error: null,
        };
      },
    },
    () => 20,
    () => "switch-1",
  );

  await assert.rejects(service.set({
    companyId: "company-1",
    memberId: "agent-1",
    executorId: "executor-new",
    authority: { kind: "company_owner", requestedByMemberId: "owner-1" },
  }), /MEMBER_EXECUTOR_SWITCH_CONFLICT/u);
  assert.deepEqual(rollbackError, {
    code: "MEMBER_EXECUTOR_SWITCH_CONFLICT",
    retryable: true,
  });
});

test("Executor switch compensates Runtime before rolling Backend back when commit fails", async () => {
  const runtimeTargets: string[] = [];
  let rolledBack = false;
  const repository = {
    beginSwitch: async () => ({
      kind: "switching" as const,
      assignment: switchingAssignment,
      previousExecutorId: "executor-old",
      targetExecutorId: "executor-new",
      operationId: "switch-1",
    }),
    readRuntimeSwitchFacts: async (input: { targetExecutorId: string }) => ({
      credentialVersion: input.targetExecutorId === "executor-old" ? 3 : 7,
      codexThreadIds: ["thread-room-a", "thread-room-b"],
    }),
    commitSwitch: async () => {
      throw new Error("database commit failed");
    },
    rollbackSwitch: async () => {
      rolledBack = true;
      return switchingAssignment;
    },
    failSwitch: async () => {
      throw new Error("failSwitch must not run");
    },
  } as unknown as PostgresMemberExecutorAssignmentRepository;
  const service = new MemberExecutorAssignmentService(
    repository,
    {
      stopMemberAppServer: async () => {
        throw new Error("stop must not run");
      },
      switchExecutor: async (_companyId, input) => {
        runtimeTargets.push(input.target_executor_id);
        return {
          member_id: input.member_id,
          assignment_version: input.assignment_version,
          outcome: "switched",
          session_state: "ready",
          executor_id: input.target_executor_id,
          resumed_codex_thread_ids: [...input.codex_thread_ids],
          error: null,
        };
      },
    },
    () => 20,
    () => "switch-1",
  );

  await assert.rejects(service.set({
    companyId: "company-1",
    memberId: "agent-1",
    executorId: "executor-new",
    authority: { kind: "company_owner", requestedByMemberId: "owner-1" },
  }), /database commit failed/u);
  assert.deepEqual(runtimeTargets, ["executor-new", "executor-old"]);
  assert.equal(rolledBack, true);
});

test("Executor switch preserves failed state when Runtime compensation fails", async () => {
  let failure: { code: string; retryable: boolean } | null = null;
  let rollbackCalled = false;
  const repository = {
    beginSwitch: async () => ({
      kind: "switching" as const,
      assignment: switchingAssignment,
      previousExecutorId: "executor-old",
      targetExecutorId: "executor-new",
      operationId: "switch-1",
    }),
    readRuntimeSwitchFacts: async () => ({
      credentialVersion: 7,
      codexThreadIds: ["thread-room-a", "thread-room-b"],
    }),
    commitSwitch: async () => {
      throw new Error("database commit failed");
    },
    rollbackSwitch: async () => {
      rollbackCalled = true;
      return switchingAssignment;
    },
    failSwitch: async (input: { errorCode: string; retryable: boolean }) => {
      failure = { code: input.errorCode, retryable: input.retryable };
    },
  } as unknown as PostgresMemberExecutorAssignmentRepository;
  const service = new MemberExecutorAssignmentService(
    repository,
    {
      stopMemberAppServer: async () => {
        throw new Error("stop must not run");
      },
      switchExecutor: async (_companyId, input) => {
        if (input.target_executor_id === "executor-old") {
          throw new Error("Runtime compensation failed");
        }
        return {
          member_id: input.member_id,
          assignment_version: input.assignment_version,
          outcome: "switched",
          session_state: "ready",
          executor_id: input.target_executor_id,
          resumed_codex_thread_ids: [...input.codex_thread_ids],
          error: null,
        };
      },
    },
    () => 20,
    () => "switch-1",
  );

  await assert.rejects(service.set({
    companyId: "company-1",
    memberId: "agent-1",
    executorId: "executor-new",
    authority: { kind: "company_owner", requestedByMemberId: "owner-1" },
  }), /MEMBER_EXECUTOR_SWITCH_COMPENSATION_FAILED/u);
  assert.deepEqual(failure, {
    code: "MEMBER_EXECUTOR_SWITCH_COMPENSATION_FAILED",
    retryable: true,
  });
  assert.equal(rollbackCalled, false);
});
