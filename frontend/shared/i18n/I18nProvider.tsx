import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { I18nextProvider } from "react-i18next";

import { setDocumentLocale } from "./html-language";
import { i18n } from "./i18n";
import { resolveDeviceLocales, resolveUiLocale, type Locale } from "./locale";
import { localeStorage } from "./storage";

type UiLocaleContextValue = {
  locale: Locale;
  preference: Locale | null;
  setLocale: (locale: Locale | null) => void;
};

const UiLocaleContext = createContext<UiLocaleContextValue | null>(null);

function systemLocale(): Locale {
  try {
    return resolveDeviceLocales(typeof navigator === "undefined" ? [] : navigator.languages);
  } catch {
    return "en";
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [locale, setCurrentLocale] = useState<Locale>("en");
  const [preference, setPreference] = useState<Locale | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const storedPreference = await localeStorage.read();
      const resolvedLocale = resolveUiLocale(systemLocale(), storedPreference);
      await i18n.changeLanguage(resolvedLocale);
      if (!active) return;
      setPreference(storedPreference);
      setCurrentLocale(resolvedLocale);
      setDocumentLocale(resolvedLocale);
      setReady(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  const setLocale = useCallback((nextPreference: Locale | null) => {
    const nextLocale = resolveUiLocale(systemLocale(), nextPreference);
    setPreference(nextPreference);
    setCurrentLocale(nextLocale);
    setDocumentLocale(nextLocale);
    void i18n.changeLanguage(nextLocale);
    void localeStorage.write(nextPreference);
  }, []);

  const value = useMemo<UiLocaleContextValue>(() => ({ locale, preference, setLocale }), [locale, preference, setLocale]);

  if (!ready) return null;

  return (
    <I18nextProvider i18n={i18n}>
      <UiLocaleContext.Provider value={value}>{children}</UiLocaleContext.Provider>
    </I18nextProvider>
  );
}

export function useUiLocale(): UiLocaleContextValue {
  const value = useContext(UiLocaleContext);
  if (!value) throw new Error("useUiLocale must be used inside I18nProvider");
  return value;
}
