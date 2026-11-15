import assert from "node:assert/strict";
import test from "node:test";

import type {
  HomeTurnEventsSubscription,
  SubscribeTurnEventsHandlers,
} from "../../../../data/home/home-machine-services";
import {
  subscribeHomeTurnEvents,
} from "../../../../features/conversation/home-turn-stream";

test("Home Turn stream leaves transport recovery to tRPC and never loops terminal errors", () => {
  const subscriptions: SubscribeTurnEventsHandlers[] = [];
  let unsubscribed = 0;
  let errors = 0;
  let starts = 0;
  const services = {
    subscribeTurnEvents(
      _input: { threadId: string },
      handlers: SubscribeTurnEventsHandlers,
    ): HomeTurnEventsSubscription {
      subscriptions.push(handlers);
      return {
        unsubscribe() {
          unsubscribed += 1;
        },
      };
    },
  };
  const subscription = subscribeHomeTurnEvents({
    threadId: "thread-one",
    services,
    handlers: {
      onStarted: () => {
        starts += 1;
      },
      onEvent: () => undefined,
      onError: () => {
        errors += 1;
      },
      onComplete: () => undefined,
    },
  });

  assert.equal(subscriptions.length, 1);
  subscriptions[0]?.onError(new Error("WebSocket closed"));
  assert.equal(errors, 1);
  assert.equal(subscriptions.length, 1);
  subscriptions[0]?.onStarted?.();
  assert.equal(starts, 1);

  subscription.unsubscribe();
  assert.equal(unsubscribed, 1);
  assert.equal(subscriptions.length, 1);
});
