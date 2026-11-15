import type {
  AgentTurnEvent,
  AgentTurnScope,
  AgentTurnSnapshot,
} from "@fields/contracts/public/agent-activity";

export type AgentActivityProjection = {
  scope: AgentTurnScope | null;
  snapshot: AgentTurnSnapshot;
};

export type AgentActivityWarning = {
  code: "AGENT_RUNTIME_EVENT_IGNORED";
  provider: string;
  event_id: string;
  method: string;
  scope_type: AgentTurnScope["type"];
  reason: string;
};

export type AgentActivityWarningSink = (warning: AgentActivityWarning) => void;

export interface AgentRuntimeActivityAdapter<TRuntimeSnapshot, TRuntimeEvent> {
  readonly provider: string;

  createProjection(): AgentActivityProjection;

  convertSnapshot(
    projection: AgentActivityProjection,
    snapshot: TRuntimeSnapshot,
  ): AgentTurnEvent;

  convertEvent(
    projection: AgentActivityProjection,
    event: TRuntimeEvent,
  ): AgentTurnEvent[];
}
export class AgentActivityConversionError extends Error {
  readonly code = "AGENT_ACTIVITY_CONVERSION_FAILED";

  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "AgentActivityConversionError";
  }
}
