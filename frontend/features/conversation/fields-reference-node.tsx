import {
  IMarkdownShortCutService,
  MARKDOWN_READER_LEVEL_HIGH,
  useLexicalComposerContext,
  useLexicalEditor,
  type IEditor,
} from "@lobehub/editor";
import type { ComposerReferenceOption, ComposerReferenceTarget } from "../../shared/types/composer";
import {
  $applyNodeReplacement,
  $createNodeSelection,
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  $insertNodes,
  $isNodeSelection,
  $isRootOrShadowRoot,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  DecoratorNode,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  createCommand,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type LexicalNodeConfig,
  type LexicalUpdateJSON,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import {
  AtSign,
  BookOpen,
  Brain,
  FileText,
  FolderKanban,
  ListTree,
  MessageSquare,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import {
  composerReferenceMarkdown,
  parseComposerReferenceLink,
  parseComposerMemberLink,
} from "./editor-markdown";

const NODE_TYPE = "fields-reference";

type SerializedFieldsReferenceNode = Spread<{
  label: string;
  target: ComposerReferenceTarget;
}, SerializedLexicalNode>;

export const INSERT_FIELDS_REFERENCE_COMMAND = createCommand<ComposerReferenceOption>(
  "INSERT_FIELDS_REFERENCE_COMMAND",
);

export class FieldsReferenceNode extends DecoratorNode<ReactNode> {
  static getType(): string {
    return NODE_TYPE;
  }

  static clone(node: FieldsReferenceNode): FieldsReferenceNode {
    return new FieldsReferenceNode(node.__label, node.__target, node.__key);
  }

  static importJSON(serializedNode: SerializedFieldsReferenceNode): FieldsReferenceNode {
    return $createFieldsReferenceNode({
      label: serializedNode.label,
      target: serializedNode.target,
    }).updateFromJSON(serializedNode);
  }

  __label: string;
  __target: ComposerReferenceTarget;

  constructor(label: string, target: ComposerReferenceTarget, key?: NodeKey) {
    super(key);
    this.__label = label;
    this.__target = target;
  }

  get label(): string {
    return this.__label;
  }

  get target(): ComposerReferenceTarget {
    return this.__target;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = document.createElement("span");
    const themeClass = config.theme[NODE_TYPE];
    if (typeof themeClass === "string") element.className = themeClass;
    return element;
  }

  updateDOM(): false {
    return false;
  }

  isInline(): true {
    return true;
  }

  getTextContent(): string {
    return this.__label;
  }

  exportJSON(): SerializedFieldsReferenceNode {
    return {
      ...super.exportJSON(),
      label: this.__label,
      target: this.__target,
      type: NODE_TYPE,
      version: 1,
    };
  }

  updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedFieldsReferenceNode>): this {
    const node = super.updateFromJSON(serializedNode);
    this.__label = serializedNode.label;
    this.__target = serializedNode.target;
    return node;
  }

  decorate(): ReactNode {
    return <ReferenceChip label={this.__label} nodeKey={this.__key} target={this.__target} />;
  }
}

function $createFieldsReferenceNode(reference: ComposerReferenceOption): FieldsReferenceNode {
  return $applyNodeReplacement(new FieldsReferenceNode(reference.label, reference.target));
}

function $isFieldsReferenceNode(node: LexicalNode | null | undefined): node is FieldsReferenceNode {
  return node instanceof FieldsReferenceNode;
}

type MarkdownNode = {
  type: string;
  text?: string;
};

type MarkdownLink = {
  type: "link";
  url?: string;
};

type ReferenceKernel = IEditor & {
  registerNodes: (nodes: LexicalNodeConfig[]) => void;
};

class FieldsReferenceKernelPlugin {
  static readonly pluginName = "FieldsReferenceKernelPlugin";
  private readonly cleanups: Array<() => void> = [];

  constructor(private readonly kernel: ReferenceKernel) {
    kernel.registerNodes([FieldsReferenceNode]);
  }

  onInit(editor: LexicalEditor): void {
    this.cleanups.push(editor.registerCommand(
      INSERT_FIELDS_REFERENCE_COMMAND,
      (reference) => {
        editor.update(() => {
          const referenceNode = $createFieldsReferenceNode(reference);
          $insertNodes([referenceNode]);
          if ($isRootOrShadowRoot(referenceNode.getParentOrThrow())) {
            const paragraph = $createParagraphNode();
            referenceNode.replace(paragraph);
            paragraph.append(referenceNode);
          }
          const spacer = $createTextNode(" ");
          referenceNode.insertAfter(spacer);
          spacer.selectEnd();
        });
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    ));
    const removeSelectedReference = (event: KeyboardEvent | null) => {
      const selection = $getSelection();
      if (!$isNodeSelection(selection)) return false;
      const references = selection.getNodes().filter($isFieldsReferenceNode);
      if (references.length === 0) return false;
      event?.preventDefault();
      for (const reference of references) reference.remove();
      return true;
    };
    this.cleanups.push(editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      removeSelectedReference,
      COMMAND_PRIORITY_LOW,
    ));
    this.cleanups.push(editor.registerCommand(
      KEY_DELETE_COMMAND,
      removeSelectedReference,
      COMMAND_PRIORITY_LOW,
    ));

    const markdown = this.kernel.requireService(IMarkdownShortCutService);
    markdown?.registerMarkdownWriter(NODE_TYPE, (context, node) => {
      if (!$isFieldsReferenceNode(node)) return false;
      context.appendLine(composerReferenceMarkdown({ label: node.label, target: node.target }));
      return true;
    });
    markdown?.registerMarkdownReader("link", (node, children) => {
      const link = node as MarkdownLink;
      const label = markdownChildrenText(children as MarkdownNode[]);
      const member = parseComposerMemberLink(label, link.url ?? "");
      if (member) {
        return {
          label: member.label,
          metadata: { id: member.id },
          type: "mention",
          version: 1,
        };
      }
      const reference = parseComposerReferenceLink(label, link.url ?? "");
      if (!reference) return false;
      return {
        label: reference.label,
        target: reference.target,
        type: NODE_TYPE,
        version: 1,
      };
    }, MARKDOWN_READER_LEVEL_HIGH);
  }

  destroy(): void {
    for (const cleanup of this.cleanups) cleanup();
  }
}

export function ReactFieldsReferencePlugin() {
  const [editor] = useLexicalComposerContext();
  useLayoutEffect(() => {
    editor.registerPlugin(FieldsReferenceKernelPlugin);
  }, [editor]);
  return null;
}

function ReferenceChip({
  label,
  nodeKey,
  target,
}: {
  label: string;
  nodeKey: NodeKey;
  target: ComposerReferenceTarget;
}) {
  const editorRef = useRef<LexicalEditor | null>(null);
  const [selected, setSelected] = useState(false);
  useLexicalEditor((editor) => {
    editorRef.current = editor;
    const updateSelected = () => {
      const selection = $getSelection();
      setSelected($isNodeSelection(selection) && selection.has(nodeKey));
    };
    editor.getEditorState().read(updateSelected);
    const unregister = editor.registerUpdateListener(({ editorState }) => {
      editorState.read(updateSelected);
    });
    return () => {
      editorRef.current = null;
      unregister();
    };
  }, [nodeKey]);

  const select = useCallback((event: React.MouseEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    editorRef.current?.update(() => {
      const selection = $createNodeSelection();
      selection.add(nodeKey);
      $setSelection(selection);
    });
  }, [nodeKey]);
  const Icon = referenceIcon(target.type);
  return (
    <span
      aria-label={label}
      contentEditable={false}
      data-reference-type={target.type}
      onClick={select}
      role="button"
      style={{ ...chipStyle, ...(selected ? selectedChipStyle : null) }}
      tabIndex={-1}
    >
      <Icon aria-hidden size={13} strokeWidth={2} />
      <span style={chipLabelStyle}>{label}</span>
    </span>
  );
}

function markdownChildrenText(children: MarkdownNode[]): string {
  return children.map((child) => child.text ?? "").join("").replace(/^@/u, "");
}

function referenceIcon(type: ComposerReferenceTarget["type"]): LucideIcon {
  switch (type) {
    case "member": return AtSign;
    case "room": return MessagesSquare;
    case "resource": return BookOpen;
    case "memory": return Brain;
    case "file": return FileText;
    case "message": return MessageSquare;
    case "thread": return FolderKanban;
    case "context": return ListTree;
  }
}

const chipStyle: CSSProperties = {
  alignItems: "center",
  background: "var(--ant-color-primary-bg)",
  border: "1px solid var(--ant-color-primary-border)",
  borderRadius: 6,
  color: "var(--ant-color-primary-text)",
  cursor: "default",
  display: "inline-flex",
  fontSize: "0.875em",
  fontWeight: 700,
  gap: 4,
  lineHeight: 1,
  marginInline: "0.2em",
  maxWidth: 240,
  padding: "0.2em 0.45em",
  userSelect: "none",
  verticalAlign: "baseline",
};

const selectedChipStyle: CSSProperties = {
  background: "var(--ant-color-warning-bg)",
  borderColor: "var(--ant-color-warning-border)",
  color: "var(--ant-color-warning-text)",
};

const chipLabelStyle: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
