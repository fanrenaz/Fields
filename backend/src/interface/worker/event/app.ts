import type { FastifyInstance } from "fastify";

import type { EventWorkerHealth } from "../../../application/eventing/index.js";
import { isApplicationError } from "../../../application/platform/errors.js";
import { type EventWorker } from "./worker.js";

export const DEFAULT_EVENT_HOST = "127.0.0.1";
export const DEFAULT_EVENT_PORT = 4_104;

/** Resources are created by Composition and released only by this process. */
export type EventAppRuntime = {
  server: FastifyInstance;
  worker: EventWorker;
  close(): Promise<void>;
};

export type EventApp = {
  server: FastifyInstance;
  worker: EventWorker;
  start(): Promise<void>;
  close(): Promise<void>;
};

export type EventAppOptions = {
  runtime: EventAppRuntime;
  host?: string;
  port?: number;
};

export type EventHealthProjection = {
  statusCode: 200 | 503;
  body: {
    worker_id: string;
    running: boolean;
    consecutive_failures: number;
    last_successful_tick_at_ms: number;
    pending_count: number;
    dead_letter_count: number;
  };
};

export function createEventApp(options: EventAppOptions): EventApp {
  const { runtime } = options;
  const host = options.host ?? DEFAULT_EVENT_HOST;
  const port = options.port ?? DEFAULT_EVENT_PORT;
  const abort = new AbortController();
  let workerPromise: Promise<void> | null = null;

  runtime.server.get("/health", async (_request, reply) => {
    const projection = eventHealthProjection(await runtime.worker.health());
    reply.code(projection.statusCode);
    return projection.body;
  });
  runtime.server.get("/ready", async (_request, reply) => {
    const projection = eventHealthProjection(await runtime.worker.health());
    reply.code(projection.statusCode);
    return projection.body;
  });

  return {
    server: runtime.server,
    worker: runtime.worker,
    start: async () => {
      await runtime.server.listen({ host, port });
      workerPromise = runtime.worker.run(abort.signal);
      void workerPromise.catch((error: unknown) => {
        runtime.server.log.error(
          eventWorkerErrorLog("event_worker_stopped", error),
          "Event worker stopped unexpectedly.",
        );
      });
    },
    close: async () => {
      abort.abort();
      await workerPromise?.catch(() => undefined);
      await runtime.server.close();
      await runtime.close();
    },
  };
}

export function eventHealthProjection(health: EventWorkerHealth): EventHealthProjection {
  const healthy = health.running && health.consecutiveFailures === 0 && health.deadLetterCount === 0;
  return {
    statusCode: healthy ? 200 : 503,
    body: {
      worker_id: health.workerId,
      running: health.running,
      consecutive_failures: health.consecutiveFailures,
      last_successful_tick_at_ms: health.lastSuccessfulTickAtMs,
      pending_count: health.pendingCount,
      dead_letter_count: health.deadLetterCount,
    },
  };
}

export function eventWorkerErrorLog(
  event: "event_tick_failed" | "event_worker_stopped",
  error: unknown,
): { event: string; code: string; retryable: boolean } {
  return {
    event,
    code: isApplicationError(error) ? error.code : event,
    retryable: isApplicationError(error) ? error.retryable : true,
  };
}
