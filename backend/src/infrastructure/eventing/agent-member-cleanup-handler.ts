import { z } from "zod";

import type {
  EventDeadLetterContext,
  EventDeliveryFailure,
  EventHandler,
  EventHandlingContext,
  PersistedEvent,
} from "../../application/eventing/index.js";
import { ApplicationError } from "../../application/platform/errors.js";
import type { MailMemberCleanupProjection } from "../../application/mail/index.js";
import type { PostgresActorDirectoryRepository } from "../persistence/postgres/repositories/actor-directory-repository.js";
import type { TrpcCompanyRuntimeGateway } from "../runtime/company-runtime/index.js";

const payloadSchema = z.strictObject({
  company_id: z.string().min(1),
  member_id: z.string().min(1),
  operation_id: z.string().min(1),
  requested_at_ms: z.number().int().nonnegative(),
});

export class AgentMemberCleanupEventHandler implements EventHandler {
  readonly consumerName = "runtime.agent-member-cleanup" as const;

  constructor(
    private readonly actors: PostgresActorDirectoryRepository,
    private readonly runtime: TrpcCompanyRuntimeGateway,
    private readonly mail: MailMemberCleanupProjection,
    private readonly now: () => number,
  ) {}

  async handle(event: PersistedEvent, context: EventHandlingContext): Promise<void> {
    if (
      context.consumerName !== this.consumerName
      || event.eventType !== "execution.agent_member_cleanup_requested.v1"
      || event.schemaVersion !== 1
    ) {
      throw new ApplicationError("AGENT_MEMBER_CLEANUP_EVENT_INVALID", false);
    }
    const payload = payloadSchema.parse(event.payload);
    const operation = await this.actors.readAgentMemberCleanup(payload.operation_id);
    if (operation === null) {
      throw new ApplicationError("AGENT_MEMBER_CLEANUP_NOT_FOUND", false);
    }
    if (
      operation.companyId !== payload.company_id
      || operation.memberId !== payload.member_id
    ) {
      throw new ApplicationError("AGENT_MEMBER_CLEANUP_INVALID", false);
    }
    if (operation.status === "succeeded" || operation.status === "failed") return;
    const attemptedAt = this.now();
    await this.actors.recordAgentMemberCleanupAttempt(operation.operationId, attemptedAt);
    try {
      if (operation.activeExecutionCount > 0) {
        throw new ApplicationError("AGENT_MEMBER_CLEANUP_EXECUTION_ACTIVE", true);
      }
      const accepted = await this.runtime.cleanupMember(
        operation.companyId,
        operation.operationId,
        operation.memberId,
      );
      if (
        !accepted.accepted
        || accepted.operation_id !== operation.operationId
        || accepted.member_id !== operation.memberId
      ) {
        throw new ApplicationError("AGENT_MEMBER_CLEANUP_REJECTED", true);
      }
      await this.mail.cleanupRemovedMember({
        companyId: operation.companyId,
        memberId: operation.memberId,
        operationId: operation.operationId,
      });
      await this.actors.finalizeAgentMemberCleanup(operation.operationId, this.now());
    } catch (error) {
      await this.actors.recordAgentMemberCleanupFailure({
        operationId: operation.operationId,
        errorCode: error instanceof ApplicationError
          ? error.code
          : "AGENT_MEMBER_CLEANUP_RUNTIME_UNAVAILABLE",
        retryable: !(error instanceof ApplicationError) || error.retryable,
        nowMs: this.now(),
      });
      throw error;
    }
  }

  async projectDeadLetter(
    event: PersistedEvent,
    failure: EventDeliveryFailure,
    context: EventDeadLetterContext,
  ): Promise<void> {
    if (
      context.consumerName !== this.consumerName
      || event.eventType !== "execution.agent_member_cleanup_requested.v1"
      || event.schemaVersion !== 1
    ) {
      throw new ApplicationError("AGENT_MEMBER_CLEANUP_EVENT_INVALID", false);
    }
    const payload = payloadSchema.parse(event.payload);
    await this.actors.markAgentMemberCleanupDeadLetter(context.transaction, {
      operationId: payload.operation_id,
      failure,
      attemptedAtMs: context.attemptedAt,
    });
  }
}
