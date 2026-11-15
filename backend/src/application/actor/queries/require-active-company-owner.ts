import {
  normalizeDirectoryFailure,
  requireActiveHumanDirectoryCaller,
  requireOwner,
  type CompanyActorDirectoryRequest,
} from "../directory-support.js";
import type { ActorDirectoryQueryRepository } from "../ports/index.js";

export type ActiveHumanCompanyOwner = {
  actorId: string;
  companyId: string;
  companyRole: "owner";
};

export type RequireActiveHumanCompanyOwnerDependencies = {
  directory: ActorDirectoryQueryRepository;
};

export interface RequireActiveHumanCompanyOwnerUseCase {
  execute(input: CompanyActorDirectoryRequest): Promise<ActiveHumanCompanyOwner>;
}

/**
 * Cross-owner authorization surface for Company commands. It proves a current
 * active Human owner without imposing a Company lifecycle state: retry remains
 * valid while the Company is `setup_failed`.
 */
export class RequireActiveHumanCompanyOwner implements RequireActiveHumanCompanyOwnerUseCase {
  constructor(private readonly dependencies: RequireActiveHumanCompanyOwnerDependencies) {}

  async execute(input: CompanyActorDirectoryRequest): Promise<ActiveHumanCompanyOwner> {
    try {
      const caller = await requireActiveHumanDirectoryCaller(this.dependencies.directory, input);
      requireOwner(caller);
      return {
        actorId: caller.actorId,
        companyId: caller.companyId,
        companyRole: "owner",
      };
    } catch (error) {
      throw normalizeDirectoryFailure(error);
    }
  }
}
