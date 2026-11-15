export type SidePanelSide = "left" | "right";

export const LEFT_SIDE_PANEL_DEFAULT_WIDTH = 320;
export const LEFT_SIDE_PANEL_MIN_WIDTH = 240;
export const LEFT_SIDE_PANEL_MAX_WIDTH = 480;

export const RIGHT_SIDE_PANEL_DEFAULT_WIDTH = 360;
export const RIGHT_SIDE_PANEL_MIN_WIDTH = 320;
export const RIGHT_SIDE_PANEL_MAX_WIDTH = 720;

export const SIDE_PANEL_CENTER_MIN_WIDTH = 480;

export function clampSidePanelWidth({
  value,
  minValue,
  maxValue,
}: {
  value: number;
  minValue: number;
  maxValue: number;
}): number {
  return Math.min(Math.max(value, minValue), maxValue);
}

export function calculateSidePanelMaxWidth({
  workspaceWidth,
  oppositePanelOpen,
  oppositePanelWidth,
  minValue,
  maxValue,
  centerMinWidth = SIDE_PANEL_CENTER_MIN_WIDTH,
}: {
  workspaceWidth: number;
  oppositePanelOpen: boolean;
  oppositePanelWidth: number;
  minValue: number;
  maxValue: number;
  centerMinWidth?: number;
}): number {
  if (workspaceWidth <= 0) return maxValue;

  const availableWidth = workspaceWidth
    - centerMinWidth
    - (oppositePanelOpen ? oppositePanelWidth : 0);
  return clampSidePanelWidth({ value: availableWidth, minValue, maxValue });
}
