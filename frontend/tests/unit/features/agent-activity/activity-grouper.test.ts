import assert from "node:assert/strict";
import test from "node:test";
import type {
  AgentActivityItem,
  AgentCommandItem,
} from "@fields/contracts/public/agent-activity";
import { groupActivity } from "../../../../features/agent-activity/activity-grouper";

function command(id: string, exploration = false): AgentCommandItem {
  return {
    type: "command",
    id,
    status: "completed",
    command: exploration ? "cat f" : "npm test",
    cwd: "/",
    actions: exploration
      ? [{ type: "read", command: "cat f", name: "f", path: "/f" }]
      : [{ type: "unknown", command: "npm test" }],
    output: exploration ? null : "tests passed",
    exit_code: 0,
    duration_ms: null,
  };
}

function tool(id: string): AgentActivityItem {
  return {
    type: "tool_call",
    id,
    status: "completed",
    namespace: "files",
    name: "read",
    display_name: null,
    content: [],
    progress: [],
    error: null,
    duration_ms: null,
  };
}

function fileChange(id: string): AgentActivityItem {
  return {
    type: "file_change",
    id,
    status: "completed",
    changes: [{ path: "a.ts", kind: "update", diff: "-old\n+new\n" }],
  };
}

function webSearch(id: string): AgentActivityItem {
  return { type: "web_search", id, status: "completed", query: "test", detail: "test", uri: null };
}

test("single items stay as single entries", () => {
  const slices = groupActivity([command("c1"), tool("t1")]);
  assert.deepEqual(slices.map((slice) => slice.kind), ["single", "single"]);
});

test("consecutive commands and file changes collapse together", () => {
  const slices = groupActivity([command("c1"), fileChange("f1"), command("c2")]);
  assert.equal(slices.length, 1);
  assert.equal(slices[0]?.kind, "collapsed-tool-activity");
  if (slices[0]?.kind === "collapsed-tool-activity") {
    assert.equal(slices[0].summary.commandCount, 2);
    assert.equal(slices[0].summary.editedFileCount, 1);
  }
});

test("consecutive calls to the same tool are grouped", () => {
  const slices = groupActivity([tool("t1"), tool("t2")]);
  assert.equal(slices.length, 1);
  assert.equal(slices[0]?.kind, "tool-call-group");
});

test("consecutive web searches are grouped", () => {
  const slices = groupActivity([webSearch("w1"), webSearch("w2")]);
  assert.equal(slices.length, 1);
  assert.equal(slices[0]?.kind, "web-search-group");
});

test("consecutive exploration commands form a dedicated group", () => {
  const slices = groupActivity([command("e1", true), command("e2", true), command("e3", true)]);
  assert.equal(slices.length, 1);
  assert.equal(slices[0]?.kind, "exploration");
  if (slices[0]?.kind === "exploration") assert.equal(slices[0].items.length, 3);
});

test("single exploration command and empty input stay ungrouped", () => {
  assert.equal(groupActivity([command("e1", true)])[0]?.kind, "single");
  assert.deepEqual(groupActivity([]), []);
});
