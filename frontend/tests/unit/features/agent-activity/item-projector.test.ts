import assert from "node:assert/strict";
import test from "node:test";
import type {
  AgentActivityItem,
} from "@fields/contracts/public/agent-activity";
import { projectActivityItems } from "../../../../features/agent-activity/item-projector";

test("merges only consecutive image views and preserves structured URIs", () => {
  const items: AgentActivityItem[] = [
    imageView("one", "file:///tmp/one.png"),
    imageView("two", "https://example.com/two.png"),
    { type: "context_compaction", id: "compact", status: "completed" },
    imageView("three", "file:///tmp/three.png"),
  ];
  const projected = projectActivityItems(items);
  assert.equal(projected.length, 3);
  assert.ok(projected[0]?.type === "image_view");
  assert.deepEqual(projected[0].images.map((image) => image.uri), [
    "file:///tmp/one.png",
    "https://example.com/two.png",
  ]);
  assert.ok(projected[2]?.type === "image_view");
  assert.equal(projected[2].images[0]?.uri, "file:///tmp/three.png");
});

function imageView(id: string, uri: string): AgentActivityItem {
  return {
    type: "image_view",
    id,
    status: "completed",
    images: [{ type: "image", uri, alt_text: null, mime_type: "image/png" }],
  };
}
