import type {
  CompanyOnboardingStatus,
  ProductSession,
  SessionMe,
} from "@fields/contracts/public/company";
import type { ReactElement } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { authClient } from "../../data/boundary/auth-client";
import { authServiceErrorMessage } from "../../data/auth/auth-machine-services";
import { backendTrpc, rebuildBackendTransport } from "../../data/boundary/backend-trpc";
import { workspaceTelemetry } from "../observability/workspace-telemetry";
import type { AuthSessionIdentity } from "../../data/auth/auth-machine-services";
import {
  activeProductSessionFrom,
  authenticatedEntryFor,
  ONBOARDING_POLL_INTERVAL_MS,
  onboardingUsesGlobalLoading,
} from "../../data/auth/entry-state";
import { INVITATION_CREDENTIAL_HEADER } from "../../data/auth/invitation-credential";
import {
  consumeWebInvitationCredential,
  invitationIdFromWebUrl,
  subscribeToWebInvitationCredentials,
} from "../../data/auth/invitation-runtime";
import {
  consumeWebRegistrationCode,
  REGISTRATION_CREDENTIAL_HEADER,
} from "../../data/auth/registration-runtime";
import { AuthLoadingState, AuthPanel, AuthPrimaryButton, AuthScaffold, AuthSecondaryButton, AuthStateMessage, AuthTextField } from "../../features/auth/AuthSurface";
import { GlobalLoadingOverlay } from "../../features/shell";
import { message, messageFromError, translateMessage, UiMessageError, type UiMessage, type UiMessageValue } from "../../shared/i18n";
import { desktopConnectionMessageKey, desktopRuntimeInfo, isDesktopConnectionFailure } from "./desktop-runtime";

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

type SessionWithoutCompany = Extract<SessionMe, { has_company: false }>;
type SessionWithCompany = Extract<SessionMe, { has_company: true }>;

type BoundaryView =
  | { kind: "initializing" }
  | { kind: "signedOut" }
  | { kind: "noAccess"; session: SessionWithoutCompany }
  | { kind: "registrationPending"; session: SessionWithoutCompany; message: UiMessageValue }
  | { kind: "onboarding"; session: SessionWithCompany }
  | { kind: "workspace"; session: ProductSession }
  | { kind: "fatal"; message: UiMessageValue };

type PasswordFieldErrors = Partial<Record<"currentPassword" | "newPassword" | "confirmPassword", UiMessage>>;

export type ChangePasswordController = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  currentPasswordVisible: boolean;
  newPasswordVisible: boolean;
  confirmPasswordVisible: boolean;
  revokeOtherSessions: boolean;
  fieldErrors: PasswordFieldErrors;
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

export type AuthenticatedAuthController = {
  session: ProductSession;
  account: {
    displayName: string;
    email: string;
    companyRole: "owner" | "member";
    menu: {
      isOpen: boolean;
      open: () => void;
      close: () => void;
    };
    password: ChangePasswordController;
    logout: () => void;
  };
};

export function AuthBoundary({
  children,
}: {
  children: (controller: AuthenticatedAuthController) => ReactElement;
}) {
  const { t } = useTranslation();
  const desktopRuntime = desktopRuntimeInfo();
  const browserOnline = useBrowserOnline();
  const [view, setView] = useState<BoundaryView>({ kind: "initializing" });
  const [identity, setIdentity] = useState<AuthSessionIdentity | null>(null);
  const [invitationCredential, setInvitationCredential] = useState<string | null>(null);
  const [registrationCode, setRegistrationCode] = useState<string | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const requestGeneration = useRef(0);
  const password = useChangePasswordController();

  const loadEntry = useCallback(async (showLoading: boolean) => {
    const generation = ++requestGeneration.current;
    if (showLoading) setView({ kind: "initializing" });

    try {
      const authResult = await authClient.getSession();
      if (generation !== requestGeneration.current) return;
      if (authResult.error) throw new UiMessageError("auth.sessionUnavailable");
      if (!authResult.data) {
        setIdentity(null);
        setView({ kind: "signedOut" });
        return;
      }

      setIdentity({
        displayName: authResult.data.user.name,
        email: authResult.data.user.email,
      });
      let session = await backendTrpc.session.me.query();
      if (generation !== requestGeneration.current) return;

      let entry = authenticatedEntryFor(session);
      if (entry === "registrationPending" && !session.has_company) {
        const pendingSession = session;
        try {
          await backendTrpc.registration.claim.mutate();
          rebuildBackendTransport();
          session = await backendTrpc.session.me.query();
          entry = authenticatedEntryFor(session);
        } catch (error) {
          setView({
            kind: "registrationPending",
            session: pendingSession,
            message: messageFromError(error, "auth.registrationClaimFailed"),
          });
          return;
        }
      }
      if (entry === "noAccess" && !session.has_company) {
        setView({ kind: "noAccess", session });
        return;
      }
      if (entry === "onboarding" && session.has_company) {
        setView({ kind: "onboarding", session });
        return;
      }

      const productSession = activeProductSessionFrom(session);
      if (!productSession) throw new UiMessageError("auth.activeCompanyUnavailable");
      setView({ kind: "workspace", session: productSession });
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      setView({
        kind: "fatal",
        message: messageFromError(error, "auth.authenticationUnavailable"),
      });
    }
  }, []);

  useEffect(() => {
    setInvitationCredential(consumeWebInvitationCredential());
    setRegistrationCode(consumeWebRegistrationCode());
    return subscribeToWebInvitationCredentials(setInvitationCredential);
  }, []);

  useEffect(() => {
    void loadEntry(true);
    return () => {
      requestGeneration.current += 1;
    };
  }, [loadEntry]);

  useEffect(() => {
    if (view.kind !== "workspace") {
      setAccountMenuOpen(false);
    }
  }, [view.kind]);

  useEffect(() => {
    if (view.kind !== "workspace") {
      workspaceTelemetry.stop();
      return;
    }
    workspaceTelemetry.start(view.session);
    return () => workspaceTelemetry.stop();
  }, [view]);

  const logout = useCallback(async () => {
    requestGeneration.current += 1;
    setView({ kind: "initializing" });
    try {
      const result = await authClient.signOut();
      rebuildBackendTransport();
      if (result.error) throw new UiMessageError("auth.logoutFailed");
      setIdentity(null);
      setView({ kind: "signedOut" });
    } catch (error) {
      setView({
        kind: "fatal",
        message: messageFromError(error, "auth.logoutFailed"),
      });
    }
  }, []);

  if (view.kind === "initializing") return <AuthLoadingState />;

  if (view.kind === "fatal") {
    const fatalMessage = isDesktopConnectionFailure(view.message, browserOnline)
      ? t(desktopConnectionMessageKey(browserOnline), { version: desktopRuntime.version })
      : translateMessage(t, view.message);
    return (
      <AuthStateMessage
        title={t("auth.unableToLoad")}
        message={fatalMessage}
        primaryAction={{ label: t("auth.tryAgain"), onPress: () => void loadEntry(true) }}
        secondaryAction={identity ? { label: t("auth.logOut"), onPress: () => void logout() } : undefined}
      />
    );
  }

  if (view.kind === "signedOut") {
    return (
      <PublicAuthSurface
        invitationCredential={invitationCredential}
        initialRegistrationCode={registrationCode}
        onInvitationConsumed={() => setInvitationCredential(null)}
        onRegistrationConsumed={() => setRegistrationCode(null)}
        onAuthenticated={() => void loadEntry(true)}
      />
    );
  }

  if (view.kind === "noAccess") {
    return (
      <AuthStateMessage
        title={t("auth.noProductAccess")}
        message={t("auth.noProductAccessMessage")}
        primaryAction={{ label: t("auth.logOut"), onPress: () => void logout() }}
      />
    );
  }

  if (view.kind === "registrationPending") {
    return (
      <AuthStateMessage
        title={t("auth.completingRegistration")}
        message={translateMessage(t, view.message)}
        primaryAction={{ label: t("common.retry"), onPress: () => void loadEntry(true) }}
        secondaryAction={{ label: t("auth.logOut"), onPress: () => void logout() }}
      />
    );
  }

  if (view.kind === "onboarding") {
    return (
      <CompanyOnboarding
        session={view.session}
        onReady={() => void loadEntry(false)}
        onLogout={() => void logout()}
      />
    );
  }

  if (!identity) return <AuthLoadingState />;

  const controller: AuthenticatedAuthController = {
    session: view.session,
    account: {
      displayName: view.session.display_name || identity.displayName,
      email: identity.email,
      companyRole: view.session.company_role,
      menu: {
        isOpen: accountMenuOpen,
        open: () => setAccountMenuOpen(true),
        close: () => setAccountMenuOpen(false),
      },
      password,
      logout: () => void logout(),
    },
  };

  return children(controller);
}

function useBrowserOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine !== false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
    const update = () => setOnline(typeof navigator === "undefined" ? true : navigator.onLine !== false);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}

function PublicAuthSurface({
  invitationCredential,
  initialRegistrationCode,
  onInvitationConsumed,
  onRegistrationConsumed,
  onAuthenticated,
}: {
  invitationCredential: string | null;
  initialRegistrationCode: string | null;
  onInvitationConsumed: () => void;
  onRegistrationConsumed: () => void;
  onAuthenticated: () => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"login" | "signup">(invitationCredential ? "signup" : "login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [registrationCode, setRegistrationCode] = useState(initialRegistrationCode ?? "");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<"displayName" | "email" | "password" | "confirmPassword" | "registrationCode", UiMessage>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<UiMessageValue>(null);

  useEffect(() => {
    if (invitationCredential) setMode("signup");
  }, [invitationCredential]);

  useEffect(() => {
    if (!initialRegistrationCode) return;
    setRegistrationCode(initialRegistrationCode);
    setMode("signup");
  }, [initialRegistrationCode]);

  function chooseMode(nextMode: "login" | "signup") {
    setMode(nextMode);
    setErrors({});
    setSubmitError(null);
  }

  async function submit() {
    if (submitting) return;
    const nextErrors = validatePublicAuth({ mode, displayName, email, password, confirmPassword, registrationCode, invitationCredential });
    setErrors(nextErrors);
    setSubmitError(null);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      if (mode === "signup") {
        const input = { name: displayName.trim(), email: email.trim(), password };
        const signupHeaders = invitationCredential
          ? { [INVITATION_CREDENTIAL_HEADER]: invitationCredential }
          : {
            [REGISTRATION_CREDENTIAL_HEADER]: (await backendTrpc.registration.prepare.mutate({
              email: email.trim(),
              code: registrationCode.trim(),
            })).signup_credential,
          };
        const result = await authClient.signUp.email(input, { headers: signupHeaders });
        if (result.error) {
          setSubmitError(publicAuthErrorMessage(result.error, "auth.signUpFailed"));
          return;
        }
      } else {
        const result = await authClient.signIn.email({ email: email.trim(), password });
        if (result.error) {
          setSubmitError(publicAuthErrorMessage(result.error, "auth.loginFailed"));
          return;
        }
      }

      rebuildBackendTransport();
      if (invitationCredential) {
        const result = await authClient.organization.acceptInvitation({
          invitationId: invitationCredential,
        });
        if (result.error) {
          setSubmitError(publicAuthErrorMessage(result.error, "auth.acceptInvitationFailed"));
          return;
        }
        rebuildBackendTransport();
        onInvitationConsumed();
      } else if (mode === "signup") {
        await backendTrpc.registration.claim.mutate();
        rebuildBackendTransport();
        onRegistrationConsumed();
      }
      setPassword("");
      setConfirmPassword("");
      onAuthenticated();
    } catch (error) {
      setSubmitError(messageFromError(error, mode === "signup" ? "auth.signUpFailed" : "auth.loginFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthScaffold>
      <AuthPanel
        title={invitationCredential ? t("auth.joinWithInvitation") : mode === "signup" ? t("auth.signUp") : t("auth.logIn")}
        feedback={submitError ? { kind: "error", message: translateMessage(t, submitError) ?? "" } : null}
      >
        {mode === "signup" ? (
          <AuthTextField
            id="signup-name"
            name="name"
            label={t("auth.name")}
            value={displayName}
            error={errors.displayName}
            autoComplete="name"
            onChangeText={setDisplayName}
          />
        ) : null}
        {mode === "signup" && !invitationCredential ? (
          <AuthTextField
            id="signup-registration-code"
            name="registration-code"
            label={t("auth.registrationCode")}
            value={registrationCode}
            error={errors.registrationCode}
            autoComplete="off"
            onChangeText={setRegistrationCode}
          />
        ) : null}
        <AuthTextField
          id={`${mode}-email`}
          name="email"
          label={t("auth.email")}
          value={email}
          error={errors.email}
          autoComplete="email"
          keyboardType="email-address"
          onChangeText={setEmail}
        />
        <AuthTextField
          id={`${mode}-password`}
          name={mode === "signup" ? "new-password" : "password"}
          label={t("auth.password")}
          value={password}
          error={errors.password}
          secureTextEntry
          visible={passwordVisible}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          onToggleVisibility={() => setPasswordVisible((value) => !value)}
          onChangeText={setPassword}
          onSubmit={mode === "login" ? () => void submit() : undefined}
        />
        {mode === "signup" ? (
          <AuthTextField
            id="signup-confirm-password"
            name="confirm-password"
            label={t("auth.confirmPassword")}
            value={confirmPassword}
            error={errors.confirmPassword}
            secureTextEntry
            visible={confirmPasswordVisible}
            autoComplete="new-password"
            onToggleVisibility={() => setConfirmPasswordVisible((value) => !value)}
            onChangeText={setConfirmPassword}
            onSubmit={() => void submit()}
          />
        ) : null}
        <AuthPrimaryButton
          label={mode === "signup" ? t("auth.signUp") : t("auth.logIn")}
          submittingLabel={mode === "signup" ? t("auth.signUpWorking") : t("auth.logInWorking")}
          submitting={submitting}
          disabled={submitting}
          onPress={() => void submit()}
        />
        <AuthSecondaryButton
          disabled={submitting}
          onPress={() => chooseMode(mode === "signup" ? "login" : "signup")}
        >
          {mode === "signup" ? t("auth.logInExisting") : t("auth.createAccount")}
        </AuthSecondaryButton>
      </AuthPanel>
    </AuthScaffold>
  );
}

function publicAuthErrorMessage(error: unknown, fallbackKey: string): UiMessageValue {
  if (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "INVALID_EMAIL_OR_PASSWORD"
  ) {
    return message("auth.invalidEmailOrPassword");
  }
  const detail = authServiceErrorMessage(error, "");
  return detail.length > 0 ? detail : message(fallbackKey);
}


function CompanyOnboarding({
  session,
  onReady,
  onLogout,
}: {
  session: SessionWithCompany;
  onReady: () => void;
  onLogout: () => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<CompanyOnboardingStatus | null>(null);
  const [statusError, setStatusError] = useState<UiMessageValue>(null);
  const [actionError, setActionError] = useState<UiMessageValue>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const refreshStatus = useCallback(async () => {
    const nextStatus = await backendTrpc.company.onboarding.status.query();
    setStatus(nextStatus);
    setStatusError(null);
    if (nextStatus.stage === "ready") onReady();
    return nextStatus;
  }, [onReady]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        await refreshStatus();
      } catch (error) {
        if (!cancelled) {
          setStatusError(messageFromError(error, "auth.statusFailed"));
        }
      } finally {
        if (!cancelled) timer = setTimeout(() => void poll(), ONBOARDING_POLL_INTERVAL_MS);
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [refreshStatus, session.company_id]);

  async function retryOnboarding() {
    if (actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const nextStatus = await backendTrpc.company.onboarding.retry.mutate();
      setStatus(nextStatus);
      setStatusError(null);
    } catch (error) {
      setActionError(messageFromError(error, "auth.retrySetupFailed"));
    } finally {
      setActionBusy(false);
    }
  }

  if (!status) {
    if (statusError) {
      return (
        <AuthStateMessage
          title={t("auth.unableToLoadSetup")}
          message={translateMessage(t, statusError)}
          primaryAction={{ label: t("auth.tryAgain"), onPress: () => void refreshStatus() }}
          secondaryAction={{ label: t("auth.logOut"), onPress: onLogout }}
        />
      );
    }
    return <AuthLoadingState />;
  }

  if (session.company_role !== "owner") {
    return (
      <AuthStateMessage
        title={t("auth.waitingForOwner")}
        message={translateMessage(t, statusError)}
        secondaryAction={{ label: t("auth.logOut"), onPress: onLogout }}
      />
    );
  }

  if (onboardingUsesGlobalLoading(status.stage) || status.stage === "ready") {
    return (
      <div style={{ background: "var(--ant-color-bg-layout)", minHeight: 720, position: "relative", width: "100%" }}>
        <GlobalLoadingOverlay open />
      </div>
    );
  }

  const failureCode = status.runtime.error?.code ?? "COMPANY_SETUP_FAILED";
  return (
    <AuthStateMessage
      title={t("auth.companySetupFailed")}
      message={translateMessage(t, actionError ?? statusError) ?? failureCode}
      primaryAction={{ label: actionBusy ? t("auth.retrying") : t("common.retry"), onPress: () => void retryOnboarding() }}
      secondaryAction={{ label: t("auth.logOut"), onPress: onLogout }}
    />
  );
}

function useChangePasswordController(): ChangePasswordController {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currentPasswordVisible, setCurrentPasswordVisible] = useState(false);
  const [newPasswordVisible, setNewPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const [revokeOtherSessions, setRevokeOtherSessions] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<PasswordFieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<UiMessageValue>(null);

  function changeField(setter: (value: string) => void, value: string) {
    setter(value);
    setFieldErrors({});
    setSuccess(false);
    setError(null);
  }

  async function submit() {
    if (submitting) return;
    const nextErrors = validatePasswordChange(currentPassword, newPassword, confirmPassword);
    setFieldErrors(nextErrors);
    setSuccess(false);
    setError(null);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions,
      });
      if (result.error) throw new UiMessageError("auth.changePasswordFailed");
      rebuildBackendTransport();
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess(true);
    } catch (submitError) {
      setError(messageFromError(submitError, "auth.changePasswordFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return {
    currentPassword,
    newPassword,
    confirmPassword,
    currentPasswordVisible,
    newPasswordVisible,
    confirmPasswordVisible,
    revokeOtherSessions,
    fieldErrors,
    submitting,
    success,
    error,
    setCurrentPassword: (value) => changeField(setCurrentPassword, value),
    setNewPassword: (value) => changeField(setNewPassword, value),
    setConfirmPassword: (value) => changeField(setConfirmPassword, value),
    toggleCurrentPasswordVisibility: () => setCurrentPasswordVisible((value) => !value),
    toggleNewPasswordVisibility: () => setNewPasswordVisible((value) => !value),
    toggleConfirmPasswordVisibility: () => setConfirmPasswordVisible((value) => !value),
    setRevokeOtherSessions,
    submit: () => void submit(),
  };
}

function validatePublicAuth({
  mode,
  displayName,
  email,
  password,
  confirmPassword,
  registrationCode,
  invitationCredential,
}: {
  mode: "login" | "signup";
  displayName: string;
  email: string;
  password: string;
  confirmPassword: string;
  registrationCode: string;
  invitationCredential: string | null;
}) {
  const errors: Partial<Record<"displayName" | "email" | "password" | "confirmPassword" | "registrationCode", UiMessage>> = {};
  if (mode === "signup" && !displayName.trim()) errors.displayName = message("auth.nameRequired");
  if (!email.trim()) errors.email = message("auth.emailRequired");
  if (!password) errors.password = message("auth.passwordRequired");
  if (mode === "signup" && (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH)) {
    errors.password = message("auth.passwordLength", { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH });
  }
  if (mode === "signup" && password !== confirmPassword) errors.confirmPassword = message("auth.passwordsDoNotMatch");
  if (mode === "signup" && !invitationCredential && !/^[A-Za-z0-9_-]{16,128}$/u.test(registrationCode.trim())) {
    errors.registrationCode = message("auth.registrationCodeRequired");
  }
  return errors;
}

function validatePasswordChange(
  currentPassword: string,
  newPassword: string,
  confirmPassword: string,
): PasswordFieldErrors {
  const errors: PasswordFieldErrors = {};
  if (!currentPassword) errors.currentPassword = message("auth.currentPasswordRequired");
  if (newPassword.length < PASSWORD_MIN_LENGTH || newPassword.length > PASSWORD_MAX_LENGTH) {
    errors.newPassword = message("auth.passwordLength", { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH });
  }
  if (newPassword !== confirmPassword) errors.confirmPassword = message("auth.passwordsDoNotMatch");
  return errors;
}

export function invitationCredentialFromInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 512 || /\s/u.test(trimmed)) return null;
  if (/^https?:\/\//iu.test(trimmed)) return invitationIdFromWebUrl(trimmed);
  return trimmed;
}
