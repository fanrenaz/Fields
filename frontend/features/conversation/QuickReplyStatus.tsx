import { LoadingDots } from "@lobehub/ui/chat";
import { createStaticStyles, cssVar } from "antd-style";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { nextQuickReplyIndex, QUICK_REPLY_KEYS } from "./quick-reply";

const ROTATION_INTERVAL_MS = 2_200;

const styles = createStaticStyles(({ css }) => ({
  label: css`
    color: ${cssVar.colorTextSecondary};
    background: linear-gradient(
      100deg,
      ${cssVar.colorTextSecondary} 15%,
      ${cssVar.colorText} 45%,
      ${cssVar.colorTextSecondary} 75%
    );
    background-size: 220% 100%;
    background-clip: text;

    font-size: 13px;

    -webkit-text-fill-color: transparent;

    animation: fields-quick-reply-shimmer 2.4s ease-in-out infinite;

    @keyframes fields-quick-reply-shimmer {
      0%,
      100% {
        background-position: 100% 50%;
      }

      50% {
        background-position: 0 50%;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      color: ${cssVar.colorTextSecondary};
      background: none;
      -webkit-text-fill-color: currentcolor;
      animation: none;
    }
  `,
  root: css`
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 24px;
  `,
}));

export function QuickReplyStatus() {
  const { t } = useTranslation();
  const [index, setIndex] = useState(() => nextQuickReplyIndex(-1, QUICK_REPLY_KEYS.length));

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIndex((current) => nextQuickReplyIndex(current, QUICK_REPLY_KEYS.length));
    }, ROTATION_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <span aria-live="polite" aria-atomic className={styles.root} role="status">
      <LoadingDots variant="typing" />
      <span className={styles.label}>{t(QUICK_REPLY_KEYS[index]!)}</span>
    </span>
  );
}
