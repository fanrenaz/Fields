import assert from "node:assert/strict";
import test from "node:test";

import { markdownToPlainText } from "../../src/application/room/markdown-to-plain-text.js";

test("Room plain text never persists semantic member URIs", () => {
  assert.equal(
    markdownToPlainText(
      "回复 [@Test](fields://member/actor_4a1f71e0-8206-4f99-b599-3b4621f60fc9) 并查看 [天气](https://example.test)",
    ),
    "回复 @Test 并查看 天气",
  );
});
