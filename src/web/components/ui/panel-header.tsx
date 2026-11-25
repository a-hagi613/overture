import type { ReactNode } from "react";

import { cn } from "./cn.ts";
import { dsCardTitle } from "./ds.ts";

/**
 * Shared panel header bar with left-aligned optional icon, title/subtitle/badge and right-aligned action slot.
 * @param props Header layout props.
 * @param props.action Optional right-aligned action or controls slot.
 * @param props.badge Optional inline badge placed beside the title.
 * @param props.className Optional additional classes.
 * @param props.icon Optional small leading icon placed beside the title.
 * @param props.subtitle Optional single-line muted subtitle.
 * @param props.title Panel heading text or node.
 * @param props.titleId Accessible id for the heading element.
 * @returns The panel header bar.
 */
export function PanelHeader({
  action,
  badge,
  className,
  icon,
  subtitle,
  title,
  titleId,
}: {
  action?: ReactNode | undefined;
  badge?: ReactNode | undefined;
  className?: string | undefined;
  icon?: ReactNode | undefined;
  subtitle?: ReactNode | undefined;
  title: ReactNode;
  titleId?: string | undefined;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {icon === undefined ? null : (
            <span className="shrink-0 text-muted-foreground">{icon}</span>
          )}
          <h2 className={dsCardTitle} id={titleId}>
            {title}
          </h2>
          {badge}
        </div>
        {subtitle === undefined ? null : (
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {action === undefined ? null : (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>
      )}
    </div>
  );
}
