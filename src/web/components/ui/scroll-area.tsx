import { Corner, Root, Scrollbar, Thumb, Viewport } from "@radix-ui/react-scroll-area";
import type { ReactNode } from "react";

import { cn } from "./cn.ts";

export function ScrollArea({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Root className={cn("relative overflow-hidden", className)}>
      <Viewport className="h-full w-full rounded-[inherit]">{children}</Viewport>
      <Scrollbar
        className="flex touch-none select-none p-0.5 transition-colors data-[orientation=horizontal]:h-2 data-[orientation=horizontal]:flex-col data-[orientation=vertical]:h-full data-[orientation=vertical]:w-2"
        orientation="vertical"
      >
        <Thumb className="relative flex-1 rounded-full bg-border" />
      </Scrollbar>
      <Corner />
    </Root>
  );
}
