import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { DBAdapter } from "better-auth";
import { AsyncLocalStorage } from "node:async_hooks";

type BetterAuthDatabaseFactory = ReturnType<typeof drizzleAdapter>;
type FindManyQuery = Parameters<DBAdapter["findMany"]>[0];
type UpdateQuery = Parameters<DBAdapter["update"]>[0];

const RENEWAL_LOOKUP_GRACE_MS = 60_000;
const invitationRenewalExpectation = new AsyncLocalStorage<{
  invitationCredential: string | null;
}>();

export function bindInvitationRenewalExpectation(invitationCredential: string): void {
  const scope = invitationRenewalExpectation.getStore();
  if (!scope) {
    throw new Error("Invitation renewal request scope is unavailable.");
  }
  scope.invitationCredential = invitationCredential;
}

export function expectedInvitationRenewalCredential(): string | null {
  return invitationRenewalExpectation.getStore()?.invitationCredential ?? null;
}

export function runInInvitationRenewalRequestScope<T>(work: () => T): T {
  return invitationRenewalExpectation.run({ invitationCredential: null }, work);
}

export function runWithInvitationRenewalExpectation<T>(
  invitationCredential: string,
  work: () => T,
): T {
  return invitationRenewalExpectation.run({ invitationCredential }, work);
}

/**
 * Better Auth 1.6.23 removes expired invitations from the identity lookup used
 * by create-invitation before its `resend: true` branch can update the row.
 * That would replace the invitation bearer instead of renewing it.
 *
 * Keep this compatibility boundary deliberately limited to the provider's
 * email + organization + pending identity lookup. Invitation reads, accepts,
 * and Organization-wide pending lists continue to observe the persisted
 * expiry. The provider immediately writes the real 48-hour expiry when it
 * handles a resend.
 */
export function preserveExpiredInvitationIdentityForRenewal(
  baseFactory: BetterAuthDatabaseFactory,
  now: () => Date = () => new Date(),
): BetterAuthDatabaseFactory {
  return (options) => {
    const adapter = baseFactory(options);

    return {
      ...adapter,
      async findMany<T>(query: FindManyQuery): Promise<T[]> {
        const rows = await adapter.findMany<T>(query);
        if (!isPendingInvitationIdentityLookup(query)) {
          return rows;
        }

        const cutoffMs = now().getTime();
        const projectedExpiry = new Date(cutoffMs + RENEWAL_LOOKUP_GRACE_MS);
        const expectedCredential = expectedInvitationRenewalCredential();
        const candidates = expectedCredential
          ? rows.filter((row) => invitationId(row) === expectedCredential)
          : canonicalPendingInvitation(rows);
        return candidates
          .map((row) => projectExpiredInvitation(row, cutoffMs, projectedExpiry));
      },
      async update<T>(query: UpdateQuery): Promise<T | null> {
        const expectedCredential = expectedInvitationRenewalCredential();
        if (
          !expectedCredential
          || !isInvitationRenewalExpiryUpdate(query, expectedCredential)
        ) {
          return adapter.update<T>(query);
        }
        return adapter.update<T>({
          ...query,
          where: [
            ...query.where,
            { field: "status", value: "pending" },
          ],
        });
      },
    };
  };
}

function invitationId(row: unknown): string | null {
  return isRecord(row) && typeof row.id === "string" ? row.id : null;
}

function canonicalPendingInvitation<T>(rows: T[]): T[] {
  if (rows.length <= 1) return rows;
  const candidates = rows.map(canonicalCandidate);
  if (candidates.some((candidate) => candidate === null)) {
    return rows;
  }
  const validCandidates = candidates.filter(
    (candidate): candidate is CanonicalCandidate<T> => candidate !== null,
  );
  return [validCandidates.sort(compareCanonicalCandidates)[0]!.row];
}

type CanonicalCandidate<T> = {
  row: T;
  createdAtMs: number;
  id: string;
};

function canonicalCandidate<T>(row: T): CanonicalCandidate<T> | null {
  if (!isRecord(row) || typeof row.id !== "string" || row.id.length === 0) {
    return null;
  }
  const createdAtMs = toTimestamp(row.createdAt);
  if (createdAtMs === null) return null;
  return {
    row,
    createdAtMs,
    id: row.id,
  };
}

function compareCanonicalCandidates<T>(
  left: CanonicalCandidate<T>,
  right: CanonicalCandidate<T>,
): number {
  if (left.createdAtMs !== right.createdAtMs) return left.createdAtMs - right.createdAtMs;
  return left.id.localeCompare(right.id);
}

function isInvitationRenewalExpiryUpdate(
  query: UpdateQuery,
  expectedCredential: string,
): boolean {
  return query.model === "invitation"
    && query.where.length === 1
    && query.where[0]?.field === "id"
    && query.where[0].value === expectedCredential
    && Object.keys(query.update).length === 1
    && query.update.expiresAt instanceof Date;
}

function isPendingInvitationIdentityLookup(query: unknown): boolean {
  if (!isRecord(query) || query.model !== "invitation") {
    return false;
  }
  if (
    query.limit !== undefined
    || query.select !== undefined
    || query.sortBy !== undefined
    || query.offset !== undefined
    || query.join !== undefined
    || !Array.isArray(query.where)
    || query.where.length !== 3
  ) {
    return false;
  }

  const clauses = new Map<string, unknown>();
  for (const clause of query.where) {
    if (
      !isRecord(clause)
      || typeof clause.field !== "string"
      || (clause.operator !== undefined && clause.operator !== "eq")
      || (clause.connector !== undefined && clause.connector !== "AND")
      || (clause.mode !== undefined && clause.mode !== "sensitive")
    ) {
      return false;
    }
    clauses.set(clause.field, clause.value);
  }

  return clauses.size === 3
    && typeof clauses.get("email") === "string"
    && typeof clauses.get("organizationId") === "string"
    && clauses.get("status") === "pending";
}

function projectExpiredInvitation<T>(
  row: T,
  cutoffMs: number,
  projectedExpiry: Date,
): T {
  if (!isRecord(row)) {
    return row;
  }
  const expiresAtMs = toTimestamp(row.expiresAt);
  if (expiresAtMs === null || expiresAtMs > cutoffMs) {
    return row;
  }
  return {
    ...row,
    expiresAt: projectedExpiry,
  } as T;
}

function toTimestamp(value: unknown): number | null {
  if (!(value instanceof Date) && typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
