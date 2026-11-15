import type {
  ExecutorSafeSummary,
  MemberExecutorAssignment,
} from "@fields/contracts/public/executor";
import { Codex } from "@lobehub/icons";
import { useState } from "react";
import { BookOpen, BrainCircuit, Check, ChevronDown, KeyRound, LoaderCircle, RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Flexbox, Icon, Popover, Text } from "@lobehub/ui";
import {
  Button,
  Switch,
  DropdownMenu,
  Input,
  type DropdownItem,
} from "@lobehub/ui/base-ui";

import { Composer } from "../conversation/Composer";
import type { ExecutorAccessController } from "../executor-onboarding";
import type { HomeMachineController } from "./use-home-machine";
import { Conversation, type ConversationMessageAction } from "../conversation/Conversation";
import { ScheduledTaskDrawer } from "../scheduled-tasks";
import { QuestionInteractionCard } from "../conversation/QuestionInteractionCard";
import { agentQuestionInteractionSchema } from "@fields/contracts/public/agent-activity";
import { translateMessage } from "../../shared/i18n";

export function HomeChat({ executorAccess, home, onOpenExecutorSetup }: { executorAccess: ExecutorAccessController; home: HomeMachineController; onOpenExecutorSetup?: () => void }) {
  const { t } = useTranslation();
  const loadingExecutor = executorAccess.status === "loading" || executorAccess.status === "transitioning";
  const executorError = executorAccess.status === "error";
  const assignment = executorAccess.assignment;
  const options = [...executorAccess.options];
  const executorReady = executorAccess.active;
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const composer = (
    <Composer
      contentWidth="main"
      draft={home.composer.draft}
      error={home.composer.error}
      mentionOptions={[]}
      onClearReply={() => undefined}
      onDraft={home.composer.onDraft}
      onSearch={() => undefined}
      onSend={(markdown) => { void home.composer.onSend(markdown); }}
      onSchedule={() => setSchedulerOpen(true)}
      referenceOptions={[]}
      replyAnchor={null}
      sendDisabled={home.composer.sendDisabled || !executorReady}
      showMentionButton={false}
      statusMessage={home.composer.statusMessage}
      surface={home.timeline.view === "active_thread" ? "docked" : "floating"}
      toolbarActions={(
        <Flexbox align="center" gap={4} horizontal>
          <HomeExecutorPicker
            assignment={assignment}
            error={executorError}
            loading={loadingExecutor}
            onOpenSetup={onOpenExecutorSetup}
            onRetry={() => void executorAccess.refresh()}
            onSelect={(id) => void executorAccess.bind(id).catch(() => undefined)}
            options={options}
          />
          <HomeModelControls
            disabled={!executorReady || home.composer.sendDisabled}
            model={home.composer.model}
          />
          <HomeMemoryControl
            disabled={!executorReady || home.composer.sendDisabled}
            memory={home.composer.memory}
          />
        </Flexbox>
      )}
    />
  );
  const scheduler = <ScheduledTaskDrawer
    mode="create"
    onClose={() => setSchedulerOpen(false)}
    onSaved={() => home.composer.onDraft("")}
    open={schedulerOpen}
    seed={{
      lockedTarget: true,
      markdown: home.composer.draft,
      target: home.timeline.activeThreadId
        ? { kind: "home", thread_mode: "existing", thread_id: home.timeline.activeThreadId }
        : { kind: "home", thread_mode: "new_each_run", thread_id: null },
    }}
    targetOptions={{ rooms: [], threads: home.rightPanel.threads.items.map((thread) => ({ id: thread.id, title: thread.title })) }}
  />;
  if (home.timeline.view === "active_thread") {
    return (
      <div style={{ background: "var(--ant-color-bg-container)", display: "flex", flex: 1, flexDirection: "column", minHeight: 0, minWidth: 0 }}>
        <Conversation
          contentWidth="main"
          context={{ id: home.timeline.activeThreadId ?? "new", surface: "home" }}
          error={home.timeline.error}
          generatingMessageIds={home.timeline.generatingMessageIds}
          loading={home.timeline.loading}
          messageActions={homeMessageActions}
          messages={home.timeline.messages}
          onBranchSwitch={home.timeline.onBranchSwitch}
          onMessageAction={(action, message) => {
            if (action === "edit") home.timeline.onEdit(message);
            if (action === "branch") home.timeline.onFork(message);
            if (action === "regenerate") home.timeline.onRegenerate(message);
            if (action === "delete") home.timeline.onDeleteThread();
          }}
          renderBelowMessage={(message) => (
            <HomeQuestionInteractions home={home} message={message} />
          )}
          store={home.timeline.store}
        />
        {composer}
        {scheduler}
      </div>
    );
  }
  return (
    <div style={{ alignItems: "center", background: "var(--ant-color-bg-container)", display: "flex", flex: 1, justifyContent: "center", minHeight: 0, padding: "0 32px 64px" }}>
      <div style={{ alignItems: "center", display: "flex", flexDirection: "column", gap: 22, width: "100%" }}>
        <h1 style={{ fontSize: "clamp(28px, 4vw, 36px)", fontWeight: 500, letterSpacing: "-0.025em", lineHeight: 1.2, margin: 0, maxWidth: 900, textAlign: "center" }}>
          {t("home.prompt")}
        </h1>
        {composer}
        {scheduler}
      </div>
    </div>
  );
}

function HomeQuestionInteractions({ home, message }: { home: HomeMachineController; message: HomeMachineController["timeline"]["messages"][number] }) {
  const values = Array.isArray(message.metadata?.fieldsQuestionInteractions)
    ? message.metadata.fieldsQuestionInteractions
    : [];
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {values.flatMap((value) => {
        const parsed = agentQuestionInteractionSchema.safeParse(value);
        return parsed.success ? [(
          <QuestionInteractionCard
            interaction={parsed.data}
            key={parsed.data.id}
            onRespond={(answers, resolution) => home.timeline.onRespondToQuestion(parsed.data.id, answers, resolution)}
            onSnooze={(mode) => home.timeline.onSnoozeQuestion(parsed.data.id, mode)}
            policy="home"
          />
        )] : [];
      })}
    </div>
  );
}

function HomeMemoryControl({ disabled, memory }: {
  disabled: boolean;
  memory: HomeMachineController["composer"]["memory"];
}) {
  const { t } = useTranslation();
  const profile = memory.profile;
  const applying = profile?.status === "applying";
  const failed = profile?.status === "failed";
  const active = profile?.applied_enabled === true;
  const unavailable = memory.loading || memory.updating || profile === null;
  return (
    <Popover
      content={(
        <Flexbox gap={10} style={{ width: 260 }}>
          <Flexbox align="center" horizontal justify="space-between">
            <Text strong>{t("home.memory")}</Text>
            <Switch
              aria-label={t("home.memory")}
              checked={profile?.enabled ?? false}
              disabled={disabled || unavailable || applying}
              onChange={memory.setEnabled}
            />
          </Flexbox>
          <Text role="status" type={failed || memory.error ? "danger" : "secondary"}>
            {memory.error
              ? translateMessage(t, memory.error)
              : t(`home.memoryStatus.${memoryStatusKey(profile)}`)}
          </Text>
          {failed || memory.error ? (
            <Button disabled={disabled || memory.loading || memory.updating || applying} onClick={memory.retry} size="small">
              {t("common.retry")}
            </Button>
          ) : null}
        </Flexbox>
      )}
      placement="topLeft"
      trigger="click"
    >
      <Button
        aria-label={t("home.memory")}
        aria-pressed={active}
        icon={memory.loading || memory.updating || applying
          ? <Icon icon={LoaderCircle} size="small" spin />
          : <BookOpen aria-hidden size={16} />}
        shape="circle"
        style={{ color: active ? "var(--ant-color-primary)" : undefined }}
        title={t("home.memory")}
      />
    </Popover>
  );
}

function memoryStatusKey(profile: HomeMachineController["composer"]["memory"]["profile"]): string {
  if (!profile) return "unavailable";
  if (profile.status === "applying") return profile.enabled ? "enabling" : "disabling";
  if (profile.status === "failed") return "failed";
  return profile.applied_enabled ? "enabled" : "disabled";
}

function homeMessageActions(message: HomeMachineController["timeline"]["messages"][number]): readonly ConversationMessageAction[] {
  if (message.metadata?.fieldsImported === true) return message.role === "user" ? ["copy", "delete"] : ["copy"];
  if (message.role === "user") return ["edit", "branch", "copy", "delete"];
  if (message.role === "assistant" || message.role === "assistantGroup") return ["regenerate", "branch", "copy"];
  return [];
}

function HomeModelControls({ disabled, model }: {
  disabled: boolean;
  model: HomeMachineController["composer"]["model"];
}) {
  const { t } = useTranslation();
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const current = model.selection;
  const selectedOption = current ? model.options.find((option) => option.model === current.model) : undefined;
  const knownOptions = current && !selectedOption
    ? [{ display_name: current.model, model: current.model }, ...model.options]
    : model.options;
  const normalizedSearch = modelSearch.trim().toLocaleLowerCase();
  const visibleOptions = normalizedSearch
    ? knownOptions.filter((option) => (
      option.display_name.toLocaleLowerCase().includes(normalizedSearch)
      || option.model.toLocaleLowerCase().includes(normalizedSearch)
    ))
    : knownOptions;
  const modelItems: DropdownItem[] = visibleOptions.map((option) => ({
    extra: option.model === current?.model ? <Check size={14} /> : null,
    key: option.model,
    label: option.display_name,
    onClick: () => model.selectModel(option.model),
  }));
  const effortItems: DropdownItem[] = selectedOption?.supported_reasoning_efforts.map((effort) => ({
    extra: (
      <Flexbox align="center" gap={8} horizontal>
        {effort === selectedOption.default_reasoning_effort
          ? <span style={{ color: "var(--ant-color-text-tertiary)", fontSize: 11 }}>{t("home.reasoningEffortDefault")}</span>
          : null}
        {effort === current?.reasoning_effort ? <Check size={14} /> : null}
      </Flexbox>
    ),
    key: effort,
    label: reasoningEffortLabel(effort, t),
    onClick: () => model.selectReasoningEffort(effort),
  })) ?? [];
  const modelDisabled = disabled || Boolean(model.error) || model.loading || model.updating || knownOptions.length === 0;
  const effortDisabled = disabled || Boolean(model.error) || model.loading || model.updating || !current || effortItems.length === 0;
  const modelLabel = model.error
    ? t("home.modelUnavailable")
    : selectedOption?.display_name ?? current?.model ?? t("home.model");
  const effortLabel = current?.reasoning_effort
    ? reasoningEffortLabel(current.reasoning_effort, t)
    : t("home.reasoningEffort");
  return (
    <>
      <span aria-hidden style={{ background: "var(--ant-color-border-secondary)", height: 18, margin: "0 2px", width: 1 }} />
      <DropdownMenu
        header={knownOptions.length > 8 ? (
          <Input
            aria-label={t("common.search")}
            onChange={(event) => setModelSearch(event.target.value)}
            placeholder={t("common.search")}
            size="small"
            value={modelSearch}
          />
        ) : undefined}
        items={modelItems}
        nativeButton
        onOpenChange={(open) => {
          setModelMenuOpen(open);
          if (!open) setModelSearch("");
        }}
        open={modelMenuOpen}
        placement="topLeft"
        trigger="click"
      >
        <Button
          aria-label={t("home.model")}
          disabled={modelDisabled}
          size="small"
          style={{ gap: 5, maxWidth: "min(190px, 30vw)", minWidth: 0, paddingInline: 7 }}
          title={modelLabel}
          type="text"
        >
          {model.loading || model.updating
            ? <Icon icon={LoaderCircle} size="small" spin />
            : <Codex.Avatar shape="square" size={17} />}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{modelLabel}</span>
          <ChevronDown aria-hidden size={13} />
        </Button>
      </DropdownMenu>
      <DropdownMenu
        items={effortItems}
        nativeButton
        placement="topLeft"
        trigger="click"
      >
        <Button
          aria-label={t("home.reasoningEffort")}
          disabled={effortDisabled}
          size="small"
          style={{ gap: 5, paddingInline: 7 }}
          type="text"
        >
          <BrainCircuit aria-hidden size={15} />
          <span>{effortLabel}</span>
          <ChevronDown aria-hidden size={13} />
        </Button>
      </DropdownMenu>
    </>
  );
}

function reasoningEffortLabel(effort: string, t: (key: string) => string): string {
  const labels: Record<string, string> = {
    none: t("home.reasoningEffortLevel.none"),
    minimal: t("home.reasoningEffortLevel.minimal"),
    low: t("home.reasoningEffortLevel.low"),
    medium: t("home.reasoningEffortLevel.medium"),
    high: t("home.reasoningEffortLevel.high"),
    xhigh: t("home.reasoningEffortLevel.xhigh"),
  };
  return labels[effort] ?? effort;
}

function HomeExecutorPicker({ assignment, options, loading, error, onSelect, onRetry, onOpenSetup }: { assignment: MemberExecutorAssignment | null; options: ExecutorSafeSummary[]; loading: boolean; error: boolean; onSelect: (executorId: string) => void; onRetry: () => void; onOpenSetup?: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const transitioning = assignment?.session_state === "preparing" || assignment?.session_state === "switching";
  const blocked = error || !assignment?.executor || assignment.session_state === "auth_required" || assignment.session_state === "failed";
  return <Popover content={<div style={{ display: "flex", flexDirection: "column", gap: 8, width: 300 }}><div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}><strong style={{ fontSize: 13 }}>{t("home.executor")}</strong>{assignment?.executor ? <span style={{ color: blocked ? "var(--ant-color-error)" : transitioning ? "var(--ant-color-warning)" : "var(--ant-color-text-secondary)", fontSize: 11 }}>{t(`home.executorState.${assignment.session_state}`)}</span> : null}</div>{assignment?.executor ? <span style={{ color: "var(--ant-color-text-secondary)", fontSize: 12 }}>{executorLabel(assignment.executor)}</span> : null}{error ? <span style={{ color: "var(--ant-color-error)", fontSize: 12 }}>{t("home.executorLoadFailed")}</span> : null}{!error && !assignment?.executor ? <span style={{ color: "var(--ant-color-error)", fontSize: 12 }}>{t("home.executorRequired")}</span> : null}<hr style={{ border: 0, borderTop: "1px solid var(--ant-color-border-secondary)", margin: "4px 0" }} />{options.map((executor) => { const selected = executor.executor_id === assignment?.executor?.executor_id; return <Button block disabled={loading || transitioning || executor.availability !== "available" || selected} icon={<Codex.Avatar shape="square" size={20} />} key={executor.executor_id} onClick={() => { setOpen(false); onSelect(executor.executor_id); }} style={{ justifyContent: "flex-start" }} type="text"><span style={{ alignItems: "center", display: "flex", flex: 1, gap: 6, justifyContent: "space-between" }}>{executorLabel(executor)}{selected ? <Check color="var(--ant-color-success)" size={15} /> : null}</span></Button>; })}{options.length === 0 && !error ? <span style={{ color: "var(--ant-color-text-secondary)", fontSize: 12 }}>{t("executor.noExecutorOptions")}</span> : null}{error ? <Button icon={<RotateCw size={14} />} loading={loading} onClick={onRetry} type="text">{t("common.retry")}</Button> : null}{blocked && onOpenSetup ? <Button icon={<KeyRound size={14} />} onClick={() => { setOpen(false); onOpenSetup(); }} type="text">{t("shell.completeExecutorSetup")}</Button> : null}</div>} onOpenChange={setOpen} open={open} placement="topLeft" trigger="click"><Button aria-label={t("home.changeExecutor")} icon={loading || transitioning ? <Icon icon={LoaderCircle} size="small" spin /> : blocked ? <KeyRound size={16} /> : <Codex.Avatar shape="square" size={20} />} shape="circle" style={{ borderColor: blocked ? "var(--ant-color-error-border)" : transitioning ? "var(--ant-color-warning-border)" : undefined }} /></Popover>;
}
function executorLabel(executor: ExecutorSafeSummary): string { return executor.owner_display_name ? `${executor.owner_display_name} · ${executor.name}` : executor.name; }
