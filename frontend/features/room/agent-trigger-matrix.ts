import type { AgentRoomTriggerPolicy } from "@fields/contracts/public/agent-room";

export type AgentTriggerMode = "off" | "explicit" | "automatic";
export type HumanTriggerMode = Exclude<AgentTriggerMode, "off">;

export type AgentTriggerMatrix = {
  human: HumanTriggerMode;
  agent: AgentTriggerMode;
};

const policyMatrices = {
  human_explicit: { human: "explicit", agent: "off" },
  member_explicit: { human: "explicit", agent: "explicit" },
  human_auto: { human: "automatic", agent: "off" },
  member_auto: { human: "automatic", agent: "automatic" },
  human_explicit_agent_auto: { human: "explicit", agent: "automatic" },
  agent_explicit_human_auto: { human: "automatic", agent: "explicit" },
} as const satisfies Record<AgentRoomTriggerPolicy, AgentTriggerMatrix>;

export function triggerMatrixFromPolicy(
  policy: AgentRoomTriggerPolicy,
): AgentTriggerMatrix {
  return policyMatrices[policy];
}

export function triggerPolicyFromMatrix(
  matrix: AgentTriggerMatrix,
): AgentRoomTriggerPolicy {
  const match = Object.entries(policyMatrices).find(([, candidate]) => (
    candidate.human === matrix.human && candidate.agent === matrix.agent
  ));
  if (!match) throw new Error("Unsupported Agent trigger matrix");
  return match[0] as AgentRoomTriggerPolicy;
}
