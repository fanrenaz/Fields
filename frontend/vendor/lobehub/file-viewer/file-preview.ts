export const FILE_PREVIEW_MAX_BYTES = 512_000;

export type FilePreviewKind = "html" | "image" | "office" | "pdf" | "text" | "video";

const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp", "image/svg+xml"]);
const videoTypes = new Set(["video/mp4", "video/webm", "video/ogg"]);
const officeExtensions = new Set(["doc", "docx", "odt", "ppt", "pptx", "xls", "xlsx"]);
const textExtensions = new Set([
  "bash", "c", "cc", "cpp", "css", "csv", "go", "graphql", "h", "html", "java", "js", "json",
  "jsx", "kt", "log", "md", "mdx", "php", "py", "rb", "rs", "sh", "sql", "swift", "toml", "ts",
  "tsx", "txt", "xml", "yaml", "yml",
]);

export function fileExtension(name: string): string {
  return name.split(".").at(-1)?.toLowerCase() ?? "";
}

export function filePreviewKind(mimeType: string, name: string): FilePreviewKind | null {
  const extension = fileExtension(name);
  if (imageTypes.has(mimeType)) return "image";
  if (videoTypes.has(mimeType)) return "video";
  if (mimeType === "application/pdf" || extension === "pdf") return "pdf";
  if (officeExtensions.has(extension)) return "office";
  if (mimeType === "text/html" || extension === "html" || extension === "htm") return "html";
  if (mimeType.startsWith("text/") || textExtensions.has(extension)) return "text";
  return null;
}

export async function readBoundedPreviewText(
  url: string,
  options: { signal: AbortSignal; maxBytes?: number },
): Promise<{ bytesRead: number; text: string; truncated: boolean }> {
  const response = await fetch(url, { signal: options.signal });
  if (!response.ok) throw new Error(`Preview failed with ${response.status}`);
  if (!response.body) throw new Error("Preview response body is unavailable");

  const maxBytes = options.maxBytes ?? FILE_PREVIEW_MAX_BYTES;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytesRead = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - bytesRead;
      if (remaining <= 0) {
        truncated = true;
        await reader.cancel();
        break;
      }
      const accepted = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      chunks.push(decoder.decode(accepted, { stream: true }));
      bytesRead += accepted.byteLength;
      if (accepted.byteLength !== value.byteLength) {
        truncated = true;
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  chunks.push(decoder.decode());
  return { bytesRead, text: chunks.join(""), truncated };
}

export function htmlPreviewDocument(html: string, sourceUrl: string): string {
  return `<base href="${escapeHtmlAttribute(sourceUrl)}">${html}`;
}

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
