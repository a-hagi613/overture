import type { ReactNode } from "react";

import { Card } from "./card.tsx";
import { cn } from "./cn.ts";
import { dsEyebrow, dsMetric, dsMono } from "./ds.ts";

export interface MetricStripItem {
  badge?: ReactNode | undefined;
  detail?: ReactNode | undefined;
  id: string;
  label: string;
  progress?: number | undefined;
  subcontent?: ReactNode | undefined;
  unit?: string | undefined;
  value: ReactNode;
}

/**
 * Hairline-divided horizontal metric strip built on `Card` for top-of-workspace operational KPIs.
 * @param props Metric strip configuration and items.
 * @param props.ariaLabel Accessible region label for the metric strip.
 * @param props.className Optional extra wrapper classes.
 * @param props.items Ordered metric cells to render across the strip.
 * @returns Responsive metric strip card.
 */
export function MetricStrip({
  ariaLabel,
  className,
  items,
}: {
  ariaLabel?: string | undefined;
  className?: string | undefined;
  items: readonly MetricStripItem[];
}) {
  return (
    <Card
      ariaLabel={ariaLabel}
      className={cn(
        "grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0",
        className,
      )}
      variant="default"
    >
      {items.map((item) => {
        let topMeta: ReactNode = null;

        if (item.badge !== undefined && item.badge !== null) {
          topMeta = <div className="shrink-0">{item.badge}</div>;
        } else if (item.detail !== undefined && item.detail !== null) {
          topMeta = <span className={`${dsMono} truncate`}>{item.detail}</span>;
        }

        return (
          <div className="min-w-0 px-4 py-2.5 sm:px-5 sm:py-3" key={item.id}>
            <div className="flex items-center justify-between gap-2">
              <p className={`${dsEyebrow} truncate`}>{item.label}</p>
              {topMeta}
            </div>
            <div className="mt-1.5 flex items-center gap-3">
              <div className="flex shrink-0 items-baseline gap-1.5">
                <p className={dsMetric}>{item.value}</p>
                {item.unit === undefined ? null : (
                  <span className="text-xs text-muted-foreground">{item.unit}</span>
                )}
              </div>
              {item.progress === undefined ? null : (
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-ok transition-all"
                    style={{ width: `${String(item.progress)}%` }}
                  />
                </div>
              )}
            </div>
            {item.subcontent ?? null}
          </div>
        );
      })}
    </Card>
  );
}
