import assert from "node:assert/strict";
import test from "node:test";
import type {
  AgentActivityItem,
  AgentCommandItem,
  AgentToolCallItem,
} from "@fields/contracts/public/agent-activity";
import {
  agentContentToMarkdown,
  computeActivityCounts,
  formatActivitySummary,
  formatCommandLabel,
  formatToolDetails,
  formatWebSearchLabel,
  truncateLines,
} from "../../../../features/agent-activity/item-formatter";
import { emptyActivityCounts } from "../../../../features/agent-activity/types";

function command(id: string): AgentCommandItem {
  return {
    type: "command",
    id,
    status: "completed",
    command: "cat foo.ts",
    cwd: "/app",
    actions: [{ type: "read", command: "cat foo.ts", name: "foo.ts", path: "/app/foo.ts" }],
    output: "content",
    exit_code: 0,
    duration_ms: null,
  };
}

function tool(id: string): AgentToolCallItem {
  return {
    type: "tool_call",
    id,
    status: "completed",
    namespace: "files",
    name: "read",
    display_name: null,
    content: [
      { type: "markdown", markdown: "**Hello**" },
      { type: "resource_link", uri: "fields://resource/brief", title: "Brief", mime_type: "text/markdown" },
    ],
    progress: [],
    error: null,
    duration_ms: null,
  };
}

test("counts provider-neutral renderable activity", () => {
  const items: AgentActivityItem[] = [
    command("c1"),
    tool("t1"),
    { type: "web_search", id: "search", status: "completed", query: "weather", detail: "weather", uri: null },
  ];
  const counts = computeActivityCounts(items);
  assert.equal(counts.commandCount, 1);
  assert.equal(counts.toolCallCount, 1);
  assert.equal(counts.webSearchCount, 1);
});

test("summary uses projected counts", () => {
  const counts = { ...emptyActivityCounts(), commandCount: 2, editedFileCount: 3, toolCallCount: 1 };
  assert.equal(formatActivitySummary(counts), "Edited 3 files, ran 2 commands, called 1 tool");
  assert.equal(formatActivitySummary(emptyActivityCounts()), "Activity");
});

test("formats semantic command, search, and structured tool output", () => {
  assert.equal(formatCommandLabel(command("c1")), "Read foo.ts");
  const details = formatToolDetails(tool("t1"));
  assert.equal(details[0]?.kind, "content");
  if (details[0]?.kind === "content") {
    assert.deepEqual(details[0].content[1], {
      type: "resource_link",
      uri: "fields://resource/brief",
      title: "Brief",
      mime_type: "text/markdown",
    });
  }
  const search: Extract<AgentActivityItem, { type: "web_search" }> = {
    type: "web_search", id: "w1", status: "completed", query: "weather", detail: "weather", uri: null,
  };
  assert.equal(formatWebSearchLabel(search), "Searched the web for “weather”");
});

test("renders activity failures as a localized safe fallback", () => {
  const unsafe = "credential=do-not-display";
  const details = formatToolDetails({
    ...tool("failed-tool"),
    error: { code: "TOOL_FAILED", message: unsafe },
  });
  const error = details.find((detail) => detail.label === "Error");
  assert.deepEqual(error, { label: "Error", value: "Activity unavailable", kind: "text" });
  assert.equal(JSON.stringify(details).includes(unsafe), false);
});

test("content-to-Markdown retains resource URIs", () => {
  assert.equal(agentContentToMarkdown([
    { type: "text", text: "Open" },
    { type: "resource_link", uri: "https://example.com/brief", title: "brief", mime_type: null },
  ]), "Open\n\n[brief](https://example.com/brief)");
});

test("truncateLines truncates long output", () => {
  assert.match(truncateLines(["a", "b", "c"].join("\n"), 2), /1 more line/);
});
