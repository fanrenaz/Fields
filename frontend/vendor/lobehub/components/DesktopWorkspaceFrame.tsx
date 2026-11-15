import { Flexbox } from "@lobehub/ui";
import { createStaticStyles, cssVar } from "antd-style";
import type { CSSProperties, ReactNode } from "react";

const styles = createStaticStyles(({ css }) => ({
  inner: css`
    position: relative;

    overflow: hidden;

    border: var(--workspace-frame-border, 1px solid ${cssVar.colorBorder});
    border-radius: var(--workspace-frame-radius, ${cssVar.borderRadius});

    background: ${cssVar.colorBgContainer};
  `,
  outer: css`
    position: relative;

    overflow: hidden;

    padding-block: var(--workspace-frame-padding-block, 8px);
    padding-inline-end: var(--workspace-frame-padding-right, 8px);
    padding-inline-start: var(--workspace-frame-padding-left, 8px);

    background: ${cssVar.colorBgLayout};
  `,
}));

export function DesktopWorkspaceFrame({
  children,
  flush = false,
  leftPanelExpanded,
}: {
  children: ReactNode;
  flush?: boolean;
  leftPanelExpanded: boolean;
}) {
  const variables = {
    "--workspace-frame-border": flush ? "0" : "1px solid var(--ant-color-border-secondary)",
    "--workspace-frame-radius": flush ? "0px" : cssVar.borderRadius,
    "--workspace-frame-padding-block": flush ? "0px" : "8px",
    "--workspace-frame-padding-left": flush || leftPanelExpanded ? "0px" : "8px",
    "--workspace-frame-padding-right": flush ? "0px" : "8px",
  } as CSSProperties;

  return (
    <Flexbox
      className={styles.outer}
      flex={1}
      height="100%"
      style={variables}
      width="100%"
    >
      <Flexbox className={styles.inner} flex={1} height="100%" width="100%">
        {children}
      </Flexbox>
    </Flexbox>
  );
}
