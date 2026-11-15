import assert from "node:assert/strict";
import test from "node:test";

import {
  composerMentionMarkdown,
  composerReferenceMarkdown,
  parseComposerMemberLink,
  parseComposerReferenceLink,
  setEditorMarkdown,
} from "../../../../features/conversation/editor-markdown";

test("Composer mentions retain the provider-neutral Fields URI", () => {
  assert.equal(
    composerMentionMarkdown({
      label: "Ada Lovelace",
      metadata: { id: "actor-ada", kind: "human", mark: "ada" },
    }),
    "[@Ada Lovelace](fields://member/actor-ada)",
  );
});

test("Composer references retain readable labels and immutable Fields targets", () => {
  assert.equal(composerReferenceMarkdown({
    label: "Plan Q3.pdf",
    target: {
      type: "file",
      id: "file/1",
      version_id: "version 3",
      room_id: "room-1",
    },
  }), "[Plan Q3.pdf](fields://room/room-1/company-file/file%2F1/version/version%203)");
  assert.equal(composerReferenceMarkdown({
    label: "Decision",
    target: { type: "message", room_id: "room/2", message_id: "message 7" },
  }), "[Decision](fields://room/room%2F2/message/message%207)");
  assert.equal(composerReferenceMarkdown({
    label: "Plan [final]\\copy.pdf",
    target: { type: "room", id: "room-1" },
  }), "[Plan \\[final\\]\\\\copy.pdf](fields://room/room-1)");
});

test("Composer reference URIs restore atomic node metadata without accepting malformed targets", () => {
  assert.deepEqual(
    parseComposerReferenceLink(
      "Plan Q3.pdf",
      "fields://room/room-1/company-file/file%2F1/version/version%203",
    ),
    {
      label: "Plan Q3.pdf",
      target: {
        type: "file",
        id: "file/1",
        version_id: "version 3",
        room_id: "room-1",
      },
    },
  );
  assert.deepEqual(parseComposerMemberLink("@Ada", "fields://member/actor%2Fada"), {
    id: "actor/ada",
    label: "Ada",
  });
  assert.equal(
    parseComposerReferenceLink("Plan", "fields://room/room-1/company-file/file-1"),
    null,
  );
});

test("empty Composer markdown cleans the editor without creating an empty editor state", () => {
  const calls: string[] = [];
  const editor = {
    cleanDocument: () => calls.push("clean"),
    setDocument: () => calls.push("set"),
  };

  setEditorMarkdown(editor as never, "");

  assert.deepEqual(calls, ["clean"]);
});

test("non-empty Composer markdown is preserved exactly", () => {
  const calls: unknown[][] = [];
  const editor = {
    cleanDocument: () => calls.push(["clean"]),
    setDocument: (...args: unknown[]) => calls.push(args),
  };

  setEditorMarkdown(editor as never, "  ");
  setEditorMarkdown(editor as never, "**Draft**");

  assert.deepEqual(calls, [
    ["markdown", "  "],
    ["markdown", "**Draft**"],
  ]);
});
