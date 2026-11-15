import type { ComposerReferenceTarget } from "../../shared/types/composer";
import {
  parseComposerMemberLink,
  parseComposerReferenceLink,
} from "../conversation/editor-markdown";

const MARKDOWN_LINK_PATTERN = /\[((?:\\.|[^\]])+)\]\(([^)\s]+)\)/gu;

function referenceKey(reference: ComposerReferenceTarget): string {
  switch (reference.type) {
    case "room":
    case "member":
    case "resource":
    case "memory":
    case "file":
      return `${reference.type}:${reference.id}`;
    case "message":
      return `${reference.type}:${reference.room_id}:${reference.message_id}`;
    case "thread":
      return `${reference.type}:${reference.room_id}:${reference.thread_id}:${reference.message_id ?? ""}`;
    case "context":
      return `${reference.type}:${reference.room_id}:${reference.tab}`;
    default: {
      const neverReference: never = reference;
      return neverReference;
    }
  }
}

export function roomMessageReferences(input: {
  markdown: string;
  memberIds: readonly string[];
  roomId: string;
}): ComposerReferenceTarget[] {
  const memberIds = new Set(input.memberIds);
  const keys = new Set<string>();
  const references: ComposerReferenceTarget[] = [];

  for (const match of input.markdown.matchAll(MARKDOWN_LINK_PATTERN)) {
    const label = match[1]?.replace(/\\([\\\[\]])/gu, "$1");
    const url = match[2];
    if (!label || !url) continue;
    const member = parseComposerMemberLink(label, url);
    let reference: ComposerReferenceTarget | null = null;
    if (member && memberIds.has(member.id)) {
      reference = { type: "member", id: member.id, room_id: input.roomId };
    } else {
      const option = parseComposerReferenceLink(label, url);
      reference = option?.target ?? null;
      if (reference?.type === "file") reference = { ...reference, room_id: input.roomId };
    }
    if (!reference) continue;
    const key = referenceKey(reference);
    if (keys.has(key)) continue;
    keys.add(key);
    references.push(reference);
  }

  return references;
}
