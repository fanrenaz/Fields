import type { ComponentProps, ReactNode } from "react";
import { lazy, Suspense } from "react";

import { isSupportedSourceUrl } from "../../shared/ui/semantic-text/model";
import type { InlineSemanticMention } from "../../shared/ui/semantic-text";

const LobeMarkdown = lazy(async () => ({ default: (await import("@lobehub/ui")).Markdown }));
const htmlPreviewSandbox = "allow-scripts allow-forms allow-modals";

type FieldsMarkdownProps = {
  allowHtml: true;
  componentProps: { html: { sandbox: string } };
  components: Record<string, ({ href, children, ...props }: ComponentProps<"a">) => ReactNode>;
  enableCustomFootnotes: true;
  enableGithubAlert: true;
  enableHtmlPreview: true;
  enableLatex: true;
  enableMermaid: true;
  fullFeaturedCodeBlock: true;
  variant: "chat";
};

export function fieldsMarkdownProps(
  mentions: InlineSemanticMention[],
  onLinkPress: (url: string) => void,
): FieldsMarkdownProps {
  return {
    allowHtml: true,
    componentProps: { html: { sandbox: htmlPreviewSandbox } },
    components: {
      a: ({ href, children, ...props }: ComponentProps<"a">) => {
        if (!href || !isSupportedSourceUrl(href)) return <>{children}</>;
        if (href.startsWith("fields://member/")) {
          const memberId = href.split("/").filter(Boolean).pop();
          if (!memberId || !mentions.some((mention) => mention.id === memberId)) return <>{children}</>;
          return <span {...props} className="message-markdown__mention" style={{ background: "var(--ant-color-primary-bg)", border: "1px solid var(--ant-color-primary-border)", borderRadius: 999, color: "var(--ant-color-primary-text)", display: "inline-flex", fontWeight: 700, padding: "0 7px" }}>{children}</span>;
        }
        return <a {...props} className="message-markdown__source" href={href} onClick={(event) => { event.preventDefault(); onLinkPress(href); }}>{children}</a>;
      },
    },
    enableCustomFootnotes: true,
    enableGithubAlert: true,
    enableHtmlPreview: true,
    enableLatex: true,
    enableMermaid: true,
    fullFeaturedCodeBlock: true,
    variant: "chat",
  };
}

export function MarkdownMessageBody({
  markdown,
  mentions,
  onLinkPress,
}: {
  markdown: string;
  mentions: InlineSemanticMention[];
  onLinkPress: (url: string) => void;
}) {
  return (
    <Suspense fallback={<span style={{ whiteSpace: "pre-wrap" }}>{markdown}</span>}>
      <LobeMarkdown {...fieldsMarkdownProps(mentions, onLinkPress)}>{markdown}</LobeMarkdown>
    </Suspense>
  );
}

export { htmlPreviewSandbox };
