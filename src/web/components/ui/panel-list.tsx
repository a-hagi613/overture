import type { ReactNode } from "react";

import { cn } from "./cn.ts";

/**
 * Shared hairline-divided row container for lists inside workspace panels.
 * @param props List container props.
 * @param props.children List row nodes.
 * @param props.className Optional extra classes.
 * @returns Divided row list wrapper.
 */
export function PanelList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string | undefined;
}) {
  return <div className={cn("divide-y divide-border px-4 sm:px-5", className)}>{children}</div>;
}
