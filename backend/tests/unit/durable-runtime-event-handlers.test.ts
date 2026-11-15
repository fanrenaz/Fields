import assert from "node:assert/strict";
import test from "node:test";

import type {
  EventDeadLetterTransaction,
  EventDeliveryFailure,
} from "../../src/application/eventing/index.js";
import { AgentMemberCleanupEventHandler } from "../../src/infrastructure/eventing/agent-member-cleanup-handler.js";
import { AgentRoomExecutionEventHandler } from "../../src/infrastructure/eventing/agent-room-execution-handler.js";
import { AgentRoomInteractionResponseEventHandler } from "../../src/infrastructure/eventing/agent-room-interaction-response-handler.js";
import type { PostgresActorDirectoryRepository } from "../../src/infrastructure/persistence/postgres/repositories/actor-directory-repository.js";
import type { PostgresRoomMessageRepository } from "../../src/infrastructure/persistence/postgres/repositories/room/room-message-repository.js";
import type { TrpcCompanyRuntimeGateway } from "../../src/infrastructure/runtime/company-runtime/index.js";

const context = {
  attempt: 1,
  inboxTransaction: { kind: "event-inbox-transaction" as const },
  renewClaim: async () => true,
};

test("durable interaction response remains pending after Runtime failure and retries", async () => {
  const dispatch = {
    persisted_response_id: "response-1",
    idempotency_key: "key-1",
    execution_id: "execution-1",
    room_id: "room-1",
    agent_member_id: "agent-1",
    message_id: "message-1",
    interaction_id: "interaction-1",
    responder_member_id: "human-1",
    response: "approve" as const,
    responded_at_ms: 1,
  };
  let delivered = false;
  let attempts = 0;
  const messages = {
    readPendingInteractionResponse: async () => delivered
      ? null
      : { companyId: "company-1", dispatch },
    markInteractionResponseDelivered: async () => {
      delivered = true;
    },
  };
  const runtime = {
    respondAgentRoomInteraction: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("interaction_not_pending");
      return {
        accepted: true as const,
        persisted_response_id: "response-1",
        idempotency_key: "key-1",
        duplicate: false,
      };
    },
  };
  const handler = new AgentRoomInteractionResponseEventHandler(
    messages as unknown as PostgresRoomMessageRepository,
    runtime as unknown as TrpcCompanyRuntimeGateway,
    () => 10,
  );
  const event = {
    eventId: "event-1",
    eventType: "execution.agent_room_interaction_response_requested.v1",
    schemaVersion: 1,
    aggregateType: "agent_room_interaction_response",
    aggregateId: "response-1",
    sequence: 1,
    payload: {
      company_id: "company-1",
      persisted_response_id: "response-1",
      requested_at_ms: 1,
    },
    occurredAtMs: 1,
  };
  await assert.rejects(handler.handle(event, {
    ...context,
    consumerName: "runtime.agent-room-interaction-response",
  }));
  assert.equal(delivered, false);
  await handler.handle(event, {
    ...context,
    attempt: 2,
    consumerName: "runtime.agent-room-interaction-response",
  });
  assert.equal(delivered, true);
  assert.equal(attempts, 2);
});

test("Agent cleanup waits for terminal executions before Runtime cleanup and finalization", async () => {
  let activeExecutionCount = 1;
  let runtimeCalls = 0;
  let mailCleanupCalls = 0;
  let finalized = false;
  let recordedAttempts = 0;
  const failureCodes: string[] = [];
  const actors = {
    readAgentMemberCleanup: async () => ({
      operationId: "cleanup-1",
      companyId: "company-1",
      memberId: "agent-1",
      status: "pending" as const,
      activeExecutionCount,
    }),
    finalizeAgentMemberCleanup: async () => {
      finalized = true;
    },
    recordAgentMemberCleanupAttempt: async () => {
      recordedAttempts += 1;
    },
    recordAgentMemberCleanupFailure: async (input: { errorCode: string }) => {
      failureCodes.push(input.errorCode);
    },
  };
  const runtime = {
    cleanupMember: async () => {
      runtimeCalls += 1;
      return {
        accepted: true as const,
        operation_id: "cleanup-1",
        member_id: "agent-1",
        duplicate: false,
      };
    },
  };
  const handler = new AgentMemberCleanupEventHandler(
    actors as unknown as PostgresActorDirectoryRepository,
    runtime as unknown as TrpcCompanyRuntimeGateway,
    {
      cleanupRemovedMember: async () => {
        mailCleanupCalls += 1;
      },
    },
    () => 10,
  );
  const event = {
    eventId: "cleanup-event",
    eventType: "execution.agent_member_cleanup_requested.v1",
    schemaVersion: 1,
    aggregateType: "agent_member_cleanup",
    aggregateId: "cleanup-1",
    sequence: 1,
    payload: {
      company_id: "company-1",
      member_id: "agent-1",
      operation_id: "cleanup-1",
      requested_at_ms: 1,
    },
    occurredAtMs: 1,
  };
  await assert.rejects(handler.handle(event, {
    ...context,
    consumerName: "runtime.agent-member-cleanup",
  }));
  assert.equal(runtimeCalls, 0);
  assert.equal(mailCleanupCalls, 0);
  assert.equal(finalized, false);
  assert.equal(recordedAttempts, 1);
  assert.deepEqual(failureCodes, ["AGENT_MEMBER_CLEANUP_EXECUTION_ACTIVE"]);
  activeExecutionCount = 0;
  await handler.handle(event, {
    ...context,
    attempt: 2,
    consumerName: "runtime.agent-member-cleanup",
  });
  assert.equal(runtimeCalls, 1);
  assert.equal(mailCleanupCalls, 1);
  assert.equal(finalized, true);
  assert.equal(recordedAttempts, 2);
});

for (const failingBoundary of ["runtime", "mail", "finalize"] as const) {
  test(`Member cleanup replays safely after ${failingBoundary} boundary failure`, async () => {
    let status: "pending" | "succeeded" = "pending";
    let runtimeCalls = 0;
    let mailCalls = 0;
    let finalizeCalls = 0;
    let failedOnce = false;
    const actors = {
      readAgentMemberCleanup: async () => ({
        operationId: "cleanup-replay",
        companyId: "company-1",
        memberId: "member-1",
        status,
        activeExecutionCount: 0,
      }),
      recordAgentMemberCleanupAttempt: async () => undefined,
      recordAgentMemberCleanupFailure: async () => undefined,
      finalizeAgentMemberCleanup: async () => {
        finalizeCalls += 1;
        if (failingBoundary === "finalize" && !failedOnce) {
          failedOnce = true;
          throw new Error("finalize unavailable");
        }
        status = "succeeded";
      },
    };
    const runtime = {
      cleanupMember: async () => {
        runtimeCalls += 1;
        if (failingBoundary === "runtime" && !failedOnce) {
          failedOnce = true;
          throw new Error("runtime unavailable");
        }
        return {
          accepted: true as const,
          operation_id: "cleanup-replay",
          member_id: "member-1",
          duplicate: runtimeCalls > 1,
        };
      },
    };
    const mail = {
      cleanupRemovedMember: async () => {
        mailCalls += 1;
        if (failingBoundary === "mail" && !failedOnce) {
          failedOnce = true;
          throw new Error("mail projection unavailable");
        }
      },
    };
    const handler = new AgentMemberCleanupEventHandler(
      actors as unknown as PostgresActorDirectoryRepository,
      runtime as unknown as TrpcCompanyRuntimeGateway,
      mail,
      () => 10,
    );
    const event = cleanupEvent({
      company_id: "company-1",
      member_id: "member-1",
      operation_id: "cleanup-replay",
    });

    await assert.rejects(handler.handle(event, {
      ...context,
      consumerName: "runtime.agent-member-cleanup",
    }));
    assert.equal(status, "pending");
    await handler.handle(event, {
      ...context,
      attempt: 2,
      consumerName: "runtime.agent-member-cleanup",
    });
    assert.equal(status, "succeeded");
    assert.equal(runtimeCalls, 2);
    assert.equal(mailCalls, failingBoundary === "runtime" ? 1 : 2);
    assert.equal(finalizeCalls, failingBoundary === "finalize" ? 2 : 1);
  });
}

test("Member cleanup rejects payload authority drift before Runtime or Backend cleanup", async () => {
  let runtimeCalls = 0;
  let mailCalls = 0;
  const handler = new AgentMemberCleanupEventHandler(
    {
      readAgentMemberCleanup: async () => ({
        operationId: "cleanup-1",
        companyId: "company-authoritative",
        memberId: "member-authoritative",
        status: "pending" as const,
        activeExecutionCount: 0,
      }),
    } as unknown as PostgresActorDirectoryRepository,
    {
      cleanupMember: async () => {
        runtimeCalls += 1;
        throw new Error("must not run");
      },
    } as unknown as TrpcCompanyRuntimeGateway,
    {
      cleanupRemovedMember: async () => {
        mailCalls += 1;
      },
    },
    () => 10,
  );
  await assert.rejects(
    handler.handle(cleanupEvent({
      company_id: "company-spoofed",
      member_id: "member-authoritative",
      operation_id: "cleanup-1",
    }), {
      ...context,
      consumerName: "runtime.agent-member-cleanup",
    }),
    (error: unknown) => (
      error instanceof Error && error.message === "AGENT_MEMBER_CLEANUP_INVALID"
    ),
  );
  assert.equal(runtimeCalls, 0);
  assert.equal(mailCalls, 0);
});

test("tenth retry dead-letter terminally fails the cleanup operation in the delivery transaction", async () => {
  const deadLetterTransaction: EventDeadLetterTransaction = {
    kind: "event-dead-letter-transaction",
  };
  let projected = false;
  const handler = new AgentMemberCleanupEventHandler(
    {
      markAgentMemberCleanupDeadLetter: async (
        transaction: EventDeadLetterTransaction,
        input: {
          operationId: string;
          failure: EventDeliveryFailure;
          attemptedAtMs: number;
        },
      ) => {
        assert.equal(transaction, deadLetterTransaction);
        assert.deepEqual(input, {
          operationId: "cleanup-dead-letter",
          failure: { code: "AGENT_MEMBER_CLEANUP_RUNTIME_UNAVAILABLE", retryable: true },
          attemptedAtMs: 1_000,
        });
        projected = true;
      },
    } as unknown as PostgresActorDirectoryRepository,
    {} as TrpcCompanyRuntimeGateway,
    { cleanupRemovedMember: async () => undefined },
    () => 10,
  );
  await handler.projectDeadLetter(
    cleanupEvent({
      company_id: "company-1",
      member_id: "member-1",
      operation_id: "cleanup-dead-letter",
    }),
    { code: "AGENT_MEMBER_CLEANUP_RUNTIME_UNAVAILABLE", retryable: true },
    {
      consumerName: "runtime.agent-member-cleanup",
      attemptedAt: 1_000,
      transaction: deadLetterTransaction,
    },
  );
  assert.equal(projected, true);
});

test("cancelled Agent execution delivery is acknowledged without invoking Runtime", async () => {
  let runtimeCalls = 0;
  const messages = {
    prepareExecutionDispatch: async () => "terminal" as const,
  };
  const runtime = {
    executeAgentRoom: async () => {
      runtimeCalls += 1;
      throw new Error("must not run");
    },
  };
  const handler = new AgentRoomExecutionEventHandler(
    messages as unknown as PostgresRoomMessageRepository,
    runtime as unknown as TrpcCompanyRuntimeGateway,
    {
      snapshotMessageInputs: async () => [],
      refreshSnapshotDownloads: async (_companyId: string, inputs: unknown[]) => inputs,
    } as never,
    () => 10,
  );
  await handler.handle({
    eventId: "execution-event",
    eventType: "execution.agent_room_requested.v1",
    schemaVersion: 1,
    aggregateType: "agent_room_execution",
    aggregateId: "execution-1",
    sequence: 1,
    payload: { company_id: "company-1", execution_id: "execution-1" },
    occurredAtMs: 1,
  }, {
    ...context,
    consumerName: "runtime.agent-room-execution",
  });
  assert.equal(runtimeCalls, 0);
});

test("Agent execution retries keep the persisted Company File version snapshot but refresh download URLs", async () => {
  const persisted = [{
    file_id: "file-1",
    version_id: "version-1",
    message_ids: ["message-1"],
    name: "plan.txt",
    mime_type: "text/plain",
    size_bytes: 4,
    sha256: "a".repeat(64),
  }];
  const refreshed = [{
    ...persisted[0]!,
    download_url: "https://files.example/fresh",
    download_expires_at_ms: 60_000,
  }];
  const messages = {
    prepareExecutionDispatch: async () => "prepared" as const,
    readExecutionDispatch: async () => ({
      company_id: "company-1",
      execution_id: "execution-1",
      idempotency_key: "execution-key",
      room_id: "room-1",
      prompt_messages: [],
      company_file_inputs: [],
    }),
    snapshotExecutionCompanyFileInputs: async (
      executionId: string,
      candidates: unknown[],
    ) => {
      assert.equal(executionId, "execution-1");
      assert.deepEqual(candidates, []);
      return persisted;
    },
  };
  const companyFiles = {
    snapshotMessageInputs: async () => [],
    refreshSnapshotDownloads: async (companyId: string, inputs: unknown[]) => {
      assert.equal(companyId, "company-1");
      assert.deepEqual(inputs, persisted);
      return refreshed;
    },
  };
  const runtime = {
    executeAgentRoom: async (companyId: string, dispatch: { company_file_inputs: unknown[] }) => {
      assert.equal(companyId, "company-1");
      assert.deepEqual(dispatch.company_file_inputs, refreshed);
      return { accepted: true, execution_id: "execution-1", idempotency_key: "execution-key" };
    },
  };
  const handler = new AgentRoomExecutionEventHandler(
    messages as unknown as PostgresRoomMessageRepository,
    runtime as unknown as TrpcCompanyRuntimeGateway,
    companyFiles as never,
    () => 10,
  );

  await handler.handle({
    eventId: "execution-event",
    eventType: "execution.agent_room_requested.v1",
    schemaVersion: 1,
    aggregateType: "agent_room_execution",
    aggregateId: "execution-1",
    sequence: 1,
    payload: { company_id: "company-1", execution_id: "execution-1" },
    occurredAtMs: 1,
  }, {
    ...context,
    consumerName: "runtime.agent-room-execution",
  });
});

function cleanupEvent(payload: {
  company_id: string;
  member_id: string;
  operation_id: string;
}) {
  return {
    eventId: `cleanup-event:${payload.operation_id}`,
    eventType: "execution.agent_member_cleanup_requested.v1",
    schemaVersion: 1,
    aggregateType: "agent_member_cleanup",
    aggregateId: payload.operation_id,
    sequence: 1,
    payload: {
      ...payload,
      requested_at_ms: 1,
    },
    occurredAtMs: 1,
  } as const;
}
