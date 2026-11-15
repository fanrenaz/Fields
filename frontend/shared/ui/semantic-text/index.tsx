import { openExternalUrl } from "../../platform/external-navigation";
import {
  parseInlineSemanticMarkdown,
  type InlineSemanticMention,
  type InlineSemanticSegment,
} from "./model";

export {
  inlineSemanticPlainText,
  memberToMention,
  parseInlineSemanticMarkdown,
  serializeInlineSemanticSegments,
  sourceFromLabel,
  sourceIdFromLabel,
  sourceUrlForLabel,
  type InlineSemanticMention,
  type InlineSemanticSegment,
  type InlineSemanticSource,
} from "./model";

export const inlineSemanticTokenTextProps = {
  base: {
    borderRadius: 999,
    display: "inline-flex" as const,
    fontWeight: 700,
    lineHeight: "20px",
    margin: "0 1px",
    padding: "0 7px",
    whiteSpace: "nowrap" as const,
  },
  mention: {
    backgroundColor: "var(--ant-color-primary-bg)",
    border: "1px solid var(--ant-color-primary-border)",
    color: "var(--ant-color-primary-text)",
  },
  source: {
    backgroundColor: "var(--ant-color-bg-container)",
    border: "1px solid var(--ant-color-border)",
    color: "inherit",
  },
} as const;

function segmentKey(segment: InlineSemanticSegment, index: number) {
  if (segment.type === "text") return `text-${index}`;
  return `${segment.type}-${segment.id}-${index}`;
}

export function InlineSemanticText({
  markdown,
  mentions = [],
  onSourcePress,
  fontSize = 15,
  lineHeight = 24,
}: {
  markdown: string;
  mentions?: InlineSemanticMention[];
  onSourcePress?: (url: string) => void;
  fontSize?: number;
  lineHeight?: number;
}) {
  const segments = parseInlineSemanticMarkdown(markdown, mentions);

  return (
    <span style={{ color: "inherit", fontSize, lineHeight: `${lineHeight}px` }}>
      {segments.map((segment, index) => {
        if (segment.type === "text") return segment.text;
        if (segment.type === "mention") {
          return (
            <span
              key={segmentKey(segment, index)}
              {...inlineSemanticTokenTextProps.base}
              {...inlineSemanticTokenTextProps.mention}
            >
              @{segment.label}
            </span>
          );
        }

        return (
          <button
            key={segmentKey(segment, index)}
            {...inlineSemanticTokenTextProps.base}
            {...inlineSemanticTokenTextProps.source}
            onClick={(event) => {
              event.stopPropagation();
              if (onSourcePress) {
                onSourcePress(segment.url);
              } else if (/^https?:\/\//.test(segment.url)) {
                openExternalUrl(segment.url);
              }
            }}
          >
            {segment.label}
          </button>
        );
      })}
    </span>
  );
}
