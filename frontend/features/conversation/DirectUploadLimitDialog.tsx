import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert } from "@lobehub/ui";
import { Modal } from "@lobehub/ui/base-ui";
import { DIRECT_UPLOAD_MAX_FILE_LABEL } from "../../shared/types/upload";

export function DirectUploadLimitDialog({ open, message, onOpenChange }: { open: boolean; message: string; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  return <Modal centered footer={null} onCancel={() => onOpenChange(false)} open={open} title={t("composer.uploadLimitTitle")}><Alert icon={<AlertTriangle size={18} />} message={message || t("composer.uploadLimit", { size: DIRECT_UPLOAD_MAX_FILE_LABEL })} showIcon type="warning" /></Modal>;
}
