import { createStaticStyles, cx } from "antd-style";
import type { CSSProperties, ReactNode } from "react";

const styles = createStaticStyles(({ css }) => ({
  compact: css`
    width: 100%;
    max-width: 960px;
  `,
  main: css`
    width: clamp(960px, 72cqi, 1440px);
    max-width: 100%;
  `,
  rail: css`
    min-width: 0;
    margin-inline: auto;
  `,
}));

export type ChatContentWidth = "compact" | "main";

export function ChatContentRail({
  children,
  contentWidth = "compact",
  style,
}: {
  children: ReactNode;
  contentWidth?: ChatContentWidth;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cx(styles.rail, contentWidth === "main" ? styles.main : styles.compact)}
      style={style}
    >
      {children}
    </div>
  );
}
