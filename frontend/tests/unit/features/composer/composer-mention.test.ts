import assert from "node:assert/strict";
import test from "node:test";

import type { IEditor } from "@lobehub/editor";

import {
  insertComposerMention,
} from "../../../../features/conversation/composer-mention";

test("Composer restores the saved Lexical selection before inserting and focusing", async () => {
  const events: string[] = [];
  let dispatchedPayload: unknown;
  const selection = {
    endNodeId: "paragraph",
    endOffset: 2,
    startNodeId: "paragraph",
    startOffset: 2,
    type: "range" as const,
  };
  const editor = {
    focus: () => events.push("focus"),
    setSelection: async (nextSelection: unknown) => {
      assert.equal(nextSelection, selection);
      events.push("selection");
      return true;
    },
  } as unknown as IEditor;

  const inserted = await insertComposerMention(editor, {
    id: "actor_one",
    kind: "human",
    label: "Ada",
    mark: "AD",
  }, (payload) => {
    events.push("dispatch");
    dispatchedPayload = payload;
    return true;
  }, selection);

  assert.equal(inserted, true);
  assert.deepEqual(events, ["selection", "dispatch", "focus"]);
  assert.deepEqual(dispatchedPayload, {
    label: "Ada",
    metadata: {
      id: "actor_one",
      kind: "human",
      mark: "AD",
    },
  });
});
