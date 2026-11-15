import type { CompanyRegistrationSettings as RegistrationSettings } from "@fields/contracts/public/company";
import { copyToClipboard, Flexbox, Text } from "@lobehub/ui";
import { Button, Checkbox, Input } from "@lobehub/ui/base-ui";
import { Copy, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { registrationLinkForWeb } from "../../data/auth/registration-runtime";
import { backendTrpc } from "../../data/boundary/backend-trpc";

export function CompanyRegistrationSettings() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<RegistrationSettings | null>(null);
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      setSettings(await backendTrpc.company.registration.get.query());
      setError(false);
    } catch {
      setError(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function rotate() {
    if (submitting) return;
    setSubmitting(true);
    try {
      setSettings(await backendTrpc.company.registration.rotate.mutate());
      setError(false);
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  }

  async function setEnabled(enabled: boolean) {
    if (submitting) return;
    setSubmitting(true);
    try {
      setSettings(await backendTrpc.company.registration.setEnabled.mutate({ enabled }));
      setError(false);
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  }

  const link = settings ? registrationLinkForWeb(settings.code) : "";
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      <Flexbox gap={24} style={{ margin: "0 auto", maxWidth: 760, padding: "48px 48px 64px", width: "100%" }}>
        <section aria-labelledby="company-registration-heading">
          <h2 id="company-registration-heading">{t("account.companyRegistration")}</h2>
          <Flexbox gap={16} style={{ maxWidth: 620 }}>
            <Checkbox checked={settings?.enabled ?? false} disabled={!settings || submitting} onChange={(checked) => void setEnabled(checked)}>
              {t("account.registrationEnabled")}
            </Checkbox>
            <ReadOnlyCredential label={t("account.registrationCode")} value={settings?.code ?? ""} />
            <ReadOnlyCredential label={t("account.registrationLink")} value={link} />
            <Button disabled={!settings || submitting} icon={<RefreshCw size={16} />} onClick={() => void rotate()}>
              {t("account.rotateRegistrationCode")}
            </Button>
            {error ? <Text role="alert" type="danger">{t("account.registrationSettingsFailed")}</Text> : null}
          </Flexbox>
        </section>
      </Flexbox>
    </div>
  );
}

function ReadOnlyCredential({ label, value }: { label: string; value: string }) {
  return (
    <label style={{ display: "grid", gap: 8 }}>
      <Text strong>{label}</Text>
      <Flexbox align="center" gap={8} horizontal>
        <Input readOnly value={value} />
        <Button aria-label={label} disabled={!value} icon={<Copy size={16} />} onClick={() => void copyToClipboard(value)} shape="circle" />
      </Flexbox>
    </label>
  );
}
