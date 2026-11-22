import type { CalendarItem } from "../lib/calendar-api.ts";
import type { CalendarDate } from "../lib/calendar-grid.ts";

import { copy } from "../../shared/copy.ts";
import { dayLabel, detailOf, timeOf } from "../lib/calendar-format.ts";
import { chipKindOf, dayKeyOf, parseDayKey } from "../lib/calendar-grid.ts";
import { CalendarChip } from "./calendar-chip.tsx";
import { CalendarSentRollup } from "./calendar-sent-rollup.tsx";

export function CalendarAgenda({
  buckets,
  month,
  onSelect,
  today,
  year,
  zone,
}: {
  buckets: ReadonlyMap<string, readonly CalendarItem[]>;
  month: number;
  onSelect: (date: CalendarDate) => void;
  today: CalendarDate;
  year: number;
  zone: string;
}) {
  const days = [...buckets.entries()]
    .flatMap(([key, items]) => {
      const date = parseDayKey(key);

      return date?.month === month && date.year === year ? [{ date, items, key }] : [];
    })
    .toSorted((left, right) => left.key.localeCompare(right.key));

  if (days.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="calendar-agenda" className="mt-5 md:hidden">
      <h2
        className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
        id="calendar-agenda"
      >
        {copy.calendar.agenda}
      </h2>
      {days.map(({ date, items, key }) => {
        const sent = items.filter((entry) => chipKindOf(entry) === "sent");
        const others = items.filter((entry) => chipKindOf(entry) !== "sent");
        const isToday = key === dayKeyOf(today);

        return (
          <div key={key}>
            <h3 className="mt-[18px] text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {dayLabel(date)}
              {isToday ? (
                <b className="ml-1.5 font-serif text-[15px] font-normal normal-case italic tracking-normal text-foreground">
                  {copy.calendar.today}
                </b>
              ) : null}
            </h3>
            <ul>
              {sent.length === 0 ? null : (
                <li>
                  <button
                    className="mt-2 flex min-h-11 w-full items-start gap-3 rounded-md border border-border bg-card p-3 text-left hover:bg-muted"
                    onClick={() => {
                      onSelect(date);
                    }}
                    type="button"
                  >
                    <CalendarChip kind="sent" />
                    <span className="min-w-0 flex-1">
                      <CalendarSentRollup items={sent} />
                    </span>
                  </button>
                </li>
              )}
              {others.map((entry) => (
                <li key={entry.id}>
                  <button
                    className="mt-2 flex min-h-11 w-full items-start gap-3 rounded-md border border-border bg-card p-3 text-left hover:bg-muted"
                    onClick={() => {
                      onSelect(date);
                    }}
                    type="button"
                  >
                    <span className="w-11 flex-none pt-[3px] font-mono text-xs text-muted-foreground">
                      {timeOf(entry.at, zone)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <CalendarChip kind={chipKindOf(entry)} />
                      <span className="mt-[5px] block break-words text-[13.5px] font-semibold">
                        {entry.company}
                      </span>
                      <span className="mt-0.5 block break-words text-[12.5px] text-muted-foreground">
                        {detailOf(entry)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
