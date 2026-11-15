import type {
  AgentContent,
} from "@fields/contracts/public/agent-activity";

import { i18n } from "../../shared/i18n/i18n";
import type { ActivityCounts, ActivityDetail, ActivityItem } from "./types";
import { emptyActivityCounts } from "./types";

const RESULT_MAX_LINES = 20;
const COMMAND_OUTPUT_MAX_LINES = 30;

export function truncateLines(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return `${lines.slice(0, maxLines).join("\n")}\n${i18n.t("activity.moreLines", { count: lines.length - maxLines })}`;
}

function countNum(value: number, key: string): string | null {
  if (value === 0) return null;
  return i18n.t(key, { count: value });
}

export function computeActivityCounts(items: readonly ActivityItem[]): ActivityCounts {
  const counts = emptyActivityCounts();
  for (const item of items) {
    switch (item.type) {
      case "command":
        counts.commandCount += 1;
        for (const action of item.actions) {
          if (action.type === "read") counts.exploredFileCount += 1;
          else if (action.type === "search") counts.searchCount += 1;
          else if (action.type === "list") counts.listCount += 1;
        }
        break;
      case "file_change":
        for (const change of item.changes) {
          if (change.kind === "add") counts.createdFileCount += 1;
          else if (change.kind === "delete") counts.deletedFileCount += 1;
          else counts.editedFileCount += 1;
        }
        break;
      case "tool_call": counts.toolCallCount += 1; break;
      case "web_search": counts.webSearchCount += 1; break;
      case "image_view": counts.imageViewCount += item.images.length; break;
      case "image_generation": counts.generatedImageCount += 1; break;
      case "collaboration":
      case "subagent_activity": counts.collaborationCount += 1; break;
      case "context_compaction": break;
    }
  }
  return counts;
}

export function formatActivitySummary(counts: ActivityCounts): string {
  const parts: string[] = [];
  const push = (firstKey: string, laterKey: string, value: number, countKey: string) => {
    const count = countNum(value, countKey);
    if (count) parts.push(`${i18n.t(parts.length === 0 ? firstKey : laterKey)} ${count}`);
  };
  push("activity.created", "activity.createdLater", counts.createdFileCount, "activity.file");
  push("activity.edited", "activity.editedLater", counts.editedFileCount, "activity.file");
  push("activity.deleted", "activity.deletedLater", counts.deletedFileCount, "activity.file");
  const explored = [
    countNum(counts.exploredFileCount, "activity.file"),
    countNum(counts.searchCount, "activity.search"),
    countNum(counts.listCount, "activity.list"),
  ].filter(Boolean);
  if (explored.length) parts.push(`${i18n.t(parts.length ? "activity.exploredLater" : "activity.explored")} ${explored.join(", ")}`);
  push("activity.ran", "activity.ranLater", counts.commandCount, "activity.command");
  push("activity.called", "activity.calledLater", counts.toolCallCount, "activity.tool");
  if (counts.webSearchCount) parts.push(i18n.t(parts.length ? "activity.searchedWebLater" : "activity.searchedWeb"));
  push("activity.viewed", "activity.viewedLater", counts.imageViewCount, "activity.image");
  push("activity.generated", "activity.generatedLater", counts.generatedImageCount, "activity.image");
  push("activity.coordinated", "activity.coordinatedLater", counts.collaborationCount, "activity.agentAction");
  return parts.length ? parts.join(", ") : i18n.t("activity.activity");
}

export function formatCommandLabel(item: Extract<ActivityItem, { type: "command" }>): string {
  const reads = item.actions.filter((action) => action.type === "read");
  if (reads.length > 0 && reads.length === item.actions.length) {
    return reads.length === 1
      ? i18n.t("activity.readFile", { name: reads[0].name })
      : i18n.t("activity.readFiles", { count: reads.length });
  }
  const searches = item.actions.filter((action) => action.type === "search");
  if (searches.length > 0 && searches.length === item.actions.length) return i18n.t("activity.searchedFiles");
  const lists = item.actions.filter((action) => action.type === "list");
  if (lists.length > 0 && lists.length === item.actions.length) return i18n.t("activity.listedFiles");
  return i18n.t(item.actions.length > 1 ? "activity.ranMultipleCommands" : "activity.ranCommand");
}

export function formatCommandDetails(item: Extract<ActivityItem, { type: "command" }>): ActivityDetail[] {
  const details: ActivityDetail[] = [{ label: i18n.t("activity.command"), value: item.command, kind: "code" }];
  if (item.cwd) details.push({ label: i18n.t("activity.workingDirectory"), value: item.cwd, kind: "text" });
  if (item.output) details.push({ label: i18n.t("activity.output"), value: truncateLines(item.output, COMMAND_OUTPUT_MAX_LINES), kind: "text" });
  if (item.exit_code != null) details.push({ label: i18n.t("activity.exitCode"), value: String(item.exit_code), kind: "text" });
  return details;
}

export function formatFileChangeLabel(item: Extract<ActivityItem, { type: "file_change" }>): string {
  return `${i18n.t("activity.edited")} ${countNum(item.changes.length, "activity.file")}`;
}

export function formatFileChangeEntryLabel(change: { path: string; kind: string; diff: string }): string {
  let additions = 0;
  let deletions = 0;
  for (const line of change.diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  const key = change.kind === "add"
    ? "activity.createdFileChange"
    : change.kind === "delete"
      ? "activity.deletedFileChange"
      : "activity.editedFileChange";
  return i18n.t(key, { path: change.path, additions, deletions });
}

export function formatToolLabel(item: Extract<ActivityItem, { type: "tool_call" }>): string {
  if (item.display_name) return item.display_name;
  return item.namespace ? `${item.namespace} · ${item.name}` : item.name;
}

export function formatToolDetails(item: Extract<ActivityItem, { type: "tool_call" }>): ActivityDetail[] {
  const details: ActivityDetail[] = [];
  if (item.content.length > 0) {
    details.push({ label: i18n.t("activity.output"), kind: "content", content: truncateAgentContent(item.content, RESULT_MAX_LINES) });
  }
  if (item.error) {
    details.push({
      label: i18n.t("activity.error"),
      value: i18n.t("activity.activityUnavailable"),
      kind: "text",
    });
  }
  return details;
}

export function formatWebSearchLabel(item: Extract<ActivityItem, { type: "web_search" }>): string {
  return i18n.t("activity.searchedWebFor", { detail: item.detail });
}

export function formatCollaborationLabel(item: Extract<ActivityItem, { type: "collaboration" }>): string {
  switch (item.action) {
    case "spawn": return i18n.t("activity.spawnedAgent", { count: item.target_count });
    case "close": return i18n.t("activity.closedAgent", { count: item.target_count });
    case "send_input": return i18n.t("activity.sentInputToAgent", { count: item.target_count });
    case "resume": return i18n.t("activity.resumedAgent", { count: item.target_count });
  }
}

export function formatSubagentLabel(item: Extract<ActivityItem, { type: "subagent_activity" }>): string {
  const name = item.agent_label ? `${item.agent_label}: ` : "";
  if (item.activity === "started") return `${name}${i18n.t("activity.started")}`;
  if (item.activity === "interacted") return `${name}${i18n.t("activity.updated")}`;
  return `${name}${i18n.t("activity.interruptedAction")}`;
}

export function formatImageLabel(item: Extract<ActivityItem, { type: "image_view" | "image_generation" }>): string {
  if (item.type === "image_view") return `${i18n.t("activity.viewed")} ${countNum(item.images.length, "activity.image")}`;
  return i18n.t("activity.generatedImage");
}

export function formatReasoningContent(summary: readonly AgentContent[]): AgentContent[] {
  const text = summary
    .flatMap((part) => part.type === "text" ? [part.text] : part.type === "markdown" ? [part.markdown] : [])
    .map((part) => part.trim())
    .filter(Boolean);
  const nonText = summary.filter((part) => part.type !== "text" && part.type !== "markdown");
  if (text.length === 0) return [...nonText];
  const [first, ...rest] = text;
  const markdown = truncateLines(rest.length ? `**${first}**\n\n${rest.join("\n\n")}` : first, 50);
  return [{ type: "markdown", markdown }, ...nonText];
}

export function agentContentToMarkdown(content: readonly AgentContent[]): string {
  return content.map((part) => {
    switch (part.type) {
      case "text": return part.text;
      case "markdown": return part.markdown;
      case "resource_link": return markdownLink(part.title ?? part.uri, part.uri);
      case "image": return markdownLink(part.alt_text ?? i18n.t("activity.image"), part.uri);
      case "audio": return [part.transcript, markdownLink(i18n.t("activity.audio"), part.uri)].filter(Boolean).join("\n\n");
      case "json": return `\`\`\`json\n${formatJson(part.value)}\n\`\`\``;
    }
  }).filter(Boolean).join("\n\n");
}

export function formatJson(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? String(value);
}

function truncateAgentContent(content: readonly AgentContent[], maxLines: number): AgentContent[] {
  return content.map((part) => {
    if (part.type === "text") return { ...part, text: truncateLines(part.text, maxLines) };
    if (part.type === "markdown") return { ...part, markdown: truncateLines(part.markdown, maxLines) };
    return part;
  });
}

function markdownLink(label: string, uri: string): string {
  return `[${label.replace(/[\[\]]/g, "")}](${uri})`;
}
