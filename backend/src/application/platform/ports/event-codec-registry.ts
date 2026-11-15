export interface EventCodec<TPayload> {
  readonly eventType: string;
  readonly schemaVersion: number;
  encode(payload: TPayload): Readonly<Record<string, unknown>>;
  decode(value: unknown): TPayload;
}

/** Registry lookup is the only route from persisted payload JSON to a typed event. */
export interface EventCodecRegistry {
  find(eventType: string, schemaVersion: number): EventCodec<unknown> | null;
}
