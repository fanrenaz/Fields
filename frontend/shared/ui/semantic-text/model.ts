import type { ProfileMember } from "../../types/member";

const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const SAFE_SOURCE_URL_PATTERN = /^(?:fields:\/\/|file:\/\/|https?:\/\/|\/|\.{1,2}\/|[^:]+$)/;

export type InlineSemanticMention = {
  id: string;
  label: string;
  kind: "human" | "agent";
  mark: string;
  status?: string;
};

export type InlineSemanticSource = {
  id: string;
  label: string;
  url: string;
};

export type InlineSemanticSegment =
  | { type: "text"; text: string }
  | ({ type: "mention" } & InlineSemanticMention)
  | ({ type: "source" } & InlineSemanticSource);

export function sourceIdFromLabel(label: string) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function sourceUrlForLabel(label: string) {
  return `fields://resource/${sourceIdFromLabel(label)}`;
}

export function sourceFromLabel(label: string, url = sourceUrlForLabel(label)): InlineSemanticSource {
  const fallbackId = sourceIdFromLabel(label);
  const urlId = url
    .split("/")
    .filter(Boolean)
    .pop()
    ?.replace(/[^a-zA-Z0-9_-]/g, "");

  return {
    id: urlId || fallbackId,
    label,
    url,
  };
}

export function memberToMention(member: ProfileMember): InlineSemanticMention {
  return {
    id: member.member_id,
    label: member.name,
    kind: member.actor_type === "agent" ? "agent" : "human",
    mark: member.mark,
    status: member.status,
  };
}

export function parseInlineSemanticMarkdown(
  markdown: string,
  mentions: InlineSemanticMention[] = [],
): InlineSemanticSegment[] {
  if (!markdown) return [];

  const segments: InlineSemanticSegment[] = [];
  let cursor = 0;
  MARKDOWN_LINK_PATTERN.lastIndex = 0;

  for (const match of markdown.matchAll(MARKDOWN_LINK_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      segments.push({ type: "text", text: markdown.slice(cursor, index) });
    }
    const url = match[2];
    const mention = url.startsWith("fields://member/") ? mentionFromUrl(match[1], url, mentions) : null;
    if (mention) {
      segments.push({ type: "mention", ...mention });
    } else if (url.startsWith("fields://member/")) {
      segments.push({ type: "text", text: match[1] });
    } else if (!isSupportedSourceUrl(url)) {
      segments.push({ type: "text", text: match[0] });
    } else {
      segments.push({ type: "source", ...sourceFromLabel(match[1], url) });
    }
    cursor = index + match[0].length;
  }

  if (cursor < markdown.length) {
    segments.push({ type: "text", text: markdown.slice(cursor) });
  }

  return segments;
}

export function serializeInlineSemanticSegments(segments: InlineSemanticSegment[]) {
  return segments
    .map((segment) => {
      if (segment.type === "text") return segment.text;
      if (segment.type === "mention") return `[@${segment.label}](fields://member/${segment.id})`;
      return `[${segment.label}](${segment.url})`;
    })
    .join("");
}

export function inlineSemanticPlainText(markdown: string, mentions: InlineSemanticMention[] = []) {
  return parseInlineSemanticMarkdown(markdown, mentions)
    .map((segment) => {
      if (segment.type === "text") return segment.text;
      if (segment.type === "mention") return `@${segment.label}`;
      return segment.label;
    })
    .join("");
}

export function isSupportedSourceUrl(url: string) {
  return SAFE_SOURCE_URL_PATTERN.test(url);
}

function mentionFromUrl(label: string, url: string, mentions: InlineSemanticMention[]) {
  const id = url
    .split("/")
    .filter(Boolean)
    .pop();
  const mention = mentions.find((item) => item.id === id);
  if (!mention) return null;

  return {
    ...mention,
    label: label.replace(/^@/, ""),
  };
}
