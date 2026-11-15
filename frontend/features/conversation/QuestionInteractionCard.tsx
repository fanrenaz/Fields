import type { AgentQuestionInteraction } from "@fields/contracts/public/agent-activity";
import { Button, Input, TextArea } from "@lobehub/ui/base-ui";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Circle, LockKeyhole, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

type Resolution = "answered" | "dismissed" | "timed_out";

export function QuestionInteractionCard({ interaction, policy, onRespond, onSnooze }: {
  interaction: AgentQuestionInteraction;
  policy: "home" | "room";
  onRespond: (answers: Record<string, string[]>, resolution: Resolution) => Promise<void>;
  onSnooze?: (mode: "foreground" | "background") => void;
}) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [other, setOther] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [deadline, setDeadline] = useState<number | null>(() => initialDeadline(interaction, policy));
  const [idleUntil, setIdleUntil] = useState<number | null>(() => policy === "home" ? Date.now() + 60_000 : null);
  const [now, setNow] = useState(Date.now());
  const secretIds = useMemo(() => new Set(interaction.questions.filter((question) => question.secret).map((question) => question.id)), [interaction.questions]);
  const submittedRef = useRef(false);
  const lastRemoteSnoozeRef = useRef(0);
  const question = interaction.questions[index] ?? interaction.questions[0]!;

  const snooze = useCallback(() => {
    if (interaction.status !== "pending") return;
    const current = Date.now();
    if (policy === "room") setDeadline(current + 90_000);
    else {
      setIdleUntil(current + 60_000);
      setDeadline(null);
    }
    if (onSnooze && current - lastRemoteSnoozeRef.current >= 2_000) {
      lastRemoteSnoozeRef.current = current;
      onSnooze("foreground");
    }
  }, [interaction.status, onSnooze, policy]);

  useEffect(() => {
    if (interaction.status !== "pending" || policy !== "home") return;
    if (document.visibilityState !== "visible") {
      setIdleUntil(null);
      setDeadline(Date.now() + 90_000);
      onSnooze?.("background");
    } else {
      snooze();
    }
    const activity = () => snooze();
    document.addEventListener("pointerdown", activity, true);
    document.addEventListener("keydown", activity, true);
    const visibility = () => {
      if (document.visibilityState === "visible") snooze();
      else {
        setIdleUntil(null);
        setDeadline(Date.now() + 90_000);
        onSnooze?.("background");
      }
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("pointerdown", activity, true);
      document.removeEventListener("keydown", activity, true);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [interaction.status, onSnooze, policy, snooze]);

  useEffect(() => {
    if (interaction.status !== "pending") return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (policy === "home" && idleUntil !== null && current >= idleUntil && deadline === null) {
        setDeadline(current + 90_000);
        setIdleUntil(null);
      }
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [deadline, idleUntil, interaction.status, policy]);

  const submit = useCallback(async (resolution: Resolution) => {
    if (submitting || submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    setError(null);
    const answers = resolution === "answered"
      ? Object.fromEntries(interaction.questions.flatMap((candidate) => {
        const value = drafts[candidate.id]?.trim() ?? "";
        return value ? [[candidate.id, [value]]] : [];
      }))
      : {};
    try {
      await onRespond(answers, resolution);
    } catch {
      submittedRef.current = false;
      setSubmitting(false);
      setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !secretIds.has(id))));
      setError(t("questionInteraction.sendFailed"));
    }
  }, [drafts, interaction.questions, onRespond, secretIds, submitting, t]);

  useEffect(() => {
    if (deadline !== null && now >= deadline && interaction.status === "pending") void submit("timed_out");
  }, [deadline, interaction.status, now, submit]);

  if (interaction.status === "completed") {
    return (
      <div style={cardStyle}>
        <button aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} style={summaryButtonStyle} type="button">
          <span>{t("questionInteraction.asked", { count: interaction.questions.length })}</span>
          <ChevronDown aria-hidden size={16} style={{ transform: expanded ? "rotate(180deg)" : undefined, transition: "transform 160ms ease" }} />
        </button>
        {expanded ? (
          <div style={{ display: "grid", gap: 14, paddingTop: 12 }}>
            {interaction.questions.map((candidate) => (
              <div key={candidate.id}>
                <div style={{ color: "var(--ant-color-text-secondary)", fontSize: 12, marginBottom: 3 }}>{candidate.header}</div>
                <div style={{ fontSize: 14 }}>{candidate.question}</div>
                <div style={{ color: "var(--ant-color-text-tertiary)", fontSize: 13, marginTop: 4 }}>
                  {interaction.answers[candidate.id]?.values.join(", ") || t("questionInteraction.noAnswer")}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const value = drafts[question.id] ?? "";
  const countdown = deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1_000));
  const showCountdown = countdown !== null && countdown <= 60;
  const canAdvance = value.trim().length > 0;
  const last = index === interaction.questions.length - 1;
  const selectOption = (label: string) => {
    snooze();
    setDrafts((current) => ({ ...current, [question.id]: label }));
    setOther((current) => ({ ...current, [question.id]: false }));
    if (!last) window.setTimeout(() => setIndex((current) => Math.min(current + 1, interaction.questions.length - 1)), 180);
  };

  return (
    <section aria-label={t("questionInteraction.label")} aria-live="polite" onPointerDown={snooze} style={cardStyle}>
      <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
          <strong style={{ fontSize: 13 }}>{question.header || t("questionInteraction.question")}</strong>
          {question.secret ? <LockKeyhole aria-label={t("questionInteraction.secret")} size={14} /> : null}
        </div>
        <div style={{ alignItems: "center", display: "flex", gap: 5 }}>
          {showCountdown ? <span style={{ color: "var(--ant-color-text-tertiary)", fontSize: 12 }}>{countdown}s</span> : null}
          {interaction.questions.length > 1 ? (
            <>
              <Button aria-label={t("questionInteraction.previous")} disabled={index === 0 || submitting} icon={<ChevronLeft size={15} />} onClick={() => setIndex((value) => Math.max(0, value - 1))} size="small" />
              <span style={{ color: "var(--ant-color-text-secondary)", fontSize: 12, minWidth: 42, textAlign: "center" }}>{t("questionInteraction.position", { current: index + 1, total: interaction.questions.length })}</span>
              <Button aria-label={t("questionInteraction.next")} disabled={last || submitting} icon={<ChevronRight size={15} />} onClick={() => setIndex((value) => Math.min(interaction.questions.length - 1, value + 1))} size="small" />
            </>
          ) : null}
          <Button aria-label={t("questionInteraction.dismiss")} disabled={submitting} icon={<X size={15} />} onClick={() => void submit("dismissed")} size="small" />
        </div>
      </div>
      <div style={{ fontSize: 15, lineHeight: 1.5, marginBottom: 12 }}>{question.question}</div>
      {question.options ? (
        <div role="radiogroup" style={{ display: "grid", gap: 7 }}>
          {question.options.map((option) => {
            const selected = !other[question.id] && value === option.label;
            return (
              <button aria-checked={selected} disabled={submitting} key={option.label} onClick={() => selectOption(option.label)} role="radio" style={{ ...optionStyle, borderColor: selected ? "var(--ant-color-primary)" : "var(--ant-color-border-secondary)" }} type="button">
                {selected ? <Check aria-hidden color="var(--ant-color-primary)" size={17} /> : <Circle aria-hidden color="var(--ant-color-text-quaternary)" size={17} />}
                <span><span style={{ display: "block", fontSize: 14 }}>{option.label}</span>{option.description ? <span style={{ color: "var(--ant-color-text-secondary)", display: "block", fontSize: 12, marginTop: 2 }}>{option.description}</span> : null}</span>
              </button>
            );
          })}
          {question.allow_other ? (
            <button aria-checked={other[question.id] === true} disabled={submitting} onClick={() => { snooze(); setOther((current) => ({ ...current, [question.id]: true })); setDrafts((current) => ({ ...current, [question.id]: "" })); }} role="radio" style={optionStyle} type="button">
              <Circle aria-hidden size={17} /><span style={{ fontSize: 14 }}>{t("questionInteraction.other")}</span>
            </button>
          ) : null}
          {other[question.id] ? <Input autoFocus onChange={(event) => setDrafts((current) => ({ ...current, [question.id]: event.target.value }))} placeholder={t("questionInteraction.otherPlaceholder")} type={question.secret ? "password" : "text"} value={value} /> : null}
        </div>
      ) : question.secret ? (
        <Input autoFocus onChange={(event) => setDrafts((current) => ({ ...current, [question.id]: event.target.value }))} placeholder={t("questionInteraction.secretPlaceholder")} type="password" value={value} />
      ) : (
        <TextArea autoFocus autoSize={{ minRows: 3, maxRows: 8 }} onChange={(event) => setDrafts((current) => ({ ...current, [question.id]: event.target.value }))} placeholder={t("questionInteraction.answerPlaceholder")} value={value} />
      )}
      {error ? <div role="alert" style={{ color: "var(--ant-color-error)", fontSize: 12, marginTop: 10 }}>{error}</div> : null}
      <div style={{ alignItems: "center", display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
        <Button disabled={submitting} onClick={() => {
          if (!last) setIndex((current) => current + 1);
          else void submit("answered");
        }} type="primary">
          {last
            ? (canAdvance ? t("questionInteraction.submit") : t("questionInteraction.skip"))
            : (canAdvance ? t("questionInteraction.nextAction") : t("questionInteraction.skip"))}
        </Button>
      </div>
    </section>
  );
}

function initialDeadline(interaction: AgentQuestionInteraction, policy: "home" | "room"): number | null {
  if (interaction.deadline_at_ms !== null) return interaction.deadline_at_ms;
  return policy === "room" ? interaction.created_at_ms + 90_000 : null;
}

const cardStyle = {
  background: "var(--ant-color-bg-container)",
  border: "1px solid var(--ant-color-border-secondary)",
  borderRadius: 12,
  boxShadow: "0 8px 24px color-mix(in srgb, var(--ant-color-text) 7%, transparent)",
  marginTop: 8,
  maxWidth: 620,
  padding: 16,
} as const;

const optionStyle = {
  alignItems: "flex-start",
  background: "var(--ant-color-bg-container)",
  border: "1px solid var(--ant-color-border-secondary)",
  borderRadius: 9,
  color: "var(--ant-color-text)",
  cursor: "pointer",
  display: "flex",
  gap: 10,
  padding: "10px 12px",
  textAlign: "left",
  width: "100%",
} as const;

const summaryButtonStyle = {
  alignItems: "center",
  background: "transparent",
  border: 0,
  color: "var(--ant-color-text-secondary)",
  cursor: "pointer",
  display: "flex",
  fontSize: 13,
  justifyContent: "space-between",
  padding: 0,
  width: "100%",
} as const;
