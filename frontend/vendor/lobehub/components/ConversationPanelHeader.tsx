import { Flexbox } from "@lobehub/ui";
import { Button, Tooltip } from "@lobehub/ui/base-ui";
import { cssVar } from "antd-style";
import { PanelLeft, PanelRight } from "lucide-react";
import type { ReactNode } from "react";

export type ConversationPanelTab = {
  disabled?: boolean;
  label: ReactNode;
  value: string;
};

export function ConversationPanelHeader({
  actions,
  ariaLabel,
  items,
  onToggle,
  onValueChange,
  side,
  toggleLabel,
  value,
}: {
  actions?: ReactNode;
  ariaLabel?: string;
  items?: ConversationPanelTab[];
  onToggle: () => void;
  onValueChange?: (value: string) => void;
  side: "left" | "right";
  toggleLabel: string;
  value?: string;
}) {
  return (
    <Flexbox
      horizontal
      align="center"
      gap={4}
      height={44}
      paddingInline={8}
      style={{ borderBottom: `1px solid ${cssVar.colorBorderSecondary}` }}
    >
      {items && items.length > 0 ? (
        <div
          aria-label={ariaLabel}
          role="tablist"
          style={{ alignItems: "center", display: "flex", flex: 1, gap: 2, minWidth: 0 }}
        >
          {items.map((item) => (
            <Button
              aria-selected={value === item.value}
              disabled={item.disabled}
              key={item.value}
              onClick={() => onValueChange?.(item.value)}
              role="tab"
              size="small"
              type={value === item.value ? "fill" : "text"}
            >
              {item.label}
            </Button>
          ))}
        </div>
      ) : <span style={{ flex: 1 }} />}
      {actions ? (
        <Flexbox horizontal align="center" gap={4}>
          {actions}
        </Flexbox>
      ) : null}
      <PanelToggleButton
        label={toggleLabel}
        side={side}
        onClick={onToggle}
      />
    </Flexbox>
  );
}

export function PanelToggleButton({
  label,
  onClick,
  side,
}: {
  label: string;
  onClick: () => void;
  side: "left" | "right";
}) {
  return (
    <Tooltip title={label}>
      <Button
        aria-label={label}
        icon={side === "left" ? <PanelLeft size={18} /> : <PanelRight size={18} />}
        onClick={onClick}
        shape="circle"
        size="small"
        type="text"
      />
    </Tooltip>
  );
}
