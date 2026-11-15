import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { IntervalEventClaimRenewalScheduler } from "../../../../src/infrastructure/eventing/claim-renewal-scheduler.js";

test("claim renewal interval stops after an ownership loss", async () => {
  let calls = 0;
  const lease = new IntervalEventClaimRenewalScheduler().start({
    delivery: {
      event: {
        eventId: "event_one",
        eventType: "company.provisioning_requested.v1",
        schemaVersion: 1,
        aggregateType: "company",
        aggregateId: "company_one",
        sequence: 1,
        payload: {},
        occurredAtMs: 1,
      },
      consumerName: "runtime.agent-room-execution",
      attempt: 1,
      claimToken: "claim_one",
      claimedUntilMs: 10,
    },
    intervalMs: 1,
    async renew() {
      calls += 1;
      return false;
    },
  });

  await sleep(15);
  lease.stop();
  assert.equal(calls, 1);
});

test("claim renewal rejects invalid timer intervals", () => {
  assert.throws(
    () => new IntervalEventClaimRenewalScheduler().start({
      delivery: {
        event: {
          eventId: "event_one",
          eventType: "company.provisioning_requested.v1",
          schemaVersion: 1,
          aggregateType: "company",
          aggregateId: "company_one",
          sequence: 1,
          payload: {},
          occurredAtMs: 1,
        },
        consumerName: "runtime.agent-room-execution",
        attempt: 1,
        claimToken: "claim_one",
        claimedUntilMs: 10,
      },
      intervalMs: 0,
      async renew() {
        return true;
      },
    }),
    /positive integer/u,
  );
});
