import type { CalendarItem } from "../lib/calendar-api.ts";
import type { CalendarDate } from "../lib/calendar-grid.ts";

import { copy } from "../../shared/copy.ts";
import { dayParts, summaryText } from "../lib/calendar-format.ts";
import { CalendarDayRows } from "./calendar-day-rows.tsx";
import { NavGlyph } from "./nav-glyph.tsx";

export function CalendarDayPanel({
  date,
  headingId,
  items,
  onClose,
  today,
  zone,
}: {
  date: CalendarDate;
  headingId: string;
  items: readonly CalendarItem[];
  onClose: () => void;
  today: boolean;
  zone: string;
}) {
  const { day, weekday } = dayParts(date);

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {copy.calendar.dayPanel}
          </p>
          <h2 className="mt-1 font-serif text-[26px] leading-[1.1]" id={headingId}>
            {weekday} <span className="italic">{day}</span>
          </h2>
          <p className="mt-1 text-[12.5px] text-muted-foreground">{summaryText(items, today)}</p>
        </div>
        <button
          aria-label={copy.calendar.closePanel}
          className="flex h-11 w-11 flex-none items-center justify-center rounded-md border border-input bg-card hover:bg-muted md:h-[34px] md:w-[34px]"
          onClick={onClose}
          type="button"
        >
          <NavGlyph name="close" size={16} />
        </button>
      </div>
      {items.length === 0 ? (
        <p className="mt-4 border-t border-border pt-4 text-[13.5px] text-muted-foreground">
          {copy.calendar.emptyDay}
        </p>
      ) : (
        <CalendarDayRows items={items} zone={zone} />
      )}
    </>
  );
}
