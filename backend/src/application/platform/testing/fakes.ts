import type { Clock, IdGenerator, IdentifierKind } from "../ports/index.js";

/** Deliberately small test fakes; they are never integration substitutes. */
export class FixedClock implements Clock {
  constructor(private currentMs: number) {}

  now(): number {
    return this.currentMs;
  }

  set(value: number): void {
    this.currentMs = value;
  }
}

export class SequenceIdGenerator implements IdGenerator {
  private readonly nextByKind = new Map<IdentifierKind, number>();

  next(kind: IdentifierKind): string {
    const next = (this.nextByKind.get(kind) ?? 0) + 1;
    this.nextByKind.set(kind, next);
    return `${kind}_${next}`;
  }
}
