import assert from "node:assert/strict";
import test from "node:test";

import { agentRoomTriggerPolicySchema } from "@fields/contracts/public/agent-room";

import {
  triggerMatrixFromPolicy,
  triggerPolicyFromMatrix,
} from "../../../../features/room/agent-trigger-matrix";

test("the trigger matrix maps all six policies without exposing unsupported combinations", () => {
  const policies = agentRoomTriggerPolicySchema.options;
  assert.equal(policies.length, 6);

  for (const policy of policies) {
    assert.equal(
      triggerPolicyFromMatrix(triggerMatrixFromPolicy(policy)),
      policy,
    );
  }
});

test("the two mixed policies remain legible as matrix coordinates", () => {
  assert.deepEqual(
    triggerMatrixFromPolicy("human_explicit_agent_auto"),
    { human: "explicit", agent: "automatic" },
  );
  assert.deepEqual(
    triggerMatrixFromPolicy("agent_explicit_human_auto"),
    { human: "automatic", agent: "explicit" },
  );
});
