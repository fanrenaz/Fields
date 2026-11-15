import type {
  HomeMachineServices,
  HomeTurnEventsSubscription,
  SubscribeTurnEventsHandlers,
} from "../../data/home/home-machine-services";

export function subscribeHomeTurnEvents(input: {
  handlers: SubscribeTurnEventsHandlers;
  services: Pick<HomeMachineServices, "subscribeTurnEvents">;
  threadId: string;
}): HomeTurnEventsSubscription {
  return input.services.subscribeTurnEvents(
    { threadId: input.threadId },
    input.handlers,
  );
}
