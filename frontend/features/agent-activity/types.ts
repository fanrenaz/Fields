import type {
  AgentActivityItem,
  AgentContent,
  AgentNarrativeItem,
} from "@fields/contracts/public/agent-activity";

export type ActivityItem = AgentActivityItem;
export type NarrativeItem = AgentNarrativeItem;

export type ActivitySlice =
  | CollapsedToolActivity
  | ExplorationGroup
  | ToolCallGroup
  | WebSearchGroup
  | CollaborationGroup
  | SingleActivityEntry;

export type CollapsedToolActivity = {
  kind: "collapsed-tool-activity";
  summary: ActivityCounts;
  units: ActivityUnit[];
};

export type ExplorationGroup = { kind: "exploration"; items: ActivityItem[] };
export type ToolCallGroup = { kind: "tool-call-group"; count: number; items: ActivityItem[] };
export type WebSearchGroup = { kind: "web-search-group"; items: ActivityItem[] };
export type CollaborationGroup = { kind: "collaboration-group"; items: ActivityItem[] };
export type SingleActivityEntry = { kind: "single"; entry: ActivityEntry };
export type ActivityUnit = { kind: "entry"; entry: ActivityEntry };
export type ActivityEntry =
  | { kind: "item"; item: ActivityItem }
  | { kind: "exploration"; items: ActivityItem[] };

export type ActivityCounts = {
  createdFileCount: number;
  editedFileCount: number;
  deletedFileCount: number;
  exploredFileCount: number;
  searchCount: number;
  listCount: number;
  commandCount: number;
  toolCallCount: number;
  webSearchCount: number;
  imageViewCount: number;
  generatedImageCount: number;
  collaborationCount: number;
};

export type ActivityDetail =
  | { label: string; kind: "text" | "code"; value: string }
  | { label: string; kind: "content"; content: readonly AgentContent[] };

export function emptyActivityCounts(): ActivityCounts {
  return {
    createdFileCount: 0,
    editedFileCount: 0,
    deletedFileCount: 0,
    exploredFileCount: 0,
    searchCount: 0,
    listCount: 0,
    commandCount: 0,
    toolCallCount: 0,
    webSearchCount: 0,
    imageViewCount: 0,
    generatedImageCount: 0,
    collaborationCount: 0,
  };
}
