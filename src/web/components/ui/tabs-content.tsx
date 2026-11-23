import { Content } from "@radix-ui/react-tabs";
import type { ReactNode } from "react";

import { cn } from "./cn.ts";

export function TabsContent({
  children,
  className,
  value,
}: {
  children: ReactNode;
  className?: string;
  value: string;
}) {
  return (
    <Content className={cn("outline-none", className)} value={value}>
      {children}
    </Content>
  );
}
