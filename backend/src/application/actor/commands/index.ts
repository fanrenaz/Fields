import type { Actor } from "../../../domain/actor/index.js";

export { ReconcileHumanActor } from "./reconcile-human-actor.js";
export {
  ReconcileRemovedHuman,
  type ReconcileRemovedHumanDependencies,
  type ReconcileRemovedHumanInput,
} from "./reconcile-removed-human.js";
export {
  CreateCompanyDirectoryActor,
  CreateOrdinaryAgent,
  RemoveOrdinaryAgent,
  type CreateCompanyDirectoryActorInput,
  type CreateCompanyDirectoryActorUseCase,
  type CreateOrdinaryAgentInput,
  type CreateOrdinaryAgentUseCase,
  type OrdinaryAgentDirectoryCommandDependencies,
  type RemoveOrdinaryAgentInput,
  type RemoveOrdinaryAgentResult,
  type RemoveOrdinaryAgentUseCase,
} from "./ordinary-agent-directory.js";

export interface ReconcileHumanActorUseCase {
  execute(input: { authUserId: string; companyId: string; displayName: string; companyRole: "owner" | "member" }): Promise<Actor>;
}

export interface ReconcileRemovedHumanUseCase {
  execute(input: { authUserId: string; companyId: string }): Promise<Actor | null>;
}
