import type { IEditor } from "@lobehub/editor";
import {
  ChatInputActionBar,
  ChatInputActions,
  type ChatInputActionsProps,
  useEditorState,
} from "@lobehub/editor/react";
import {
  Bold,
  Braces,
  CodeXml,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  MessageSquareQuote,
  Sigma,
  Strikethrough,
  Underline,
} from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export function FormattingBar({ editor }: { editor: IEditor }) {
  const { t } = useTranslation();
  const editorState = useEditorState(editor);
  const items = useMemo<ChatInputActionsProps["items"]>(() => [
    {
      active: editorState.isBold,
      icon: Bold,
      key: "bold",
      label: t("composer.formatBold"),
      onClick: editorState.bold,
    },
    {
      active: editorState.isItalic,
      icon: Italic,
      key: "italic",
      label: t("composer.formatItalic"),
      onClick: editorState.italic,
    },
    {
      active: editorState.isUnderline,
      icon: Underline,
      key: "underline",
      label: t("composer.formatUnderline"),
      onClick: editorState.underline,
    },
    {
      active: editorState.isStrikethrough,
      icon: Strikethrough,
      key: "strikethrough",
      label: t("composer.formatStrikethrough"),
      onClick: editorState.strikethrough,
    },
    { type: "divider" },
    {
      active: editorState.blockType === "bullet",
      icon: List,
      key: "bullet-list",
      label: t("composer.formatBulletList"),
      onClick: editorState.bulletList,
    },
    {
      active: editorState.blockType === "number",
      icon: ListOrdered,
      key: "number-list",
      label: t("composer.formatNumberList"),
      onClick: editorState.numberList,
    },
    {
      active: editorState.blockType === "check",
      icon: ListChecks,
      key: "task-list",
      label: t("composer.formatTaskList"),
      onClick: editorState.checkList,
    },
    { type: "divider" },
    {
      active: editorState.isBlockquote,
      icon: MessageSquareQuote,
      key: "blockquote",
      label: t("composer.formatBlockquote"),
      onClick: editorState.blockquote,
    },
    {
      icon: Sigma,
      key: "math",
      label: t("composer.formatMath"),
      onClick: editorState.insertMath,
    },
    {
      active: editorState.isCode,
      icon: CodeXml,
      key: "inline-code",
      label: t("composer.formatInlineCode"),
      onClick: editorState.code,
    },
    {
      active: editorState.isCodeblock,
      icon: Braces,
      key: "code-block",
      label: t("composer.formatCodeBlock"),
      onClick: editorState.codeblock,
    },
  ], [editorState, t]);

  return (
    <ChatInputActionBar
      left={<ChatInputActions items={items} />}
      style={{
        background: "var(--ant-color-fill-quaternary)",
        borderTopLeftRadius: 8,
        borderTopRightRadius: 8,
      }}
    />
  );
}
