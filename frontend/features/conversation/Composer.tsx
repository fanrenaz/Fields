// @refresh reset

import {
  INSERT_MENTION_COMMAND,
  ReactCodePlugin,
  ReactCodemirrorPlugin,
  ReactHRPlugin,
  ReactLinkHighlightPlugin,
  ReactListPlugin,
  ReactMathPlugin,
  ReactVirtualBlockPlugin,
  type IEditor,
} from "@lobehub/editor";
import {
  ChatInput,
  ChatInputActionBar,
  ChatInputActions,
  Editor,
  SendButton,
  type ChatInputActionsProps,
  type EditorProps,
  useEditor,
} from "@lobehub/editor/react";
import { ActionIcon, Alert, Popover } from "@lobehub/ui";
import { Button } from "@lobehub/ui/base-ui";
import {
  AtSign,
  BookOpen,
  Clock3,
  FileText,
  MessageSquare,
  Paperclip,
  Plus,
  Type,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { FilePickButton } from "../../shared/platform/file-pick-button";
import { translateMessage, type UiMessageValue } from "../../shared/i18n/message";
import type { ComposerReferenceOption } from "../../shared/types/composer";
import { directUploadLimitMessage, type PickedFile } from "../../shared/types/upload";
import type { InlineSemanticMention } from "../../shared/ui/semantic-text";
import { DirectUploadLimitDialog } from "./DirectUploadLimitDialog";
import {
  ChatContentRail,
  type ChatContentWidth,
} from "./ChatContentRail";
import {
  composerMentionMarkdown,
  editorMarkdown,
  setEditorMarkdown,
} from "./editor-markdown";
import { FormattingBar } from "./FormattingBar";
import { insertComposerMention } from "./composer-mention";
import {
  INSERT_FIELDS_REFERENCE_COMMAND,
  ReactFieldsReferencePlugin,
} from "./fields-reference-node";

export type ComposerMention = InlineSemanticMention;

const COMPOSER_PLUGINS: NonNullable<EditorProps["plugins"]> = [
  ReactFieldsReferencePlugin,
  ReactListPlugin,
  ReactCodePlugin,
  ReactCodemirrorPlugin,
  ReactHRPlugin,
  ReactLinkHighlightPlugin,
  ReactVirtualBlockPlugin,
  ReactMathPlugin,
];

function composerReferenceTargetKey(target: ComposerReferenceOption["target"]) {
  switch (target.type) {
    case "room":
    case "member":
    case "resource":
    case "memory":
    case "file":
      return `${target.type}:${target.id}`;
    case "message":
      return `${target.type}:${target.room_id}:${target.message_id}`;
    case "thread":
      return `${target.type}:${target.room_id}:${target.thread_id}:${target.message_id ?? ""}`;
    case "context":
      return `${target.type}:${target.room_id}:${target.tab}`;
    default: {
      const neverTarget: never = target;
      return neverTarget;
    }
  }
}

type ComposerProps = {
  draft: string;
  contentWidth?: ChatContentWidth;
  error?: UiMessageValue;
  mentionOptions: readonly ComposerMention[];
  onReferenceInserted?: (id: number) => void;
  onClearReply: () => void;
  onDraft: (draft: string) => void;
  onSearch: () => void;
  onSend: (markdown: string) => void;
  onUploadFiles?: (files: PickedFile[]) => Promise<unknown>;
  pendingReferenceInsertion?: { id: number; reference: ComposerReferenceOption } | null;
  referenceOptions: readonly ComposerReferenceOption[];
  replyAnchor: string | null;
  replyAnchorClearable?: boolean;
  sendDisabled?: boolean;
  showMentionButton?: boolean;
  statusMessage?: UiMessageValue;
  surface?: "docked" | "floating";
  toolbarActions?: ReactNode;
  minimal?: boolean;
  hideSendButton?: boolean;
  onSchedule?: () => void;
  showReferenceActions?: boolean;
};

export function Composer({
  draft,
  contentWidth = "compact",
  replyAnchor,
  replyAnchorClearable = true,
  pendingReferenceInsertion = null,
  referenceOptions,
  mentionOptions,
  onDraft,
  onClearReply,
  onSearch,
  onReferenceInserted,
  onUploadFiles,
  onSend,
  sendDisabled = false,
  showMentionButton = true,
  toolbarActions = null,
  minimal = false,
  hideSendButton = false,
  onSchedule,
  showReferenceActions = true,
  statusMessage = null,
  surface = "docked",
  error,
}: ComposerProps) {
  const { t } = useTranslation();
  const editor = useEditor();
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const initializationFrameRef = useRef<number | null>(null);
  const mentionSelectionRef = useRef<ReturnType<IEditor["getSelection"]>>(null);
  const referenceSelectionRef = useRef<ReturnType<IEditor["getSelection"]>>(null);
  const lastInsertedReferenceIdRef = useRef<number | null>(null);
  const latestDraftRef = useRef(draft);
  const lastEditorMarkdownRef = useRef(draft);
  const [editorReady, setEditorReady] = useState(false);
  const [currentMarkdown, setCurrentMarkdown] = useState(draft);
  const [docsOpen, setDocsOpen] = useState(false);
  const [formattingOpen, setFormattingOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [uploadError, setUploadError] = useState("");
  latestDraftRef.current = draft;

  useEffect(() => () => {
    if (initializationFrameRef.current !== null) {
      cancelAnimationFrame(initializationFrameRef.current);
    }
  }, []);

  const mentionOption = useMemo<EditorProps["mentionOption"]>(() => (
    mentionOptions.length > 0 ? {
      items: mentionOptions.map((mention) => ({
        key: mention.id,
        label: mention.label,
        metadata: {
          id: mention.id,
          kind: mention.kind,
          mark: mention.mark,
        },
      })),
      markdownWriter: composerMentionMarkdown,
      maxLength: 50,
      onSelect: (instance, option) => {
        const metadata = option.metadata as {
          id: string;
          kind: InlineSemanticMention["kind"];
          mark: string;
        };
        void insertComposerMention(instance, {
          id: metadata.id,
          kind: metadata.kind,
          label: String(option.label),
          mark: metadata.mark,
        }, (payload) => instance.dispatchCommand(INSERT_MENTION_COMMAND, payload));
      },
    } : undefined
  ), [mentionOptions]);

  async function insertMention(mention: ComposerMention) {
    await insertComposerMention(
      editor,
      mention,
      (payload) => editor.dispatchCommand(INSERT_MENTION_COMMAND, payload),
      mentionSelectionRef.current,
    );
    mentionSelectionRef.current = null;
    setMentionOpen(false);
  }

  const insertReference = useCallback(async (reference: ComposerReferenceOption) => {
    const selection = referenceSelectionRef.current;
    referenceSelectionRef.current = null;
    if (reference.target.type === "member") {
      const memberId = reference.target.id;
      const mention = mentionOptions.find((candidate) => candidate.id === memberId);
      if (mention) {
        await insertComposerMention(
          editor,
          mention,
          (payload) => editor.dispatchCommand(INSERT_MENTION_COMMAND, payload),
          selection,
        );
        return;
      }
    }
    if (selection) await editor.setSelection(selection);
    editor.dispatchCommand(INSERT_FIELDS_REFERENCE_COMMAND, reference);
    editor.focus();
  }, [editor, mentionOptions]);

  function publishEditorMarkdown(instance: IEditor) {
    const nextMarkdown = editorMarkdown(instance);
    lastEditorMarkdownRef.current = nextMarkdown;
    setCurrentMarkdown(nextMarkdown);
    if (nextMarkdown !== latestDraftRef.current) onDraft(nextMarkdown);
  }

  function submitCurrentDocument() {
    if (hideSendButton) return;
    const markdown = editorMarkdown(editor);
    const submittedMarkdown = markdown.trim();
    if (!submittedMarkdown || sendDisabled) return;
    lastEditorMarkdownRef.current = "";
    setCurrentMarkdown("");
    if (markdown !== latestDraftRef.current) onDraft(markdown);
    onSend(submittedMarkdown);
    editor.cleanDocument();
  }

  async function handleUpload(files: PickedFile[]) {
    if (!onUploadFiles) {
      setUploadError(t("composer.uploadUnavailable"));
      return;
    }
    try {
      await onUploadFiles(files);
      setDocsOpen(false);
      setUploadError("");
      editor.focus();
    } catch {
      setUploadError(t("composer.uploadFailed"));
    }
  }

  useEffect(() => {
    if (!editorReady) return;
    const current = editorMarkdown(editor);
    if (current === draft) {
      lastEditorMarkdownRef.current = draft;
      setCurrentMarkdown(draft);
      return;
    }
    if (draft === lastEditorMarkdownRef.current) return;
    setEditorMarkdown(editor, draft);
    lastEditorMarkdownRef.current = draft;
    setCurrentMarkdown(draft);
  }, [draft, editor, editorReady]);

  useEffect(() => {
    if (!editorReady || !pendingReferenceInsertion) return;
    if (lastInsertedReferenceIdRef.current === pendingReferenceInsertion.id) return;
    lastInsertedReferenceIdRef.current = pendingReferenceInsertion.id;
    void insertReference(pendingReferenceInsertion.reference).finally(() => {
      onReferenceInserted?.(pendingReferenceInsertion.id);
    });
  }, [editorReady, insertReference, onReferenceInserted, pendingReferenceInsertion]);

  const actionItems: NonNullable<ChatInputActionsProps["items"]> = [];
  if (!minimal && onSchedule) {
    actionItems.push({
      icon: Clock3,
      key: "schedule",
      label: t("composer.schedule"),
      onClick: onSchedule,
    });
  }
  if (!minimal && toolbarActions) {
    actionItems.push({
      children: toolbarActions,
      key: "business-actions",
    });
  }
  if (!minimal && showMentionButton && mentionOptions.length > 0) {
    actionItems.push({
      children: (
        <Popover
          content={(
            <div
              onMouseDown={(event) => event.preventDefault()}
              onPointerDown={(event) => event.preventDefault()}
              style={{ display: "flex", flexDirection: "column", gap: 4, width: 240 }}
            >
              {mentionOptions.map((mention) => (
                <Button
                  block
                  key={mention.id}
                  onClick={() => void insertMention(mention)}
                  style={{ height: "auto", justifyContent: "flex-start", paddingBlock: 6 }}
                  type="text"
                >
                  <span style={{ textAlign: "left" }}>
                    <strong style={{ display: "block" }}>{mention.label}</strong>
                    <small style={{ color: "var(--ant-color-text-secondary)", display: "block" }}>
                      @{mention.mark}
                    </small>
                  </span>
                </Button>
              ))}
            </div>
          )}
          onOpenChange={setMentionOpen}
          open={mentionOpen}
          placement="topLeft"
          trigger="click"
        >
          <span
            onMouseDown={(event) => event.preventDefault()}
            onPointerDown={(event) => {
              mentionSelectionRef.current = editor.getSelection();
              event.preventDefault();
            }}
          >
            <ActionIcon
              active={mentionOpen}
              icon={AtSign}
              title={t("composer.mention")}
            />
          </span>
        </Popover>
      ),
      key: "mention",
    });
  }
  if (!minimal && showReferenceActions) actionItems.push(
    {
      children: (
        <Popover
          content={(
            <div style={{ display: "flex", flexDirection: "column", gap: 4, width: 280 }}>
              <span style={{ color: "var(--ant-color-text-secondary)", fontSize: 12, padding: 4 }}>
                {t("composer.projectDocs")}
              </span>
              {referenceOptions.map((doc) => (
                <Button
                  block
                  icon={<FileText size={16} />}
                  key={composerReferenceTargetKey(doc.target)}
                  onClick={() => {
                    void insertReference(doc);
                    setDocsOpen(false);
                  }}
                  style={{ justifyContent: "flex-start" }}
                  type="text"
                >
                  {doc.label}
                </Button>
              ))}
              <FilePickButton
                icon={<Paperclip size={16} />}
                onFilesPicked={(files) => void handleUpload(files)}
                onFilesRejected={(files) => setUploadError(directUploadLimitMessage(files))}
                style={{ justifyContent: "flex-start" }}
                type="text"
              >
                {t("composer.uploadNew")}
              </FilePickButton>
            </div>
          )}
          onOpenChange={setDocsOpen}
          open={docsOpen}
          placement="topLeft"
          trigger="click"
        >
          <span
            onPointerDown={(event) => {
              referenceSelectionRef.current = editor.getSelection();
              event.preventDefault();
            }}
          >
            <ActionIcon icon={Plus} title={t("composer.addDocument")} />
          </span>
        </Popover>
      ),
      key: "documents",
    },
    {
      children: (
        <span
          onPointerDown={(event) => {
            referenceSelectionRef.current = editor.getSelection();
            event.preventDefault();
          }}
        >
          <ActionIcon icon={BookOpen} onClick={onSearch} title={t("composer.reference")} />
        </span>
      ),
      key: "reference",
    },
    {
      active: formattingOpen,
      icon: Type,
      key: "formatting",
      label: t(formattingOpen ? "composer.hideFormatting" : "composer.showFormatting"),
      onClick: () => setFormattingOpen((open) => !open),
    },
  );

  const header = formattingOpen || replyAnchor ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {formattingOpen ? <FormattingBar editor={editor} /> : null}
      {replyAnchor ? (
        <div style={{ alignItems: "center", display: "flex", gap: 6, padding: "4px 8px" }}>
          <span style={{
            alignItems: "center",
            background: "var(--ant-color-fill-secondary)",
            borderRadius: 999,
            display: "inline-flex",
            fontSize: 12,
            fontWeight: 700,
            gap: 4,
            padding: "3px 8px",
          }}>
            <MessageSquare size={13} />
            {replyAnchor}
          </span>
          {replyAnchorClearable ? (
            <Button
              aria-label={t("composer.clearReply")}
              icon={<X size={14} />}
              onClick={onClearReply}
              shape="circle"
              size="small"
              type="text"
            />
          ) : null}
        </div>
      ) : null}
    </div>
  ) : undefined;

  const canSend = currentMarkdown.trim().length > 0 && !sendDisabled;
  const translatedError = translateMessage(t, error);
  const translatedStatus = translateMessage(t, statusMessage);
  const floating = surface === "floating";

  return (
    <section
      aria-label={t("composer.label")}
      style={floating ? {
        background: "transparent",
        padding: 0,
        width: "100%",
      } : {
        background: "var(--ant-color-bg-container)",
        padding: "0 12px 8px",
      }}
    >
      <ChatContentRail contentWidth={contentWidth} style={{
        position: "relative",
      }}>
        <ChatInput
          defaultHeight={minimal ? 52 : floating ? 64 : 36}
          footer={(
            <ChatInputActionBar
              left={<ChatInputActions collapseOffset={72} items={actionItems} />}
              right={hideSendButton ? null : (
                <SendButton
                  aria-label={t("composer.send")}
                  disabled={!canSend}
                  onSend={submitCurrentDocument}
                  shape="round"
                  size={32}
                />
              )}
            />
          )}
          header={header}
          maxHeight={320}
          minHeight={minimal ? 52 : floating ? 64 : 36}
          resize
          slashMenuRef={slashMenuRef}
          style={{
            border: "1px solid var(--ant-color-border-secondary)",
            borderRadius: floating ? 18 : 12,
            boxShadow: floating
              ? "0 12px 32px color-mix(in srgb, var(--ant-color-text) 8%, transparent)"
              : undefined,
            overflow: "hidden",
          }}
          styles={floating ? {
            body: {
              paddingBlock: "14px 4px",
              paddingInline: 16,
            },
            footer: {
              padding: "0 8px 8px",
            },
          } : undefined}
        >
          <Editor
            autoFocus
            autoFormatMarkdown
            content=""
            debounceWait={0}
            editor={editor}
            enablePasteMarkdown
            getPopupContainer={() => slashMenuRef.current}
            mentionOption={mentionOption}
            pasteAsPlainText
            plugins={COMPOSER_PLUGINS}
            slashPlacement="top"
            style={{ display: "block" }}
            type="text"
            variant="chat"
            onChange={publishEditorMarkdown}
            onInit={(instance) => {
              if (initializationFrameRef.current !== null) {
                cancelAnimationFrame(initializationFrameRef.current);
              }
              initializationFrameRef.current = requestAnimationFrame(() => {
                initializationFrameRef.current = null;
                const initialDraft = latestDraftRef.current;
                setEditorMarkdown(instance, initialDraft);
                lastEditorMarkdownRef.current = initialDraft;
                setCurrentMarkdown(initialDraft);
                setEditorReady(true);
              });
            }}
            onPressEnter={({ event }) => {
              if (hideSendButton) return;
              if (event.shiftKey) return;
              submitCurrentDocument();
              return true;
            }}
          />
        </ChatInput>
        {translatedError ? (
          <Alert message={translatedError} showIcon style={{ marginTop: 8 }} type="error" />
        ) : translatedStatus ? (
          <p style={{ color: "var(--ant-color-text-secondary)", fontSize: 12, margin: "6px 4px 0" }}>
            {translatedStatus}
          </p>
        ) : null}
      </ChatContentRail>
      <DirectUploadLimitDialog
        message={uploadError}
        onOpenChange={(open) => {
          if (!open) setUploadError("");
        }}
        open={Boolean(uploadError)}
      />
    </section>
  );
}
