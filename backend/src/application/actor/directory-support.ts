import { isActiveHumanActor, isOrdinaryAgent, type Actor } from "../../domain/actor/index.js";
import type { CompanyAccessQuery } from "../company/queries/index.js";
import { ApplicationError, isApplicationError } from "../platform/errors.js";

import {
  ACTOR_DIRECTORY_ACCESS_DENIED_CODE,
  ACTOR_DIRECTORY_DATA_INVALID_CODE,
  type ActiveHumanDirectoryCaller,
  type ActorDirectoryQueryRepository,
  type HumanActorEmailQuery,
} from "./ports/index.js";

export const COMPANY_DIRECTORY_UNAUTHENTICATED_CODE = "COMPANY_DIRECTORY_UNAUTHENTICATED";
export const COMPANY_ACTOR_NOT_FOUND_CODE = "COMPANY_ACTOR_NOT_FOUND";
export const COMPANY_OWNER_REQUIRED_CODE = "COMPANY_OWNER_REQUIRED";
export const COMPANY_OWNER_PROTECTED_CODE = "COMPANY_OWNER_PROTECTED";
export const COMPANY_ACTOR_TYPE_UNSUPPORTED_CODE = "COMPANY_ACTOR_TYPE_UNSUPPORTED";
export const COMPANY_ACTOR_PROVISIONING_FAILED_CODE = "COMPANY_ACTOR_PROVISIONING_FAILED";
export const COMPANY_DIRECTORY_INVARIANT_VIOLATION_CODE = "COMPANY_DIRECTORY_INVARIANT_VIOLATION";

const DIRECTORY_PUBLIC_CODES = new Set([
  COMPANY_DIRECTORY_UNAUTHENTICATED_CODE,
  COMPANY_ACTOR_NOT_FOUND_CODE,
  COMPANY_OWNER_REQUIRED_CODE,
  COMPANY_OWNER_PROTECTED_CODE,
  COMPANY_ACTOR_TYPE_UNSUPPORTED_CODE,
  COMPANY_ACTOR_PROVISIONING_FAILED_CODE,
  COMPANY_DIRECTORY_INVARIANT_VIOLATION_CODE,
]);

export type CompanyDirectoryActor = {
  actorId: string;
  displayName: string;
  mark: string;
  email: string | null;
  actorType: "human" | "agent";
  companyRole: "owner" | "member";
  status: "active";
};

export type CompanyActorDirectoryRequest = {
  companyId: string;
  requestedByActorId: string;
};

export type CompanyDirectoryAccessDependencies = {
  companies: CompanyAccessQuery;
  directory: ActorDirectoryQueryRepository;
};

export async function requireCompanyDirectoryCaller(
  dependencies: CompanyDirectoryAccessDependencies,
  input: CompanyActorDirectoryRequest,
): Promise<ActiveHumanDirectoryCaller> {
  requiredDirectoryRequest(input);
  await requireActiveCompany(dependencies.companies, input.companyId);
  return requireActiveHumanDirectoryCaller(dependencies.directory, input);
}

/**
 * Verifies an Actor-owned session identity without imposing a Company lifecycle
 * state. Company retry commands use this surface because `setup_failed` is a
 * valid state from which a Human owner may retry provisioning.
 */
export async function requireActiveHumanDirectoryCaller(
  directory: ActorDirectoryQueryRepository,
  input: CompanyActorDirectoryRequest,
): Promise<ActiveHumanDirectoryCaller> {
  requiredDirectoryRequest(input);
  try {
    const caller = await directory.requireActiveHumanCaller({
      actorId: input.requestedByActorId,
      companyId: input.companyId,
    });
    if (
      caller.actorId !== input.requestedByActorId
      || caller.companyId !== input.companyId
      || (caller.companyRole !== "owner" && caller.companyRole !== "member")
    ) {
      throw unauthenticated();
    }
    return caller;
  } catch (error) {
    if (isApplicationError(error) && error.code === COMPANY_DIRECTORY_UNAUTHENTICATED_CODE) {
      throw error;
    }
    if (isApplicationError(error) && error.code === ACTOR_DIRECTORY_ACCESS_DENIED_CODE) {
      throw unauthenticated();
    }
    if (isApplicationError(error) && error.retryable) {
      throw provisioningFailed(true);
    }
    if (isApplicationError(error) && error.code === ACTOR_DIRECTORY_DATA_INVALID_CODE) {
      throw unauthenticated();
    }
    if (isApplicationError(error)) {
      throw provisioningFailed(false);
    }
    throw provisioningFailed(true);
  }
}

export async function projectCompanyDirectoryActors(
  actors: readonly Actor[],
  emails: HumanActorEmailQuery,
): Promise<readonly CompanyDirectoryActor[]> {
  const authUserIds = actors.flatMap((actor) => actor.type === "human" && actor.authUserId !== null
    ? [actor.authUserId]
    : []);
  let emailByAuthUserId: ReadonlyMap<string, string>;
  try {
    emailByAuthUserId = await emails.findEmailsByAuthUserIds(authUserIds);
  } catch (error) {
    throw normalizeDirectoryFailure(error);
  }
  return actors.map((actor) => projectCompanyDirectoryActor(actor, emailByAuthUserId));
}

export function projectCompanyDirectoryActor(
  actor: Actor,
  emailByAuthUserId: ReadonlyMap<string, string>,
): CompanyDirectoryActor {
  if (!isActiveDirectoryActor(actor)) {
    throw invariant();
  }
  if (actor.type === "agent") {
    return {
      actorId: actor.id,
      displayName: actor.displayName,
      mark: actor.mark,
      email: null,
      actorType: "agent",
      companyRole: "member",
      status: "active",
    };
  }
  const email = actor.authUserId === null ? undefined : emailByAuthUserId.get(actor.authUserId);
  if (!validEmail(email)) {
    throw invariant();
  }
  return {
    actorId: actor.id,
    displayName: actor.displayName,
    mark: actor.mark,
    email,
    actorType: "human",
    companyRole: actor.companyRole,
    status: "active",
  };
}

export function requireOwner(caller: ActiveHumanDirectoryCaller): void {
  if (caller.companyRole !== "owner") {
    throw new ApplicationError(COMPANY_OWNER_REQUIRED_CODE, false);
  }
}

export function requiredDirectoryRequest(input: CompanyActorDirectoryRequest): void {
  if (!validIdentifier(input.companyId) || !validIdentifier(input.requestedByActorId)) {
    throw invariant();
  }
}

export function requiredActorId(actorId: string): void {
  if (!validIdentifier(actorId)) {
    throw invariant();
  }
}

export function requiredDisplayName(value: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > 255) {
    throw invariant();
  }
  return normalized;
}

export function requiredMark(value: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > 32) {
    throw invariant();
  }
  return normalized;
}

export function requiredTimestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invariant();
  }
  return value;
}

export function isOrdinaryAgentDirectoryTarget(actor: Actor): boolean {
  return isOrdinaryAgent(actor);
}

export function normalizeDirectoryFailure(error: unknown): ApplicationError {
  if (isApplicationError(error)) {
    if (DIRECTORY_PUBLIC_CODES.has(error.code)) {
      return error;
    }
    if (error.code === ACTOR_DIRECTORY_ACCESS_DENIED_CODE) {
      return unauthenticated();
    }
    if (error.code === ACTOR_DIRECTORY_DATA_INVALID_CODE) {
      return invariant();
    }
    return provisioningFailed(error.retryable);
  }
  return provisioningFailed(true);
}

export function actorNotFound(): ApplicationError {
  return new ApplicationError(COMPANY_ACTOR_NOT_FOUND_CODE, false);
}

export function invariant(): ApplicationError {
  return new ApplicationError(COMPANY_DIRECTORY_INVARIANT_VIOLATION_CODE, false);
}

export function provisioningFailed(retryable: boolean): ApplicationError {
  return new ApplicationError(COMPANY_ACTOR_PROVISIONING_FAILED_CODE, retryable);
}

function isActiveDirectoryActor(actor: Actor): boolean {
  return actor.status === "active"
    && validIdentifier(actor.id)
    && validIdentifier(actor.companyId)
    && validDisplayName(actor.displayName)
    && validMark(actor.mark)
    && (isActiveHumanActor(actor) || isOrdinaryAgent(actor));
}

function validIdentifier(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function validDisplayName(value: string): boolean {
  return typeof value === "string" && value === value.trim() && value.length > 0 && value.length <= 255;
}

function validMark(value: string): boolean {
  return typeof value === "string" && value === value.trim() && value.length > 0 && value.length <= 32;
}

function validEmail(value: unknown): value is string {
  return typeof value === "string"
    && value === value.trim()
    && value.length > 0
    && value.length <= 255
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}

function unauthenticated(): ApplicationError {
  return new ApplicationError(COMPANY_DIRECTORY_UNAUTHENTICATED_CODE, false);
}

async function requireActiveCompany(companies: CompanyAccessQuery, companyId: string): Promise<void> {
  try {
    const company = await companies.requireActiveCompany(companyId);
    if (company.companyId !== companyId || company.status !== "active") {
      throw unauthenticated();
    }
  } catch (error) {
    if (isApplicationError(error) && error.code === COMPANY_DIRECTORY_UNAUTHENTICATED_CODE) {
      throw error;
    }
    if (isApplicationError(error) && error.retryable) {
      throw provisioningFailed(true);
    }
    throw unauthenticated();
  }
}
