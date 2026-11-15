import type {
  ActorDirectoryQueryRepository,
  HumanActorEmailQuery,
} from "../ports/index.js";

import {
  actorNotFound,
  normalizeDirectoryFailure,
  projectCompanyDirectoryActor,
  projectCompanyDirectoryActors,
  requireCompanyDirectoryCaller,
  requiredActorId,
  type CompanyActorDirectoryRequest,
  type CompanyDirectoryAccessDependencies,
  type CompanyDirectoryActor,
} from "../directory-support.js";

export type ListCompanyDirectoryActorsDependencies = CompanyDirectoryAccessDependencies & {
  directory: ActorDirectoryQueryRepository;
  humanEmails: HumanActorEmailQuery;
};

export interface ListCompanyDirectoryActorsUseCase {
  execute(input: CompanyActorDirectoryRequest): Promise<readonly CompanyDirectoryActor[]>;
}

/**
 * Reads only active Actor projections after the caller and Company
 * have been authorized. Human email hydration stays behind its own narrow
 * query rather than entering the generic Actor repository.
 */
export class ListCompanyDirectoryActors implements ListCompanyDirectoryActorsUseCase {
  constructor(private readonly dependencies: ListCompanyDirectoryActorsDependencies) {}

  async execute(input: CompanyActorDirectoryRequest): Promise<readonly CompanyDirectoryActor[]> {
    try {
      await requireCompanyDirectoryCaller(this.dependencies, input);
      const actors = await this.dependencies.directory.listActiveActors(input.companyId);
      return projectCompanyDirectoryActors(actors, this.dependencies.humanEmails);
    } catch (error) {
      throw normalizeDirectoryFailure(error);
    }
  }
}

export type GetCompanyDirectoryActorInput = CompanyActorDirectoryRequest & {
  actorId: string;
};

export type GetCompanyDirectoryActorDependencies = CompanyDirectoryAccessDependencies & {
  directory: ActorDirectoryQueryRepository;
  humanEmails: HumanActorEmailQuery;
};

export interface GetCompanyDirectoryActorUseCase {
  execute(input: GetCompanyDirectoryActorInput): Promise<CompanyDirectoryActor>;
}

export class GetCompanyDirectoryActor implements GetCompanyDirectoryActorUseCase {
  constructor(private readonly dependencies: GetCompanyDirectoryActorDependencies) {}

  async execute(input: GetCompanyDirectoryActorInput): Promise<CompanyDirectoryActor> {
    try {
      requiredActorId(input.actorId);
      await requireCompanyDirectoryCaller(this.dependencies, input);
      const actor = await this.dependencies.directory.findActiveActor({
        actorId: input.actorId,
        companyId: input.companyId,
      });
      if (actor === null) {
        throw actorNotFound();
      }
      const emails = actor.type === "human" && actor.authUserId !== null
        ? await this.dependencies.humanEmails.findEmailsByAuthUserIds([actor.authUserId])
        : new Map<string, string>();
      return projectCompanyDirectoryActor(actor, emails);
    } catch (error) {
      throw normalizeDirectoryFailure(error);
    }
  }
}
