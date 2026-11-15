import type {
  AgentActivityItem,
  AgentImageViewItem,
} from "@fields/contracts/public/agent-activity";

/**
 * Apply presentation-only normalization to already provider-neutral activity.
 * Provider interpretation and filtering belong to the Backend adapter.
 */
export function projectActivityItems(items: readonly AgentActivityItem[]): AgentActivityItem[] {
  const projected: AgentActivityItem[] = [];

  for (const item of items) {
    if (item.type === "image_view") {
      const previous = projected.at(-1);
      if (previous?.type === "image_view") {
        projected[projected.length - 1] = mergeImageViews(previous, item);
        continue;
      }
    }
    projected.push(item);
  }

  return projected;
}

function mergeImageViews(previous: AgentImageViewItem, next: AgentImageViewItem): AgentImageViewItem {
  return {
    ...previous,
    status: next.status,
    images: [...previous.images, ...next.images],
  };
}
