import { Button } from "@lobehub/ui/base-ui";
import { ImagePlus, RefreshCw, X } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { translateMessage } from "../shared/i18n";
import type { MobileImageDraft } from "./use-mobile-image-drafts";

export function MobileImagePicker({ onFiles }: { onFiles: (files: File[]) => void }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <input accept="image/jpeg,image/png,image/webp" capture="environment" hidden multiple onChange={(event) => { onFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} ref={input} type="file" />
      <Button aria-label={t("mobile.addImage")} icon={<ImagePlus size={16} />} onClick={() => input.current?.click()} size="small" type="text" />
    </>
  );
}

export function MobileImageTray<THandle>({ drafts, onRemove, onRetry }: { drafts: MobileImageDraft<THandle>[]; onRemove: (id: string) => void; onRetry: (id: string) => void }) {
  const { t } = useTranslation();
  if (drafts.length === 0) return null;
  return (
    <div aria-live="polite" className="fields-mobile-image-tray">
      {drafts.map((draft) => (
        <div className={`fields-mobile-image is-${draft.status}`} key={draft.clientId}>
          <img alt={draft.file.name} src={draft.previewUrl} />
          {draft.status === "uploading" || draft.status === "queued" ? <span className="fields-mobile-image-progress" /> : null}
          {draft.status === "failed" ? <button aria-label={t("mobile.retryImage")} onClick={() => onRetry(draft.clientId)} type="button"><RefreshCw size={16} /></button> : null}
          <Button aria-label={t("mobile.removeImage")} className="fields-mobile-image-remove" icon={<X size={13} />} onClick={() => onRemove(draft.clientId)} shape="circle" size="small" type="text" />
          {draft.error ? <small>{translateMessage(t, draft.error)}</small> : null}
        </div>
      ))}
    </div>
  );
}
