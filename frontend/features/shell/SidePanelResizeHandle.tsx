import { useTranslation } from "react-i18next";

import {
  clampSidePanelWidth,
  type SidePanelSide,
} from "./side-panel-sizing";

export type SidePanelResizeHandleProps = {
  side: SidePanelSide;
  value: number;
  minValue: number;
  maxValue: number;
  onChange: (value: number) => void;
};

const ACCESSIBILITY_STEP = 16;

export function SidePanelResizeHandle({ side, value, minValue, maxValue, onChange }: SidePanelResizeHandleProps) {
  const { t } = useTranslation();

  return (
    <div
      aria-label={side === "left" ? t("shell.leftPanelWidth") : t("shell.rightPanelWidth")}
      aria-orientation="vertical"
      aria-valuemax={maxValue}
      aria-valuemin={minValue}
      aria-valuenow={value}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const sideDirection = side === "left" ? direction : -direction;
        onChange(clampSidePanelWidth({
          value: value + (sideDirection * ACCESSIBILITY_STEP),
          minValue,
          maxValue,
        }));
      }}
      role="separator"
      style={{
        bottom: 0,
        left: side === "right" ? -1 : undefined,
        outlineOffset: -2,
        pointerEvents: "none",
        position: "absolute",
        right: side === "left" ? -1 : undefined,
        top: 0,
        width: 2,
        zIndex: 20,
      }}
      tabIndex={0}
    />
  );
}
