import type { OutboxTransaction } from "./outbox.js";

export type OwnerName = "company" | "actor" | "room" | "execution";

/**
 * Owner-scoped transaction capability. It intentionally contains no database
 * client, SQL builder, or repository implementation detail.
 */
export interface OwnerTransaction {
  readonly owner: OwnerName;
  readonly outbox: OutboxTransaction;
}

export interface OwnerUnitOfWork {
  execute<T>(owner: OwnerName, work: (transaction: OwnerTransaction) => Promise<T>): Promise<T>;
}

/** The sole approved transaction capability spanning Company and Actor. */
export interface CreateCompanyTransaction {
  readonly company: OwnerTransaction;
  readonly actor: OwnerTransaction;
  readonly outbox: OutboxTransaction;
}

export interface CreateCompanyUnitOfWork {
  execute<T>(work: (transaction: CreateCompanyTransaction) => Promise<T>): Promise<T>;
}
