import type { ReactNode } from "react";

import { Card } from "./card.tsx";
import { cn } from "./cn.ts";
import { dsCardTitle } from "./ds.ts";

/**
 * Compact horizontal banner/strip built on `Card` for system alerts, profile prompts, and status notices.
 * @param props Strip configuration and slots.
 * @param props.action Right-aligned action button or link.
 * @param props.ariaLabelledBy Accessible heading id reference.
 * @param props.className Optional extra classes.
 * @param props.dataTestId Optional test id attribute.
 * @param props.description Supporting line placed beside or under the title.
 * @param props.title Primary concise message.
 * @param props.titleId Optional heading element id.
 * @returns Compact single-row horizontal status strip.
 */
export function StatusStrip({
  action,
  ariaLabelledBy,
  className,
  dataTestId,
  description,
  title,
  titleId,
}: {
  action?: ReactNode | undefined;
  ariaLabelledBy?: string | undefined;
  className?: string | undefined;
  dataTestId?: string | undefined;
  description?: ReactNode | undefined;
  title: ReactNode;
  titleId?: string | undefined;
}) {
  return (
    <Card
      ariaLabelledBy={ariaLabelledBy}
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 px-4 py-3 sm:px-5",
        className,
      )}
      dataTestId={dataTestId}
    >
      <div className="min-w-0 flex-1">
        <h2 className={dsCardTitle} id={titleId}>
          {title}
        </h2>
        {description === undefined ? null : (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {action === undefined ? null : <div className="shrink-0">{action}</div>}
    </Card>
  );
}
