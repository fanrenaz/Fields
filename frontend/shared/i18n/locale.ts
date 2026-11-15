export const SUPPORTED_LOCALES = ["en", "zh-CN", "zh-TW"] as const;

export type Locale = typeof SUPPORTED_LOCALES[number];

export const DEFAULT_LOCALE: Locale = "en";

const INTL_LOCALES: Record<Locale, string> = {
  en: "en-US",
  "zh-CN": "zh-CN",
  "zh-TW": "zh-TW",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function intlLocaleFor(locale: Locale): string {
  return INTL_LOCALES[locale];
}

/**
 * Resolve one device preference according to the approved product mapping.
 * Unknown values intentionally fall back to English rather than trying to
 * guess based on a language's display name or browser implementation.
 */
export function resolveDeviceLocale(value: unknown): Locale {
  if (typeof value !== "string") return DEFAULT_LOCALE;

  const normalized = value.replace(/_/g, "-").toLowerCase();
  if (normalized === "zh-hans" || normalized.startsWith("zh-hans-") || normalized === "zh-cn" || normalized.startsWith("zh-cn-")) {
    return "zh-CN";
  }
  if (
    normalized === "zh-hant"
    || normalized.startsWith("zh-hant-")
    || normalized === "zh-tw"
    || normalized.startsWith("zh-tw-")
    || normalized === "zh-hk"
    || normalized.startsWith("zh-hk-")
    || normalized === "zh-mo"
    || normalized.startsWith("zh-mo-")
  ) {
    return "zh-TW";
  }
  return DEFAULT_LOCALE;
}

export type DeviceLocaleLike = { languageTag?: unknown } | string | null | undefined;

export function resolveDeviceLocales(locales: readonly DeviceLocaleLike[] | null | undefined): Locale {
  const first = locales?.[0];
  return resolveDeviceLocale(typeof first === "string" ? first : first?.languageTag);
}

export function resolveUiLocale(systemLocale: Locale, preference: Locale | null): Locale {
  return preference ?? systemLocale;
}
