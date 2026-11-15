import type { MessageImageAttachment } from "@fields/contracts/public/home";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { basename, extname, relative, sep } from "node:path";

import type { MemberWorkspaceLayout } from "../../infrastructure/filesystem/workspace.js";
import {
  assertVisibleHomeFilesystemPath,
  resolveHomeFilesystemPath,
  workspaceRelativePath,
} from "../filesystem/paths.js";

export class MessageImageError extends Error {
  readonly code: string;
  readonly retryable = false;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MessageImageError";
    this.code = code;
  }
}

const signatures = {
  "image/jpeg": (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  "image/png": (bytes: Uint8Array) => Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  "image/webp": (bytes: Uint8Array) => Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF"
    && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP",
} satisfies Record<MessageImageAttachment["mime_type"], (bytes: Uint8Array) => boolean>;

export function isMessageImageMimeType(value: string): value is MessageImageAttachment["mime_type"] {
  return Object.hasOwn(signatures, value);
}

export async function resolveHomeImageAttachments(
  layout: MemberWorkspaceLayout,
  attachments: readonly MessageImageAttachment[],
): Promise<string[]> {
  const paths: string[] = [];
  for (const attachment of attachments) {
    if (attachment.storage !== "member_workspace") {
      throw new MessageImageError("message_image_storage_invalid", "Image attachment storage is invalid.");
    }
    assertVisibleHomeFilesystemPath(attachment.path);
    if (
      basename(attachment.path) !== attachment.name
      || imageMimeTypeFromPath(attachment.path) !== attachment.mime_type
    ) {
      throw new MessageImageError("message_image_metadata_invalid", "Image attachment name or extension is invalid.");
    }
    const resolved = resolveHomeFilesystemPath(layout.workspace, attachment.path);
    await assertImageFile(resolved.absolutePath, attachment.mime_type, attachment.size_bytes);
    paths.push(resolved.absolutePath);
  }
  return paths;
}

export async function assertImageFile(
  absolutePath: string,
  mimeType: MessageImageAttachment["mime_type"],
  expectedBytes: number,
): Promise<void> {
  const metadata = await lstat(absolutePath).catch(() => null);
  if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size !== expectedBytes) {
    throw new MessageImageError("message_image_invalid", "Image attachment metadata does not match a regular file.");
  }
  const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => null);
  if (!handle) throw new MessageImageError("message_image_invalid", "Image attachment is unavailable.");
  try {
    const bytes = Buffer.alloc(12);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (!signatures[mimeType](bytes.subarray(0, bytesRead))) {
      throw new MessageImageError("message_image_type_invalid", "Image attachment bytes do not match its MIME type.");
    }
  } finally {
    await handle.close();
  }
}

export function homeImageRenderUri(workspace: string, absolutePath: string): string | null {
  const workspaceRelative = relative(workspace, absolutePath);
  if (
    workspaceRelative.length === 0
    || workspaceRelative.startsWith(`..${sep}`)
    || workspaceRelative === ".."
  ) return null;
  const path = workspaceRelativePath(workspace, absolutePath);
  try {
    assertVisibleHomeFilesystemPath(path);
  } catch {
    return null;
  }
  return `/api/v1/files/home/download?path=${encodeURIComponent(path)}&disposition=inline`;
}

export function imageMimeTypeFromPath(path: string): MessageImageAttachment["mime_type"] | null {
  switch (extname(path).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    default:
      return null;
  }
}
