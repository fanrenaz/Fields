import { useCallback, useEffect, useRef, useState } from "react";

import { message, type UiMessageValue } from "../shared/i18n/message";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_COUNT = 4;
const MAX_IMAGE_TOTAL_BYTES = 100 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type MobileImageDraft<THandle> = {
  clientId: string;
  file: File;
  previewUrl: string;
  status: "queued" | "uploading" | "ready" | "failed";
  handle?: THandle;
  error?: UiMessageValue;
};

export type MobileImageUploadAdapter<THandle> = {
  upload: (file: File, signal: AbortSignal) => Promise<THandle>;
};

export function useMobileImageDrafts<THandle>(adapter?: MobileImageUploadAdapter<THandle>) {
  const [drafts, setDrafts] = useState<MobileImageDraft<THandle>[]>([]);
  const draftsRef = useRef(drafts);
  const aborters = useRef(new Map<string, AbortController>());
  draftsRef.current = drafts;

  const upload = useCallback((clientId: string, file: File) => {
    const aborter = new AbortController();
    aborters.current.set(clientId, aborter);
    setDrafts((current) => updateDraft(current, clientId, { status: "uploading", error: undefined }));
    void (adapter?.upload(file, aborter.signal) ?? Promise.reject(new Error("mobile_image_upload_unavailable")))
      .then((handle) => setDrafts((current) => updateDraft(current, clientId, { status: "ready", handle, error: undefined })))
      .catch(() => {
        if (!aborter.signal.aborted) setDrafts((current) => updateDraft(current, clientId, { status: "failed", error: message("mobile.imageUploadFailed") }));
      })
      .finally(() => aborters.current.delete(clientId));
  }, [adapter]);

  const add = useCallback((files: File[]) => {
    const selected = draftsRef.current.filter((draft) => validateMobileImage(draft.file) === null);
    for (const file of files) {
      const error = validateMobileImageSelection(selected, file);
      const clientId = crypto.randomUUID();
      const draft: MobileImageDraft<THandle> = {
        clientId,
        file,
        previewUrl: URL.createObjectURL(file),
        status: error ? "failed" : "queued",
        error,
      };
      setDrafts((current) => [...current, draft]);
      if (!error) {
        selected.push(draft);
        upload(clientId, file);
      }
    }
  }, [upload]);

  const remove = useCallback((clientId: string) => {
    aborters.current.get(clientId)?.abort();
    aborters.current.delete(clientId);
    setDrafts((current) => {
      const removed = current.find((draft) => draft.clientId === clientId);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((draft) => draft.clientId !== clientId);
    });
  }, []);

  const retry = useCallback((clientId: string) => {
    const draft = draftsRef.current.find((candidate) => candidate.clientId === clientId);
    if (!draft) return;
    const existing = draftsRef.current.filter((candidate) => candidate.clientId !== clientId && validateMobileImage(candidate.file) === null);
    const error = validateMobileImageSelection(existing, draft.file);
    if (error) {
      setDrafts((current) => updateDraft(current, clientId, { status: "failed", error }));
      return;
    }
    upload(clientId, draft.file);
  }, [upload]);

  const clear = useCallback(() => {
    aborters.current.forEach((aborter) => aborter.abort());
    aborters.current.clear();
    setDrafts((current) => {
      current.forEach((draft) => URL.revokeObjectURL(draft.previewUrl));
      return [];
    });
  }, []);

  useEffect(() => () => {
    aborters.current.forEach((aborter) => aborter.abort());
    draftsRef.current.forEach((draft) => URL.revokeObjectURL(draft.previewUrl));
  }, []);

  return {
    drafts,
    handles: drafts.flatMap((draft) => draft.status === "ready" && draft.handle !== undefined ? [draft.handle] : []),
    blocked: drafts.some((draft) => draft.status !== "ready"),
    add,
    remove,
    retry,
    clear,
  };
}

export function validateMobileImage(file: Pick<File, "size" | "type">): UiMessageValue {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) return message("mobile.imageTypeUnsupported");
  if (file.size > MAX_IMAGE_BYTES) return message("mobile.imageTooLarge");
  return null;
}

export function validateMobileImageSelection(existing: Array<Pick<File, "size"> | MobileImageDraft<unknown>>, file: Pick<File, "size" | "type">): UiMessageValue {
  const intrinsic = validateMobileImage(file);
  if (intrinsic) return intrinsic;
  if (existing.length >= MAX_IMAGE_COUNT) return message("mobile.imageCountExceeded");
  const total = existing.reduce((sum, item) => sum + ("file" in item ? item.file.size : item.size), 0) + file.size;
  if (total > MAX_IMAGE_TOTAL_BYTES) return message("mobile.imageTotalExceeded");
  return null;
}

function updateDraft<THandle>(drafts: MobileImageDraft<THandle>[], clientId: string, patch: Partial<MobileImageDraft<THandle>>) {
  return drafts.map((draft) => draft.clientId === clientId ? { ...draft, ...patch } : draft);
}
