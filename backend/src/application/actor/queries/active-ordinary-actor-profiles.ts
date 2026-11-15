import { ApplicationError, isApplicationError } from "../../platform/errors.js";
import type {
  ActiveOrdinaryActorProfile,
  ActorDirectoryProfileQuery,
} from "../ports/index.js";

export const ACTOR_DIRECTORY_PROFILE_INVALID_CODE = "ACTOR_DIRECTORY_PROFILE_INVALID";
export const ACTOR_DIRECTORY_PROFILE_UNAVAILABLE_CODE = "ACTOR_DIRECTORY_PROFILE_UNAVAILABLE";

export type ListActiveOrdinaryActorProfilesInput = {
  companyId: string;
  actorIds: readonly string[];
};

export type ListActiveOrdinaryActorProfilesDependencies = {
  profiles: ActorDirectoryProfileQuery;
};

export interface ListActiveOrdinaryActorProfilesUseCase {
  execute(input: ListActiveOrdinaryActorProfilesInput): Promise<readonly ActiveOrdinaryActorProfile[]>;
}

/**
 * Cross-owner Actor read surface for member projections. It preserves the
 * caller's requested order and intentionally treats unavailable or ineligible
 * Actor IDs as omissions, matching the legacy membership-to-Actor inner join.
 */
export class ListActiveOrdinaryActorProfiles implements ListActiveOrdinaryActorProfilesUseCase {
  constructor(private readonly dependencies: ListActiveOrdinaryActorProfilesDependencies) {}

  async execute(input: ListActiveOrdinaryActorProfilesInput): Promise<readonly ActiveOrdinaryActorProfile[]> {
    if (!validInput(input)) {
      throw new ApplicationError(ACTOR_DIRECTORY_PROFILE_INVALID_CODE, false);
    }
    try {
      const requestedActorIds = [...new Set(input.actorIds)];
      const profiles = await this.dependencies.profiles.listActiveOrdinaryProfiles({
        companyId: input.companyId,
        actorIds: requestedActorIds,
      });
      const profileByActorId = new Map<string, ActiveOrdinaryActorProfile>();
      for (const profile of profiles) {
        if (
          !validProfile(profile)
          || profile.companyId !== input.companyId
          || !requestedActorIds.includes(profile.actorId)
          || profileByActorId.has(profile.actorId)
        ) {
          throw new ApplicationError(ACTOR_DIRECTORY_PROFILE_INVALID_CODE, false);
        }
        profileByActorId.set(profile.actorId, profile);
      }
      return requestedActorIds.flatMap((actorId) => {
        const profile = profileByActorId.get(actorId);
        return profile ? [profile] : [];
      });
    } catch (error) {
      if (isApplicationError(error)) {
        if (error.code === ACTOR_DIRECTORY_PROFILE_INVALID_CODE) {
          throw error;
        }
        throw new ApplicationError(ACTOR_DIRECTORY_PROFILE_UNAVAILABLE_CODE, error.retryable);
      }
      throw new ApplicationError(ACTOR_DIRECTORY_PROFILE_UNAVAILABLE_CODE, true);
    }
  }
}

function validInput(input: ListActiveOrdinaryActorProfilesInput): boolean {
  return validIdentifier(input.companyId)
    && Array.isArray(input.actorIds)
    && input.actorIds.every(validIdentifier);
}

function validProfile(profile: ActiveOrdinaryActorProfile): boolean {
  return validIdentifier(profile.actorId)
    && validIdentifier(profile.companyId)
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
