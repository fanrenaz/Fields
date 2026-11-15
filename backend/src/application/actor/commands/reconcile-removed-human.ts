import type { Actor } from "../../../domain/actor/index.js";
import { ApplicationError, isApplicationError } from "../../platform/errors.js";
import type { Clock, IdGenerator, OwnerUnitOfWork } from "../../platform/ports/index.js";
import type { ActorCommandRepository } from "../ports/index.js";

export const ACTOR_OWNER_REMOVAL_FORBIDDEN_CODE = "ACTOR_OWNER_REMOVAL_FORBIDDEN";
export const ACTOR_HUMAN_REMOVAL_FAILED_CODE = "ACTOR_HUMAN_REMOVAL_FAILED";
export const ACTOR_HUMAN_REMOVAL_CONFLICT_CODE = "ACTOR_HUMAN_REMOVAL_CONFLICT";

export type ReconcileRemovedHumanDependencies = {
  actorCommands: ActorCommandRepository;
  actorUnitOfWork: OwnerUnitOfWork;
  ids: IdGenerator;
  clock: Clock;
};
export type ReconcileRemovedHumanInput = { authUserId: string; companyId: string };

export class ReconcileRemovedHuman {
  constructor(private readonly dependencies: ReconcileRemovedHumanDependencies) {}

  async execute(input: ReconcileRemovedHumanInput): Promise<Actor | null> {
    try {
      return await this.dependencies.actorUnitOfWork.execute("actor", async (transaction) => {
        const human = await this.dependencies.actorCommands.findHumanForReconciliation(
          transaction,
          input.authUserId,
        );
        if (human === null) return null;
        if (human.companyRole === "owner") {
          throw new ApplicationError(ACTOR_OWNER_REMOVAL_FORBIDDEN_CODE, false);
        }
        if (
          human.type !== "human"
          || human.companyId !== input.companyId
          || human.authUserId !== input.authUserId
        ) {
          throw new ApplicationError(ACTOR_HUMAN_REMOVAL_CONFLICT_CODE, false);
        }
        if (human.status === "inactive") return human;
        const inactive = await this.dependencies.actorCommands.inactivate(
          transaction,
          human.id,
          this.dependencies.clock.now(),
        );
        if (!inactive || inactive.status !== "inactive") {
          throw new ApplicationError(ACTOR_HUMAN_REMOVAL_CONFLICT_CODE, false);
        }
        return inactive;
      });
    } catch (error) {
      if (isApplicationError(error)) throw error;
      throw new ApplicationError(ACTOR_HUMAN_REMOVAL_FAILED_CODE, true);
    }
  }
}
