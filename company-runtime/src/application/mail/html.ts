import sanitizeHtml from "sanitize-html";
import { createHash } from "node:crypto";

export function sanitizeMailHtml(source: string): {
  html: string;
  remoteImagesBlocked: boolean;
} {
  let remoteImagesBlocked = false;
  const html = sanitizeHtml(source, {
    allowedTags: [
      "a", "abbr", "address", "article", "aside", "b", "blockquote", "br",
      "caption", "code", "col", "colgroup", "dd", "del", "details", "div", "dl",
      "dt", "em", "figcaption", "figure", "footer", "h1", "h2", "h3", "h4",
      "h5", "h6", "header", "hr", "i", "img", "ins", "kbd", "li", "main",
      "mark", "ol", "p", "pre", "q", "s", "section", "small", "span", "strong",
      "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead",
      "tr", "u", "ul",
    ],
    allowedAttributes: {
      a: ["href", "name", "target", "rel"],
      img: ["alt", "title", "width", "height", "src"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan", "scope"],
      col: ["span", "width"],
    },
    allowedSchemes: ["https", "http", "mailto", "cid", "data"],
    allowedSchemesByTag: {
      a: ["https", "http", "mailto"],
      img: ["cid", "data"],
    },
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attributes) => ({
        tagName: "a",
        attribs: {
          ...(attributes.href && /^https?:\/\/[^\s]+$/iu.test(attributes.href)
            ? {
              href: attributes.href,
              target: "_blank",
              rel: "noopener noreferrer",
            }
            : {}),
        },
      }),
      img: (_tagName, attributes) => {
        const source = attributes.src?.trim() ?? "";
        if (safeInlineImageSource(source)) {
          return { tagName: "img", attribs: attributes };
        }
        remoteImagesBlocked = true;
        return {
          tagName: "span",
          attribs: { "data-fields-remote-image-blocked": "true" },
          text: attributes.alt ?? "",
        };
      },
    },
    disallowedTagsMode: "discard",
    enforceHtmlBoundary: true,
  });
  return { html, remoteImagesBlocked };
}

function safeInlineImageSource(source: string): boolean {
  if (/^cid:[^\s<>"']{1,1024}$/iu.test(source)) return true;
  const match = /^data:image\/(?:png|jpeg|gif|webp);base64,([A-Za-z0-9+/]*={0,2})$/iu.exec(source);
  if (!match) return false;
  const payload = match[1]!;
  if (
    payload.length > 1_398_104
    || payload.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(payload)
  ) {
    return false;
  }
  return true;
}

export function mailThreadId(input: {
  messageId: string | null | undefined;
  inReplyTo: string | null | undefined;
  references: readonly string[];
  resolvedParentThreadId?: string | null;
  surrogateId: string;
}): string {
  if (input.resolvedParentThreadId) return input.resolvedParentThreadId;
  const root = normalizeMessageId(input.references[0])
    ?? normalizeMessageId(input.inReplyTo)
    ?? normalizeMessageId(input.messageId);
  return `mail_thread_${createHash("sha256")
    .update(root ?? `surrogate:${input.surrogateId}`)
    .digest("hex")
    .slice(0, 32)}`;
}

export function normalizeMessageId(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.length <= 2_048 ? normalized : null;
}
