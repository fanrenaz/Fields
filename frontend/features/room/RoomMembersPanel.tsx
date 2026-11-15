import {
  agentRoomErrorCodeSchema,
  type AgentRoomErrorCode,
  type AgentRoomTriggerPolicy,
  type RoomAgentTriggerPolicyResult,
} from "@fields/contracts/public/agent-room";
import {
  type CompanyActor,
} from "@fields/contracts/public/company";
import {
  type RoomMember,
} from "@fields/contracts/public/room";
import { Empty, ListItem, ScrollArea, Skeleton, Text } from "@lobehub/ui";
import { Button, Modal, Segmented, Tooltip } from "@lobehub/ui/base-ui";
import { ArrowLeft, Bot, Plus, RotateCw, Settings, UserMinus, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { backendTrpc } from "../../data/boundary/backend-trpc";
import { translateMessage, type UiMessageValue } from "../../shared/i18n";
import {
  type AgentTriggerMatrix,
  type AgentTriggerMode,
  triggerMatrixFromPolicy,
  triggerPolicyFromMatrix,
} from "./agent-trigger-matrix";
import { canRemoveRoomMember, roomMemberCandidates } from "./room-member-candidates";

export type RoomMembersPanelProps = {
  roomId: string | null;
  members: RoomMember[];
  loading?: boolean;
  error?: UiMessageValue;
  canManage?: boolean;
  adding?: boolean;
  companyActors?: CompanyActor[];
  companyActorsLoading?: boolean;
  companyActorsLoaded?: boolean;
  companyActorsError?: UiMessageValue;
  onAddMember?: (actorId: string, actorType: "human" | "agent") => void;
  onCloseAdd?: () => void;
  onRetryCompanyActors?: () => void;
  onRemoveMember?: (member: RoomMember) => void;
};

const panelStyle = {
  background: "var(--ant-color-bg-container)",
  display: "flex",
  flex: 1,
  flexDirection: "column" as const,
  minHeight: 0,
};

export function RoomMembersPanel({
  roomId,
  members,
  loading = false,
  error = null,
  canManage = false,
  adding = false,
  companyActors = [],
  companyActorsLoading = false,
  companyActorsLoaded = false,
  companyActorsError = null,
  onAddMember,
  onCloseAdd,
  onRetryCompanyActors,
  onRemoveMember,
}: RoomMembersPanelProps) {
  const { t } = useTranslation();
  const errorMessage = translateMessage(t, error);

  if (adding && canManage) {
    return (
      <AddRoomMembersPanel
        candidates={roomMemberCandidates(companyActors, members)}
        directoryError={companyActorsError}
        loaded={companyActorsLoaded}
        loading={companyActorsLoading}
        mutating={loading}
        mutationError={error}
        onAddMember={onAddMember}
        onBack={onCloseAdd}
        onRetry={onRetryCompanyActors}
      />
    );
  }

  return (
    <div style={panelStyle}>
      <ScrollArea scrollFade style={{ flex: 1, minHeight: 0 }}>
        <div aria-busy={loading} aria-label={t("workspace.addMember")} role="list" style={{ paddingBlock: "4px 12px" }}>
          {members.map((member) => (
            <MemberRow
              canManage={canManage}
              key={member.member_id}
              member={member}
              onRemove={canRemoveRoomMember(canManage, member) && onRemoveMember ? () => onRemoveMember(member) : undefined}
              roomId={roomId}
            />
          ))}
          {loading && members.length === 0 && !errorMessage ? <Skeleton active aria-label={t("common.loading")} paragraph={{ rows: 3 }} style={{ padding: 12 }} title={false} /> : null}
          {errorMessage ? <PanelState label={errorMessage} tone="error" /> : null}
          {!loading && !errorMessage && members.length === 0 ? <Empty description={t("room.noMembers")} imageSize={32} padding={12} /> : null}
        </div>
      </ScrollArea>
    </div>
  );
}

function AddRoomMembersPanel({
  candidates,
  loading,
  loaded,
  directoryError,
  mutationError,
  mutating,
  onAddMember,
  onBack,
  onRetry,
}: {
  candidates: CompanyActor[];
  loading: boolean;
  loaded: boolean;
  directoryError: UiMessageValue;
  mutationError: UiMessageValue;
  mutating: boolean;
  onAddMember?: (actorId: string, actorType: "human" | "agent") => void;
  onBack?: () => void;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const translatedMutationError = translateMessage(t, mutationError);

  return (
    <div style={panelStyle}>
      <div style={{ alignItems: "center", borderBottom: "1px solid var(--ant-color-border-secondary)", display: "flex", gap: 8, minHeight: 44, paddingInline: 8 }}>
        <Tooltip title={t("room.backToMembers")}>
          <Button aria-label={t("room.backToMembers")} disabled={!onBack} icon={<ArrowLeft size={15} />} onClick={onBack} shape="circle" size="small" type="text" />
        </Tooltip>
        <Text strong style={{ fontSize: 13 }}>{t("room.addMembers")}</Text>
      </div>
      <ScrollArea scrollFade style={{ flex: 1, minHeight: 0 }}>
        <div aria-busy={loading || mutating} aria-label={t("room.addMembers")} role="list" style={{ paddingBlock: "4px 12px" }}>
          {directoryError ? <PanelError error={directoryError} onRetry={onRetry} /> : null}
          {translatedMutationError ? <PanelState label={translatedMutationError} tone="error" /> : null}
          {candidates.map((candidate) => (
            <CandidateRow
              candidate={candidate}
              disabled={mutating || !onAddMember}
              key={candidate.actor_id}
              onSelect={() => onAddMember?.(candidate.actor_id, candidate.actor_type)}
            />
          ))}
          {(!loaded || loading) && candidates.length === 0 && !directoryError ? (
            <Skeleton active aria-label={t("common.loading")} paragraph={{ rows: 3 }} style={{ padding: 12 }} title={false} />
          ) : null}
          {loaded && !loading && !directoryError && candidates.length === 0 ? <Empty description={t("room.allMembersAdded")} imageSize={32} padding={12} /> : null}
        </div>
      </ScrollArea>
    </div>
  );
}

function CandidateRow({ candidate, disabled, onSelect }: { candidate: CompanyActor; disabled: boolean; onSelect: () => void }) {
  const { t } = useTranslation();
  return (
    <button disabled={disabled} onClick={onSelect} role="listitem" style={{ ...rowButtonStyle(disabled), padding: 0 }} type="button">
      <ListItem
        actions={<Plus aria-hidden color="var(--ant-color-text-secondary)" size={14} />}
        avatar={<MemberMark mark={candidate.mark} />}
        description={<span style={{ alignItems: "center", display: "flex", gap: 4 }}>
          {candidate.actor_type === "human" ? <UserRound size={11} /> : <Bot size={11} />}
          {candidate.actor_type === "human" ? t("room.human") : t("timeline.agent")}
        </span>}
        key={candidate.actor_id}
        styles={{ container: { minHeight: 48, padding: "8px 12px" }, title: ellipsisStyle }}
        title={candidate.display_name}
      />
    </button>
  );
}

function MemberRow({
  member,
  roomId,
  canManage,
  onRemove,
}: {
  member: RoomMember;
  roomId: string | null;
  canManage: boolean;
  onRemove?: () => void;
}) {
  return (
    <div role="listitem">
      <ListItem
        actions={<>
          {member.actor_type === "agent" ? <AgentTriggerPolicyControl agentMemberId={member.member_id} canManage={canManage} roomId={roomId} /> : null}
          {onRemove ? <RemoveMemberButton onRemove={onRemove} /> : null}
        </>}
        avatar={<MemberMark mark={member.mark} />}
        description={member.meta}
        key={member.member_id}
        showAction
        styles={{ container: { minHeight: 48, padding: "8px 12px" }, desc: ellipsisStyle, title: ellipsisStyle }}
        title={<span style={{ alignItems: "center", display: "flex", gap: 8, minWidth: 0 }}><strong style={ellipsisStyle}>{member.name}</strong><span style={{ color: "var(--ant-color-text-secondary)", fontSize: 11, ...ellipsisStyle }}>{member.role}</span></span>}
      />
    </div>
  );
}

function AgentTriggerPolicyControl({
  agentMemberId,
  canManage,
  roomId,
}: {
  agentMemberId: string;
  canManage: boolean;
  roomId: string | null;
}) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState<RoomAgentTriggerPolicyResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draftPolicy, setDraftPolicy] = useState<AgentRoomTriggerPolicy | null>(null);

  useEffect(() => {
    let active = true;
    setCurrent(null);
    setDraftPolicy(null);
    setErrorKey(null);
    if (!roomId) {
      setLoading(false);
      setErrorKey("room.triggerPolicyLoadFailed");
      return () => { active = false; };
    }
    setLoading(true);
    void backendTrpc.room.agents.triggerPolicy.get.query({
      agent_member_id: agentMemberId,
      room_id: roomId,
    }).then((result) => {
      if (active) {
        setCurrent(result);
        setDraftPolicy(result.policy);
      }
    }).catch((caught) => {
      const code = productErrorCode(caught);
      if (active) setErrorKey(code ? `productErrors.${code}` : "room.triggerPolicyLoadFailed");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [agentMemberId, roomId]);

  async function refetchAuthoritative(): Promise<RoomAgentTriggerPolicyResult | null> {
    if (!roomId) return null;
    const result = await backendTrpc.room.agents.triggerPolicy.get.query({
      agent_member_id: agentMemberId,
      room_id: roomId,
    });
    setCurrent(result);
    return result;
  }

  async function retryPolicy(): Promise<void> {
    setLoading(true);
    setErrorKey(null);
    try {
      const authoritative = await refetchAuthoritative();
      setDraftPolicy(authoritative?.policy ?? null);
    } catch {
      setErrorKey("room.triggerPolicyLoadFailed");
    } finally {
      setLoading(false);
    }
  }

  async function updatePolicy(policy: AgentRoomTriggerPolicy): Promise<boolean> {
    if (!roomId || !current || saving) return false;
    if (policy === current.policy) return true;
    setSaving(true);
    setErrorKey(null);
    try {
      const result = await backendTrpc.room.agents.triggerPolicy.set.mutate({
        agent_member_id: agentMemberId,
        expected_version: current.version,
        policy,
        room_id: roomId,
      });
      setCurrent(result);
      setDraftPolicy(result.policy);
      return true;
    } catch (caught) {
      const code = productErrorCode(caught);
      const conflict = code === "TRIGGER_POLICY_VERSION_CONFLICT";
      if (conflict) {
        try {
          const authoritative = await refetchAuthoritative();
          setDraftPolicy(authoritative?.policy ?? null);
          setErrorKey("room.triggerPolicyConflictRefreshed");
        } catch {
          setErrorKey("room.triggerPolicyLoadFailed");
        }
      } else {
        setErrorKey(code ? `productErrors.${code}` : "room.triggerPolicyUpdateFailed");
      }
      return false;
    } finally {
      setSaving(false);
    }
  }

  function openDialog(): void {
    setDraftPolicy(current?.policy ?? null);
    setErrorKey(null);
    setDialogOpen(true);
  }

  function updateMatrix(next: Partial<AgentTriggerMatrix>): void {
    if (!draftPolicy) return;
    setDraftPolicy(triggerPolicyFromMatrix({
      ...triggerMatrixFromPolicy(draftPolicy),
      ...next,
    }));
  }

  async function saveMatrix(): Promise<void> {
    if (!draftPolicy) return;
    if (await updatePolicy(draftPolicy)) setDialogOpen(false);
  }

  const status = loading
    ? t("common.loading")
    : current
      ? t(`room.triggerPolicies.${current.policy}`)
      : t("room.triggerPolicyUnavailable");

  const compactStatus = (
    <Text aria-label={`${t("room.triggerPolicy")}: ${status}`} role="status" type={errorKey && !current ? "danger" : "secondary"} style={{ fontSize: 11, whiteSpace: "nowrap" }}>
      {status}
    </Text>
  );

  if (!canManage) return compactStatus;

  const matrix = draftPolicy ? triggerMatrixFromPolicy(draftPolicy) : null;
  const modeOptions = [
    { label: t("room.triggerModes.off"), value: "off" },
    { label: t("room.triggerModes.explicit"), value: "explicit" },
    { label: t("room.triggerModes.automatic"), value: "automatic" },
  ];

  return (
    <>
      <span style={{ alignItems: "center", display: "inline-flex", gap: 4 }}>
        {compactStatus}
        <Tooltip title={t("room.changeTriggerPolicy")}>
          <Button aria-label={t("room.changeTriggerPolicy")} icon={<Settings size={14} />} onClick={openDialog} shape="circle" size="small" type="text" />
        </Tooltip>
      </span>
      <Modal
        cancelText={t("common.cancel")}
        confirmLoading={saving}
        destroyOnHidden
        okButtonProps={{ disabled: !matrix || loading }}
        okText={t("common.save")}
        onCancel={() => {
          if (!saving) setDialogOpen(false);
        }}
        onOk={() => void saveMatrix()}
        open={dialogOpen}
        title={t("room.changeTriggerPolicy")}
        width={560}
      >
        <Text as="p" type="secondary">{t("room.triggerMatrixDescription")}</Text>
        {matrix ? (
          <div aria-label={t("room.triggerMatrix")} role="group" style={{ display: "grid", gap: 12, marginTop: 20 }}>
            <TriggerMatrixRow
              label={t("room.humanMessages")}
              mode={matrix.human}
              onChange={(mode) => {
                if (mode !== "off") updateMatrix({ human: mode });
              }}
              options={modeOptions.map((option) => ({ ...option, disabled: option.value === "off" }))}
              saving={saving}
            />
            <TriggerMatrixRow
              label={t("room.agentMessages")}
              mode={matrix.agent}
              onChange={(mode) => updateMatrix({ agent: mode })}
              options={modeOptions}
              saving={saving}
            />
          </div>
        ) : loading ? (
          <Skeleton active aria-label={t("common.loading")} paragraph={{ rows: 2 }} title={false} />
        ) : null}
        {errorKey ? <Text as="p" role="alert" type="danger">{t(errorKey)}</Text> : null}
        {!current && !loading ? (
          <Button icon={<RotateCw size={14} />} onClick={() => void retryPolicy()} size="small" type="text">
            {t("common.retry")}
          </Button>
        ) : null}
      </Modal>
    </>
  );
}

function TriggerMatrixRow({
  label,
  mode,
  onChange,
  options,
  saving,
}: {
  label: string;
  mode: AgentTriggerMode;
  onChange: (mode: AgentTriggerMode) => void;
  options: { label: string; value: string; disabled?: boolean }[];
  saving: boolean;
}) {
  return (
    <div style={{ alignItems: "center", display: "grid", gap: 16, gridTemplateColumns: "88px minmax(0, 1fr)" }}>
      <Text strong>{label}</Text>
      <Segmented
        aria-label={label}
        block
        disabled={saving}
        onChange={(value) => {
          if (typeof value === "string") onChange(value as AgentTriggerMode);
        }}
        options={options}
        value={mode}
      />
    </div>
  );
}

function RemoveMemberButton({ onRemove }: { onRemove: () => void }) {
  const { t } = useTranslation();
  return (
    <Tooltip title={t("room.removeMember")}>
      <Button aria-label={t("room.removeMember")} icon={<UserMinus size={14} />} onClick={onRemove} shape="circle" size="small" type="text" />
    </Tooltip>
  );
}

function productErrorCode(error: unknown, depth = 0): AgentRoomErrorCode | null {
  if (depth > 4 || error === null || typeof error !== "object") return null;
  const candidate = error as Record<string, unknown>;
  for (const key of ["code", "error_code", "product_code"]) {
    const parsed = agentRoomErrorCodeSchema.safeParse(candidate[key]);
    if (parsed.success) return parsed.data;
  }
  for (const key of ["data", "cause", "error", "shape", "details", "meta", "product_error"]) {
    const nested = productErrorCode(candidate[key], depth + 1);
    if (nested) return nested;
  }
  const message = candidate.message;
  if (typeof message === "string") {
    return agentRoomErrorCodeSchema.options.find((code) => message.includes(code)) ?? null;
  }
  return null;
}

function PanelError({ error, onRetry }: { error: UiMessageValue; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div style={{ alignItems: "center", display: "flex", gap: 8, justifyContent: "space-between", padding: "8px 12px" }}>
      <Text type="danger" style={{ flex: 1, fontSize: 11 }}>{translateMessage(t, error)}</Text>
      {onRetry ? <Button onClick={onRetry} size="small">{t("common.retry")}</Button> : null}
    </div>
  );
}

function MemberMark({ mark }: { mark: string }) {
  return (
    <span style={{ alignItems: "center", background: "var(--ant-color-bg-container)", border: "1px solid var(--ant-color-border)", borderRadius: 6, display: "flex", fontSize: 10, fontWeight: 800, height: 28, justifyContent: "center", minWidth: 28 }}>
      {mark}
    </span>
  );
}

function PanelState({ label, tone = "muted" }: { label: string; tone?: "muted" | "error" }) {
  return <Text type={tone === "error" ? "danger" : "secondary"} style={{ display: "block", fontSize: 12, padding: "8px 12px 0" }}>{label}</Text>;
}

const ellipsisStyle = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap" as const,
};

function rowButtonStyle(disabled: boolean) {
  return {
    alignItems: "center",
    background: "transparent",
    border: 0,
    color: "var(--ant-color-text)",
    cursor: disabled ? "default" : "pointer",
    display: "flex",
    gap: 8,
    minHeight: 48,
    opacity: disabled ? 0.56 : 1,
    padding: "8px 12px",
    width: "100%",
  } as const;
}
