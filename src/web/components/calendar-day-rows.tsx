import { Link } from "react-router";

import type { CalendarItem } from "../lib/calendar-api.ts";

import { detailOf, timeOf } from "../lib/calendar-format.ts";
import { chipKindOf } from "../lib/calendar-grid.ts";
import { CalendarChip } from "./calendar-chip.tsx";

export function CalendarDayRows({ items, zone }: { items: readonly CalendarItem[]; zone: string }) {
  return (
    <ul className="mt-3">
      {items.map((entry) => (
        <li key={entry.id}>
          <Link
            className="grid grid-cols-[48px_minmax(0,1fr)] items-start gap-3 border-t border-border py-3 hover:bg-muted"
            to={`/board?application=${encodeURIComponent(entry.applicationId)}`}
          >
            <span className="pt-[3px] font-mono text-xs text-muted-foreground">
              {timeOf(entry.at, zone)}
            </span>
            <span className="min-w-0">
              <CalendarChip kind={chipKindOf(entry)} />
              <span className="mt-[5px] block break-words text-[13.5px] font-semibold leading-[1.3]">
                {entry.company}
              </span>
              <span className="mt-0.5 block break-words text-[12.5px] leading-[1.35] text-muted-foreground">
                {detailOf(entry)}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
