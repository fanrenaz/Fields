import type { ProductSession } from "@fields/contracts/public/company";
import { Button, Input } from "@lobehub/ui/base-ui";
import { LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import appMarkUrl from "../assets/brand/fields-app-mark-dark.png";
import { useLocation, useNavigate } from "react-router";

import { authClient } from "../data/boundary/auth-client";
import { rebuildBackendTransport, backendTrpc } from "../data/boundary/backend-trpc";
import { activeProductSessionFrom } from "../data/auth/entry-state";
import { workspaceTelemetry } from "../app/observability/workspace-telemetry";
import type { AuthenticatedAuthController } from "../app/session/AuthBoundary";

type MobileAuthState =
  | { kind: "loading" }
  | { kind: "signedOut" }
  | { kind: "workspace"; session: ProductSession; email: string }
  | { kind: "error"; authenticated: boolean };

export type MobileAuthenticatedController = AuthenticatedAuthController;

export function MobileAuthBoundary({
  children,
}: {
  children: (controller: AuthenticatedAuthController) => ReactElement;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState<MobileAuthState>({ kind: "loading" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loginError, setLoginError] = useState(false);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const auth = await authClient.getSession();
      if (auth.error || !auth.data) {
        setState({ kind: "signedOut" });
        if (location.pathname !== "/login") void navigate("/login", { replace: true });
        return;
      }
      const product = activeProductSessionFrom(await backendTrpc.session.me.query());
      if (!product) {
        setState({ kind: "error", authenticated: true });
        return;
      }
      setState({ kind: "workspace", session: product, email: auth.data.user.email });
      if (location.pathname === "/login") void navigate("/home", { replace: true });
    } catch {
      setState({ kind: "error", authenticated: false });
    }
  }, [location.pathname, navigate]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (state.kind !== "workspace") {
      workspaceTelemetry.stop();
      return;
    }
    workspaceTelemetry.start(state.session);
    return () => workspaceTelemetry.stop();
  }, [state]);

  const logout = useCallback(async () => {
    setState({ kind: "loading" });
    await authClient.signOut();
    rebuildBackendTransport();
    setPassword("");
    setState({ kind: "signedOut" });
    void navigate("/login", { replace: true });
  }, [navigate]);

  if (state.kind === "loading") {
    return <MobileAuthFrame><LoaderCircle aria-label={t("common.loading")} className="fields-mobile-spin" size={24} /></MobileAuthFrame>;
  }
  if (state.kind === "signedOut") {
    const submit = async () => {
      if (submitting || !email.trim() || !password) return;
      setSubmitting(true);
      setLoginError(false);
      try {
        const result = await authClient.signIn.email({ email: email.trim(), password });
        if (result.error) {
          setLoginError(true);
          return;
        }
        rebuildBackendTransport();
        await load();
      } catch {
        setLoginError(true);
      } finally {
        setSubmitting(false);
      }
    };
    return (
      <MobileAuthFrame>
        <form className="fields-mobile-auth-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <img alt="Fields" className="fields-mobile-auth-mark" src={appMarkUrl} />
          <h1>{t("auth.logIn")}</h1>
          <label><span>{t("auth.email")}</span><Input autoComplete="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label><span>{t("auth.password")}</span><Input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {loginError ? <p role="alert">{t("auth.invalidEmailOrPassword")}</p> : null}
          <Button block disabled={submitting || !email.trim() || !password} htmlType="submit" loading={submitting} size="large" type="primary">{t("auth.logIn")}</Button>
        </form>
      </MobileAuthFrame>
    );
  }
  if (state.kind === "error") {
    return (
      <MobileAuthFrame>
        <div className="fields-mobile-state">
          <h1>{t("auth.unableToLoad")}</h1>
          <Button onClick={() => void load()} type="primary">{t("common.retry")}</Button>
          {state.authenticated ? <Button onClick={() => void logout()} type="text">{t("auth.logOut")}</Button> : null}
        </div>
      </MobileAuthFrame>
    );
  }

  const controller: AuthenticatedAuthController = {
    session: state.session,
    account: {
      displayName: state.session.display_name,
      email: state.email,
      companyRole: state.session.company_role,
      menu: { isOpen: false, open: () => undefined, close: () => undefined },
      password: unavailablePasswordController(),
      logout: () => void logout(),
    },
  };
  return children(controller);
}

function MobileAuthFrame({ children }: { children: ReactElement }) {
  return <main className="fields-mobile-auth">{children}</main>;
}

function unavailablePasswordController(): AuthenticatedAuthController["account"]["password"] {
  return {
    currentPassword: "", newPassword: "", confirmPassword: "",
    currentPasswordVisible: false, newPasswordVisible: false, confirmPasswordVisible: false,
    revokeOtherSessions: true, fieldErrors: {}, submitting: false, success: false, error: null,
    setCurrentPassword: () => undefined, setNewPassword: () => undefined, setConfirmPassword: () => undefined,
    toggleCurrentPasswordVisibility: () => undefined, toggleNewPasswordVisibility: () => undefined,
    toggleConfirmPasswordVisibility: () => undefined, setRevokeOtherSessions: () => undefined,
    submit: () => undefined,
  };
}
