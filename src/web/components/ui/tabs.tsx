import { Root } from "@radix-ui/react-tabs";
import type { ReactNode } from "react";

import { cn } from "./cn.ts";

export function Tabs({
  children,
  className,
  onValueChange,
  value,
}: {
  children: ReactNode;
  className?: string;
  onValueChange: (value: string) => void;
  value: string;
}) {
  return (
    <Root
      className={cn("flex flex-col gap-2", className)}
      onValueChange={onValueChange}
      value={value}
    >
      {children}
    </Root>
  );
}
