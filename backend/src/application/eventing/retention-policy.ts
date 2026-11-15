export const EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const EVENT_RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1_000;

/** The earliest timestamp eligible for completed Event retention cleanup. */
export function retentionBeforeMs(nowMs: number): number {
  return nowMs - EVENT_RETENTION_MS;
}

/** A restarted worker is deliberately due for one safe sweep immediately. */
export function isRetentionSweepDue(lastSuccessfulSweepAtMs: number | null, nowMs: number): boolean {
  return lastSuccessfulSweepAtMs === null || nowMs - lastSuccessfulSweepAtMs >= EVENT_RETENTION_SWEEP_INTERVAL_MS;
}
