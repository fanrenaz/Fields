import { Flexbox, TooltipGroup } from "@lobehub/ui";
import type { CSSProperties, ReactNode } from "react";

export type NavHeaderProps = {
  center?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  slotClassNames?: {
    center?: string;
    left?: string;
    right?: string;
  };
  styles?: {
    center?: CSSProperties;
    left?: CSSProperties;
    right?: CSSProperties;
  };
};

export function NavHeader({
  center,
  left,
  right,
  slotClassNames,
  styles,
}: NavHeaderProps) {
  return (
    <Flexbox
      allowShrink
      horizontal
      align="center"
      flex="none"
      gap={4}
      height={44}
      justify="space-between"
      padding={8}
    >
      <TooltipGroup>
        <Flexbox
          allowShrink
          horizontal
          align="center"
          className={slotClassNames?.left}
          gap={2}
          justify="flex-start"
          style={styles?.left}
        >
          {left}
        </Flexbox>
        {center ? (
          <Flexbox className={slotClassNames?.center} flex={1} style={styles?.center}>
            {center}
          </Flexbox>
        ) : null}
        <Flexbox
          horizontal
          align="center"
          className={slotClassNames?.right}
          gap={2}
          justify="flex-end"
          style={styles?.right}
        >
          {right}
        </Flexbox>
      </TooltipGroup>
    </Flexbox>
  );
}
