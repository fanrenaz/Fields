import assert from "node:assert/strict";
import test from "node:test";

import type { DurableEventEngine, EventTickResult, EventWorkerHealth } from "../../../../../src/application/eventing/index.js";
import {
  eventTickDidWork,
  EventWorker,
} from "../../../../../src/interface/worker/event/worker.js";

const noWorkTick: EventTickResult = {
  fannedOut: 0,
  deliveries: {
    claimed: 0,
    succeeded: 0,
    alreadyProcessed: 0,
    retried: 0,
    deadLettered: 0,
  },
  retention: { ran: false, deleted: 0 },
};

test("Event Worker schedules engine work and reads its single authoritative health state", async () => {
  const engine = new FakeEventEngine({ ...noWorkTick, fannedOut: 1 });
  const worker = new EventWorker(engine.asEngine());

  assert.equal(await worker.tick(), true);
  assert.deepEqual(await worker.health(), {
    workerId: "event_test",
    running: false,
    consecutiveFailures: 0,
    lastSuccessfulTickAtMs: 0,
    pendingCount: 3,
    deadLetterCount: 0,
  });
  assert.equal(engine.tickCalls, 1);
});

test("Event Worker reports scheduler failures without starving durable Event work", async () => {
  const engine = new FakeEventEngine({ ...noWorkTick, fannedOut: 1 });
  let fail = true;
  const worker = new EventWorker(engine.asEngine(), {
    scheduledTasks: {
      runTick: async () => {
        if (fail) throw new Error("scheduler unavailable");
        return { queued: 0, missed: 0, cleaned: 0 };
      },
    },
  });

  await assert.rejects(worker.tick(), /scheduler unavailable/u);
  assert.equal(engine.tickCalls, 1);
  assert.equal((await worker.health()).consecutiveFailures, 1);

  fail = false;
  assert.equal(await worker.tick(), true);
  assert.equal(engine.tickCalls, 2);
  assert.equal((await worker.health()).consecutiveFailures, 0);
});

test("Event work detection ignores a due retention sweep that deletes nothing", () => {
  assert.equal(eventTickDidWork(noWorkTick), false);
  assert.equal(eventTickDidWork({ ...noWorkTick, retention: { ran: true, deleted: 1 } }), true);
  assert.equal(eventTickDidWork({ ...noWorkTick, deliveries: { ...noWorkTick.deliveries, claimed: 1 } }), true);
});

test("Event Worker starts and stops the engine lifecycle when an aborted run exits", async () => {
  const engine = new FakeEventEngine(noWorkTick);
  const worker = new EventWorker(engine.asEngine());
  const abort = new AbortController();
  abort.abort();

  await worker.run(abort.signal);
  assert.equal(engine.starts, 1);
  assert.equal(engine.stops, 1);
});

class FakeEventEngine {
  tickCalls = 0;
  starts = 0;
  stops = 0;

  constructor(private readonly tickResult: EventTickResult) {}

  asEngine(): DurableEventEngine {
    return this as unknown as DurableEventEngine;
  }

  start(): void {
    this.starts += 1;
  }

  stop(): void {
    this.stops += 1;
  }

  async runTick(): Promise<EventTickResult> {
    this.tickCalls += 1;
    return this.tickResult;
  }

  async readHealth(): Promise<EventWorkerHealth> {
    return {
      workerId: "event_test",
      running: false,
      consecutiveFailures: 0,
      lastSuccessfulTickAtMs: 0,
      pendingCount: 3,
      deadLetterCount: 0,
    };
  }
}
