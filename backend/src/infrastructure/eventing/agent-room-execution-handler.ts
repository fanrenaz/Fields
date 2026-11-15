import { z } from "zod";

import type {
  EventHandler,
  EventHandlingContext,
  PersistedEvent,
} from "../../application/eventing/index.js";
import { ApplicationError } from "../../application/platform/errors.js";
import type { PostgresRoomMessageRepository } from "../persistence/postgres/repositories/room/room-message-repository.js";
import type { TrpcCompanyRuntimeGateway } from "../runtime/company-runtime/index.js";
import type { CompanyFileApplication } from "../../application/company/ports/company-files.js";

const payloadSchema = z.strictObject({
  company_id: z.string().min(1),
  execution_id: z.string().min(1),
}).passthrough();

export class AgentRoomExecutionEventHandler implements EventHandler {
  readonly consumerName = "runtime.agent-room-execution" as const;

  constructor(
    private readonly messages: PostgresRoomMessageRepository,
    private readonly runtime: TrpcCompanyRuntimeGateway,
    private readonly companyFiles: CompanyFileApplication,
    private readonly now: () => number,
  ) {}

  async handle(event: PersistedEvent, context: EventHandlingContext): Promise<void> {
    if (
      context.consumerName !== this.consumerName
      || event.eventType !== "execution.agent_room_requested.v1"
      || event.schemaVersion !== 1
    ) {
      throw new ApplicationError("AGENT_ROOM_EXECUTION_EVENT_INVALID", false);
    }
    const payload = payloadSchema.parse(event.payload);
    const prepared = await this.messages.prepareExecutionDispatch(
      payload.execution_id,
      this.now(),
    );
    if (prepared === "terminal") return;
    if (prepared === "blocked") {
      throw new ApplicationError("AGENT_ROOM_EXECUTION_PREDECESSOR_ACTIVE", true);
    }
    const dispatch = await this.messages.readExecutionDispatch(payload.execution_id);
    if (dispatch === null || dispatch.company_id !== payload.company_id) {
      throw new ApplicationError("AGENT_ROOM_EXECUTION_NOT_FOUND", false);
    }
    const companyFileSnapshot = await this.messages.snapshotExecutionCompanyFileInputs(
      dispatch.execution_id,
      await this.companyFiles.snapshotMessageInputs(
        dispatch.company_id,
        dispatch.room_id,
        dispatch.prompt_messages,
      ),
    );
    const companyFileInputs = await this.companyFiles.refreshSnapshotDownloads(
      dispatch.company_id,
      companyFileSnapshot,
    );
    const resolvedDispatch = {
      ...dispatch,
      company_file_inputs: companyFileInputs,
    };
    const accepted = await this.runtime.executeAgentRoom(payload.company_id, resolvedDispatch);
    if (
      accepted.execution_id !== dispatch.execution_id
      || accepted.idempotency_key !== dispatch.idempotency_key
    ) {
      throw new ApplicationError("AGENT_ROOM_EXECUTION_REJECTED", true);
    }
  }
}
