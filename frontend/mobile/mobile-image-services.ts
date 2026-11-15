import { homeFilesystemEntrySchema, type MessageImageAttachment } from "@fields/contracts/public/home";
import type { RoomMessageImageAttachment } from "@fields/contracts/public/room";

import { backendTrpc } from "../data/boundary/backend-trpc";
import { normalizedImageFileName } from "./mobile-pure-adapters";

export async function uploadHomeMessageImage(file: File, signal: AbortSignal): Promise<MessageImageAttachment> {
  const name = `mobile-${crypto.randomUUID()}-${normalizedImageFileName(file.name, file.type)}`;
  const query = new URLSearchParams({ parent_path: ".", name });
  const response = await fetch(`/api/v1/files/home/upload?${query}`, {
    body: file,
    credentials: "include",
    headers: { "content-type": "application/octet-stream" },
    method: "POST",
    signal,
  });
  if (!response.ok) throw new Error("home_image_upload_failed");
  const entry = homeFilesystemEntrySchema.parse(await response.json());
  return {
    attachment_id: crypto.randomUUID(),
    kind: "image",
    storage: "member_workspace",
    path: entry.path,
    name: entry.name,
    mime_type: supportedMimeType(file.type),
    size_bytes: file.size,
  };
}

export async function uploadRoomMessageImage(file: File, signal: AbortSignal): Promise<RoomMessageImageAttachment> {
  const bytes = await file.arrayBuffer();
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
  const idempotencyKey = crypto.randomUUID();
  const begin = await backendTrpc.company.files.upload.begin.mutate({
    folder_id: null,
    name: normalizedImageFileName(file.name, file.type),
    mime_type: file.type,
    size_bytes: file.size,
    sha256,
    idempotency_key: idempotencyKey,
  }, { signal });
  if (begin.upload_required) {
    if (!begin.upload_url) throw new Error("room_image_upload_url_missing");
    const response = await fetch(begin.upload_url, { body: file, headers: begin.upload_headers, method: "PUT", signal });
    if (!response.ok) throw new Error("room_image_upload_failed");
  }
  const stored = await backendTrpc.company.files.upload.finalize.mutate({
    upload_id: begin.upload_id,
    idempotency_key: idempotencyKey,
  }, { signal });
  return {
    attachment_id: crypto.randomUUID(),
    kind: "image",
    storage: "company_file_version",
    file_id: stored.file_id,
    version_id: stored.current_version.version_id,
    name: stored.name,
    mime_type: supportedMimeType(file.type),
    size_bytes: file.size,
  };
}

function supportedMimeType(value: string): "image/jpeg" | "image/png" | "image/webp" {
  if (value === "image/jpeg" || value === "image/png" || value === "image/webp") return value;
  throw new Error("image_mime_type_unsupported");
}

function hex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
