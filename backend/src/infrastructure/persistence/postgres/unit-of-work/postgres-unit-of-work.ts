import type {
  CreateCompanyTransaction,
  CreateCompanyUnitOfWork,
  OutboxTransaction,
  OwnerName,
  OwnerTransaction,
  OwnerUnitOfWork,
} from "../../../../application/platform/ports/index.js";
import type { BackendDatabase } from "../database-service.js";

type BackendTransaction = Parameters<Parameters<BackendDatabase["transaction"]>[0]>[0];

const databaseByOwnerTransaction = new WeakMap<OwnerTransaction, BackendTransaction>();
const databaseByOutboxTransaction = new WeakMap<OutboxTransaction, BackendTransaction>();

/**
 * Opens one owner-scoped PostgreSQL transaction without exposing a Drizzle
 * transaction object to Application. Repositories resolve the private mapping
 * only while the callback is active.
 */
export class PostgresOwnerUnitOfWork implements OwnerUnitOfWork {
  constructor(private readonly db: BackendDatabase) {}

  async execute<T>(owner: OwnerName, work: (transaction: OwnerTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction(async (databaseTransaction) => {
      const outbox = createOutboxTransaction(databaseTransaction);
      const transaction = createOwnerTransaction(owner, outbox, databaseTransaction);
      try {
        return await work(transaction);
      } finally {
        releaseOwnerTransaction(transaction, outbox);
      }
    });
  }
}

/**
 * This is the only PostgreSQL UoW that spans Company and Actor. The two owner
 * capabilities and the Outbox capability all resolve to the same private
 * database transaction and disappear when the callback completes.
 */
export class PostgresCreateCompanyUnitOfWork implements CreateCompanyUnitOfWork {
  constructor(private readonly db: BackendDatabase) {}

  async execute<T>(work: (transaction: CreateCompanyTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction(async (databaseTransaction) => {
      const outbox = createOutboxTransaction(databaseTransaction);
      const company = createOwnerTransaction("company", outbox, databaseTransaction);
      const actor = createOwnerTransaction("actor", outbox, databaseTransaction);
      const transaction: CreateCompanyTransaction = Object.freeze({ company, actor, outbox });
      try {
        return await work(transaction);
      } finally {
        releaseOwnerTransaction(company, outbox);
        releaseOwnerTransaction(actor, outbox);
      }
    });
  }
}

/** Infrastructure-only bridge; Application receives no raw transaction shape. */
export function postgresTransactionForOwner(
  transaction: OwnerTransaction,
  expectedOwner?: OwnerName,
): BackendTransaction {
  if (expectedOwner !== undefined && transaction.owner !== expectedOwner) {
    throw new PostgresTransactionUnavailableError();
  }
  const databaseTransaction = databaseByOwnerTransaction.get(transaction);
  if (!databaseTransaction) {
    throw new PostgresTransactionUnavailableError();
  }
  return databaseTransaction;
}

/** Infrastructure-only bridge for the transaction-bound Outbox writer. */
export function postgresTransactionForOutbox(transaction: OutboxTransaction): BackendTransaction {
  const databaseTransaction = databaseByOutboxTransaction.get(transaction);
  if (!databaseTransaction) {
    throw new PostgresTransactionUnavailableError();
  }
  return databaseTransaction;
}

export class PostgresTransactionUnavailableError extends Error {
  constructor() {
    super("The PostgreSQL transaction capability is no longer active.");
    this.name = "PostgresTransactionUnavailableError";
  }
}

function createOutboxTransaction(databaseTransaction: BackendTransaction): OutboxTransaction {
  const transaction: OutboxTransaction = Object.freeze({ kind: "outbox-transaction" });
  databaseByOutboxTransaction.set(transaction, databaseTransaction);
  return transaction;
}

function createOwnerTransaction(
  owner: OwnerName,
  outbox: OutboxTransaction,
  databaseTransaction: BackendTransaction,
): OwnerTransaction {
  const transaction: OwnerTransaction = Object.freeze({ owner, outbox });
  databaseByOwnerTransaction.set(transaction, databaseTransaction);
  return transaction;
}

function releaseOwnerTransaction(transaction: OwnerTransaction, outbox: OutboxTransaction): void {
  databaseByOwnerTransaction.delete(transaction);
  databaseByOutboxTransaction.delete(outbox);
}
