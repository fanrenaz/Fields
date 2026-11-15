import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  AgentRoomExecutionCompletion,
  AgentRoomExecutionDispatch,
} from "@fields/contracts/internal/agent-room";

import {
  AgentRoomExecutionCoordinator,
} from "../src/application/agent-room/coordinator.js";
import type { CompanyRuntimeLifecycle } from "../src/application/company-runtime/lifecycle.js";
import type {
  AgentRoomExecutionInput,
  AgentRoomExecutionResult,
  MemberRuntimeManager,
  PendingAgentRoomExecutionCompletion,
} from "../src/application/member-runtime/manager.js";

test("completion callback retries without rerunning Codex or changing the final answer", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-agent-room-coordinator-"));
  const pending = new Map<string, PendingAgentRoomExecutionCompletion>();
  let dispatchCount = 0;
  let callbackCount = 0;
  const delivered: AgentRoomExecutionCompletion[] = [];
  const trackedDeliveries: string[] = [];
  const runtime = {
    pendingAgentRoomExecutionCompletions: async () => [...pending.values()],
    dispatchAgentRoomExecution: async (input: AgentRoomExecutionInput): Promise<AgentRoomExecutionResult> => {
      dispatchCount += 1;
      assert.equal(input.prompt, [
        "You are Agent, participating in the Fields Room “Room”.",
        "Read the conversation below and respond naturally in your final answer.",
        "Conversation:\n\nHuman:\n@Agent hello",
      ].join("\n\n"));
      assert.doesNotMatch(input.prompt, /execution_token|room_files_root|message\.send|message_id/u);
      assert.equal(input.developerInstructions, "Always answer with evidence and state uncertainty.");
      assert.equal(input.model, "gpt-5.3-codex");
      assert.equal(input.reasoningEffort, "high");
      const completion = successfulCompletion("Durable reply");
      pending.set(input.idempotencyKey, { memberId: input.memberId, completion });
      return executionResult(completion);
    },
    persistPendingAgentRoomExecutionCompletion: async (
      memberId: string,
      completion: AgentRoomExecutionCompletion,
    ) => {
      pending.set(completion.idempotency_key, { memberId, completion });
    },
    markAgentRoomExecutionCompletionDelivered: async (_memberId: string, idempotencyKey: string) => {
      pending.delete(idempotencyKey);
    },
    trackAgentRoomExecutionCompletionDelivery: (
      memberId: string,
      delivery: Promise<void>,
    ) => {
      trackedDeliveries.push(memberId);
      void delivery.catch(() => undefined);
    },
  } as unknown as MemberRuntimeManager;
  const lifecycle = {
    executionProgress: async () => undefined,
    executionComplete: async (completion: AgentRoomExecutionCompletion) => {
      callbackCount += 1;
      if (callbackCount === 1) throw new Error("temporary Backend outage");
      delivered.push(completion);
    },
  } as unknown as CompanyRuntimeLifecycle;
  const coordinator = new AgentRoomExecutionCoordinator(workdir, runtime, lifecycle, {
    retryDelaysMs: [0],
  });

  await coordinator.start();
  coordinator.execute(dispatch(workdir));
  await coordinator.waitForIdle();

  assert.equal(dispatchCount, 1);
  assert.equal(callbackCount, 2);
  assert.equal(pending.size, 0);
  assert.deepEqual(trackedDeliveries, ["member-1"]);
  assert.equal(delivered[0]?.final_answer_markdown, "Durable reply");
  await coordinator.shutdown();
});

test("a rebuilt Coordinator replays a persisted pending completion before any new execution", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "fields-agent-room-coordinator-"));
  const completion = successfulCompletion("Recovered reply");
  const pending = new Map<string, PendingAgentRoomExecutionCompletion>([[
    completion.idempotency_key,
    { memberId: completion.agent_member_id, completion },
  ]]);
  let dispatchCount = 0;
  let callbackCount = 0;
  const runtime = {
    pendingAgentRoomExecutionCompletions: async () => [...pending.values()],
    dispatchAgentRoomExecution: async () => {
      dispatchCount += 1;
      throw new Error("startup replay must not execute Codex");
    },
    markAgentRoomExecutionCompletionDelivered: async (_memberId: string, idempotencyKey: string) => {
      pending.delete(idempotencyKey);
    },
    trackAgentRoomExecutionCompletionDelivery: (
      _memberId: string,
      delivery: Promise<void>,
    ) => {
      void delivery.catch(() => undefined);
    },
  } as unknown as MemberRuntimeManager;
  const lifecycle = {
    executionComplete: async (candidate: AgentRoomExecutionCompletion) => {
      callbackCount += 1;
      assert.deepEqual(candidate, completion);
    },
  } as unknown as CompanyRuntimeLifecycle;
  const coordinator = new AgentRoomExecutionCoordinator(workdir, runtime, lifecycle, {
    retryDelaysMs: [0],
  });

  await coordinator.start();
  await coordinator.waitForIdle();

  assert.equal(callbackCount, 1);
  assert.equal(dispatchCount, 0);
  assert.equal(pending.size, 0);
  await coordinator.shutdown();
});

function dispatch(_workdir: string): AgentRoomExecutionDispatch {
  return {
    execution_id: "execution-1",
    idempotency_key: "idempotency-1",
    cascade_id: "cascade-1",
    company_id: "company-1",
    room_id: "room-1",
    agent_member_id: "member-1",
    membership_version: 1,
    source_message_id: "message-1",
    source_message_sequence: 1,
    room_title: "Room",
    agent_display_name: "Agent",
    agent_instructions: "Always answer with evidence and state uncertainty.",
    model: "gpt-5.3-codex",
    reasoning_effort: "high",
    trigger: "mention",
    trigger_policy: "human_explicit",
    thread: {
      room_id: "room-1",
      agent_member_id: "member-1",
      codex_thread_id: null,
      state: "active",
      last_consumed_sequence: 0,
      membership_version: 1,
      updated_at_ms: 1,
    },
    prompt_messages: [{
      message_id: "message-1",
      sequence: 1,
      occurred_at_ms: 1,
      sender: {
        type: "human",
        id: "human-1",
        display_name: "Human",
        mark: "H",
        avatar_resource_id: null,
      },
      body: {
        format: "inline_markdown",
        markdown: "@Agent hello",
        plain_text: "@Agent hello",
      },
      reply_to: null,
      references: [],
    }],
    company_file_inputs: [],
  };
}

function successfulCompletion(
  finalAnswerMarkdown?: string,
): AgentRoomExecutionCompletion {
  return {
    execution_id: "execution-1",
    idempotency_key: "idempotency-1",
    cascade_id: "cascade-1",
    room_id: "room-1",
    agent_member_id: "member-1",
    status: "succeeded",
    codex_thread_id: "thread-1",
    codex_turn_id: "turn-1",
    consumed_through_sequence: 1,
    ...(finalAnswerMarkdown === undefined
      ? {}
      : { final_answer_markdown: finalAnswerMarkdown }),
    error: null,
    completed_at_ms: 10,
  };
}

function executionResult(
  completion: AgentRoomExecutionCompletion,
): AgentRoomExecutionResult {
  return {
    executionId: completion.execution_id,
    idempotencyKey: completion.idempotency_key,
    memberId: completion.agent_member_id,
    roomId: completion.room_id,
    agentRoomThreadKey: `${completion.room_id}\0${completion.agent_member_id}`,
    codexThreadId: completion.codex_thread_id!,
    codexTurnId: "turn-1",
    completed: true,
    agentText: completion.final_answer_markdown ?? "",
    completion,
    completionPending: true,
    replayed: false,
  };
}
