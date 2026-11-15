import type { RuntimeMemberMemoryApplyInput } from "@fields/contracts/internal/member-memory";

import type { MemberRuntimeManager } from "../member-runtime/manager.js";
import { emitLifecycleEvent } from "../../observability/events.js";

export type MemberMemoryCompletion = {
  memberId: string;
  operationId: string;
  appliedEnabled: boolean;
  status: "ready" | "failed";
  errorCode: string | null;
  completedAtMs: number;
};

export class MemberMemoryCapabilityService {
  private readonly operations = new Map<string, Promise<void>>();
  private readonly memberFlights = new Map<string, Promise<void>>();

  constructor(
    private readonly runtime: MemberRuntimeManager,
    private readonly complete: (input: MemberMemoryCompletion) => Promise<void>,
    private readonly nowMs: () => number = Date.now,
  ) {}

  apply(input: RuntimeMemberMemoryApplyInput): { accepted: true } {
    if (!this.operations.has(input.operation_id)) {
      const previous = this.memberFlights.get(input.member_id) ?? Promise.resolve();
      const operation = previous.catch(() => undefined).then(
        () => this.applyAfterCurrentTurn(input),
      ).finally(() => {
        this.operations.delete(input.operation_id);
        if (this.memberFlights.get(input.member_id) === operation) this.memberFlights.delete(input.member_id);
      });
      this.operations.set(input.operation_id, operation);
      this.memberFlights.set(input.member_id, operation);
      void operation.catch(() => undefined);
    }
    return { accepted: true };
  }

  private async applyAfterCurrentTurn(input: RuntimeMemberMemoryApplyInput): Promise<void> {
    try {
      await this.runtime.restartMemberAppServer(input.member_id, {
        enabled: input.enabled,
        model: input.memory_model,
      });
      await this.complete({
        memberId: input.member_id,
        operationId: input.operation_id,
        appliedEnabled: input.enabled,
        status: "ready",
        errorCode: null,
        completedAtMs: this.nowMs(),
      });
      emitLifecycleEvent("codex.member_memory.apply", {
        result: "succeeded",
        code: input.enabled ? "enabled" : "disabled",
        retryable: false,
        "fields.actor_id": input.member_id,
      });
    } catch (error) {
      const code = runtimeErrorCode(error);
      await this.complete({
        memberId: input.member_id,
        operationId: input.operation_id,
        appliedEnabled: input.previous_enabled,
        status: "failed",
        errorCode: code,
        completedAtMs: this.nowMs(),
      });
      emitLifecycleEvent("codex.member_memory.apply", {
        result: "failed",
        code,
        retryable: true,
        "fields.actor_id": input.member_id,
      });
    }
  }
}

function runtimeErrorCode(error: unknown): string {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : "member_memory_apply_failed";
}
