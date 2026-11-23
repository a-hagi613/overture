import { List } from "@radix-ui/react-tabs";
import type { ReactNode } from "react";

import { cn } from "./cn.ts";

export function TabsList({
  ariaLabel,
  children,
  className,
}: {
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <List
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border border-border bg-muted p-1 text-muted-foreground",
        className,
      )}
    >
      {children}
    </List>
  );
}
