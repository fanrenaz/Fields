import type { Clock } from "../../application/platform/ports/index.js";

/** Production clock adapter. Tests use the explicit fake Clock instead. */
export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}
