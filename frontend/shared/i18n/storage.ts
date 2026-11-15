import { isLocale, type Locale } from "./locale";

export const UI_LOCALE_STORAGE_KEY = "fields.ui-locale.v1";

export type BrowserStoragePort = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export function createLocaleStorage(storage: BrowserStoragePort) {
  return {
    async read(): Promise<Locale | null> {
      try {
        const stored = await storage.getItem(UI_LOCALE_STORAGE_KEY);
        return isLocale(stored) ? stored : null;
      } catch {
        return null;
      }
    },
    async write(locale: Locale | null): Promise<void> {
      try {
        if (locale === null) {
          await storage.removeItem(UI_LOCALE_STORAGE_KEY);
        } else {
          await storage.setItem(UI_LOCALE_STORAGE_KEY, locale);
        }
      } catch {
        // Locale preference is a convenience. Storage unavailability must not
        // prevent a person from entering or using the product.
      }
    },
  };
}

export function createBrowserAsyncStorage(storage: Storage | undefined = typeof window === "undefined" ? undefined : window.localStorage): BrowserStoragePort {
  return {
    async getItem(key) {
      try {
        return storage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    async setItem(key, value) {
      try {
        storage?.setItem(key, value);
      } catch {
        // Browser storage failures must not prevent locale selection.
      }
    },
    async removeItem(key) {
      try {
        storage?.removeItem(key);
      } catch {
        // Browser storage failures must not prevent locale selection.
      }
    },
  };
}

export const localeStorage = createLocaleStorage(createBrowserAsyncStorage());
