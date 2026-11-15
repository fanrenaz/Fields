import { z } from "zod";

import type {
  EventHandler,
  EventHandlingContext,
  PersistedEvent,
} from "../../application/eventing/index.js";
import { ApplicationError } from "../../application/platform/errors.js";
import type { PostgresRoomMessageRepository } from "../persistence/postgres/repositories/room/room-message-repository.js";
import type { TrpcCompanyRuntimeGateway } from "../runtime/company-runtime/index.js";

const payloadSchema = z.strictObject({
  company_id: z.string().min(1),
  persisted_response_id: z.string().min(1),
  requested_at_ms: z.number().int().nonnegative(),
});

export class AgentRoomInteractionResponseEventHandler implements EventHandler {
  readonly consumerName = "runtime.agent-room-interaction-response" as const;

  constructor(
    private readonly messages: PostgresRoomMessageRepository,
    private readonly runtime: TrpcCompanyRuntimeGateway,
    private readonly now: () => number,
  ) {}

  async handle(event: PersistedEvent, context: EventHandlingContext): Promise<void> {
    if (
      context.consumerName !== this.consumerName
      || event.eventType !== "execution.agent_room_interaction_response_requested.v1"
      || event.schemaVersion !== 1
    ) {
      throw new ApplicationError("AGENT_ROOM_INTERACTION_RESPONSE_EVENT_INVALID", false);
    }
    const payload = payloadSchema.parse(event.payload);
    const pending = await this.messages.readPendingInteractionResponse(payload.persisted_response_id);
    if (pending === null) return;
    if (pending.companyId !== payload.company_id) {
      throw new ApplicationError("AGENT_ROOM_INTERACTION_RESPONSE_INVALID", false);
    }
    const accepted = await this.runtime.respondAgentRoomInteraction(
      pending.companyId,
      pending.dispatch,
    );
    await this.messages.markInteractionResponseDelivered(
      pending.dispatch,
      accepted,
      this.now(),
    );
  }
}
