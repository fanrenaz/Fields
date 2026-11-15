import type {
  AgentTurnSnapshot,
} from "@fields/contracts/public/agent-activity";
import { groupActivity } from "./activity-grouper";
import { projectActivityItems } from "./item-projector";
import {
  computeActivityCounts,
  formatActivitySummary,
  formatReasoningContent,
} from "./item-formatter";
import type { ActivitySlice } from "./types";

export type {
  ActivitySlice,
  ActivityUnit,
  ActivityEntry,
  ActivityCounts,
  ActivityDetail,
  ActivityItem,
} from "./types";
export { projectActivityItems } from "./item-projector";
export {
  agentContentToMarkdown,
  computeActivityCounts,
  formatActivitySummary,
  formatCollaborationLabel,
  formatCommandDetails,
  formatCommandLabel,
  formatFileChangeEntryLabel,
  formatFileChangeLabel,
  formatImageLabel,
  formatJson,
  formatReasoningContent,
  formatSubagentLabel,
  formatToolDetails,
  formatToolLabel,
  formatWebSearchLabel,
  truncateLines,
} from "./item-formatter";

export type SidePanelNarrative = {
  id: string;
  content: AgentTurnSnapshot["narrative_items"][number]["content"];
};

export type SidePanelViewModel = {
  slices: ActivitySlice[];
  summary: string | null;
  commentaryItems: SidePanelNarrative[];
};

export function projectSidePanelViewModel(
  snapshot: AgentTurnSnapshot | null | undefined,
): SidePanelViewModel {
  const activityItems = projectActivityItems(snapshot?.activity_items ?? []);
  const slices = groupActivity(activityItems);
  const summary = formatActivitySummary(computeActivityCounts(activityItems));
  const commentaryItems = (snapshot?.narrative_items ?? []).flatMap((item) => {
    if (item.type === "user_message") return [];
    if (item.type === "assistant_message") {
      if (item.phase === "final_answer" || item.content.length === 0) return [];
      return [{ id: item.id, content: item.content }];
    }
    if (item.type === "plan") {
      return item.content.length > 0 ? [{ id: item.id, content: item.content }] : [];
    }
    const content = formatReasoningContent(item.summary);
    return content.length > 0 ? [{ id: item.id, content }] : [];
  });

  return {
    slices,
    summary: summary !== "Activity" ? summary : null,
    commentaryItems,
  };
}
