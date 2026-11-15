import { Home, MessageCircleMore, UserRound } from "lucide-react";
import { NavLink } from "react-router";
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";

export function MobileTabBar() {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("mobile.navigation")} className="fields-mobile-tabs">
      <Tab icon={<Home aria-hidden size={20} />} label={t("shell.home")} to="/home" />
      <Tab icon={<MessageCircleMore aria-hidden size={20} />} label={t("shell.rooms")} to="/rooms" />
      <Tab icon={<UserRound aria-hidden size={20} />} label={t("mobile.me")} to="/me" />
    </nav>
  );
}

function Tab({ to, label, icon }: { to: string; label: string; icon: ReactNode }) {
  return <NavLink className={({ isActive }) => isActive ? "is-active" : ""} to={to}>{icon}<span>{label}</span></NavLink>;
}
