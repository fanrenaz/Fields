import { useTranslation } from "react-i18next";
import { Flexbox, Text } from "@lobehub/ui";
import { Button, DropdownMenu, RadioGroup, type DropdownItem } from "@lobehub/ui/base-ui";
import { Check, ChevronDown, Globe2 } from "lucide-react";

import { SUPPORTED_LOCALES, type Locale } from "./locale";
import { useUiLocale } from "./I18nProvider";

const languageNameKey: Record<Locale, "language.english" | "language.simplifiedChinese" | "language.traditionalChinese"> = {
  en: "language.english",
  "zh-CN": "language.simplifiedChinese",
  "zh-TW": "language.traditionalChinese",
};

export function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const { locale, preference, setLocale } = useUiLocale();

  if (compact) {
    const items: DropdownItem[] = [
      {
        extra: preference === null ? <Check aria-hidden size={14} /> : null,
        key: "system",
        label: t("language.followSystem"),
        onClick: () => setLocale(null),
      },
      ...SUPPORTED_LOCALES.map((candidate) => ({
        extra: preference === candidate ? <Check aria-hidden size={14} /> : null,
        key: candidate,
        label: t(languageNameKey[candidate]),
        onClick: () => setLocale(candidate),
      })),
    ];

    return (
      <section aria-label={t("language.label")}>
        <DropdownMenu items={items} nativeButton placement="bottomRight" trigger="click">
          <Button
            aria-label={t("language.label")}
            icon={<Globe2 aria-hidden size={15} />}
            size="small"
            style={{ color: "var(--ant-color-text-secondary)", gap: 6, paddingInline: 8 }}
            type="text"
          >
            <span>{t(languageNameKey[locale])}</span>
            <ChevronDown aria-hidden size={13} />
          </Button>
        </DropdownMenu>
      </section>
    );
  }

  return (
    <section aria-label={t("language.label")}>
      <Text strong>
        {t("language.label")}
      </Text>
      <Flexbox style={{ marginTop: 12 }}>
        <RadioGroup
          aria-label={t("language.label")}
          onChange={(value) => setLocale((value || null) as Locale | null)}
          options={[
            { label: t("language.followSystem"), value: "" },
            ...SUPPORTED_LOCALES.map((candidate) => ({ label: t(languageNameKey[candidate]), value: candidate })),
          ]}
          value={preference ?? ""}
        />
      </Flexbox>
    </section>
  );
}
