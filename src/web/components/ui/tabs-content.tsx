import { Content } from "@radix-ui/react-tabs";
import type { ReactNode } from "react";

export function TabsPanel({
  children,
  className,
  value,
}: {
  children: ReactNode;
  className?: string;
  value: string;
}) {
  return (
    <Content className={className} value={value}>
      {children}
    </Content>
  );
}
