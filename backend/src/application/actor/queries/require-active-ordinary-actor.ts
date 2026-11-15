import { ApplicationError, isApplicationError } from "../../platform/errors.js";
import type {
  ActiveOrdinaryActorProfile,
  ActorDirectoryProfileQuery,
} from "../ports/index.js";

export const ACTOR_ORDINARY_ACCESS_DENIED_CODE = "ACTOR_ORDINARY_ACCESS_DENIED";
export const ACTOR_ORDINARY_ACCESS_UNAVAILABLE_CODE = "ACTOR_ORDINARY_ACCESS_UNAVAILABLE";

export type ActiveOrdinaryActorAccess = {
  actorId: string;
  companyId: string;
  actorType: "human" | "agent";
};

export type RequireActiveOrdinaryActorDependencies = {
  profiles: ActorDirectoryProfileQuery;
};

export interface RequireActiveOrdinaryActorUseCase {
  execute(input: { actorId: string; companyId: string }): Promise<ActiveOrdinaryActorAccess>;
}

/**
 * Actor public access surface for consumers such as Room. It intentionally
 * proves only an active same-Company Actor; it grants no Room access
 * and exposes no Actor repository or provider data.
 */
export class RequireActiveOrdinaryActor implements RequireActiveOrdinaryActorUseCase {
  constructor(private readonly dependencies: RequireActiveOrdinaryActorDependencies) {}

  async execute(input: { actorId: string; companyId: string }): Promise<ActiveOrdinaryActorAccess> {
    if (!validIdentifier(input.actorId) || !validIdentifier(input.companyId)) {
      throw denied();
    }
    try {
      const profiles = await this.dependencies.profiles.listActiveOrdinaryProfiles({
        actorIds: [input.actorId],
        companyId: input.companyId,
      });
      if (profiles.length !== 1 || !matchesRequestedProfile(profiles[0], input)) {
        throw denied();
      }
      return { actorId: input.actorId, companyId: input.companyId, actorType: profiles[0].actorType };
    } catch (error) {
      if (isApplicationError(error) && error.code === ACTOR_ORDINARY_ACCESS_DENIED_CODE) {
        throw error;
      }
      if (isApplicationError(error)) {
        throw new ApplicationError(ACTOR_ORDINARY_ACCESS_UNAVAILABLE_CODE, error.retryable);
      }
      throw new ApplicationError(ACTOR_ORDINARY_ACCESS_UNAVAILABLE_CODE, true);
    }
  }
}

function matchesRequestedProfile(
  profile: ActiveOrdinaryActorProfile | undefined,
  input: { actorId: string; companyId: string },
): profile is ActiveOrdinaryActorProfile {
  return profile !== undefined
    && profile.actorId === input.actorId
    && profile.companyId === input.companyId
    && validDisplayName(profile.displayName)
    && validMark(profile.mark)
    && (profile.actorType === "human" || profile.actorType === "agent");
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function validDisplayName(value: unknown): value is string {
  return typeof value === "string" && value === value.trim() && value.length > 0 && value.length <= 255;
}

function validMark(value: unknown): value is string {
  return typeof value === "string" && value === value.trim() && value.length > 0 && value.length <= 32;
}

function denied(): ApplicationError {
  return new ApplicationError(ACTOR_ORDINARY_ACCESS_DENIED_CODE, false);
}
