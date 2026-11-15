import { Flexbox, Text } from "@lobehub/ui";
import { Button, Modal } from "@lobehub/ui/base-ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export function DesktopUpdatePrompt() {
  const { t } = useTranslation();
  const [state, setState] = useState<DesktopUpdateState | null>(null);
  const bridge = window.fieldsDesktop?.updates;

  useEffect(() => {
    void window.fieldsDesktop?.runtime.markHealthy();
  }, []);

  useEffect(() => {
    if (!bridge) return undefined;
    const applyState = (next: DesktopUpdateState | null) => setState(next?.status === "ready" ? next : null);
    void bridge.getState().then(applyState);
    return bridge.onState(applyState);
  }, [bridge]);

  const ready = state?.status === "ready" ? state : null;

  return (
    <Modal closable draggable={false} footer={null} onCancel={() => setState(null)} open={ready !== null} title={t("desktopUpdate.title")} width={420}>
      {ready ? <Flexbox gap={24}>
        <Text as="p" style={{ margin: 0 }}>{t("desktopUpdate.ready", { version: `#${ready.releaseSequence}` })}</Text>
        <Flexbox horizontal gap={8} justify="flex-end" width="100%">
          <Button onClick={() => setState(null)}>{t("desktopUpdate.later")}</Button>
          <Button onClick={() => void bridge?.install()} type="primary">{t("desktopUpdate.install")}</Button>
        </Flexbox>
      </Flexbox> : null}
    </Modal>
  );
}
