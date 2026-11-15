/**
 * An opaque capability created only by a Unit of Work. Passing it to the
 * writer makes the transactional requirement explicit without exposing a
 * database transaction to application code.
 */
export interface OutboxTransaction {
  readonly kind: "outbox-transaction";
}

export type VersionedOutboxEvent = {
  eventId: string;
  eventType: string;
  schemaVersion: number;
  aggregateType: string;
  aggregateId: string;
  payload: Readonly<Record<string, unknown>>;
  occurredAtMs: number;
};

export interface OutboxWriter {
  append(transaction: OutboxTransaction, event: VersionedOutboxEvent): Promise<void>;
}
