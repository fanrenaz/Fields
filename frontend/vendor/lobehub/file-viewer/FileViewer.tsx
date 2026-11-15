import { Center, Flexbox, Highlighter } from "@lobehub/ui";
import { Button } from "@lobehub/ui/base-ui";
import { Alert, Skeleton, Tag } from "antd";
import { Download, FileQuestion } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Document, Page, pdfjs } from "react-pdf";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

import {
  fileExtension,
  filePreviewKind,
  htmlPreviewDocument,
  readBoundedPreviewText,
  type FilePreviewKind,
} from "./file-preview";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type FileViewerProps = {
  downloadUrl: string;
  mimeType: string;
  name: string;
  onPreviewError?: (kind: FilePreviewKind) => void;
  previewUrl: string;
  sizeBytes: number;
};

export const FileViewer = memo<FileViewerProps>(({ downloadUrl, mimeType, name, onPreviewError, previewUrl, sizeBytes }) => {
  const { t } = useTranslation();
  const extension = useMemo(() => fileExtension(name), [name]);
  const kind = useMemo(() => filePreviewKind(mimeType, name), [mimeType, name]);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [textPreview, setTextPreview] = useState<{ text: string; truncated: boolean } | null>(null);
  const failureReported = useRef(false);

  useEffect(() => {
    failureReported.current = false;
    setFailed(false);
    setReady(false);
    setTextPreview(null);
  }, [kind, previewUrl]);

  const fail = useCallback(() => {
    setFailed(true);
    if (!kind || failureReported.current) return;
    failureReported.current = true;
    onPreviewError?.(kind);
  }, [kind, onPreviewError]);

  useEffect(() => {
    if (kind !== "text" && kind !== "html") return;
    const abort = new AbortController();
    void readBoundedPreviewText(previewUrl, { signal: abort.signal })
      .then((result) => setTextPreview({
        text: result.text,
        truncated: result.truncated || sizeBytes > result.bytesRead,
      }))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) fail();
      });
    return () => abort.abort();
  }, [fail, kind, previewUrl, sizeBytes]);

  if (failed) {
    return <Fallback description={t("companyFiles.previewFailed")} downloadLabel={t("companyFiles.download")} downloadUrl={downloadUrl} name={name} />;
  }

  if (kind === "image") {
    return (
      <MediaFrame ready={ready}>
        <img alt={name} onError={fail} onLoad={() => setReady(true)} src={previewUrl} style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain" }} />
      </MediaFrame>
    );
  }
  if (kind === "video") {
    return (
      <MediaFrame ready={ready}>
        <video controls onError={fail} onLoadedMetadata={() => setReady(true)} src={previewUrl} style={{ maxHeight: "100%", maxWidth: "100%" }} />
      </MediaFrame>
    );
  }
  if (kind === "pdf") {
    return <PDFViewer name={name} onError={fail} url={previewUrl} />;
  }
  if (kind === "office") {
    const officeUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(previewUrl)}`;
    return (
      <MediaFrame ready={ready}>
        <iframe allowFullScreen onError={fail} onLoad={() => setReady(true)} src={officeUrl} style={{ border: 0, height: "100%", width: "100%" }} title={name} />
      </MediaFrame>
    );
  }
  if (kind === "html") {
    if (textPreview === null) return <Flexbox padding={24}><Skeleton active /></Flexbox>;
    if (textPreview.truncated) {
      return <Fallback description={t("companyFiles.previewTruncated")} downloadLabel={t("companyFiles.download")} downloadUrl={downloadUrl} name={name} />;
    }
    return (
      <MediaFrame ready={ready}>
        <iframe onError={fail} onLoad={() => setReady(true)} sandbox="" srcDoc={htmlPreviewDocument(textPreview.text, previewUrl)} style={{ border: 0, height: "100%", width: "100%" }} title={name} />
      </MediaFrame>
    );
  }
  if (kind === "text") {
    if (textPreview === null) return <Flexbox padding={24}><Skeleton active /></Flexbox>;
    return (
      <div style={{ height: "100%", overflow: "auto", padding: 20 }}>
        {textPreview.truncated ? <Tag color="warning" style={{ marginBottom: 12 }}>{t("companyFiles.previewTruncated")}</Tag> : null}
        <Highlighter language={extension || "text"}>{textPreview.text}</Highlighter>
      </div>
    );
  }
  return <Fallback description={t("companyFiles.previewUnsupported")} downloadLabel={t("companyFiles.download")} downloadUrl={downloadUrl} name={name} />;
});

FileViewer.displayName = "FileViewer";

function MediaFrame({ children, ready }: { children: ReactNode; ready: boolean }) {
  return (
    <Center height="100%" style={{ position: "relative" }}>
      {!ready ? <Flexbox padding={24} style={{ inset: 0, position: "absolute", width: "100%" }}><Skeleton active /></Flexbox> : null}
      <div style={{ alignItems: "center", display: "flex", height: "100%", justifyContent: "center", opacity: ready ? 1 : 0, width: "100%" }}>
        {children}
      </div>
    </Center>
  );
}

function Fallback({ description, downloadLabel, downloadUrl, name }: { description: string; downloadLabel: string; downloadUrl: string; name: string }) {
  return (
    <Center height="100%">
      <Flexbox align="center" gap={16} style={{ maxWidth: 420 }}>
        <FileQuestion size={42} />
        <Alert description={description} message={name} showIcon />
        <Button icon={<Download size={16} />} onClick={() => window.location.assign(downloadUrl)} type="primary">
          {downloadLabel}
        </Button>
      </Flexbox>
    </Center>
  );
}

function PDFViewer({ name, onError, url }: { name: string; onError: () => void; url: string }) {
  const [pages, setPages] = useState(0);
  return (
    <div aria-label={name} style={{ height: "100%", overflow: "auto", padding: "20px 0" }}>
      <Document
        file={url}
        loading={<Flexbox padding={24}><Skeleton active /></Flexbox>}
        onLoadError={onError}
        onLoadSuccess={({ numPages }) => setPages(numPages)}
        onSourceError={onError}
      >
        <Flexbox align="center" gap={16}>
          {Array.from({ length: pages }, (_, index) => (
            <Page key={index} onRenderError={onError} pageNumber={index + 1} renderAnnotationLayer renderTextLayer width={Math.min(900, window.innerWidth - 96)} />
          ))}
        </Flexbox>
      </Document>
    </div>
  );
}
