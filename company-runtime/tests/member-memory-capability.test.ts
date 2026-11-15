import assert from "node:assert/strict";
import test from "node:test";

import { MemberMemoryCapabilityService } from "../src/application/member-memory/capability.js";
import type { MemberRuntimeManager } from "../src/application/member-runtime/manager.js";

test("Member Memory operations for one Member apply in submission order", async () => {
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const starts: boolean[] = [];
  const completions: boolean[] = [];
  let completeAll!: () => void;
  const allCompleted = new Promise<void>((resolve) => { completeAll = resolve; });
  const runtime = {
    restartMemberAppServer: async (_memberId: string, memory: { enabled: boolean }) => {
      starts.push(memory.enabled);
      if (starts.length === 1) await firstGate;
      return new Map();
    },
  } as unknown as MemberRuntimeManager;
  const service = new MemberMemoryCapabilityService(runtime, async (input) => {
    completions.push(input.appliedEnabled);
    if (completions.length === 2) completeAll();
  }, () => 1);

  service.apply(operation("enable", true, false));
  service.apply(operation("disable", false, true));
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(starts, [true]);
  releaseFirst();
  await allCompleted;
  assert.deepEqual(starts, [true, false]);
  assert.deepEqual(completions, [true, false]);
});

function operation(operationId: string, enabled: boolean, previousEnabled: boolean) {
  return {
    company_id: "company-1",
    member_id: "member-1",
    operation_id: operationId,
    enabled,
    previous_enabled: previousEnabled,
    memory_model: "provider-codex-model",
  };
}
