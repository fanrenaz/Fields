import type { Locale } from "./locale";

export function setDocumentLocale(locale: Locale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
}
