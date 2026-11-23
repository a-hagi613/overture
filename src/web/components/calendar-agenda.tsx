import { useEffect, useRef } from "react";

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
  const todayRef = useRef<HTMLDivElement>(null);
  const todayKey = dayKeyOf(today);

  const days = [...buckets.entries()]
    .flatMap(([key, items]) => {
      const date = parseDayKey(key);

      return date?.month === month && date.year === year ? [{ date, items, key }] : [];
    })
    .toSorted((left, right) => left.key.localeCompare(right.key));

  const showsToday = days.some(({ key }) => key === todayKey);

  useEffect(() => {
    if (showsToday) {
      todayRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [showsToday]);

  if (days.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="calendar-agenda" className="mt-5 md:hidden">
      <h2
        className="text-eyebrow font-semibold uppercase tracking-[0.12em] text-muted-foreground"
        id="calendar-agenda"
      >
        {copy.calendar.agenda}
      </h2>
      {days.map(({ date, items, key }) => {
        const sent = items.filter((entry) => chipKindOf(entry) === "sent");
        const others = items.filter((entry) => chipKindOf(entry) !== "sent");
        const isToday = key === todayKey;

        return (
          <div key={key} ref={isToday ? todayRef : undefined}>
            <h3 className="mt-4 text-eyebrow font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {dayLabel(date)}
              {isToday ? (
                <b className="ml-1.5 font-serif text-sm font-normal normal-case italic tracking-normal text-foreground">
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
                    <span className="w-11 flex-none pt-1 font-mono text-xs text-muted-foreground">
                      {timeOf(entry.at, zone)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <CalendarChip kind={chipKindOf(entry)} />
                      <span className="mt-1 block break-words text-sm font-semibold">
                        {entry.company}
                      </span>
                      <span className="mt-0.5 block break-words text-xs text-muted-foreground">
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
