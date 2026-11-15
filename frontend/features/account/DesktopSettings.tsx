import { Flexbox, Text } from "@lobehub/ui";
import { Checkbox } from "@lobehub/ui/base-ui";
import { Bell, Power } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export function DesktopSettings() {
  const { t } = useTranslation();
  const bridge = window.fieldsDesktop?.settings;
  const [settings, setSettings] = useState<DesktopSettings | null>(null);

  useEffect(() => {
    if (!bridge) return undefined;
    void bridge.get().then(setSettings);
    return bridge.onChanged(setSettings);
  }, [bridge]);
  if (!bridge || !settings) return null;

  const update = (input: Partial<DesktopSettings>) => void bridge.update(input).then(setSettings);
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      <Flexbox gap={24} style={{ margin: "0 auto", maxWidth: 760, padding: "48px 48px 64px", width: "100%" }}>
        <section><h2>{t("desktopSettings.title")}</h2><DesktopSettingRow icon={<Power size={18} />} label={t("desktopSettings.launchAtLogin")} checked={settings.launchAtLogin} onChange={(checked) => update({ launchAtLogin: checked })} /></section>
        <section><h2>{t("desktopSettings.notifications")}</h2><DesktopSettingRow icon={<Bell size={18} />} label={t("desktopSettings.enableNotifications")} checked={settings.notificationsEnabled} onChange={(checked) => update({ notificationsEnabled: checked })} /></section>
      </Flexbox>
    </div>
  );
}

function DesktopSettingRow({ icon, label, checked, onChange }: { icon: ReactNode; label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <Flexbox align="center" horizontal justify="space-between" style={{ borderTop: "1px solid var(--ant-color-border-secondary)", minHeight: 58 }}><Flexbox align="center" gap={10} horizontal>{icon}<Text>{label}</Text></Flexbox><Checkbox checked={checked} onChange={onChange} /></Flexbox>;
}
