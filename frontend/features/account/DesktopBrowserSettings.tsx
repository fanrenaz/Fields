import { Alert, Block, Flexbox, Text } from "@lobehub/ui";
import { Button } from "@lobehub/ui/base-ui";
import { Globe2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { authServiceErrorMessage } from "../../data/auth/auth-machine-services";
import { backendTrpc } from "../../data/boundary/backend-trpc";

export function DesktopBrowserSettings() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    void backendTrpc.account.desktopBrowser.status.query()
      .then((status) => setEnabled(status.enabled))
      .catch(setError);
  }, []);

  async function update(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const status = await backendTrpc.account.desktopBrowser.set.mutate({ enabled: next });
      setEnabled(status.enabled);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Block gap={16} padding={16} variant="outlined">
      <Flexbox align="center" gap={10} horizontal>
        <Globe2 size={20} />
        <div><Text strong>{t("desktopBrowser.settingsTitle")}</Text><Text type="secondary">{t("desktopBrowser.settingsDescription")}</Text></div>
      </Flexbox>
      {error ? <Alert message={authServiceErrorMessage(error, t("desktopBrowser.settingsFailed"))} showIcon type="error" /> : null}
      <Flexbox align="center" horizontal justify="space-between">
        <Text type="secondary">{enabled ? t("desktopBrowser.enabled") : t("desktopBrowser.disabled")}</Text>
        <Button disabled={busy || enabled === null} onClick={() => void update(!enabled)} type={enabled ? "default" : "primary"}>
          {enabled ? t("desktopBrowser.disable") : t("desktopBrowser.enable")}
        </Button>
      </Flexbox>
    </Block>
  );
}
