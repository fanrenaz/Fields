import type {
  CompanyActor,
  CompanyActorCreateInput,
  CompanyActorCreateResult,
  CompanyInvitation,
} from "@fields/contracts/public/company";
import { useCallback, useEffect, useRef, useState } from "react";

import { backendTrpc } from "../../data/boundary/backend-trpc";
import {
  removeHumanMember,
  revokeHumanInvitation,
} from "../../data/members/organization-actions";
import { messageFromError, UiMessageError, type UiMessageValue } from "../../shared/i18n";
import { loadMemberDirectory } from "./member-directory-load";
import {
  expireCompanyInvitationsAt,
  removeCompanyInvitation,
  serverInvitationAllowsCopy,
  sortCompanyMemberDirectory,
  upsertCompanyActor,
  type CompanyMemberDirectoryEntry,
} from "./member-model";

export type MemberWorkspaceController = {
  directory: {
    members: CompanyActor[];
    invitations: CompanyInvitation[];
    entries: CompanyMemberDirectoryEntry[];
    loading: boolean;
    loaded: boolean;
    error: UiMessageValue;
    invitationError: UiMessageValue;
    removingActorId: string | null;
    refresh: () => Promise<void>;
    getActor: (actorId: string) => Promise<CompanyActor>;
    createActor: (input: CompanyActorCreateInput) => Promise<CompanyActorCreateResult>;
    confirmInvitationCopy: (invitationCredential: string) => Promise<boolean>;
    revokeInvitation: (invitationCredential: string) => Promise<boolean>;
    removeActor: (actor: CompanyActor) => Promise<boolean>;
  };
  panels: {
    leftOpen: boolean;
    rightOpen: boolean;
    openLeft: () => void;
    closeLeft: () => void;
    openRight: () => void;
    closeRight: () => void;
  };
};

export function useMemberWorkspace(
  _currentActorId: string,
  canManageInvitations: boolean,
): MemberWorkspaceController {
  const listRequestRef = useRef(0);
  const removedActorIdsRef = useRef(new Set<string>());
  const [members, setMembers] = useState<CompanyActor[]>([]);
  const [invitations, setInvitations] = useState<CompanyInvitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<UiMessageValue>(null);
  const [invitationError, setInvitationError] = useState<UiMessageValue>(null);
  const [removingActorId, setRemovingActorId] = useState<string | null>(null);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);

  const refresh = useCallback(async () => {
    const requestId = listRequestRef.current + 1;
    listRequestRef.current = requestId;
    setLoading(true);
    setError(null);
    setInvitationError(null);
    const result = await loadMemberDirectory({
      currentMembers: members,
      currentInvitations: invitations,
      loadMembers: async () => (await backendTrpc.company.actors.list.query()).items,
      loadInvitations: canManageInvitations
        ? async () => (await backendTrpc.company.invitations.list.query()).items
        : async () => [],
    });
    if (listRequestRef.current === requestId) {
      setMembers(result.members);
      setInvitations(result.invitations);
      setError(result.memberError
        ? messageFromError(result.memberError, "member.unableToLoadMembers")
        : null);
      setInvitationError(result.invitationError
        ? messageFromError(result.invitationError, "member.unableToLoadInvitations")
        : null);
      setLoaded(true);
      setLoading(false);
    }
  }, [canManageInvitations, invitations, members]);

  useEffect(() => {
    if (leftOpen && !loaded && !loading) {
      void refresh();
    }
  }, [leftOpen, loaded, loading, refresh]);

  useEffect(() => {
    const nextExpiryAtMs = invitations.reduce<number | null>((next, invitation) => {
      if (invitation.status !== "pending") return next;
      return next === null || invitation.expires_at_ms < next
        ? invitation.expires_at_ms
        : next;
    }, null);
    if (nextExpiryAtMs === null) return;
    const timeout = globalThis.setTimeout(() => {
      setInvitations((current) => expireCompanyInvitationsAt(current, Date.now()));
    }, Math.max(0, nextExpiryAtMs - Date.now()));
    return () => globalThis.clearTimeout(timeout);
  }, [invitations]);

  const getActor = useCallback(async (actorId: string) => {
    const actor = await backendTrpc.company.actors.get.query({ actor_id: actorId });
    if (!removedActorIdsRef.current.has(actor.actor_id)) {
      setMembers((current) => upsertCompanyActor(current, actor));
    }
    return actor;
  }, []);

  const createActor = useCallback(async (input: CompanyActorCreateInput) => {
    const result = await backendTrpc.company.actors.create.mutate(input);
    listRequestRef.current += 1;
    setMembers((current) => upsertCompanyActor(current, result.actor));
    setLoaded(true);
    setLoading(false);
    setError(null);
    return result;
  }, []);


  const confirmInvitationCopy = useCallback(async (invitationCredential: string) => {
    const authoritative = (await backendTrpc.company.invitations.list.query()).items;
    listRequestRef.current += 1;
    setInvitations(authoritative);
    setInvitationError(null);
    return serverInvitationAllowsCopy(authoritative, invitationCredential);
  }, []);

  const revokeInvitation = useCallback(async (invitationCredential: string) => {
    setInvitationError(null);
    try {
      await revokeHumanInvitation(invitationCredential);
      listRequestRef.current += 1;
      setInvitations((current) => removeCompanyInvitation(
        current,
        invitationCredential,
      ));
      return true;
    } catch (caught) {
      setInvitationError(messageFromError(caught, "member.unableToRevokeInvitation"));
      return false;
    }
  }, []);

  const removeActor = useCallback(async (actor: CompanyActor) => {
    setRemovingActorId(actor.actor_id);
    setError(null);
    try {
      if (actor.actor_type === "human") {
        if (!actor.email) throw new UiMessageError("member.humanNoEmail");
        await removeHumanMember(actor.email);
      } else {
        await backendTrpc.company.actors.remove.mutate({ actor_id: actor.actor_id });
      }
      removedActorIdsRef.current.add(actor.actor_id);
      listRequestRef.current += 1;
      setMembers((current) => current.filter((candidate) => candidate.actor_id !== actor.actor_id));
      setLoading(false);
      await refresh();
      return true;
    } catch (caught) {
      setError(messageFromError(caught, "member.unableToRemoveMember"));
      return false;
    } finally {
      setRemovingActorId(null);
    }
  }, [refresh]);

  return {
    directory: {
      members,
      invitations,
      entries: sortCompanyMemberDirectory(members, invitations),
      loading,
      loaded,
      error,
      invitationError,
      removingActorId,
      refresh,
      getActor,
      createActor,
      confirmInvitationCopy,
      revokeInvitation,
      removeActor,
    },
    panels: {
      leftOpen,
      rightOpen,
      openLeft: () => setLeftOpen(true),
      closeLeft: () => setLeftOpen(false),
      openRight: () => setRightOpen(true),
      closeRight: () => setRightOpen(false),
    },
  };
}
