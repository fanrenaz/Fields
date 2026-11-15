import assert from "node:assert/strict";
import test from "node:test";
import type { UIChatMessage } from "@lobechat/types";

import {
  createDoubleEscapeEditHandler,
} from "../../../../features/conversation/use-home-conversation";

test("empty Home Composer double-Escape edits the latest user version", () => {
  const selected: UIChatMessage[] = [];
  const times = [1_000, 1_500];
  let prevented = 0;
  const handler = createDoubleEscapeEditHandler({
    messages: [
      message("user-old", "user"),
      message("assistant", "assistant"),
      message("user-latest", "user"),
    ],
    onEdit: (messageValue) => selected.push(messageValue),
  }, () => times.shift()!);

  handler({ key: "Escape", preventDefault: () => { prevented += 1; } });
  assert.equal(selected.length, 0);
  handler({ key: "Escape", preventDefault: () => { prevented += 1; } });
  assert.deepEqual(selected.map((candidate) => candidate.id), ["user-latest"]);
  assert.equal(prevented, 1);
});

test("Home double-Escape window expires and non-Escape keys do not arm it", () => {
  const selected: UIChatMessage[] = [];
  const times = [1_000, 2_000, 2_400];
  const handler = createDoubleEscapeEditHandler({
    messages: [message("user-1", "user")],
    onEdit: (messageValue) => selected.push(messageValue),
  }, () => times.shift()!);
  const event = { key: "Escape", preventDefault: () => undefined };

  handler({ ...event, key: "Enter" });
  handler(event);
  handler(event);
  assert.equal(selected.length, 0);
  handler(event);
  assert.deepEqual(selected.map((candidate) => candidate.id), ["user-1"]);
});

function message(id: string, role: UIChatMessage["role"]): UIChatMessage {
  return {
    id,
    role,
    content: id,
    createdAt: 1,
    updatedAt: 1,
  };
}
