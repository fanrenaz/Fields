import { Avatar, Flexbox } from "@lobehub/ui";
import { ChatHeader, ChatHeaderTitle } from "@lobehub/ui/mobile";
import { Button } from "@lobehub/ui/base-ui";
import { Bell, Cpu, Download, LogOut, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { ExecutorAccessController } from "../features/executor-onboarding";
import { LanguageSelector } from "../shared/i18n/LanguageSelector";
import type { MobileAuthenticatedController } from "./MobileAuthBoundary";
import type { useMobileCapabilities } from "./use-mobile-capabilities";

export function MobileMe({ auth, executorAccess, capabilities }: { auth: MobileAuthenticatedController; executorAccess: ExecutorAccessController; capabilities: ReturnType<typeof useMobileCapabilities> }) {
  const { t } = useTranslation();
  return (
    <section className="fields-mobile-screen fields-mobile-me">
      <ChatHeader center={<ChatHeaderTitle title={t("mobile.me")} />} />
      <div className="fields-mobile-profile">
        <Avatar avatar={auth.account.displayName} size={64} />
        <h1>{auth.account.displayName}</h1>
        <p>{auth.account.email}</p>
      </div>
      <div className="fields-mobile-settings-list">
        <div><ShieldCheck aria-hidden size={18} /><span><strong>{t("mobile.companyRole")}</strong><small>{auth.account.companyRole === "owner" ? t("account.owner") : t("account.member")}</small></span></div>
        <div><Cpu aria-hidden size={18} /><span><strong>{t("mobile.executor")}</strong><small>{executorAccess.assignment?.executor?.name ?? t("executor.unavailable")}</small></span></div>
        <div className="fields-mobile-executor-options">{executorAccess.options.map((executor) => <Button disabled={executor.availability !== "available" || executorAccess.assignment?.executor?.executor_id === executor.executor_id} key={executor.executor_id} onClick={() => void executorAccess.bind(executor.executor_id)} size="small" type="text">{executor.name}</Button>)}</div>
        <div><Bell aria-hidden size={18} /><span><strong>{t("mobile.notifications")}</strong><small>{capabilities.notificationError ? t("mobile.notificationError") : t(`mobile.notificationPermission.${capabilities.permission}`)}</small></span>{capabilities.permission !== "granted" ? <Button loading={capabilities.notificationBusy} onClick={() => void capabilities.enableNotifications()} size="small" type="text">{t("mobile.enable")}</Button> : capabilities.notificationError ? <Button loading={capabilities.notificationBusy} onClick={() => void capabilities.reconcileNotifications()} size="small" type="text">{t("common.retry")}</Button> : null}</div>
        {capabilities.canInstall ? <div><Download aria-hidden size={18} /><span><strong>{t("mobile.install")}</strong></span><Button onClick={() => void capabilities.install()} size="small" type="text">{t("mobile.install")}</Button></div> : null}
        {capabilities.iosInstallGuide ? <div><Download aria-hidden size={18} /><span><strong>{t("mobile.install")}</strong><small>{t("mobile.iosInstallGuide")}</small></span></div> : null}
        <Flexbox className="fields-mobile-language"><LanguageSelector compact /></Flexbox>
      </div>
      <Button block danger icon={<LogOut size={17} />} onClick={auth.account.logout} size="large" type="text">{t("auth.logOut")}</Button>
    </section>
  );
}
