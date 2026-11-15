import type { AgentRoomTriggerPolicy } from "./ports/index.js";

export type AgentRoomTriggerSenderType = "human" | "agent" | "system";

export function agentRoomPolicyTriggers(
  policy: AgentRoomTriggerPolicy,
  senderType: AgentRoomTriggerSenderType,
  explicit: boolean,
): boolean {
  if (senderType === "system") return false;

  switch (policy) {
    case "human_explicit":
      return senderType === "human" && explicit;
    case "member_explicit":
      return explicit;
    case "human_auto":
      return senderType === "human";
    case "member_auto":
      return true;
    case "human_explicit_agent_auto":
      return senderType === "agent" || explicit;
    case "agent_explicit_human_auto":
      return senderType === "human" || explicit;
  }
}
