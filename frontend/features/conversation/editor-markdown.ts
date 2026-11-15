import type { IEditor } from "@lobehub/editor";
import type { ComposerReferenceOption, ComposerReferenceTarget } from "../../shared/types/composer";

export type ComposerMentionNode = {
  readonly label: string;
  readonly metadata: Readonly<Record<string, unknown>>;
};

export function composerMentionMarkdown(mention: ComposerMentionNode): string {
  const id = typeof mention.metadata.id === "string" ? mention.metadata.id : "";
  return id ? `[@${mention.label}](fields://member/${id})` : `@${mention.label}`;
}

export function editorMarkdown(editor: IEditor): string {
  return String(editor.getDocument("markdown") ?? "").trimEnd();
}

export function setEditorMarkdown(editor: IEditor, markdown: string): void {
  if (markdown === "") {
    editor.cleanDocument();
    return;
  }
  editor.setDocument("markdown", markdown);
}

export function composerReferenceMarkdown(reference: ComposerReferenceOption): string {
  return `[${escapeMarkdownLabel(reference.label)}](${composerReferenceUrl(reference.target)})`;
}

export function composerReferenceUrl(target: ComposerReferenceTarget): string {
  const component = (value: string) => encodeURIComponent(value);
  switch (target.type) {
    case "room":
      return `fields://room/${component(target.id)}`;
    case "member":
      return `fields://member/${component(target.id)}`;
    case "resource":
      return `fields://room/${component(target.room_id)}/resource/${component(target.id)}`;
    case "memory":
      return `fields://room/${component(target.room_id)}/memory/${component(target.id)}`;
    case "file":
      return `fields://room/${component(target.room_id)}/company-file/${component(target.id)}/version/${component(target.version_id)}`;
    case "message":
      return `fields://room/${component(target.room_id)}/message/${component(target.message_id)}`;
    case "thread":
      return `fields://room/${component(target.room_id)}/thread/${component(target.thread_id)}${target.message_id ? `/message/${component(target.message_id)}` : ""}`;
    case "context":
      return `fields://room/${component(target.room_id)}/context/${target.tab}`;
    default: {
      const neverTarget: never = target;
      return neverTarget;
    }
  }
}

export function parseComposerMemberLink(label: string, url: string): {
  id: string;
  label: string;
} | null {
  const match = /^fields:\/\/member\/([^/]+)$/u.exec(url);
  const id = match?.[1] ? decodeUriComponent(match[1]) : null;
  return id ? { id, label: label.replace(/^@/u, "") } : null;
}

export function parseComposerReferenceLink(
  label: string,
  url: string,
): ComposerReferenceOption | null {
  const segments = fieldsRoomSegments(url);
  if (!segments) return null;
  const [roomId, kind, id, qualifier, qualifiedId] = segments;
  if (!roomId) return null;
  if (!kind) return { label, target: { type: "room", id: roomId } };
  if (!id) return null;
  switch (kind) {
    case "resource":
      return { label, target: { type: "resource", id, room_id: roomId } };
    case "memory":
      return { label, target: { type: "memory", id, room_id: roomId } };
    case "company-file":
      return qualifier === "version" && qualifiedId
        ? { label, target: { type: "file", id, version_id: qualifiedId, room_id: roomId } }
        : null;
    case "message":
      return { label, target: { type: "message", room_id: roomId, message_id: id } };
    case "thread":
      return qualifier === undefined
        ? { label, target: { type: "thread", room_id: roomId, thread_id: id } }
        : qualifier === "message" && qualifiedId
          ? { label, target: { type: "thread", room_id: roomId, thread_id: id, message_id: qualifiedId } }
          : null;
    case "context":
      return id === "basis" || id === "changes" || id === "risks"
        ? { label, target: { type: "context", room_id: roomId, tab: id } }
        : null;
    default:
      return null;
  }
}

function fieldsRoomSegments(url: string): string[] | null {
  const match = /^fields:\/\/room\/([^/]+)(?:\/([^/]+)\/([^/]+)(?:\/([^/]+)\/([^/]+))?)?$/u.exec(url);
  if (!match) return null;
  const decoded: string[] = [];
  for (const value of match.slice(1)) {
    if (value === undefined) break;
    const component = decodeUriComponent(value);
    if (component === null) return null;
    decoded.push(component);
  }
  return decoded;
}

function decodeUriComponent(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

function escapeMarkdownLabel(label: string): string {
  return label.replace(/[\\\[\]]/gu, "\\$&");
}
