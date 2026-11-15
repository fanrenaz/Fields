export const actorTypes = ["human", "agent"] as const;
export const actorStatuses = ["active", "inactive"] as const;
export const companyRoles = ["owner", "member"] as const;

export type ActorType = typeof actorTypes[number];
export type ActorStatus = typeof actorStatuses[number];
export type CompanyRole = typeof companyRoles[number];

export type Actor = {
  id: string;
  companyId: string;
  type: ActorType;
  displayName: string;
  mark: string;
  companyRole: CompanyRole;
  status: ActorStatus;
  authUserId: string | null;
  /** Internal-only role. Public Actor projections must exclude non-null roles. */
  systemRole?: "scheduler" | null;
};

export function isActiveHumanActor(actor: Actor): boolean {
  return actor.type === "human"
    && actor.status === "active"
    && actor.authUserId !== null;
}

export function isOrdinaryAgent(actor: Actor): boolean {
  return actor.type === "agent"
    && actor.companyRole === "member"
    && (actor.status === "active" || actor.status === "inactive")
    && actor.authUserId === null;
}

export function markFromDisplayName(displayName: string): string {
  const words = displayName.trim().split(/\s+/u).filter(Boolean);
  const rawMark = words.length >= 2
    ? `${unicodeCharacters(words[0])[0] ?? ""}${unicodeCharacters(words[1])[0] ?? ""}`
    : unicodeCharacters(words[0] ?? "").slice(0, 2).join("");
  return unicodeCharacters(rawMark.toUpperCase()).slice(0, 2).join("");
}

function unicodeCharacters(value: string): string[] {
  return Array.from(value);
}
