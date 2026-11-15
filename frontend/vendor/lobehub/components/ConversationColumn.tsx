import { Flexbox } from "@lobehub/ui";
import { createStaticStyles, cssVar, cx } from "antd-style";
import type { ReactNode } from "react";

import { NavHeader } from "./NavHeader";

const FLOATING_HEADER_QUERY = "@container fields-agent-chat-layout (min-width: 1200px)";

const styles = createStaticStyles(({ css }) => ({
  agentColumn: css`
    position: relative;

    container-name: fields-agent-chat-layout;
    container-type: inline-size;
  `,
  agentHeader: css`
    position: relative;

    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};

    ${FLOATING_HEADER_QUERY} {
      pointer-events: none;

      position: absolute;
      z-index: 10;
      inset-block-start: 0;
      inset-inline: 0;

      border-block-end: none;

      background: transparent;
    }
  `,
  agentHeaderLeft: css`
    overflow: hidden;
    flex: 1 1 auto;
    min-width: 0;
    background: ${cssVar.colorBgContainer};

    ${FLOATING_HEADER_QUERY} {
      pointer-events: auto;

      overflow: visible;
      flex-grow: 0;

      border-radius: ${cssVar.borderRadius};
      box-shadow: ${cssVar.boxShadowTertiary};
    }
  `,
  agentHeaderRight: css`
    flex: 0 0 auto;
    min-width: 0;
    background: ${cssVar.colorBgContainer};

    ${FLOATING_HEADER_QUERY} {
      pointer-events: auto;

      border-radius: ${cssVar.borderRadius};
      box-shadow: ${cssVar.boxShadowTertiary};
    }
  `,
  agentStage: css`
    ${FLOATING_HEADER_QUERY} {
      padding-block-start: 44px;
    }
  `,
  conversationStage: css`
    container-name: fields-main-conversation;
    container-type: inline-size;
  `,
  groupHeader: css`
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    background: ${cssVar.colorBgContainer};
  `,
}));

export function ConversationColumn({
  actions,
  center,
  children,
  leftToggle,
  rightToggle,
  showHeader,
  subtitle,
  surface,
  title,
}: {
  actions?: ReactNode;
  center?: ReactNode;
  children: ReactNode;
  leftToggle?: ReactNode;
  rightToggle?: ReactNode;
  showHeader: boolean;
  subtitle?: string | null;
  surface: "agent" | "group";
  title?: string | null;
}) {
  const header = showHeader ? (
    <NavHeader
      center={center}
      left={(
        <>
          {leftToggle}
          <WorkspaceTitle title={title} subtitle={subtitle} />
        </>
      )}
      right={(
        <>
          {actions}
          {rightToggle}
        </>
      )}
      slotClassNames={surface === "agent" ? {
        left: styles.agentHeaderLeft,
        right: styles.agentHeaderRight,
      } : undefined}
      styles={{
        center: { alignItems: "center", minWidth: 0 },
        left: { flex: "1 1 auto", minWidth: 0 },
        right: { flex: "0 0 auto", minWidth: 0 },
      }}
    />
  ) : null;

  return (
    <Flexbox
      className={surface === "agent" ? styles.agentColumn : undefined}
      flex={1}
      style={{ minHeight: 0, minWidth: 0 }}
    >
      {header ? (
        <div className={surface === "agent" ? styles.agentHeader : styles.groupHeader}>
          {header}
        </div>
      ) : null}
      <div
        className={cx(
          styles.conversationStage,
          surface === "agent" ? styles.agentStage : undefined,
        )}
        style={{ display: "flex", flex: 1, minHeight: 0, minWidth: 0 }}
      >
        {children}
      </div>
    </Flexbox>
  );
}

function WorkspaceTitle({
  subtitle,
  title,
}: {
  subtitle?: string | null;
  title?: string | null;
}) {
  if (!title && !subtitle) return null;
  return (
    <div style={{ minWidth: 0 }}>
      {title ? (
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            lineHeight: "18px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </div>
      ) : null}
      {subtitle ? (
        <div
          style={{
            color: cssVar.colorTextSecondary,
            fontSize: 11,
            lineHeight: "14px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}
