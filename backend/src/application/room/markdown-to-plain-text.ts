export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gmu, "")
    .replace(/```[^\n]*\n?/gu, "")
    .replace(/[`*_~]/gu, "")
    .replace(/<[^>]+>/gu, "")
    .trim();
}
