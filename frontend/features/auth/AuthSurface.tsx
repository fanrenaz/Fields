import { Flexbox, Skeleton, Text } from "@lobehub/ui";
import { Button, Input } from "@lobehub/ui/base-ui";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import authAbstract from "../../assets/brand/auth-abstract.png";
import { LanguageSelector, translateMessage, type UiMessageValue } from "../../shared/i18n";
import { AppShell } from "../shell/Shell";
export function AuthScaffold({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <main className="fields-auth-scaffold" style={{ background: "var(--fields-color-surface)" }}>
        <section className="fields-auth-visual" style={{ background: "var(--fields-color-ink)" }}>
          <img alt="" src={authAbstract} style={{ height: "100%", inset: 0, objectFit: "cover", position: "absolute", width: "100%" }} />
          <span style={{ color: "#f7f4ed", fontFamily: "Instrument Sans, sans-serif", fontSize: 40, fontWeight: 600, left: 40, letterSpacing: -1.5, lineHeight: 1, position: "absolute", top: 40 }}>Fields</span>
        </section>
        <section className="fields-auth-content">
          <div style={{ position: "absolute", right: 28, top: 24, zIndex: 1 }}><LanguageSelector compact /></div>
          <div className="fields-auth-panel">{children}</div>
        </section>
      </main>
    </AppShell>
  );
}

export function AuthPanel({ title, children, feedback }: { title: string; children: ReactNode; feedback?: { kind: "error" | "success"; message: string } | null }) {
  return (
    <Flexbox gap={24} width="100%">
      <h1 style={{ color: "var(--fields-color-ink)", fontFamily: "Instrument Sans, sans-serif", fontSize: 46, letterSpacing: -1.5, lineHeight: 1.1, margin: 0 }}>{title}</h1>
      <Flexbox gap={16} width="100%">{children}</Flexbox>
      {feedback ? <AuthFeedback kind={feedback.kind}>{feedback.message}</AuthFeedback> : null}
    </Flexbox>
  );
}

export function AuthTextField({
  id,
  name,
  label,
  value,
  error,
  onChangeText,
  onSubmit,
  secureTextEntry,
  visible,
  onToggleVisibility,
  autoComplete,
  keyboardType,
}: {
  id: string;
  name?: string;
  label: string;
  value: string;
  error?: UiMessageValue;
  onChangeText: (value: string) => void;
  onSubmit?: () => void;
  secureTextEntry?: boolean;
  visible?: boolean;
  onToggleVisibility?: () => void;
  autoComplete?: string;
  keyboardType?: string;
}) {
  const { t } = useTranslation();
  const labelId = `${id}-label`;
  const errorId = `${id}-error`;
  const passwordField = secureTextEntry === true;
  const errorMessage = translateMessage(t, error);

  return (
    <label htmlFor={id} style={{ display: "grid", gap: 8, width: "100%" }}>
      <Text id={labelId} strong style={{ color: "var(--fields-color-ink)" }}>{label}</Text>
      <div style={{ position: "relative" }}>
        <Input
          aria-describedby={errorMessage ? errorId : undefined}
          aria-invalid={Boolean(errorMessage)}
          aria-labelledby={labelId}
          autoComplete={autoComplete}
          autoCapitalize={keyboardType === "email-address" || passwordField ? "none" : "sentences"}
          id={id}
          name={name}
          onChange={(event) => onChangeText(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") onSubmit?.(); }}
          style={{ background: "var(--fields-color-surface)", borderColor: errorMessage ? "var(--fields-color-primary)" : "var(--fields-color-border)", color: "var(--fields-color-ink)", height: 50, paddingInline: 14, paddingRight: passwordField ? 54 : 14 }}
          type={passwordField && !visible ? "password" : "text"}
          value={value}
        />
        {passwordField && onToggleVisibility ? (
          <Button
            aria-label={visible ? t("auth.hideField", { field: label.toLowerCase() }) : t("auth.showField", { field: label.toLowerCase() })}
            onClick={onToggleVisibility}
            size="small"
            style={{ position: "absolute", right: 7, top: 10 }}
            type="text"
          >
            {visible ? t("auth.hide") : t("auth.show")}
          </Button>
        ) : null}
      </div>
      {errorMessage ? <Text id={errorId} role="alert" style={{ color: "var(--fields-color-primary)" }}>{errorMessage}</Text> : null}
    </label>
  );
}

export function AuthPrimaryButton({ label, submittingLabel, submitting, disabled, onPress }: { label: string; submittingLabel: string; submitting: boolean; disabled: boolean; onPress: () => void }) {
  return <Button block disabled={disabled} loading={submitting} onClick={onPress} size="large" style={{ height: 50 }} type="primary">{submitting ? submittingLabel : label}</Button>;
}

export function AuthSecondaryButton({ children, onPress, disabled = false }: { children: ReactNode; onPress: () => void; disabled?: boolean }) {
  return <Button disabled={disabled} onClick={onPress} style={{ marginLeft: -8 }} type="text">{children}</Button>;
}

export function AuthFeedback({ kind, children }: { kind: "error" | "success"; children: ReactNode }) {
  return <Text role={kind === "error" ? "alert" : "status"} style={{ color: kind === "error" ? "var(--fields-color-primary)" : "var(--fields-color-success)" }}>{children}</Text>;
}

export function AuthLoadingState() {
  const { t } = useTranslation();
  return <AuthScaffold><Skeleton active aria-label={t("auth.loading")} paragraph={{ rows: 3 }} title={{ width: "68%" }} /></AuthScaffold>;
}

export function AuthStateMessage({ title, message, primaryAction, secondaryAction }: { title: string; message?: string | null; primaryAction?: { label: string; onPress: () => void }; secondaryAction?: { label: string; onPress: () => void } }) {
  return (
    <AuthScaffold>
      <AuthPanel feedback={message ? { kind: "error", message } : null} title={title}>
        {primaryAction ? <AuthPrimaryButton disabled={false} label={primaryAction.label} onPress={primaryAction.onPress} submitting={false} submittingLabel={primaryAction.label} /> : null}
        {secondaryAction ? <AuthSecondaryButton onPress={secondaryAction.onPress}>{secondaryAction.label}</AuthSecondaryButton> : null}
      </AuthPanel>
    </AuthScaffold>
  );
}
