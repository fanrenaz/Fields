import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { translation as en } from "./resources/en";
import { translation as zhCN } from "./resources/zh-CN";
import { translation as zhTW } from "./resources/zh-TW";

void i18n
  .use(initReactI18next)
  .init({
    compatibilityJSON: "v4",
    resources: {
      en: { translation: en },
      "zh-CN": { translation: zhCN },
      "zh-TW": { translation: zhTW },
    },
    lng: "en",
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });

export { i18n };
