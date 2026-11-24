import { Content, Portal, Root, Trigger } from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export function TooltipHint({
  children,
  label,
  side = "right",
}: {
  children: ReactNode;
  label: string;
  side?: "bottom" | "left" | "right" | "top";
}) {
  return (
    <Root>
      <Trigger asChild>{children}</Trigger>
      <Portal>
        <Content
          className="z-50 rounded-md border border-input bg-card px-2.5 py-1 text-xs font-medium text-foreground shadow-sh"
          side={side}
          sideOffset={8}
        >
          {label}
        </Content>
      </Portal>
    </Root>
  );
}
