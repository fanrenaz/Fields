import assert from "node:assert/strict";
import test from "node:test";

import {
  agentRoomPolicyTriggers,
  type AgentRoomTriggerSenderType,
} from "../../../../src/application/room/agent-room-trigger-policy.js";
import {
  agentRoomTriggerPolicies,
  type AgentRoomTriggerPolicy,
} from "../../../../src/application/room/ports/index.js";

const senderCases = [
  { explicit: false, senderType: "human" },
  { explicit: true, senderType: "human" },
  { explicit: false, senderType: "agent" },
  { explicit: true, senderType: "agent" },
  { explicit: false, senderType: "system" },
  { explicit: true, senderType: "system" },
] as const satisfies readonly {
  senderType: AgentRoomTriggerSenderType;
  explicit: boolean;
}[];

const expected = {
  human_explicit: [false, true, false, false, false, false],
  member_explicit: [false, true, false, true, false, false],
  human_auto: [true, true, false, false, false, false],
  member_auto: [true, true, true, true, false, false],
  human_explicit_agent_auto: [false, true, true, true, false, false],
  agent_explicit_human_auto: [true, true, false, true, false, false],
} as const satisfies Record<AgentRoomTriggerPolicy, readonly boolean[]>;

test("all agent Room trigger policies follow the sender and explicit-trigger matrix", () => {
  assert.deepEqual(Object.keys(expected), [...agentRoomTriggerPolicies]);

  for (const policy of agentRoomTriggerPolicies) {
    assert.deepEqual(
      senderCases.map(({ senderType, explicit }) => (
        agentRoomPolicyTriggers(policy, senderType, explicit)
      )),
      expected[policy],
      policy,
    );
  }
});
