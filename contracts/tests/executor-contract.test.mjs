import assert from "node:assert/strict";
import test from "node:test";

import {
  executorSafeSummarySchema,
  executorCustomApiConfigureInputSchema,
  executorModelPolicySchema,
  memberExecutorAssignmentSchema,
  memberExecutorErrorCodeSchema,
  personalExecutorSummarySchema,
} from "../dist/public/executor.js";
import {
  roomMemberSchema,
  roomMembersAddInputSchema,
} from "../dist/public/room.js";
import { backendRouter } from "../dist/router/backend.js";
import {
  companyExecutorTokenIssueResultSchema,
  memberExecutorSwitchInputSchema,
  memberExecutorSwitchResultSchema,
} from "../dist/internal/company-runtime.js";

const safeExecutor = {
  executor_id: "executor_one",
  scope: "personal",
  owner_actor_id: "human_one",
  owner_display_name: "Ada",
  name: "Ada Pro",
  executor_type: "codex",
  binding_method: "device_code",
  authorization: { method: "chatgpt", plan_type: "pro" },
  availability: "available",
  model_policy: {
    revision: 1,
    status: "ready",
    models: [{
      model: "gpt-5.3-codex",
      display_name: "GPT-5.3 Codex",
      source: "catalog",
      supported_reasoning_efforts: ["medium", "high"],
      validation_status: "available",
      last_validated_at_ms: 10,
    }],
    allowed_reasoning_efforts: ["medium", "high"],
    default_model: "gpt-5.3-codex",
    default_reasoning_effort: "high",
    catalog_checked_at_ms: 9,
    updated_at_ms: 10,
  },
};

function rejected(schema, value) {
  assert.equal(schema.safeParse(value).success, false);
}

test("browser-safe Executor summaries exclude account identity and credentials", () => {
  assert.deepEqual(executorSafeSummarySchema.parse(safeExecutor), safeExecutor);
  for (const field of ["chatgpt_account_id", "access_token", "refresh_token", "auth_json", "credential_path"]) {
    rejected(executorSafeSummarySchema, { ...safeExecutor, [field]: "secret" });
  }
});

test("owner credential summaries do not carry a Room default preference", () => {
  const owned = {
    ...safeExecutor,
    authorization: { method: "chatgpt", account_id: "account_one", plan_type: "pro" },
    sharing_status: "private",
    credential_version: 2,
    connected_at_ms: 10,
    updated_at_ms: 11,
  };
  assert.deepEqual(personalExecutorSummarySchema.parse(owned), owned);
  rejected(personalExecutorSummarySchema, { ...owned, is_default_room_executor: true });
});

test("custom API authorization exposes only its method publicly and host to its owner", () => {
  const safe = {
    ...safeExecutor,
    authorization: { method: "custom_api_key" },
  };
  assert.deepEqual(executorSafeSummarySchema.parse(safe), safe);
  const owned = {
    ...safe,
    authorization: { method: "custom_api_key", endpoint_host: "api.example.test" },
    sharing_status: "private",
    credential_version: 2,
    connected_at_ms: 10,
    updated_at_ms: 11,
  };
  assert.deepEqual(personalExecutorSummarySchema.parse(owned), owned);
  assert.equal(executorCustomApiConfigureInputSchema.safeParse({
    executor_id: "executor_one",
    base_url: "https://api.example.test/v1",
    api_key: "secret",
  }).success, true);
  assert.equal(executorCustomApiConfigureInputSchema.safeParse({
    executor_id: "executor_one",
    base_url: "http://api.example.test/v1",
    api_key: "secret",
  }).success, false);
});

test("Member Executor assignment is Company-wide and has explicit switching state", () => {
  const assignment = {
    member_id: "agent_one",
    executor: safeExecutor,
    version: 3,
    session_state: "switching",
    updated_at_ms: 100,
  };
  assert.deepEqual(memberExecutorAssignmentSchema.parse(assignment), assignment);
  rejected(memberExecutorAssignmentSchema, { ...assignment, home_actor_id: "legacy" });
  rejected(memberExecutorAssignmentSchema, { ...assignment, room_id: "legacy" });
  rejected(memberExecutorAssignmentSchema, {
    ...assignment,
    executor: null,
    session_state: "ready",
  });
});

test("Room membership never embeds Executor assignment or runtime session state", () => {
  const member = {
    member_id: "agent_one",
    name: "Research Agent",
    mark: "RA",
    role: "member",
    meta: "agent",
    actor_type: "agent",
    joined_at_ms: 10,
    membership_version: 2,
  };
  assert.deepEqual(roomMemberSchema.parse(member), member);
  rejected(roomMemberSchema, { ...member, executor: safeExecutor });
  rejected(roomMemberSchema, { ...member, session_state: "ready" });

  const add = { room_id: "room_one", actor_id: "agent_one", actor_type: "agent" };
  assert.deepEqual(roomMembersAddInputSchema.parse(add), add);
  rejected(roomMembersAddInputSchema, { ...add, executor_id: "executor_one" });
});

test("public router exposes self and Owner-managed Agent Executor bindings only", () => {
  const procedures = backendRouter._def.procedures;
  assert.equal(procedures["member.executor.current"]?._def.type, "query");
  assert.equal(procedures["member.executor.options"]?._def.type, "query");
  assert.equal(procedures["member.executor.set"]?._def.type, "mutation");
  assert.equal(procedures["company.members.executor.current"]?._def.type, "query");
  assert.equal(procedures["company.members.executor.options"]?._def.type, "query");
  assert.equal(procedures["company.members.executor.set"]?._def.type, "mutation");
  assert.equal(procedures["home.executor.current"], undefined);
  assert.equal(procedures["room.members.executorOptions"], undefined);
  assert.equal(procedures["room.members.changeExecutor"], undefined);
  assert.equal(procedures["account.executors.setDefaultRoom"], undefined);
  assert.equal(procedures["account.executors.models.catalog"]?._def.type, "query");
  assert.equal(procedures["account.executors.models.validate"]?._def.type, "mutation");
  assert.equal(procedures["account.executors.models.configure"]?._def.type, "mutation");
});

test("a ready Executor policy requires one default supported by every selected model", () => {
  assert.deepEqual(executorModelPolicySchema.parse(safeExecutor.model_policy), safeExecutor.model_policy);
  rejected(executorModelPolicySchema, {
    ...safeExecutor.model_policy,
    default_reasoning_effort: "xhigh",
  });
  rejected(executorModelPolicySchema, {
    ...safeExecutor.model_policy,
    models: [{ ...safeExecutor.model_policy.models[0], validation_status: "unavailable" }],
  });
});

test("Executor switch preserves resumed Thread identities and represents rollback", () => {
  const input = {
    member_id: "agent_one",
    assignment_version: 4,
    current_executor_id: "executor_one",
    target_executor_id: "executor_two",
    target_credential_version: 7,
    target_memory_enabled: true,
    target_memory_managed: true,
    target_memory_model: "gpt-5.4",
    codex_thread_ids: ["thread_home", "thread_room"],
  };
  assert.deepEqual(memberExecutorSwitchInputSchema.parse(input), input);

  const success = {
    member_id: "agent_one",
    assignment_version: 4,
    outcome: "switched",
    session_state: "ready",
    executor_id: "executor_two",
    resumed_codex_thread_ids: ["thread_home", "thread_room"],
    error: null,
  };
  assert.deepEqual(memberExecutorSwitchResultSchema.parse(success), success);
  rejected(memberExecutorSwitchResultSchema, { ...success, session_state: "switching" });
  rejected(memberExecutorSwitchResultSchema, { ...success, error: { code: "FAILED", retryable: true } });
});

test("runtime credential issue exposes access-only ChatGPT tokens", () => {
  const issued = {
    executor_id: "executor_one",
    credential_version: 2,
    credential: {
      type: "chatgpt_auth_tokens",
      access_token: "access-only",
      account_id: "account_one",
      plan_type: "pro",
    },
  };
  assert.deepEqual(companyExecutorTokenIssueResultSchema.parse(issued), issued);
  for (const forbidden of ["refresh_token", "auth_json", "codex_auth_json"]) {
    rejected(companyExecutorTokenIssueResultSchema, {
      ...issued,
      credential: { ...issued.credential, [forbidden]: "secret" },
    });
  }
});

test("Member Executor public errors are a finite stable allowlist", () => {
  assert.equal(memberExecutorErrorCodeSchema.safeParse("FORBIDDEN").success, true);
  assert.equal(memberExecutorErrorCodeSchema.safeParse("MEMBER_EXECUTOR_RESUME_FAILED").success, true);
  assert.equal(memberExecutorErrorCodeSchema.safeParse("EXECUTOR_THREAD_MODEL_SELECTION_REQUIRED").success, true);
  assert.equal(memberExecutorErrorCodeSchema.safeParse("provider_secret").success, false);
});
