import type {
  ActivityEntry,
  ActivityItem,
  ActivitySlice,
  ActivityUnit,
  CollapsedToolActivity,
} from "./types";
import { computeActivityCounts } from "./item-formatter";

export function groupActivity(items: readonly ActivityItem[]): ActivitySlice[] {
  if (items.length === 0) return [];
  return mergeSlices(wrapUnits(items));
}

function wrapUnits(items: readonly ActivityItem[]): ActivityUnit[] {
  const units: ActivityUnit[] = [];
  let index = 0;
  while (index < items.length) {
    const explorationGroup = takeExplorationRun(items, index);
    if (explorationGroup.length >= 2) {
      units.push({ kind: "entry", entry: { kind: "exploration", items: explorationGroup } });
      index += explorationGroup.length;
    } else {
      units.push({ kind: "entry", entry: { kind: "item", item: items[index] } });
      index += 1;
    }
  }
  return units;
}

function takeExplorationRun(items: readonly ActivityItem[], start: number): ActivityItem[] {
  const run: ActivityItem[] = [];
  for (let index = start; index < items.length; index += 1) {
    const item = items[index];
    if (item.type !== "command" || !isExplorationCommand(item)) break;
    run.push(item);
  }
  return run;
}

function isExplorationCommand(item: ActivityItem & { type: "command" }): boolean {
  return item.actions.length > 0
    && item.actions.every((action) => action.type === "read" || action.type === "search" || action.type === "list");
}

function mergeSlices(units: ActivityUnit[]): ActivitySlice[] {
  const slices: ActivitySlice[] = [];
  let index = 0;
  while (index < units.length) {
    const unit = units[index];
    if (unit.entry.kind === "exploration") {
      slices.push({ kind: "exploration", items: unit.entry.items });
      index += 1;
      continue;
    }

    const groupType = groupableType(unit.entry.item);
    if (groupType === null) {
      slices.push({ kind: "single", entry: unit.entry });
      index += 1;
      continue;
    }

    const groupedUnits: ActivityUnit[] = [unit];
    let nextIndex = index + 1;
    while (nextIndex < units.length) {
      const next = units[nextIndex];
      if (next.entry.kind !== "item" || groupableType(next.entry.item) !== groupType) break;
      groupedUnits.push(next);
      nextIndex += 1;
    }

    if (groupedUnits.length >= 2) {
      const groupedItems = groupedUnits.map((value) => (
        value.entry as Extract<ActivityEntry, { kind: "item" }>
      ).item);
      slices.push(makeGroupSlice(groupType, groupedItems));
    } else {
      slices.push({ kind: "single", entry: unit.entry });
    }
    index = nextIndex;
  }
  return slices;
}

function groupableType(item: ActivityItem): string | null {
  switch (item.type) {
    case "command":
    case "file_change":
      return "tool-activity";
    case "tool_call":
      return `tool-call:${item.namespace ?? ""}:${item.name}`;
    case "web_search":
      return "web-search";
    case "collaboration":
      return `collaboration:${item.action}`;
    default:
      return null;
  }
}

function makeGroupSlice(groupType: string, items: ActivityItem[]): ActivitySlice {
  if (groupType.startsWith("tool-call:")) {
    return { kind: "tool-call-group", count: items.length, items };
  }
  if (groupType.startsWith("collaboration:")) {
    return { kind: "collaboration-group", items };
  }
  if (groupType === "web-search") {
    return { kind: "web-search-group", items };
  }
  return makeCollapsedSlice(items);
}

function makeCollapsedSlice(items: ActivityItem[]): CollapsedToolActivity {
  const summary = computeActivityCounts(items);
  const units: ActivityUnit[] = items.map((item) => ({
    kind: "entry",
    entry: { kind: "item", item },
  }));
  return { kind: "collapsed-tool-activity", summary, units };
}
