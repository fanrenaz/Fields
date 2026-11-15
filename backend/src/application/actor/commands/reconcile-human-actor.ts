import { markFromDisplayName, type Actor } from "../../../domain/actor/index.js";
import { ApplicationError, isApplicationError } from "../../platform/errors.js";
import type { Clock, IdGenerator, OwnerTransaction, OwnerUnitOfWork } from "../../platform/ports/index.js";
import type { ActorCommandRepository } from "../ports/index.js";

export const ACTOR_HUMAN_PROJECTION_CONFLICT_CODE = "ACTOR_HUMAN_PROJECTION_CONFLICT";
export const ACTOR_OWNER_PROJECTION_MISSING_CODE = "ACTOR_OWNER_PROJECTION_MISSING";
export const ACTOR_HUMAN_RECONCILIATION_FAILED_CODE = "ACTOR_HUMAN_RECONCILIATION_FAILED";

export type ReconcileHumanActorDependencies = {
  actorCommands: ActorCommandRepository;
  actorUnitOfWork: OwnerUnitOfWork;
  ids: IdGenerator;
  clock: Clock;
};

/** Projects one committed Auth membership directly to one Human Member. */
export class ReconcileHumanActor {
  constructor(private readonly dependencies: ReconcileHumanActorDependencies) {}

  async execute(input: {
    authUserId: string;
    companyId: string;
    displayName: string;
    companyRole: "owner" | "member";
  }): Promise<Actor> {
    const displayName = requiredDisplayName(input.displayName);
    const mark = markFromDisplayName(displayName);
    const nowMs = this.dependencies.clock.now();
    try {
      return await this.dependencies.actorUnitOfWork.execute("actor", async (transaction) => {
        const existing = await this.dependencies.actorCommands.findHumanForReconciliation(
          transaction,
          input.authUserId,
        );
        if (existing) {
          return this.update(transaction, existing, { ...input, displayName, mark, nowMs });
        }
        if (input.companyRole === "owner") {
          throw new ApplicationError(ACTOR_OWNER_PROJECTION_MISSING_CODE, false);
        }
        const human: Actor = {
          id: this.dependencies.ids.next("actor"),
          companyId: input.companyId,
          type: "human",
          displayName,
          mark,
          companyRole: "member",
          status: "active",
          authUserId: input.authUserId,
        };
        await this.dependencies.actorCommands.create(transaction, human);
        return human;
      });
    } catch (error) {
      if (isApplicationError(error)) throw error;
      throw new ApplicationError(ACTOR_HUMAN_RECONCILIATION_FAILED_CODE, true);
    }
  }

  private async update(
    transaction: OwnerTransaction,
    existing: Actor,
    input: {
      authUserId: string;
      companyId: string;
      displayName: string;
      mark: string;
      companyRole: "owner" | "member";
      nowMs: number;
    },
  ): Promise<Actor> {
    if (
      existing.type !== "human"
      || existing.authUserId !== input.authUserId
      || existing.companyId !== input.companyId
    ) {
      throw new ApplicationError(ACTOR_HUMAN_PROJECTION_CONFLICT_CODE, false);
    }
    const updated = await this.dependencies.actorCommands.updateHumanProjection(transaction, {
      actorId: existing.id,
      authUserId: input.authUserId,
      companyId: input.companyId,
      displayName: input.displayName,
      mark: input.mark,
      companyRole: input.companyRole,
      status: "active",
      updatedAtMs: input.nowMs,
    });
    if (!updated) throw new ApplicationError(ACTOR_HUMAN_PROJECTION_CONFLICT_CODE, false);
    return updated;
  }
}

function requiredDisplayName(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 255) {
    throw new ApplicationError(ACTOR_HUMAN_PROJECTION_CONFLICT_CODE, false);
  }
  return normalized;
}
