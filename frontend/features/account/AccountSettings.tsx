import { copyToClipboard, Flexbox, Text } from "@lobehub/ui";
import { Button, Checkbox, Form, FormDivider, Input, Segmented, Tooltip } from "@lobehub/ui/base-ui";
import { Building2, Check, ChevronLeft, Copy, Eye, EyeOff, KeyRound, Monitor, User } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { LanguageSelector, translateMessage, type UiMessageValue } from "../../shared/i18n";
import { ExecutorSettings } from "./ExecutorSettings";
import type { PersonalExecutorSummary } from "@fields/contracts/public/executor";
import { TerminalSettings } from "./TerminalSettings";
import { CompanyRegistrationSettings } from "./CompanyRegistrationSettings";
import { DesktopSettings } from "./DesktopSettings";

export type AccountSettingsPasswordField = "currentPassword" | "newPassword" | "confirmPassword";

export type AccountSettingsPasswordController = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  currentPasswordVisible: boolean;
  newPasswordVisible: boolean;
  confirmPasswordVisible: boolean;
  revokeOtherSessions: boolean;
  fieldErrors: Partial<Record<AccountSettingsPasswordField, UiMessageValue>>;
  submitting: boolean;
  success: boolean;
  error: UiMessageValue;
  setCurrentPassword: (value: string) => void;
  setNewPassword: (value: string) => void;
  setConfirmPassword: (value: string) => void;
  toggleCurrentPasswordVisibility: () => void;
  toggleNewPasswordVisibility: () => void;
  toggleConfirmPasswordVisibility: () => void;
  setRevokeOtherSessions: (value: boolean) => void;
  submit: () => void;
};

export type AccountSettingsController<TPassword extends AccountSettingsPasswordController = AccountSettingsPasswordController> = {
  actorId?: string;
  companyId?: string;
  displayName: string;
  email: string;
  companyRole: "owner" | "member";
  close: () => void;
  createExecutor: () => void;
  configureExecutorModels: (executor: PersonalExecutorSummary) => void;
  password: TPassword;
};

export type SettingsSection = "account" | "company" | "desktop" | "executors" | "terminals";

export function AccountSettings<TController extends AccountSettingsController = AccountSettingsController>({ controller, initialSection = "account" }: { controller: TController; initialSection?: SettingsSection }) {
  const { t } = useTranslation();
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const password = controller.password;
  const passwordError = translateMessage(t, password.error);
  const submitFeedbackId = password.error ? "change-password-submit-error" : password.success ? "change-password-submit-success" : undefined;
  const submitLabel = password.submitting ? t("account.changingPassword") : passwordError ? t("common.retry") : t("account.changePassword");

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  return (
    <section style={{ background: "var(--ant-color-bg-layout)", display: "flex", flex: 1, flexDirection: "column", minHeight: 0, minWidth: 0 }}>
      <header style={{ alignItems: "center", borderBottom: "1px solid var(--ant-color-border-secondary)", display: "flex", gap: 8, minHeight: 60, padding: "0 20px" }}>
        <Button aria-label={t("account.close")} icon={<ChevronLeft size={16} />} onClick={controller.close} shape="circle" type="text" />
        <h1 style={{ fontSize: 24, margin: 0 }}>{t("account.title")}</h1>
      </header>
      <nav aria-label={t("account.title")} style={{ borderBottom: "1px solid var(--ant-color-border-secondary)", padding: "6px 20px" }}>
        <Segmented
          onChange={(value) => setSection(value as SettingsSection)}
          options={[
            { icon: <User size={15} />, label: t("account.account"), value: "account" },
            ...(controller.companyRole === "owner" ? [{ icon: <Building2 size={15} />, label: t("account.company"), value: "company" }] : []),
            { icon: <KeyRound size={15} />, label: t("account.executors"), value: "executors" },
            ...(window.fieldsDesktop ? [{ icon: <Monitor size={15} />, label: t("desktopSettings.title"), value: "desktop" }] : []),
            ...(controller.companyRole === "owner" ? [{ icon: <KeyRound size={15} />, label: t("account.terminals"), value: "terminals" }] : []),
          ]}
          value={section}
        />
      </nav>
      {section === "company" && controller.companyRole === "owner" ? <CompanyRegistrationSettings /> : section === "terminals" && controller.companyRole === "owner" ? <TerminalSettings /> : section === "desktop" && window.fieldsDesktop ? <DesktopSettings /> : section === "executors" ? <ExecutorSettings actorId={controller.actorId ?? ""} companyId={controller.companyId ?? ""} canGovern={controller.companyRole === "owner"} onCreate={controller.createExecutor} onConfigureModels={controller.configureExecutorModels} /> : (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <Flexbox gap={24} style={{ margin: "0 auto", maxWidth: 760, padding: "48px 48px 64px", width: "100%" }}>
            <section aria-labelledby="account-identity-heading">
              <h2 id="account-identity-heading">{t("account.account")}</h2>
              <div style={{ borderTop: "1px solid var(--ant-color-border-secondary)" }}>
                <ReadOnlyAccountRow id="account-name" label={t("account.displayName")} value={controller.displayName} />
                <ReadOnlyAccountRow id="account-email" label={t("account.email")} value={controller.email} />
                <ReadOnlyAccountRow id="account-role" label={t("account.companyRole")} last value={companyRoleLabel(controller.companyRole, t)} />
              </div>
            </section>
            <LanguageSelector />
            <FormDivider />
            <Form aria-busy={password.submitting} aria-labelledby="account-security-heading" onFinish={() => password.submit()} style={{ maxWidth: 520 }}>
              <h2 id="account-security-heading">{t("account.security")}</h2>
              <Flexbox gap={16}>
                <Text strong>{t("account.changePassword")}</Text>
                <PasswordField id="current-password" label={t("account.currentPassword")} value={password.currentPassword} error={password.fieldErrors.currentPassword} visible={password.currentPasswordVisible} disabled={password.submitting} autoComplete="current-password" onChangeText={password.setCurrentPassword} onToggleVisibility={password.toggleCurrentPasswordVisibility} onSubmit={password.submit} />
                <PasswordField id="new-password" label={t("account.newPassword")} value={password.newPassword} error={password.fieldErrors.newPassword} visible={password.newPasswordVisible} disabled={password.submitting} autoComplete="new-password" onChangeText={password.setNewPassword} onToggleVisibility={password.toggleNewPasswordVisibility} onSubmit={password.submit} />
                <PasswordField id="confirm-password" label={t("account.confirmNewPassword")} value={password.confirmPassword} error={password.fieldErrors.confirmPassword} visible={password.confirmPasswordVisible} disabled={password.submitting} autoComplete="new-password" onChangeText={password.setConfirmPassword} onToggleVisibility={password.toggleConfirmPasswordVisibility} onSubmit={password.submit} />
                <Checkbox checked={password.revokeOtherSessions} disabled={password.submitting} id="revoke-other-sessions" onChange={password.setRevokeOtherSessions}>
                  {t("account.signOutOtherDevices")}
                </Checkbox>
                {passwordError ? <Text id="change-password-submit-error" role="alert" type="danger">{passwordError}</Text> : password.success ? <Text id="change-password-submit-success" role="status" type="success">{t("account.passwordChanged")}</Text> : null}
                <Button aria-describedby={submitFeedbackId} aria-label={submitLabel} disabled={password.submitting} htmlType="submit" type="primary">{submitLabel}</Button>
              </Flexbox>
            </Form>
          </Flexbox>
        </div>
      )}
    </section>
  );
}

function ReadOnlyAccountRow({ id, label, value, last = false }: { id: string; label: string; value: string; last?: boolean }) {
  const labelId = `${id}-label`;
  return <div style={{ alignItems: "center", borderBottom: last ? 0 : "1px solid var(--ant-color-border-secondary)", display: "flex", gap: 20, minHeight: 52, padding: "10px 0" }}><Text id={labelId} style={{ color: "var(--ant-color-text-secondary)", width: 156 }}>{label}</Text><Flexbox align="center" flex={1} gap={8} horizontal><Text aria-labelledby={labelId} strong style={{ minWidth: 0 }}>{value}</Text><AccessibleCopyButton label={label} value={value} /></Flexbox></div>;
}

function PasswordField({ id, label, value, error, visible, disabled, autoComplete, onChangeText, onToggleVisibility, onSubmit }: { id: string; label: string; value: string; error?: UiMessageValue; visible: boolean; disabled: boolean; autoComplete: string; onChangeText: (value: string) => void; onToggleVisibility: () => void; onSubmit: () => void }) {
  const { t } = useTranslation();
  const labelId = `${id}-label`;
  const errorId = `${id}-error`;
  const errorMessage = translateMessage(t, error);
  return <label htmlFor={id} style={{ display: "grid", gap: 8, width: "100%" }}><Text id={labelId} strong>{label}</Text><div style={{ position: "relative" }}><Input aria-describedby={errorMessage ? errorId : undefined} aria-invalid={Boolean(errorMessage)} aria-labelledby={labelId} autoComplete={autoComplete} disabled={disabled} id={id} onChange={(event) => onChangeText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onSubmit(); } }} style={{ paddingRight: 52 }} type={visible ? "text" : "password"} value={value} /><Button aria-label={visible ? t("auth.hideField", { field: label.toLowerCase() }) : t("auth.showField", { field: label.toLowerCase() })} disabled={disabled} icon={visible ? <EyeOff size={17} /> : <Eye size={17} />} onClick={onToggleVisibility} shape="circle" style={{ position: "absolute", right: 4, top: 1 }} type="text" /></div>{errorMessage ? <Text id={errorId} role="alert" type="danger">{errorMessage}</Text> : null}</label>;
}

function companyRoleLabel(role: AccountSettingsController["companyRole"], t: (key: string) => string): string {
  return role === "owner" ? t("account.owner") : t("account.member");
}

function AccessibleCopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2_000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <Tooltip title={label}>
      <Button
        aria-label={label}
        aria-pressed={copied}
        icon={copied ? <Check size={15} /> : <Copy size={15} />}
        onClick={() => { void copyToClipboard(value).then(() => setCopied(true)); }}
        shape="circle"
        size="small"
        type="text"
      />
    </Tooltip>
  );
}
