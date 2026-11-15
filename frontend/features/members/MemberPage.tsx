import {
  memberExecutorErrorCodeSchema,
  type ExecutorSafeSummary,
  type MemberExecutorAssignment,
} from "@fields/contracts/public/executor";
import {
  type CompanyActor,
  type CompanyActorCreateInput,
  type CompanyActorCreateResult,
  type CompanyInvitation,
} from "@fields/contracts/public/company";
import type {
  MemberAssetInstallation,
  MemberAssetOption,
  MemberAssetProfile,
} from "@fields/contracts/public/asset";
import { Empty, Flexbox, Modal, ScrollArea, Select, Skeleton, Text, copyToClipboard } from "@lobehub/ui";
import { Button, Input } from "@lobehub/ui/base-ui";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { invitationLinkForWeb } from "../../data/auth/invitation-runtime";
import { backendTrpc } from "../../data/boundary/backend-trpc";
import { messageFromError, translateMessage, type UiMessageValue } from "../../shared/i18n/message";
import { generateMemberMark } from "./member-creation";
import { companyInvitationStatusAt } from "./member-model";
import { AgentProfileEditor } from "./AgentBuilderWorkspace";

export type MemberWorkspaceTarget =
  | { kind: "new"; key: number }
  | { kind: "existing"; actorId: string }
  | { kind: "invitation"; invitationCredential: string };

export function MemberPage({ target, members, invitations, canManageAgentExecutor, getActor, createActor, confirmInvitationCopy, revokeInvitation, onAgentCreated, onInvitationRevoked, onMemberUnavailable }: {
  target: MemberWorkspaceTarget;
  members: CompanyActor[];
  invitations: CompanyInvitation[];
  canManageAgentExecutor: boolean;
  getActor: (actorId: string) => Promise<CompanyActor>;
  createActor: (input: CompanyActorCreateInput) => Promise<CompanyActorCreateResult>;
  confirmInvitationCopy: (invitationCredential: string) => Promise<boolean>;
  revokeInvitation: (invitationCredential: string) => Promise<boolean>;
  onAgentCreated: (actorId: string) => void;
  onInvitationRevoked: (invitationCredential: string) => void;
  onMemberUnavailable?: (actorId: string) => void;
}) {
  if (target.kind === "new") return <NewMemberSurface key={target.key} createActor={createActor} onAgentCreated={onAgentCreated} />;
  if (target.kind === "invitation") {
    const invitation = invitations.find((candidate) => (
      candidate.invitation_credential === target.invitationCredential
    ));
    return invitation
      ? <InvitationDetails key={target.invitationCredential} invitation={invitation} confirmInvitationCopy={confirmInvitationCopy} revokeInvitation={revokeInvitation} onInvitationRevoked={onInvitationRevoked} />
      : <CenteredMemberState><Empty description={<InvitationMissing />} /></CenteredMemberState>;
  }
  return <ExistingMemberSurface key={target.actorId} actorId={target.actorId} canManageAgentExecutor={canManageAgentExecutor} initialProfile={members.find((member) => member.actor_id === target.actorId) ?? null} getActor={getActor} onUnavailable={onMemberUnavailable} />;
}

function InvitationMissing() {
  const { t } = useTranslation();
  return t("member.invitationNotFound");
}

function ExistingMemberSurface({ actorId, canManageAgentExecutor, initialProfile, getActor, onUnavailable }: { actorId: string; canManageAgentExecutor: boolean; initialProfile: CompanyActor | null; getActor: (actorId: string) => Promise<CompanyActor>; onUnavailable?: (actorId: string) => void }) {
  const [profile, setProfile] = useState<CompanyActor | null>(initialProfile);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<UiMessageValue>(null);
  const [reload, setReload] = useState(0);
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;
  const { t } = useTranslation();
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void getActor(actorId).then((actor) => { if (active) setProfile(actor); }).catch((caught) => {
      if (!active) return;
      if (isMissingMember(caught)) onUnavailableRef.current?.(actorId);
      else setError(messageFromError(caught, "member.unableToLoadDetails"));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [actorId, getActor, reload]);
  if (loading && !profile) return <CenteredMemberState><Skeleton active avatar={{ size: 72 }} paragraph={{ rows: 3 }} /></CenteredMemberState>;
  if (error && !profile) return <CenteredMemberState><Empty action={<Button onClick={() => setReload((value) => value + 1)}>{t("common.retry")}</Button>} description={translateMessage(t, error)} /></CenteredMemberState>;
  if (!profile) return <CenteredMemberState><Empty description={t("member.memberNotFound")} /></CenteredMemberState>;
  return <MemberDetails canManageAgentExecutor={canManageAgentExecutor} profile={profile} error={error} onRetry={() => setReload((value) => value + 1)} />;
}

function isMissingMember(error: unknown): boolean {
  if (error instanceof Error && error.message === "MEMBER_NOT_FOUND") return true;
  if (typeof error !== "object" || error === null) return false;
  const data = (error as { data?: unknown }).data;
  return typeof data === "object"
    && data !== null
    && (data as { code?: unknown }).code === "NOT_FOUND";
}

function MemberDetails({ profile, canManageAgentExecutor, error, onRetry }: { profile: CompanyActor; canManageAgentExecutor: boolean; error: UiMessageValue; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <MemberScrollSurface>
      <div style={memberContentStyle}>
        <Flexbox align="center" gap={10}>
          <span style={{ alignItems: "center", background: "var(--ant-color-fill-tertiary)", border: "1px solid var(--ant-color-border)", borderRadius: 20, color: "var(--ant-color-text-secondary)", display: "inline-flex", fontSize: 20, fontWeight: 800, height: 72, justifyContent: "center", width: 72 }}>{profile.mark}</span>
          <Text align="center" as="h2" fontSize={26} lineHeight="34px" strong style={{ margin: 0 }}>{profile.display_name}</Text>
          <Flexbox align="center" gap={8} horizontal><Text type="secondary">{profile.actor_type === "human" ? t("member.human") : t("member.agent")}</Text><span aria-hidden style={{ background: "var(--ant-color-text-quaternary)", borderRadius: "50%", height: 3, width: 3 }} /><Text type="secondary">{profile.company_role === "owner" ? t("member.owner") : t("member.member")}</Text></Flexbox>
        </Flexbox>
        {error ? <Flexbox align="center" gap={8} horizontal justify="center" style={{ marginTop: 16 }}><Text type="danger">{translateMessage(t, error)}</Text><Button onClick={onRetry} size="small">{t("common.retry")}</Button></Flexbox> : null}
        <div style={{ borderTop: "1px solid var(--ant-color-border)", marginTop: 56 }}>
          <MemberDetailRow label={t("member.displayName")} value={profile.display_name} />
          {profile.email ? <><hr style={dividerStyle} /><MemberDetailRow label={t("member.email")} value={profile.email} /></> : null}
          <hr style={dividerStyle} /><MemberDetailRow label={t("member.mark")} value={profile.mark} />
          <hr style={dividerStyle} /><MemberDetailRow label={t("member.actorType")} value={profile.actor_type === "human" ? t("member.human") : t("member.agent")} />
          <hr style={dividerStyle} /><MemberDetailRow label={t("member.companyRole")} value={profile.company_role === "owner" ? t("member.owner") : t("member.member")} />
          <hr style={dividerStyle} /><MemberDetailRow label={t("member.actorId")} mono value={profile.actor_id} />
          {profile.actor_type === "agent" && canManageAgentExecutor ? <><hr style={dividerStyle} /><AgentMemberExecutorControl memberId={profile.actor_id} /></> : null}
          {profile.actor_type === "agent" ? <><hr style={dividerStyle} /><AgentProfileEditor agentMemberId={profile.actor_id} /></> : null}
          {profile.actor_type === "agent" ? <><hr style={dividerStyle} /><AgentMemberAssetControl memberId={profile.actor_id} /></> : null}
        </div>
      </div>
    </MemberScrollSurface>
  );
}

function AgentMemberExecutorControl({ memberId }: { memberId: string }) {
  const { t } = useTranslation();
  const [assignment, setAssignment] = useState<MemberExecutorAssignment | null>(null);
  const [options, setOptions] = useState<ExecutorSafeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setErrorKey(null);
    void Promise.all([
      backendTrpc.company.members.executor.current.query({ member_id: memberId }),
      backendTrpc.company.members.executor.options.query({ member_id: memberId }),
    ]).then(([current, available]) => {
      if (!active) return;
      setAssignment(current);
      setOptions(available.items);
    }).catch((caught) => {
      if (active) setErrorKey(memberExecutorMessageKey(caught, "member.executorLoadFailed"));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [memberId]);

  async function refetchCurrent(): Promise<void> {
    const current = await backendTrpc.company.members.executor.current.query({ member_id: memberId });
    setAssignment(current);
  }

  async function setExecutor(executorId: string): Promise<void> {
    if (saving || executorId === assignment?.executor?.executor_id) return;
    setSaving(true);
    setErrorKey(null);
    try {
      const result = await backendTrpc.company.members.executor.set.mutate({
        executor_id: executorId,
        member_id: memberId,
      });
      setAssignment(result);
    } catch (caught) {
      const mutationErrorKey = memberExecutorMessageKey(caught, "member.executorChangeFailed");
      try {
        await refetchCurrent();
      } catch {
        setErrorKey("member.executorLoadFailed");
        return;
      } finally {
        setSaving(false);
      }
      setErrorKey(mutationErrorKey);
      return;
    }
    setSaving(false);
  }

  const selectOptions = options.map((executor) => ({
    disabled: executor.availability !== "available",
    label: executorLabel(executor),
    title: t(`member.executorAvailability.${executor.availability}`),
    value: executor.executor_id,
  }));

  return (
    <div style={{ alignItems: "start", display: "grid", gap: 16, gridTemplateColumns: "140px minmax(0, 1fr)", minHeight: 80, paddingBlock: 12 }}>
      <Text type="secondary">{t("member.executor")}</Text>
      <Flexbox gap={8}>
        <Select
          disabled={loading || saving}
          loading={loading || saving}
          onChange={(value) => { if (typeof value === "string") void setExecutor(value); }}
          options={selectOptions}
          placeholder={t("member.executorUnconfigured")}
          style={{ maxWidth: 420, width: "100%" }}
          value={assignment?.executor?.executor_id ?? null}
        />
        {assignment ? <Text role="status" type="secondary" style={{ fontSize: 12 }}>{t(`member.executorState.${assignment.session_state}`)}</Text> : null}
        {errorKey ? <Flexbox align="center" gap={8} horizontal><Text role="alert" type="danger" style={{ fontSize: 12 }}>{t(errorKey)}</Text><Button onClick={() => void refetchCurrent().then(() => setErrorKey(null)).catch(() => setErrorKey("member.executorLoadFailed"))} size="small">{t("common.retry")}</Button></Flexbox> : null}
      </Flexbox>
    </div>
  );
}

function memberExecutorMessageKey(error: unknown, fallback: string): string {
  const code = memberExecutorErrorCode(error);
  return code ? `productErrors.${code}` : fallback;
}

function memberExecutorErrorCode(error: unknown, depth = 0): string | null {
  if (depth > 4 || error === null || typeof error !== "object") return null;
  const candidate = error as Record<string, unknown>;
  for (const key of ["code", "error_code", "product_code"]) {
    const parsed = memberExecutorErrorCodeSchema.safeParse(candidate[key]);
    if (parsed.success) return parsed.data;
  }
  for (const key of ["data", "cause", "error", "shape", "details", "meta", "product_error"]) {
    const nested = memberExecutorErrorCode(candidate[key], depth + 1);
    if (nested) return nested;
  }
  const message = candidate.message;
  if (typeof message === "string") {
    const code = memberExecutorErrorCodeSchema.options.find((item) => message.includes(item));
    return code ?? null;
  }
  return null;
}

function executorLabel(executor: ExecutorSafeSummary): string {
  const owner = executor.owner_display_name ? `${executor.owner_display_name} · ` : "";
  const planType = executor.authorization.method === "chatgpt"
    ? executor.authorization.plan_type
    : null;
  return `${owner}${executor.name}${planType ? ` · ${planType}` : ""}`;
}

function InvitationDetails({
  invitation,
  confirmInvitationCopy,
  revokeInvitation,
  onInvitationRevoked,
}: {
  invitation: CompanyInvitation;
  confirmInvitationCopy: (invitationCredential: string) => Promise<boolean>;
  revokeInvitation: (invitationCredential: string) => Promise<boolean>;
  onInvitationRevoked: (invitationCredential: string) => void;
}) {
  const { t } = useTranslation();
  const [working, setWorking] = useState<"copy" | "revoke" | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeConfirmOpen, setRevokeConfirmOpen] = useState(false);
  const [error, setError] = useState<UiMessageValue>(null);
  const invitationLink = invitationLinkForWeb(invitation.invitation_credential);
  const status = companyInvitationStatusAt(invitation, Date.now());

  async function revoke(): Promise<void> {
    if (working) return;
    setRevokeConfirmOpen(false);
    setCopied(false);
    setWorking("revoke");
    setError(null);
    const revoked = await revokeInvitation(invitation.invitation_credential);
    setWorking(null);
    if (revoked) {
      onInvitationRevoked(invitation.invitation_credential);
    } else {
      setError("member.unableToRevokeInvitation");
    }
  }

  async function copyInvitationLink(): Promise<void> {
    if (working || companyInvitationStatusAt(invitation, Date.now()) !== "pending") return;
    setWorking("copy");
    setError(null);
    try {
      if (!await confirmInvitationCopy(invitation.invitation_credential)) return;
      await copyToClipboard(invitationLink);
      setCopied(true);
    } catch (caught) {
      setError(messageFromError(caught, "member.unableToLoadInvitations"));
    } finally {
      setWorking(null);
    }
  }

  return (
    <>
      <MemberScrollSurface>
        <div style={memberContentStyle}>
          <Flexbox align="center" gap={8} horizontal>
            <Text as="h2" fontSize={26} lineHeight="34px" strong style={{ margin: 0 }}>{invitation.email}</Text>
            <Text type={status === "expired" ? "danger" : "secondary"}>{t(`member.invitationStatus.${status}`)}</Text>
          </Flexbox>
          <div style={{ borderTop: "1px solid var(--ant-color-border)", marginTop: 44 }}>
            <MemberDetailRow label={t("member.email")} value={invitation.email} />
            <hr style={dividerStyle} />
            <MemberDetailRow label={t("member.createdAt")} value={formatInvitationTime(invitation.created_at_ms)} />
            <hr style={dividerStyle} />
            <MemberDetailRow label={t("member.expiresAt")} value={formatInvitationTime(invitation.expires_at_ms)} />
            {status === "pending" ? <><hr style={dividerStyle} /><MemberDetailRow label={t("member.invitationLink")} mono value={invitationLink} /></> : null}
          </div>
          {error ? <Text role="alert" type="danger" style={{ marginTop: 16 }}>{translateMessage(t, error)}</Text> : null}
          {copied ? <Text role="status" style={{ display: "block", marginTop: 16 }} type="success">{t("member.copied")}</Text> : null}
          <Flexbox gap={8} horizontal justify="flex-end" style={{ marginTop: 20 }}>
            {status === "pending" ? <Button disabled={Boolean(working)} loading={working === "copy"} onClick={() => void copyInvitationLink()}>{copied ? t("member.copied") : t("member.copy")}</Button> : null}
            <Button danger disabled={Boolean(working)} loading={working === "revoke"} onClick={() => setRevokeConfirmOpen(true)}>{t("member.revokeInvitation")}</Button>
          </Flexbox>
        </div>
      </MemberScrollSurface>
      <Modal
        footer={[
          <Button key="cancel" onClick={() => setRevokeConfirmOpen(false)}>{t("common.cancel")}</Button>,
          <Button danger key="revoke" loading={working === "revoke"} onClick={() => void revoke()}>{t("member.revokeInvitation")}</Button>,
        ]}
        onCancel={() => setRevokeConfirmOpen(false)}
        open={revokeConfirmOpen}
        title={t("member.revokeInvitationTitle")}
      >
        <Text>{t("member.revokeInvitationConfirm", { email: invitation.email })}</Text>
      </Modal>
    </>
  );
}

function NewMemberSurface({
  createActor,
  onAgentCreated,
}: {
  createActor: (input: CompanyActorCreateInput) => Promise<CompanyActorCreateResult>;
  onAgentCreated: (actorId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <MemberScrollSurface>
      <div style={memberContentStyle}>
        <Text as="h2" fontSize={26} lineHeight="34px" strong style={{ margin: 0 }}>{t("member.newMember")}</Text>
        <Flexbox gap={16} style={{ marginTop: 44 }}>
          <AgentCreationForm createActor={createActor} onAgentCreated={onAgentCreated} />
        </Flexbox>
      </div>
    </MemberScrollSurface>
  );
}

function AgentCreationForm({
  createActor,
  onAgentCreated,
}: {
  createActor: (input: CompanyActorCreateInput) => Promise<CompanyActorCreateResult>;
  onAgentCreated: (actorId: string) => void;
}) {
  const { t } = useTranslation();
  const [displayName, setDisplayName] = useState("");
  const [mark, setMark] = useState("");
  const [markEdited, setMarkEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<UiMessageValue>(null);

  async function submit(): Promise<void> {
    const normalizedName = displayName.trim();
    const normalizedMark = mark.trim();
    if (submitting || !normalizedName || !normalizedMark) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createActor({
        actor_type: "agent",
        display_name: normalizedName,
        mark: normalizedMark,
      });
      onAgentCreated(result.actor.actor_id);
    } catch (caught) {
      setError(messageFromError(caught, "member.unableToCreateAgent"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Text type="secondary">{t("member.agentBuilderCreationHint")}</Text>
      <Field label={t("member.displayName")}><Input onChange={(event) => {
        const name = event.target.value;
        setDisplayName(name);
        if (!markEdited) setMark(generateMemberMark(name));
      }} value={displayName} /></Field>
      <Field label={t("member.mark")}><Input maxLength={32} onChange={(event) => {
        setMarkEdited(true);
        setMark(event.target.value);
      }} value={mark} /></Field>
      {error ? <Text role="alert" type="danger">{translateMessage(t, error)}</Text> : null}
      <Flexbox horizontal justify="flex-end"><Button disabled={submitting || !displayName.trim() || !mark.trim()} loading={submitting} onClick={() => void submit()} type="primary">{submitting ? t("member.creating") : t("member.create")}</Button></Flexbox>
    </>
  );
}

function AgentMemberAssetControl({
  memberId,
  initialSetup = false,
  onDone,
}: {
  memberId: string;
  initialSetup?: boolean;
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<MemberAssetProfile | null>(null);
  const [options, setOptions] = useState<MemberAssetOption[]>([]);
  const [selection, setSelection] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<UiMessageValue>(null);
  const [reload, setReload] = useState(0);
  const preserveSelection = useRef(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void Promise.all([
      backendTrpc.company.members.assets.current.query({ member_id: memberId }),
      backendTrpc.company.members.assets.options.query({ member_id: memberId }),
    ]).then(([current, available]) => {
      if (!active) return;
      setProfile(current);
      setOptions(available.items);
      if (
        !preserveSelection.current
        || current.operation?.status === "applied"
      ) {
        preserveSelection.current = false;
        setSelection(current.installations.map((
          installation: MemberAssetInstallation,
        ) => installation.version_id));
      }
    }).catch((caught) => {
      if (active) setError(messageFromError(caught, "member.assetsLoadFailed"));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [memberId, reload]);

  useEffect(() => {
    const operation = profile?.operation;
    if (!operation || (operation.status !== "pending" && operation.status !== "applying")) return;
    const timeout = globalThis.setTimeout(() => setReload((value) => value + 1), 1_000);
    return () => globalThis.clearTimeout(timeout);
  }, [profile?.operation]);

  function changeSelection(values: string[]) {
    const selected = new Map<string, string>();
    for (const versionId of values) {
      const option = options.find((candidate) => candidate.version_id === versionId);
      if (option) selected.set(option.asset_id, option.version_id);
    }
    setSelection([...selected.values()]);
  }

  async function apply(): Promise<void> {
    if (!profile || saving) return;
    setSaving(true);
    setError(null);
    preserveSelection.current = true;
    try {
      const next = await backendTrpc.company.members.assets.applyInstallation.mutate({
        member_id: memberId,
        expected_revision: profile.revision,
        installations: selection.flatMap((versionId) => {
          const option = options.find((candidate) => candidate.version_id === versionId);
          return option ? [{ asset_id: option.asset_id, version_id: versionId }] : [];
        }),
        idempotency_key: globalThis.crypto.randomUUID(),
      });
      setProfile(next);
    } catch (caught) {
      preserveSelection.current = false;
      setError(messageFromError(caught, "member.assetsApplyFailed"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Skeleton active paragraph={{ rows: 2 }} title={false} />;
  if (!profile) {
    return (
      <Flexbox gap={8}>
        <Text type="danger">{error ? translateMessage(t, error) : t("member.assetsLoadFailed")}</Text>
        <Button onClick={() => setReload((value) => value + 1)} size="small">{t("common.retry")}</Button>
      </Flexbox>
    );
  }
  const operation = profile.operation;
  const applying = operation?.status === "pending" || operation?.status === "applying";
  const failed = operation?.status === "failed";
  return (
    <div style={{ alignItems: "start", display: "grid", gap: 16, gridTemplateColumns: initialSetup ? "1fr" : "140px minmax(0, 1fr)", paddingBlock: 12 }}>
      {!initialSetup ? <Text type="secondary">{t("member.assets")}</Text> : null}
      <Flexbox gap={12}>
        {initialSetup ? <Text as="h3" fontSize={18} strong>{t("member.configureAssets")}</Text> : null}
        <Select
          disabled={applying || saving}
          mode="multiple"
          onChange={(value) => changeSelection(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [])}
          options={options.map((option) => ({
            label: `${t(`assets.kinds.${option.kind}`)} · ${option.name} · ${option.version}`,
            value: option.version_id,
          }))}
          placeholder={t("member.noAssetsInstalled")}
          value={selection}
        />
        {applying ? <Text type="secondary">{t("member.assetsApplying")}</Text> : null}
        {failed ? <Text role="alert" type="danger">{t("member.assetsApplyFailed")}</Text> : null}
        {profile.installations.some((installation) => installation.health === "degraded")
          ? <Text type="warning">{t("member.assetsDegraded")}</Text>
          : null}
        {error ? <Text role="alert" type="danger">{translateMessage(t, error)}</Text> : null}
        <Flexbox gap={8} horizontal justify="flex-end">
          {initialSetup ? <Button disabled={applying || saving} onClick={onDone}>{t("member.skipAssets")}</Button> : null}
          <Button disabled={applying || saving} loading={saving} onClick={() => void apply()} type="primary">
            {failed ? t("common.retry") : t("common.save")}
          </Button>
          {initialSetup && operation?.status === "applied" ? <Button onClick={onDone}>{t("common.done")}</Button> : null}
        </Flexbox>
      </Flexbox>
    </div>
  );
}

function formatInvitationTime(timestampMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestampMs));
}

function MemberScrollSurface({ children }: { children: ReactNode }) { return <ScrollArea scrollFade style={{ background: "var(--ant-color-bg-container)", flex: 1, minHeight: 0, minWidth: 0 }}>{children}</ScrollArea>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label style={{ display: "flex", flexDirection: "column", gap: 8 }}><Text type="secondary">{label}</Text>{children}</label>; }
function MemberDetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) { return <div style={{ alignItems: "center", display: "grid", gap: 16, gridTemplateColumns: "140px minmax(0, 1fr)", minHeight: 64, paddingBlock: 12 }}><Text type="secondary">{label}</Text><Text ellipsis style={{ fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, monospace" : undefined }}>{value}</Text></div>; }
function CenteredMemberState({ children }: { children: ReactNode }) { return <Flexbox align="center" flex={1} gap={12} justify="center" style={{ background: "var(--ant-color-bg-container)", minHeight: 0, minWidth: 0 }}>{children}</Flexbox>; }

const memberContentStyle = { margin: "0 auto", maxWidth: 680, padding: "72px 20px 32px", width: "100%" } as const;
const dividerStyle = { border: 0, borderTop: "1px solid var(--ant-color-border)", margin: 0 } as const;
