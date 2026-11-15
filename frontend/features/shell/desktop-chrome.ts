export function isDesktopSearchShortcut(
  event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey">,
): boolean {
  return event.ctrlKey
    && !event.altKey
    && !event.metaKey
    && !event.shiftKey
    && event.key.toLowerCase() === "k";
}
