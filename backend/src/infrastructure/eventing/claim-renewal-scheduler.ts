import type {
  EventClaimRenewalLease,
  EventClaimRenewalScheduler,
} from "../../application/eventing/index.js";

/**
 * Timer adapter for token-bound Event claim renewal. A failed renewal stops
 * this lease; the repository fence then prevents a stale success transition.
 */
export class IntervalEventClaimRenewalScheduler implements EventClaimRenewalScheduler {
  start(input: Parameters<EventClaimRenewalScheduler["start"]>[0]): EventClaimRenewalLease {
    if (!Number.isInteger(input.intervalMs) || input.intervalMs < 1) {
      throw new RangeError("Event claim renewal interval must be a positive integer.");
    }

    let stopped = false;
    let renewing = false;
    const timer = setInterval(() => {
      if (stopped || renewing) {
        return;
      }
      renewing = true;
      void input.renew().then(
        (renewed) => {
          if (!renewed) {
            stop();
          }
        },
        () => {
          stop();
        },
      ).finally(() => {
        renewing = false;
      });
    }, input.intervalMs);

    const stop = (): void => {
      if (stopped) {
        return;
      }
      stopped = true;
      clearInterval(timer);
    };

    return { stop };
  }
}
