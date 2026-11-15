import type { CompanyActor } from "@fields/contracts/public/company";
import { ContextMenuTrigger, Flexbox, ListItem, Skeleton, Text } from "@lobehub/ui";
import { Button } from "@lobehub/ui/base-ui";
import type { ReactNode } from "react";
import { Bot, Mail, Trash2, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";

import { translateMessage, type UiMessageValue } from "../../shared/i18n";
import type { CompanyMemberDirectoryEntry } from "./member-model";

export type CompanyMemberListItem = CompanyMemberDirectoryEntry;

export function MemberDirectoryList({
  entries,
  loading,
  error,
  invitationError,
  canManage,
  removingActorId,
  onRetry,
  onSelectMember,
  onSelectInvitation,
  onRemoveMember,
}: {
  entries: CompanyMemberDirectoryEntry[];
  loading: boolean;
  error: UiMessageValue;
  invitationError: UiMessageValue;
  canManage: boolean;
  removingActorId: string | null;
  onRetry: () => void;
  onSelectMember: (actorId: string) => void;
  onSelectInvitation: (invitationCredential: string) => void;
  onRemoveMember: (
    member: Extract<CompanyMemberDirectoryEntry, { kind: "member" }>["member"],
  ) => void;
}) {
  const { t } = useTranslation();
  const memberCount = entries.filter((entry) => entry.kind === "member").length;
  if (loading && entries.length === 0) return <DirectoryState><Skeleton active paragraph={{ rows: 2 }} title={false} width="100%" /></DirectoryState>;
  if (error && memberCount === 0) {
    return <DirectoryState><Text type="danger">{translateMessage(t, error)}</Text><Button onClick={onRetry} size="small">{t("common.retry")}</Button></DirectoryState>;
  }
  if (entries.length === 0) return <DirectoryState><Text type="secondary">{t("room.noMembers")}</Text></DirectoryState>;

  return (
    <Flexbox gap={4} padding={8}>
      {error ? <Flexbox align="center" gap={8} horizontal justify="space-between"><Text fontSize={11} type="danger">{translateMessage(t, error)}</Text><Button onClick={onRetry} size="small">{t("common.retry")}</Button></Flexbox> : null}
      {invitationError ? <Flexbox align="center" gap={8} horizontal justify="space-between"><Text fontSize={11} type="danger">{translateMessage(t, invitationError)}</Text><Button onClick={onRetry} size="small">{t("common.retry")}</Button></Flexbox> : null}
      {entries.map((entry) => entry.kind === "member"
        ? (
          <CompanyMemberItem
            key={entry.member.actor_id}
            member={entry.member}
            canRemove={canManage && entry.member.company_role !== "owner"}
            removing={removingActorId === entry.member.actor_id}
            onOpen={() => onSelectMember(entry.member.actor_id)}
            onRemove={() => onRemoveMember(entry.member)}
          />
        )
        : (
          <CompanyInvitationItem
            key={entry.invitation.invitation_credential}
            email={entry.invitation.email}
            status={entry.invitation.status}
            onOpen={() => onSelectInvitation(entry.invitation.invitation_credential)}
          />
        ))}
    </Flexbox>
  );
}

function CompanyMemberItem({ member, canRemove, removing, onOpen, onRemove }: { member: CompanyActor; canRemove: boolean; removing: boolean; onOpen: () => void; onRemove: () => void }) {
  const { t } = useTranslation();
  const row = (
    <ListItem
      aria-disabled={removing}
      avatar={<span style={{ alignItems: "center", background: "var(--ant-color-fill-tertiary)", border: "1px solid var(--ant-color-border)", borderRadius: 8, color: "var(--ant-color-text-secondary)", display: "inline-flex", flex: "0 0 30px", fontSize: 11, fontWeight: 800, height: 30, justifyContent: "center" }}>{member.mark}</span>}
      description={<Flexbox align="center" gap={4} horizontal>{member.actor_type === "human" ? <UserRound size={11} /> : <Bot size={11} />}{member.actor_type === "human" ? t("room.human") : t("timeline.agent")}</Flexbox>}
      key={member.actor_id}
      onClick={removing ? undefined : onOpen}
      onKeyDown={(event) => {
        if (!removing && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onOpen();
        }
      }}
      role="button"
      style={{ height: 48, opacity: removing ? 0.56 : 1, padding: "8px" }}
      tabIndex={removing ? -1 : 0}
      title={<Flexbox align="center" gap={6} horizontal><Text ellipsis strong>{member.display_name}</Text>{member.company_role === "owner" ? <Text fontSize={11} type="secondary">{t("account.owner")}</Text> : null}</Flexbox>}
    />
  );
  if (!canRemove) return row;
  return (
    <ContextMenuTrigger
      items={[{
        danger: true,
        icon: Trash2,
        key: "remove-member",
        label: t("room.removeMember"),
        onClick: onRemove,
      }]}
    >
      {row}
    </ContextMenuTrigger>
  );
}

function CompanyInvitationItem({
  email,
  status,
  onOpen,
}: {
  email: string;
  status: "pending" | "expired";
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ListItem
      avatar={<span style={{ alignItems: "center", background: "var(--ant-color-fill-tertiary)", border: "1px solid var(--ant-color-border)", borderRadius: 8, color: "var(--ant-color-text-secondary)", display: "inline-flex", flex: "0 0 30px", height: 30, justifyContent: "center" }}><Mail size={14} /></span>}
      description={<Text fontSize={11} type={status === "expired" ? "danger" : "secondary"}>{t(`member.invitationStatus.${status}`)}</Text>}
      key={email}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      role="button"
      style={{ height: 48, padding: "8px" }}
      tabIndex={0}
      title={<Text ellipsis strong>{email}</Text>}
    />
  );
}

function DirectoryState({ children }: { children: ReactNode }) {
  return <Flexbox align="center" gap={12} justify="center" padding={12} style={{ minHeight: 120, textAlign: "center" }}>{children}</Flexbox>;
}
