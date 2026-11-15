import { isOrdinaryAgent, type Actor } from "../../../domain/actor/index.js";
import { ApplicationError } from "../../platform/errors.js";
import type { Clock, IdGenerator, OwnerUnitOfWork } from "../../platform/ports/index.js";
import type {
  ActorDirectoryCommandRepository,
  ActorDirectoryQueryRepository,
} from "../ports/index.js";

import {
  COMPANY_ACTOR_TYPE_UNSUPPORTED_CODE,
  COMPANY_OWNER_PROTECTED_CODE,
  actorNotFound,
  invariant,
  isOrdinaryAgentDirectoryTarget,
  normalizeDirectoryFailure,
  projectCompanyDirectoryActor,
  requireCompanyDirectoryCaller,
  requireOwner,
  requiredActorId,
  requiredDisplayName,
  requiredMark,
  requiredTimestamp,
  type CompanyActorDirectoryRequest,
  type CompanyDirectoryAccessDependencies,
  type CompanyDirectoryActor,
} from "../directory-support.js";

export type CreateOrdinaryAgentInput = CompanyActorDirectoryRequest & {
  displayName: string;
  mark: string;
};

export type OrdinaryAgentDirectoryCommandDependencies = CompanyDirectoryAccessDependencies & {
  directory: ActorDirectoryQueryRepository;
  commands: ActorDirectoryCommandRepository;
  actorUnitOfWork: OwnerUnitOfWork;
  ids: IdGenerator;
  clock: Clock;
};

export interface CreateOrdinaryAgentUseCase {
  execute(input: CreateOrdinaryAgentInput): Promise<CompanyDirectoryActor>;
}

/**
 * Router-facing directory command that preserves legacy authorization order:
 * caller ownership is decided before a non-Agent actor type is rejected.
 */
export type CreateCompanyDirectoryActorInput = CompanyActorDirectoryRequest & {
  actorType: string;
  displayName: string;
  mark: string;
};

export interface CreateCompanyDirectoryActorUseCase {
  execute(input: CreateCompanyDirectoryActorInput): Promise<CompanyDirectoryActor>;
}

export class CreateCompanyDirectoryActor implements CreateCompanyDirectoryActorUseCase {
  constructor(private readonly dependencies: OrdinaryAgentDirectoryCommandDependencies) {}

  async execute(input: CreateCompanyDirectoryActorInput): Promise<CompanyDirectoryActor> {
    try {
      const caller = await requireCompanyDirectoryCaller(this.dependencies, input);
      requireOwner(caller);
      if (input.actorType !== "agent") {
        throw new ApplicationError(COMPANY_ACTOR_TYPE_UNSUPPORTED_CODE, false);
      }
      return createOrdinaryAgentForAuthorizedOwner(this.dependencies, input);
    } catch (error) {
      throw normalizeDirectoryFailure(error);
    }
  }
}

/** Creates the directory-managed Agent shape: an active Company member. */
export class CreateOrdinaryAgent implements CreateOrdinaryAgentUseCase {
  constructor(private readonly dependencies: OrdinaryAgentDirectoryCommandDependencies) {}

  async execute(input: CreateOrdinaryAgentInput): Promise<CompanyDirectoryActor> {
    try {
      const caller = await requireCompanyDirectoryCaller(this.dependencies, input);
      requireOwner(caller);
      return createOrdinaryAgentForAuthorizedOwner(this.dependencies, input);
    } catch (error) {
      throw normalizeDirectoryFailure(error);
    }
  }
}

async function createOrdinaryAgentForAuthorizedOwner(
  dependencies: OrdinaryAgentDirectoryCommandDependencies,
  input: { companyId: string; displayName: string; mark: string },
): Promise<CompanyDirectoryActor> {
  const displayName = requiredDisplayName(input.displayName);
  const mark = requiredMark(input.mark);
  const nowMs = requiredTimestamp(dependencies.clock.now());
  const actor: Actor = {
    id: dependencies.ids.next("actor"),
    companyId: input.companyId,
    type: "agent",
    displayName,
    mark,
    companyRole: "member",
    status: "active",
    authUserId: null,
  };
  requiredActorId(actor.id);
  if (!isOrdinaryAgent(actor)) {
    throw invariant();
  }

  const created = await dependencies.actorUnitOfWork.execute("actor", (transaction) =>
    dependencies.commands.createOrdinaryAgent(transaction, actor, nowMs));
  assertCreatedOrdinaryAgent(created, actor);
  return projectCompanyDirectoryActor(created, new Map<string, string>());
}

export type RemoveOrdinaryAgentInput = CompanyActorDirectoryRequest & {
  actorId: string;
};

export type RemoveOrdinaryAgentResult = {
  actorId: string;
  status: "inactive";
};

export interface RemoveOrdinaryAgentUseCase {
  execute(input: RemoveOrdinaryAgentInput): Promise<RemoveOrdinaryAgentResult>;
}

/**
 * Removes only an ordinary Agent. Human lifecycle remains Better Auth-owned.
 */
export class RemoveOrdinaryAgent implements RemoveOrdinaryAgentUseCase {
  constructor(private readonly dependencies: OrdinaryAgentDirectoryCommandDependencies) {}

  async execute(input: RemoveOrdinaryAgentInput): Promise<RemoveOrdinaryAgentResult> {
    try {
      requiredActorId(input.actorId);
      const caller = await requireCompanyDirectoryCaller(this.dependencies, input);
      requireOwner(caller);
      const nowMs = requiredTimestamp(this.dependencies.clock.now());
      const target = await this.dependencies.actorUnitOfWork.execute("actor", async (transaction) => {
        const current = await this.dependencies.commands.findActorForRemoval(transaction, {
          actorId: input.actorId,
          companyId: input.companyId,
        });
        if (current === null) {
          throw actorNotFound();
        }
        assertRemovalTarget(current, input);
        const updated = await this.dependencies.commands.deactivateOrdinaryAgent(transaction, {
          actorId: input.actorId,
          companyId: input.companyId,
          updatedAtMs: nowMs,
        });
        if (updated === null) {
          throw actorNotFound();
        }
        assertInactiveOrdinaryAgent(updated, input);
        return updated;
      });
      return { actorId: target.id, status: "inactive" };
    } catch (error) {
      throw normalizeDirectoryFailure(error);
    }
  }
}

function assertCreatedOrdinaryAgent(created: Actor | null, expected: Actor): asserts created is Actor {
  if (
    created === null
    || !isOrdinaryAgent(created)
    || created.status !== "active"
    || created.id !== expected.id
    || created.companyId !== expected.companyId
    || created.displayName !== expected.displayName
    || created.mark !== expected.mark
  ) {
    throw invariant();
  }
}

function assertRemovalTarget(actor: Actor, input: RemoveOrdinaryAgentInput): void {
  if (actor.id !== input.actorId || actor.companyId !== input.companyId) {
    throw invariant();
  }
  if (actor.companyRole === "owner") {
    throw new ApplicationError(COMPANY_OWNER_PROTECTED_CODE, false);
  }
  if (actor.companyRole !== "member") {
    throw invariant();
  }
  if (actor.type === "human") {
    throw new ApplicationError(COMPANY_ACTOR_TYPE_UNSUPPORTED_CODE, false);
  }
  if (!isOrdinaryAgentDirectoryTarget(actor)) {
    throw invariant();
  }
}

function assertInactiveOrdinaryAgent(actor: Actor, input: RemoveOrdinaryAgentInput): void {
  if (
    !isOrdinaryAgent(actor)
    || actor.id !== input.actorId
    || actor.companyId !== input.companyId
    || actor.status !== "inactive"
  ) {
    throw invariant();
  }
}
