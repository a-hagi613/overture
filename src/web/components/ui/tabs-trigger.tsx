import { Trigger } from "@radix-ui/react-tabs";
import type { ReactNode } from "react";

import { cn } from "./cn.ts";

export function TabsTrigger({
  children,
  className,
  disabled,
  value,
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  value: string;
}) {
  return (
    <Trigger
      className={cn(
        "inline-flex min-h-8 max-md:min-h-11 max-md:min-w-11 cursor-pointer items-center justify-center rounded-md px-3 text-xs font-semibold text-muted-foreground transition duration-quick ease-out hover:bg-card/60 hover:text-foreground data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sh disabled:pointer-events-none disabled:opacity-45",
        className,
      )}
      disabled={disabled}
      value={value}
    >
      {children}
    </Trigger>
  );
}
