import type {
  CompanyActor,
  CompanyActorCreateResult,
  CompanyInvitation,
} from "@fields/contracts/public/company";
import type {
  CompanySharedPoolExecutorSummary,
  MemberExecutorAssignment,
} from "@fields/contracts/public/executor";

export type HumanInvitationDecision =
  | { kind: "create"; normalizedEmail: string }
  | { kind: "invalid_email" }
  | { kind: "existing_member" }
  | { kind: "existing_invitation"; invitation: CompanyInvitation };

export function decideHumanInvitation(
  email: string,
  members: readonly CompanyActor[],
  invitations: readonly CompanyInvitation[],
): HumanInvitationDecision {
  const normalizedEmail = email.trim().toLowerCase();
  if (
    normalizedEmail.length === 0
    || normalizedEmail.length > 255
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalizedEmail)
  ) {
    return { kind: "invalid_email" };
  }
  if (members.some((member) => member.email?.trim().toLowerCase() === normalizedEmail)) {
    return { kind: "existing_member" };
  }
  const invitation = invitations.find((candidate) => (
    candidate.email.trim().toLowerCase() === normalizedEmail
  ));
  return invitation
    ? { kind: "existing_invitation", invitation }
    : { kind: "create", normalizedEmail };
}

export async function resolveAuthoritativeHumanInvitation(
  email: string,
  members: readonly CompanyActor[],
  invitations: readonly CompanyInvitation[],
  resolve: (normalizedEmail: string) => Promise<HumanInvitationDecision>,
): Promise<HumanInvitationDecision> {
  const local = decideHumanInvitation(email, members, invitations);
  if (local.kind === "invalid_email") return local;
  return resolve(email.trim().toLowerCase());
}

export function generateMemberMark(displayName: string): string {
  const words = displayName.trim().split(/\s+/u).filter(Boolean);
  const selected = words.length > 1
    ? words.slice(0, 2).map((word) => Array.from(word)[0] ?? "")
    : Array.from(words[0] ?? "").slice(0, 2);
  return selected.map(uppercaseLatin).join("");
}

export function availableCompanySharedExecutors(
  executors: readonly CompanySharedPoolExecutorSummary[],
): CompanySharedPoolExecutorSummary[] {
  return executors.filter((executor) => (
    executor.sharing_status === "company_shared"
    && executor.availability === "available"
  ));
}

export type AgentCreationOutcome =
  | { status: "configured"; actor: CompanyActor; assignment: MemberExecutorAssignment }
  | { status: "executor_failed"; actor: CompanyActor; error: unknown };

export async function createOrConfigureAgent(input: {
  createdActor: CompanyActor | null;
  displayName: string;
  mark: string;
  executorId: string;
  createActor: (input: {
    actor_type: "agent";
    display_name: string;
    mark: string;
  }) => Promise<CompanyActorCreateResult>;
  setExecutor: (input: {
    member_id: string;
    executor_id: string;
  }) => Promise<MemberExecutorAssignment>;
}): Promise<AgentCreationOutcome> {
  const actor = input.createdActor ?? (await input.createActor({
    actor_type: "agent",
    display_name: input.displayName,
    mark: input.mark,
  })).actor;
  try {
    const assignment = await input.setExecutor({
      member_id: actor.actor_id,
      executor_id: input.executorId,
    });
    return { status: "configured", actor, assignment };
  } catch (error) {
    return { status: "executor_failed", actor, error };
  }
}

function uppercaseLatin(character: string): string {
  return /^\p{Script=Latin}$/u.test(character)
    ? character.toUpperCase()
    : character;
}
