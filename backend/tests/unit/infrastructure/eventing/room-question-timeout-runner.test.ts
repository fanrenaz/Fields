import assert from "node:assert/strict";
import test from "node:test";

import type { AgentRoomInteractionResponseDispatch } from "@fields/contracts/internal/agent-room";

import { PostgresRoomQuestionTimeoutRunner } from "../../../../src/infrastructure/eventing/room-question-timeout-runner.js";

test("Room question timeout claims once and sends an empty timed-out answer", async () => {
  const calls: AgentRoomInteractionResponseDispatch[] = [];
  let transaction = 0;
  const database = {
    execute: async () => ({ rows: [] }),
    transaction: async (run: (database: { execute: (query: unknown) => Promise<unknown> }) => Promise<unknown>) => {
      transaction += 1;
      let call = 0;
      return run({
        execute: async () => {
          call += 1;
          if (transaction === 2 && call === 1) {
            return { rows: [{
              interaction_id: "interaction-1",
              company_id: "company-1",
              execution_id: "execution-1",
              room_id: "room-1",
              agent_member_id: "agent-1",
              message_id: "message-1",
              interaction_json: {
                id: "interaction-1",
                item_id: "item-1",
                status: "pending",
                questions: [{ id: "env", header: "Environment", question: "Where?", allow_other: false, secret: false, options: null }],
                answers: {},
                resolution: null,
                deadline_at_ms: 900,
                created_at_ms: 800,
                completed_at_ms: null,
              },
            }] };
          }
          if (transaction === 3 && call === 2) return { rows: [{ event_sequence: 7 }] };
          return { rows: [] };
        },
      });
    },
  };
  const runner = new PostgresRoomQuestionTimeoutRunner(database as never, {
    respondAgentRoomInteraction: async (_companyId, dispatch) => {
      calls.push(dispatch);
    },
  }, () => 1_000);

  assert.equal(await runner.runTick(), 1);
  assert.deepEqual(calls[0]?.response, { answers: {}, resolution: "timed_out" });
  assert.equal(calls[0]?.interaction_id, "interaction-1");
  assert.equal(transaction, 3);
});
