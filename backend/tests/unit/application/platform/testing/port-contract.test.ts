import assert from "node:assert/strict";
import test from "node:test";

import { assertPortContract } from "../../../../../src/application/platform/testing/port-contract.js";

test("port contract harness observes a candidate before asserting its semantics", async () => {
  const calls: string[] = [];
  await assertPortContract({
    create: () => ({ read: () => "value" }),
    observe: (candidate) => {
      calls.push("observe");
      return candidate.read();
    },
    assert: (value) => {
      calls.push("assert");
      assert.equal(value, "value");
    },
  });
  assert.deepEqual(calls, ["observe", "assert"]);
});
