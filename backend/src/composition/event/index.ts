import { randomUUID } from "node:crypto";

import Fastify from "fastify";

import { DurableEventEngine, type EventHandler } from "../../application/eventing/index.js";
import type { Clock, EventCodecRegistry } from "../../application/platform/ports/index.js";
import { loadBackendEnvFiles } from "../../infrastructure/configuration/env.js";
import { SystemClock } from "../../infrastructure/configuration/index.js";
import { AgentMemberCleanupEventHandler } from "../../infrastructure/eventing/agent-member-cleanup-handler.js";
import { AgentRoomExecutionEventHandler } from "../../infrastructure/eventing/agent-room-execution-handler.js";
import { AgentRoomInteractionResponseEventHandler } from "../../infrastructure/eventing/agent-room-interaction-response-handler.js";
import { ScheduledTaskOccurrenceHandler } from "../../infrastructure/eventing/scheduled-task-occurrence-handler.js";
import { PostgresScheduledTaskRunner } from "../../infrastructure/eventing/scheduled-task-runner.js";
import { PostgresRoomQuestionTimeoutRunner } from "../../infrastructure/eventing/room-question-timeout-runner.js";
import { PostgresWebPushDeliveryRunner } from "../../infrastructure/eventing/web-push-delivery-runner.js";
import { IntervalEventClaimRenewalScheduler } from "../../infrastructure/eventing/claim-renewal-scheduler.js";
import {
  FixedEventCodecRegistry,
  FixedEventConsumerRegistry,
} from "../../infrastructure/eventing/codecs/index.js";
import { PostgresEventingRepository } from "../../infrastructure/eventing/postgres/index.js";
import {
  type BackendDatabase,
  createBackendDatabaseService,
  type BackendDatabaseService,
} from "../../infrastructure/persistence/postgres/database-service.js";
import {
  PostgresActorDirectoryRepository,
  PostgresCompanyFileActorSummaryQuery,
  PostgresMemberExecutorAssignmentRepository,
  PostgresCompanyRuntimeRepository,
  PostgresMailMemberCleanupProjection,
  PostgresCompanyFileApplication,
  PostgresRoomMessageRepository,
} from "../../infrastructure/persistence/postgres/repositories/index.js";
import {
  companyFileObjectStoreConfigFromEnv,
  S3CompanyFileObjectStore,
} from "../../infrastructure/object-storage/company-file-object-store.js";
import { postgresTransactionForOwner } from "../../infrastructure/persistence/postgres/unit-of-work/index.js";
import { TrpcCompanyRuntimeGateway } from "../../infrastructure/runtime/company-runtime/index.js";
import {
  createEventApp,
  DEFAULT_EVENT_HOST,
  DEFAULT_EVENT_PORT,
  eventWorkerErrorLog,
  EventWorker,
  type EventApp,
  type EventAppRuntime,
} from "../../interface/worker/event/index.js";

export { DEFAULT_EVENT_HOST, DEFAULT_EVENT_PORT };

export type EventCompositionOptions = {
  env?: NodeJS.ProcessEnv;
  database?: BackendDatabaseService;
};
export type EventHandlerCompositionDependencies = {
  database: BackendDatabase;
  codecs: EventCodecRegistry;
  clock: Clock;
  internalControlTokenFile: string;
  companyId: string;
  runtimeUrl: string;
  companyFileObjects: S3CompanyFileObjectStore;
};

export function createEventComposition(options: EventCompositionOptions = {}): EventApp {
  const env = options.env ?? process.env;
  const database = options.database ?? createBackendDatabaseService();
  const server = Fastify({ logger: true });
  const clock = new SystemClock();
  const codecs = new FixedEventCodecRegistry();
  const repository = new PostgresEventingRepository(database.db);
  const engine = new DurableEventEngine({
    workerId: eventWorkerId(env),
    clock,
    codecs,
    consumers: new FixedEventConsumerRegistry(),
    handlers: createEventHandlers({
      database: database.db,
      codecs,
      clock,
      internalControlTokenFile: eventInternalControlTokenFile(env),
      companyId: env.FIELDS_INTERNAL_COMPANY_ID ?? "company_internal",
      runtimeUrl: env.FIELDS_COMPANY_RUNTIME_URL ?? "http://backend:4110",
      companyFileObjects: new S3CompanyFileObjectStore(companyFileObjectStoreConfigFromEnv(env)),
    }),
    outbox: repository,
    deliveries: repository,
    inbox: repository,
    health: repository,
    claimRenewal: new IntervalEventClaimRenewalScheduler(),
  });
  const scheduledTaskRunner = new PostgresScheduledTaskRunner(database.db);
  const timeoutRuntime = new TrpcCompanyRuntimeGateway(
    new PostgresCompanyRuntimeRepository(database.db, {
      companyId: env.FIELDS_INTERNAL_COMPANY_ID ?? "company_internal",
      runtimeUrl: env.FIELDS_COMPANY_RUNTIME_URL ?? "http://backend:4110",
      controlTokenFile: eventInternalControlTokenFile(env),
    }),
    eventInternalControlTokenFile(env),
    new PostgresMemberExecutorAssignmentRepository(database.db),
  );
  const questionTimeoutRunner = new PostgresRoomQuestionTimeoutRunner(database.db, timeoutRuntime, () => clock.now());
  const worker = new EventWorker(engine, {
    pushDeliveries: new PostgresWebPushDeliveryRunner(database.db, {
      subject: env.FIELDS_WEB_PUSH_SUBJECT,
      publicKey: env.FIELDS_WEB_PUSH_VAPID_PUBLIC_KEY,
      privateKey: env.FIELDS_WEB_PUSH_VAPID_PRIVATE_KEY,
    }),
    scheduledTasks: {
      async runTick() {
        const scheduled = await scheduledTaskRunner.runTick();
        const questions = await questionTimeoutRunner.runTick();
        return { ...scheduled, queued: scheduled.queued + questions };
      },
    },
    onError: (error) => server.log.error(
      eventWorkerErrorLog("event_tick_failed", error),
      "Event tick failed; retrying.",
    ),
  });
  const runtime: EventAppRuntime = {
    server,
    worker,
    close: async () => {
      if (!options.database) await database.close();
    },
  };
  return createEventApp({
    runtime,
    host: env.FIELDS_EVENT_HOST ?? DEFAULT_EVENT_HOST,
    port: positiveInt(env.FIELDS_EVENT_PORT, DEFAULT_EVENT_PORT),
  });
}

export async function startEventFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<EventApp> {
  loadBackendEnvFiles();
  const app = createEventComposition({ env });
  await app.start();
  return app;
}

export function eventWorkerId(env: NodeJS.ProcessEnv): string {
  return env.FIELDS_EVENT_WORKER_ID?.trim() || `event_${randomUUID()}`;
}

export function eventInternalControlTokenFile(env: NodeJS.ProcessEnv): string {
  return env.FIELDS_INTERNAL_CONTROL_TOKEN_FILE ?? "";
}

export function createEventHandlers(
  dependencies: EventHandlerCompositionDependencies,
): readonly EventHandler[] {
  const runtimes = new PostgresCompanyRuntimeRepository(dependencies.database, {
    companyId: dependencies.companyId,
    runtimeUrl: dependencies.runtimeUrl,
    controlTokenFile: dependencies.internalControlTokenFile,
  });
  const assignments = new PostgresMemberExecutorAssignmentRepository(dependencies.database);
  const messages = new PostgresRoomMessageRepository(dependencies.database);
  const runtime = new TrpcCompanyRuntimeGateway(
    runtimes,
    dependencies.internalControlTokenFile,
    assignments,
  );
  const companyFiles = new PostgresCompanyFileApplication(
    dependencies.database,
    dependencies.companyFileObjects,
    () => dependencies.clock.now(),
    randomUUID,
    "event-runtime-does-not-create-company-file-shares",
    new PostgresCompanyFileActorSummaryQuery(dependencies.database),
  );
  return Object.freeze([
    new AgentRoomExecutionEventHandler(
      messages,
      runtime,
      companyFiles,
      () => dependencies.clock.now(),
    ),
    new AgentRoomInteractionResponseEventHandler(
      messages,
      runtime,
      () => dependencies.clock.now(),
    ),
    new AgentMemberCleanupEventHandler(
      new PostgresActorDirectoryRepository(
        dependencies.database,
        postgresTransactionForOwner,
      ),
      runtime,
      new PostgresMailMemberCleanupProjection(dependencies.database),
      () => dependencies.clock.now(),
    ),
    new ScheduledTaskOccurrenceHandler(
      dependencies.database,
      messages,
      runtime,
      companyFiles,
      () => dependencies.clock.now(),
    ),
  ]);
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
