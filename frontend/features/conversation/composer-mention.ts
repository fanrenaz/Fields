import type { IEditor } from "@lobehub/editor";

import type { InlineSemanticMention } from "../../shared/ui/semantic-text";

type MentionPayload = {
  id: string;
  kind: InlineSemanticMention["kind"];
  label: string;
  mark: string;
};

type InsertMention = (payload: {
  label: string;
  metadata: {
    id: string;
    kind: InlineSemanticMention["kind"];
    mark: string;
  };
}) => boolean;

type ComposerSelection = NonNullable<ReturnType<IEditor["getSelection"]>>;

export async function insertComposerMention(
  editor: IEditor,
  mention: MentionPayload,
  insert: InsertMention,
  selection?: ComposerSelection | null,
): Promise<boolean> {
  const payload = {
    label: mention.label,
    metadata: {
      id: mention.id,
      kind: mention.kind,
      mark: mention.mark,
    },
  };
  if (selection) await editor.setSelection(selection);
  const inserted = insert(payload);
  editor.focus();
  return inserted;
}
