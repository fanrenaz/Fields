import type {
  AgentRoomExecutionAccepted,
  AgentRoomExecutionCompletion,
  AgentRoomExecutionDispatch,
  AgentRoomInteractionResponseAccepted,
  AgentRoomInteractionResponseDispatch,
} from "@fields/contracts/internal/agent-room";

import type { CompanyRuntimeLifecycle } from "../company-runtime/lifecycle.js";
import {
  MemberRuntimeManager,
  type AgentRoomExecutionResult,
  type PendingAgentRoomExecutionCompletion,
} from "../member-runtime/manager.js";

export type AgentRoomExecutionCoordinatorOptions = {
  retryDelaysMs?: readonly number[];
};

const DEFAULT_RETRY_DELAYS_MS = [100, 500, 1_000, 5_000, 30_000] as const;

export class AgentRoomExecutionCoordinator {
  private readonly accepted = new Set<string>();
  private readonly tasks = new Map<string, Promise<void>>();
  private readonly deliveryTasks = new Map<string, Promise<void>>();
  private readonly retryWaiters = new Set<{
    handle: ReturnType<typeof setTimeout>;
    resolve: () => void;
  }>();
  private readonly retryDelaysMs: readonly number[];
  private started = false;
  private closing = false;

  constructor(
    readonly workdir: string,
    private readonly runtime: MemberRuntimeManager,
    private readonly lifecycle: CompanyRuntimeLifecycle,
    options: AgentRoomExecutionCoordinatorOptions = {},
  ) {
    this.retryDelaysMs = options.retryDelaysMs?.length
      ? options.retryDelaysMs
      : DEFAULT_RETRY_DELAYS_MS;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    for (const pending of await this.runtime.pendingAgentRoomExecutionCompletions()) {
      void this.deliverCompletion(pending);
    }
  }

  execute(dispatch: AgentRoomExecutionDispatch): AgentRoomExecutionAccepted {
    const duplicate = this.accepted.has(dispatch.idempotency_key);
    if (!duplicate) {
      this.accepted.add(dispatch.idempotency_key);
      const task = this.run(dispatch).finally(() => {
        if (this.tasks.get(dispatch.idempotency_key) === task) {
          this.tasks.delete(dispatch.idempotency_key);
        }
      });
      this.tasks.set(dispatch.idempotency_key, task);
      void task.catch(() => undefined);
    }
    return {
      accepted: true,
      execution_id: dispatch.execution_id,
      idempotency_key: dispatch.idempotency_key,
      duplicate,
    };
  }

  respondInteraction(
    dispatch: AgentRoomInteractionResponseDispatch,
  ): Promise<AgentRoomInteractionResponseAccepted> {
    return this.runtime.respondAgentRoomInteraction(dispatch);
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    for (const waiter of this.retryWaiters) {
      clearTimeout(waiter.handle);
      waiter.resolve();
    }
    this.retryWaiters.clear();
    await Promise.allSettled([
      ...this.tasks.values(),
      ...this.deliveryTasks.values(),
    ]);
  }

  async waitForIdle(): Promise<void> {
    while (this.tasks.size > 0 || this.deliveryTasks.size > 0) {
      await Promise.allSettled([
        ...this.tasks.values(),
        ...this.deliveryTasks.values(),
      ]);
    }
  }

  private async run(dispatch: AgentRoomExecutionDispatch): Promise<void> {
    const consumedThroughSequence = dispatch.source_message_sequence;
    let result: AgentRoomExecutionResult | null = null;
    try {
      await this.lifecycle.executionProgress({
        execution_id: dispatch.execution_id,
        status: "running",
        codex_turn_id: null,
        occurred_at_ms: Date.now(),
      });
      result = await this.runtime.dispatchAgentRoomExecution({
        executionId: dispatch.execution_id,
        idempotencyKey: dispatch.idempotency_key,
        memberId: dispatch.agent_member_id,
        roomId: dispatch.room_id,
        agentRoomThreadKey: dispatch.regeneration
          ? `${dispatch.room_id}\0${dispatch.agent_member_id}\0version:${dispatch.execution_id}`
          : `${dispatch.room_id}\0${dispatch.agent_member_id}`,
        codexThreadId: dispatch.thread.codex_thread_id,
        regeneration: dispatch.regeneration
          ? {
            sourceExecutionId: dispatch.regeneration.source_execution_id,
            forkParentThreadId: dispatch.regeneration.fork_parent_thread_id,
            forkBeforeTurnId: dispatch.regeneration.fork_before_turn_id,
          }
          : null,
        prompt: executionPrompt(dispatch),
        developerInstructions: dispatch.agent_instructions || null,
        model: dispatch.model ?? null,
        reasoningEffort: dispatch.reasoning_effort ?? null,
        companyFileInputs: dispatch.company_file_inputs,
        clientUserMessageId: dispatch.execution_id,
        completion: {
          cascadeId: dispatch.cascade_id,
          consumedThroughSequence,
        },
      });
    } catch (error) {
      const completion: AgentRoomExecutionCompletion = {
        execution_id: dispatch.execution_id,
        idempotency_key: dispatch.idempotency_key,
        cascade_id: dispatch.cascade_id,
        room_id: dispatch.room_id,
        agent_member_id: dispatch.agent_member_id,
        status: "failed",
        codex_thread_id: result?.codexThreadId ?? dispatch.thread.codex_thread_id ?? null,
        codex_turn_id: result?.codexTurnId ?? null,
        consumed_through_sequence: consumedThroughSequence,
        error: {
          code: executionErrorCode(error),
          retryable: executionErrorRetryable(error),
        },
        completed_at_ms: Date.now(),
      };
      await this.runtime.persistPendingAgentRoomExecutionCompletion(
        dispatch.agent_member_id,
        completion,
      );
      await this.deliverCompletion({
        memberId: dispatch.agent_member_id,
        completion,
      });
      return;
    }
    if (result.completion && result.completionPending) {
      await this.deliverCompletion({
        memberId: dispatch.agent_member_id,
        completion: result.completion,
      });
    }
  }

  private deliverCompletion(pending: PendingAgentRoomExecutionCompletion): Promise<void> {
    const key = pending.completion.idempotency_key;
    const existing = this.deliveryTasks.get(key);
    if (existing) return existing;
    const task = this.deliverCompletionWithRetry(pending).finally(() => {
      if (this.deliveryTasks.get(key) === task) {
        this.deliveryTasks.delete(key);
      }
    });
    this.deliveryTasks.set(key, task);
    this.runtime.trackAgentRoomExecutionCompletionDelivery(pending.memberId, task);
    return task;
  }

  private async deliverCompletionWithRetry(
    pending: PendingAgentRoomExecutionCompletion,
  ): Promise<void> {
    let attempt = 0;
    while (!this.closing) {
      try {
        await this.lifecycle.executionComplete(pending.completion);
        await this.runtime.markAgentRoomExecutionCompletionDelivered(
          pending.memberId,
          pending.completion.idempotency_key,
        );
        return;
      } catch {
        const delay = this.retryDelaysMs[
          Math.min(attempt, this.retryDelaysMs.length - 1)
        ]!;
        attempt += 1;
        await this.waitForRetry(delay);
      }
    }
  }

  private waitForRetry(delayMs: number): Promise<void> {
    if (this.closing) return Promise.resolve();
    return new Promise((resolvePromise) => {
      const waiter = {
        handle: setTimeout(() => {
          this.retryWaiters.delete(waiter);
          resolvePromise();
        }, delayMs),
        resolve: resolvePromise,
      };
      this.retryWaiters.add(waiter);
    });
  }
}

export class AgentRoomExecutionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AgentRoomExecutionError";
    this.code = code;
  }
}

export function executionPrompt(dispatch: AgentRoomExecutionDispatch): string {
  const senderByMessageId = new Map(
    dispatch.prompt_messages.map((message) => [
      message.message_id,
      message.sender.display_name,
    ]),
  );
  const conversation = dispatch.prompt_messages.map((message) => {
    const targetSender = message.reply_to?.message_ids
      .map((messageId) => senderByMessageId.get(messageId))
      .find((sender): sender is string => sender !== undefined);
    const heading = targetSender
      ? `${message.sender.display_name} (replying to ${targetSender}):`
      : `${message.sender.display_name}:`;
    return `${heading}\n${message.body.markdown}`;
  }).join("\n\n");
  return [
    `You are ${dispatch.agent_display_name}, participating in the Fields Room “${dispatch.room_title}”.`,
    "Read the conversation below and respond naturally in your final answer.",
    `Conversation:\n\n${conversation}`,
  ].join("\n\n");
}

function executionErrorCode(error: unknown): string {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : "AGENT_ROOM_EXECUTION_FAILED";
}

function executionErrorRetryable(error: unknown): boolean {
  return error instanceof Error
    && "retryable" in error
    && typeof error.retryable === "boolean"
    && error.retryable;
}
