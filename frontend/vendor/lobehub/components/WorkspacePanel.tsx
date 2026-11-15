import { DraggablePanel } from "@lobehub/ui";
import { createStaticStyles, cssVar } from "antd-style";
import type { ReactNode } from "react";

const styles = createStaticStyles(({ css }) => ({
  content: css`
    position: relative;

    overflow: hidden;
    display: flex;
    flex-direction: column;

    height: 100%;
    min-height: 100%;
    max-height: 100%;
  `,
  inner: css`
    position: relative;

    overflow: hidden;
    flex: 1;

    width: 100%;
    min-height: 0;
  `,
  left: css`
    height: 100%;
    color: ${cssVar.colorTextSecondary};
    background: ${cssVar.colorBgLayout};
  `,
  right: css`
    height: 100%;
    border-inline-start: 1px solid ${cssVar.colorBorderSecondary};
    background: ${cssVar.colorBgContainer};
  `,
}));

export function WorkspacePanel({
  children,
  maxWidth,
  minWidth,
  onExpandChange,
  onSizeChange,
  open,
  placement,
  resizeHandle,
  width,
}: {
  children: ReactNode;
  maxWidth: number;
  minWidth: number;
  onExpandChange: (open: boolean) => void;
  onSizeChange: (width: number | string | undefined) => void;
  open: boolean;
  placement: "left" | "right";
  resizeHandle?: ReactNode;
  width: number;
}) {
  return (
    <DraggablePanel
      backgroundColor={placement === "left" ? cssVar.colorBgLayout : cssVar.colorBgContainer}
      className={placement === "left" ? styles.left : styles.right}
      classNames={{ content: styles.content }}
      expand={open}
      maxWidth={maxWidth}
      minWidth={minWidth}
      placement={placement}
      showBorder={false}
      size={{ height: "100%", width }}
      stableLayout
      style={{ height: "100%" }}
      onExpandChange={onExpandChange}
      onSizeChange={(_, size) => onSizeChange(size?.width)}
    >
      <div className={styles.inner}>
        {children}
        {resizeHandle}
      </div>
    </DraggablePanel>
  );
}
