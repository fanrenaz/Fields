import { randomUUID } from "node:crypto";

import type { IdGenerator, IdentifierKind } from "../../application/platform/ports/index.js";

const prefixByKind: Record<IdentifierKind, string> = {
  company: "company",
  actor: "actor",
  room: "room",
  runtime: "runtime",
  executor: "executor",
  // Keep the legacy externally visible auth-attempt identifier shape while
  // making allocation Composition-owned like every other Product identity.
  attempt: "executor_attempt",
  event: "event",
  operation: "operation",
};

/**
 * Composition-owned opaque identifier generator for Product facts. The UUID
 * implementation detail remains outside Domain and Application code.
 */
export class UuidIdGenerator implements IdGenerator {
  constructor(private readonly generateUuid: () => string = randomUUID) {}

  next(kind: IdentifierKind): string {
    const uuid = this.generateUuid();
    if (!uuid || /[\r\n]/u.test(uuid)) {
      throw new UuidGenerationError();
    }
    return `${prefixByKind[kind]}_${uuid}`;
  }
}

export class UuidGenerationError extends Error {
  constructor() {
    super("An opaque identifier could not be generated.");
    this.name = "UuidGenerationError";
  }
}
