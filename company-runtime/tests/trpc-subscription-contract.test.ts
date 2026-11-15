import assert from "node:assert/strict";
import test from "node:test";

import {
  codexAgentRuntimeEventStreamSchema,
} from "@fields/contracts/internal/agent-runtime";
import {
  homeFilesystemEventStreamSchema,
} from "@fields/contracts/public/home";

import { createCompanyRuntimeTrpcRouter } from "../src/interface/trpc-router.js";

test("Company Runtime subscriptions expose their exact internal stream schemas", () => {
  const procedures = createCompanyRuntimeTrpcRouter()._def.procedures as unknown as Record<
    string,
    { _def: { output: unknown; type: string } }
  >;
  const subscriptions: ReadonlyArray<readonly [string, unknown]> = [
    ["home.filesystem.events", homeFilesystemEventStreamSchema],
    ["home.turn.events", codexAgentRuntimeEventStreamSchema],
    ["home.turn.allEvents", codexAgentRuntimeEventStreamSchema],
    ["roomSideChat.turn.events", codexAgentRuntimeEventStreamSchema],
  ];

  for (const [route, output] of subscriptions) {
    assert.equal(procedures[route]?._def.type, "subscription", route);
    assert.equal(procedures[route]?._def.output, output, route);
  }
});
