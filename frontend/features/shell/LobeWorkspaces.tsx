import { Flexbox } from "@lobehub/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ConversationColumn } from "../../vendor/lobehub/components/ConversationColumn";
import {
  ConversationPanelHeader,
  PanelToggleButton,
} from "../../vendor/lobehub/components/ConversationPanelHeader";
import { DesktopWorkspaceFrame } from "../../vendor/lobehub/components/DesktopWorkspaceFrame";
import { SideBarLayout } from "../../vendor/lobehub/components/SideBarLayout";
import { WorkspacePanel } from "../../vendor/lobehub/components/WorkspacePanel";
import { SidePanelResizeHandle } from "./SidePanelResizeHandle";
import {
  FocusStage,
  OverlayLayer,
  WorkspaceCanvasTabs,
  type MainWorkspacePanelSlot,
  type MainWorkspaceProps,
} from "./Shell";
import {
  calculateSidePanelMaxWidth,
  LEFT_SIDE_PANEL_DEFAULT_WIDTH,
  LEFT_SIDE_PANEL_MAX_WIDTH,
  LEFT_SIDE_PANEL_MIN_WIDTH,
  RIGHT_SIDE_PANEL_DEFAULT_WIDTH,
  RIGHT_SIDE_PANEL_MAX_WIDTH,
  RIGHT_SIDE_PANEL_MIN_WIDTH,
} from "./side-panel-sizing";

type LobeWorkspaceProps = MainWorkspaceProps & {
  surface: "agent" | "group";
};

export function LobeAgentWorkspace(props: MainWorkspaceProps) {
  return <LobeWorkspace {...props} surface="agent" />;
}

export function LobeGroupWorkspace(props: MainWorkspaceProps) {
  return <LobeWorkspace {...props} surface="group" />;
}

function LobeWorkspace({
  canvas,
  focusStage,
  header,
  hidden = false,
  leftPanel,
  overlay,
  rightPanel,
  surface,
}: LobeWorkspaceProps) {
  const [leftPanelWidth, setLeftPanelWidth] = useState(LEFT_SIDE_PANEL_DEFAULT_WIDTH);
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_SIDE_PANEL_DEFAULT_WIDTH);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const leftMax = calculateSidePanelMaxWidth({
    maxValue: LEFT_SIDE_PANEL_MAX_WIDTH,
    minValue: LEFT_SIDE_PANEL_MIN_WIDTH,
    oppositePanelOpen: Boolean(rightPanel?.open),
    oppositePanelWidth: rightPanelWidth,
    workspaceWidth,
  });
  const rightMax = calculateSidePanelMaxWidth({
    maxValue: RIGHT_SIDE_PANEL_MAX_WIDTH,
    minValue: RIGHT_SIDE_PANEL_MIN_WIDTH,
    oppositePanelOpen: Boolean(leftPanel?.open),
    oppositePanelWidth: leftPanelWidth,
    workspaceWidth,
  });
  const currentCanvas = canvas?.contents.filter(
    (entry) => entry.forceMount || entry.value === canvas.value,
  ) ?? [];
  const stage = canvas
    ? currentCanvas.map((entry) => (
      <div
        key={entry.value}
        style={{
          display: entry.value === canvas.value ? "flex" : "none",
          flex: 1,
          minHeight: 0,
          minWidth: 0,
        }}
      >
        {entry.content}
      </div>
    ))
    : focusStage;
  const showHeader = Boolean(header || canvas || leftPanel || rightPanel);

  return (
    <section
      aria-hidden={hidden || undefined}
      ref={(node) => {
        if (!node) return;
        const update = () => setWorkspaceWidth(node.getBoundingClientRect().width);
        update();
        const observer = new ResizeObserver(update);
        observer.observe(node);
        return () => observer.disconnect();
      }}
      style={{
        display: hidden ? "none" : "flex",
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        position: "relative",
      }}
    >
      {leftPanel ? (
        <WorkspacePanel
          maxWidth={leftMax}
          minWidth={LEFT_SIDE_PANEL_MIN_WIDTH}
          open={leftPanel.open}
          placement="left"
          resizeHandle={leftPanel.open ? (
            <SidePanelResizeHandle
              maxValue={leftMax}
              minValue={LEFT_SIDE_PANEL_MIN_WIDTH}
              side="left"
              value={leftPanelWidth}
              onChange={setLeftPanelWidth}
            />
          ) : null}
          width={leftPanelWidth}
          onExpandChange={(open) => open ? leftPanel.onExpand() : leftPanel.onCollapse()}
          onSizeChange={(width) => setLeftPanelWidth(panelWidthFromSize(
            width,
            leftPanelWidth,
            LEFT_SIDE_PANEL_MIN_WIDTH,
            leftMax,
          ))}
        >
          <SideBarLayout
            body={leftPanel.content}
            bodyScrollable={false}
            header={(
              <PanelHeaderAdapter panel={leftPanel} side="left" />
            )}
          />
        </WorkspacePanel>
      ) : null}
      <DesktopWorkspaceFrame flush leftPanelExpanded={Boolean(leftPanel?.open)}>
        <Flexbox horizontal flex={1} style={{ minHeight: 0, minWidth: 0 }}>
          <ConversationColumn
            actions={header?.actions}
            center={(
              <>
                {canvas ? <WorkspaceCanvasTabs slot={canvas} /> : null}
                {header?.center}
              </>
            )}
            leftToggle={leftPanel && !leftPanel.open ? (
              <PanelToggleAdapter panel={leftPanel} side="left" />
            ) : null}
            rightToggle={rightPanel && !rightPanel.open ? (
              <PanelToggleAdapter panel={rightPanel} side="right" />
            ) : null}
            showHeader={showHeader}
            subtitle={header?.subtitle}
            surface={surface}
            title={header?.title}
          >
            <FocusStage>{stage}</FocusStage>
          </ConversationColumn>
          {rightPanel ? (
            <WorkspacePanel
              maxWidth={rightMax}
              minWidth={RIGHT_SIDE_PANEL_MIN_WIDTH}
              open={rightPanel.open}
              placement="right"
              resizeHandle={rightPanel.open ? (
                <SidePanelResizeHandle
                  maxValue={rightMax}
                  minValue={RIGHT_SIDE_PANEL_MIN_WIDTH}
                  side="right"
                  value={rightPanelWidth}
                  onChange={setRightPanelWidth}
                />
              ) : null}
              width={rightPanelWidth}
              onExpandChange={(open) => open ? rightPanel.onExpand() : rightPanel.onCollapse()}
              onSizeChange={(width) => setRightPanelWidth(panelWidthFromSize(
                width,
                rightPanelWidth,
                RIGHT_SIDE_PANEL_MIN_WIDTH,
                rightMax,
              ))}
            >
              <SideBarLayout
                body={rightPanel.content}
                bodyScrollable={false}
                header={(
                  <PanelHeaderAdapter panel={rightPanel} side="right" />
                )}
              />
            </WorkspacePanel>
          ) : null}
        </Flexbox>
      </DesktopWorkspaceFrame>
      <OverlayLayer open={overlay.open} onOpenChange={overlay.onOpenChange}>
        {overlay.content}
      </OverlayLayer>
    </section>
  );
}

function PanelHeaderAdapter({
  panel,
  side,
}: {
  panel: MainWorkspacePanelSlot;
  side: "left" | "right";
}) {
  const { t } = useTranslation();
  const tabs = panel.tabs;
  return (
    <ConversationPanelHeader
      actions={tabs?.actions}
      ariaLabel={tabs?.ariaLabel}
      items={tabs?.items}
      onToggle={panel.open ? panel.onCollapse : panel.onExpand}
      onValueChange={tabs?.onValueChange}
      side={side}
      toggleLabel={panelToggleLabel(panel, side, t)}
      value={tabs?.value}
    />
  );
}

function PanelToggleAdapter({
  panel,
  side,
}: {
  panel: MainWorkspacePanelSlot;
  side: "left" | "right";
}) {
  const { t } = useTranslation();
  return (
    <PanelToggleButton
      label={panelToggleLabel(panel, side, t)}
      onClick={panel.open ? panel.onCollapse : panel.onExpand}
      side={side}
    />
  );
}

function panelToggleLabel(
  panel: MainWorkspacePanelSlot,
  side: "left" | "right",
  t: (key: string) => string,
) {
  return side === "left"
    ? panel.open ? t("shell.collapseLeftSidePanel") : t("shell.expandLeftSidePanel")
    : panel.open ? t("shell.collapseSidePanel") : t("shell.expandSidePanel");
}

function panelWidthFromSize(
  value: number | string | undefined,
  fallback: number,
  minValue: number,
  maxValue: number,
): number {
  const numeric = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(numeric, minValue), maxValue);
}
