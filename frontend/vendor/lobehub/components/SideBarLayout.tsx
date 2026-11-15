import { Flexbox, ScrollShadow, TooltipGroup } from "@lobehub/ui";
import type { ReactNode } from "react";
import { Suspense } from "react";

export function SideBarLayout({
  body,
  bodyScrollable = true,
  header,
}: {
  body?: ReactNode;
  bodyScrollable?: boolean;
  header?: ReactNode;
}) {
  const content = (
    <TooltipGroup>
      <Suspense fallback={null}>{body}</Suspense>
    </TooltipGroup>
  );

  return (
    <Flexbox gap={1} style={{ height: "100%", minHeight: 0, overflow: "hidden" }}>
      <Suspense fallback={null}>{header}</Suspense>
      {bodyScrollable ? (
        <ScrollShadow size={2} style={{ height: "100%", minHeight: 0 }}>
          {content}
        </ScrollShadow>
      ) : (
        <Flexbox flex={1} style={{ minHeight: 0, overflow: "hidden" }}>
          {content}
        </Flexbox>
      )}
    </Flexbox>
  );
}
