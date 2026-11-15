import assert from "node:assert/strict";
import test from "node:test";

import { markdownPlainText } from "../../../../features/conversation/markdown-plain-text";

test("message plain text hides semantic member URIs", () => {
  assert.equal(
    markdownPlainText(
      "回复 [@Test](fields://member/actor_4a1f71e0-8206-4f99-b599-3b4621f60fc9) 并查看 [天气](https://example.test)",
    ),
    "回复 @Test 并查看 天气",
  );
});

test("message plain text removes common Markdown presentation syntax", () => {
  assert.equal(
    markdownPlainText("## **结论**\n\n- `今天`有雨"),
    "结论\n今天有雨",
  );
});
