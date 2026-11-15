export const QUICK_REPLY_KEYS = [
  "timeline.quickReply.received",
  "timeline.quickReply.thinking",
  "timeline.quickReply.letMeThink",
  "timeline.quickReply.organizing",
  "timeline.quickReply.almostThere",
] as const;

export function nextQuickReplyIndex(
  current: number,
  length: number,
  random: () => number = Math.random,
): number {
  if (length <= 1) return 0;
  if (current < 0 || current >= length) {
    return Math.min(length - 1, Math.floor(random() * length));
  }
  const offset = 1 + Math.floor(random() * (length - 1));
  return (current + offset) % length;
}
