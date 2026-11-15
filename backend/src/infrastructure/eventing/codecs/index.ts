import { z } from "zod";

import type { EventConsumerName, EventConsumerRegistry } from "../../../application/eventing/index.js";
import type { EventCodec, EventCodecRegistry } from "../../../application/platform/ports/index.js";

const agentRoomExecutionRequestedSchema = z.strictObject({
  company_id: z.string().min(1),
  room_id: z.string().min(1),
  agent_member_id: z.string().min(1),
  execution_id: z.string().min(1),
  cascade_id: z.string().min(1),
  source_message_id: z.string().min(1),
  idempotency_key: z.string().min(1),
  from_sequence: z.number().int().positive(),
  through_sequence: z.number().int().positive(),
  thread_id: z.string().min(1).nullable(),
  requested_at_ms: z.number().int().nonnegative(),
});

const agentRoomInteractionResponseRequestedSchema = z.strictObject({
  company_id: z.string().min(1),
  persisted_response_id: z.string().min(1),
  requested_at_ms: z.number().int().nonnegative(),
});

const agentMemberCleanupRequestedSchema = z.strictObject({
  company_id: z.string().min(1),
  member_id: z.string().min(1),
  operation_id: z.string().min(1),
  requested_at_ms: z.number().int().nonnegative(),
});

const scheduledTaskOccurrenceRequestedSchema = z.strictObject({
  company_id: z.string().min(1),
  task_id: z.string().min(1),
  run_id: z.string().min(1),
  requested_at_ms: z.number().int().nonnegative(),
});

export const eventCodecs: readonly EventCodec<unknown>[] = Object.freeze([
  zodEventCodec("execution.agent_room_requested.v1", agentRoomExecutionRequestedSchema),
  zodEventCodec(
    "execution.agent_room_interaction_response_requested.v1",
    agentRoomInteractionResponseRequestedSchema,
  ),
  zodEventCodec("scheduled_task.occurrence_requested.v1", scheduledTaskOccurrenceRequestedSchema),
  zodEventCodec("execution.agent_member_cleanup_requested.v1", agentMemberCleanupRequestedSchema),
]);

export class FixedEventCodecRegistry implements EventCodecRegistry {
  readonly #codecs = new Map<string, EventCodec<unknown>>();

  constructor(codecs: readonly EventCodec<unknown>[] = eventCodecs) {
    for (const codec of codecs) this.#codecs.set(key(codec.eventType, codec.schemaVersion), codec);
  }

  find(eventType: string, schemaVersion: number): EventCodec<unknown> | null {
    return this.#codecs.get(key(eventType, schemaVersion)) ?? null;
  }
}

export class FixedEventConsumerRegistry implements EventConsumerRegistry {
  consumersFor(eventType: string, schemaVersion: number): readonly EventConsumerName[] {
    if (eventType === "execution.agent_room_requested.v1" && schemaVersion === 1) {
      return Object.freeze(["runtime.agent-room-execution"]);
    }
    if (
      eventType === "execution.agent_room_interaction_response_requested.v1"
      && schemaVersion === 1
    ) {
      return Object.freeze(["runtime.agent-room-interaction-response"]);
    }
    if (eventType === "execution.agent_member_cleanup_requested.v1" && schemaVersion === 1) {
      return Object.freeze(["runtime.agent-member-cleanup"]);
    }
    if (eventType === "scheduled_task.occurrence_requested.v1" && schemaVersion === 1) {
      return Object.freeze(["runtime.scheduled-task"]);
    }
    return Object.freeze([]);
  }
}

function zodEventCodec(eventType: string, schema: z.ZodType): EventCodec<unknown> {
  return {
    eventType,
    schemaVersion: 1,
    encode: (payload) => record(schema.parse(payload)),
    decode: (payload) => record(schema.parse(payload)),
  };
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("A persisted Event payload must be an object.");
  }
  return value as Readonly<Record<string, unknown>>;
}

function key(eventType: string, schemaVersion: number): string {
  return `${eventType}:${schemaVersion}`;
}
