import type { ReactNode } from "react";

import { cn } from "./cn.ts";

/**
 * Quiet inline empty state inside a workspace panel without nested dashed cards.
 * @param props Empty state props.
 * @param props.action Optional CTA button or link.
 * @param props.className Optional extra classes.
 * @param props.description Optional helper copy below the title.
 * @param props.title Primary empty-state message.
 * @returns Centered panel empty state.
 */
export function PanelEmpty({
  action,
  className,
  description,
  title,
}: {
  action?: ReactNode | undefined;
  className?: string | undefined;
  description?: ReactNode | undefined;
  title: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center justify-center px-5 py-8 text-center",
        className,
      )}
    >
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description === undefined ? null : (
        <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">{description}</p>
      )}
      {action === undefined ? null : <div className="mt-3">{action}</div>}
    </div>
  );
}
