import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";

import type { CalendarItem } from "../lib/calendar-api.ts";
import type { CalendarDate } from "../lib/calendar-grid.ts";

import { copy } from "../../shared/copy.ts";
import { cellLabel, monthLabel, weekdayNames } from "../lib/calendar-format.ts";
import { dayKeyOf, monthCells, moveFocus } from "../lib/calendar-grid.ts";
import { CalendarCellBody } from "./calendar-cell-body.tsx";

const WEEKDAYS = {
  long: weekdayNames("long"),
  narrow: weekdayNames("narrow"),
  short: weekdayNames("short"),
};

export function CalendarMonthGrid({
  buckets,
  focus,
  month,
  onFocusChange,
  onSelect,
  selected,
  today,
  year,
}: {
  buckets: ReadonlyMap<string, readonly CalendarItem[]>;
  focus: CalendarDate;
  month: number;
  onFocusChange: (date: CalendarDate) => void;
  onSelect: (date: CalendarDate) => void;
  selected: CalendarDate;
  today: CalendarDate;
  year: number;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const wantsFocus = useRef(false);
  const cells = monthCells(year, month);
  const focusKey = dayKeyOf(focus);
  const selectedKey = dayKeyOf(selected);
  const todayKey = dayKeyOf(today);

  useEffect(() => {
    if (!wantsFocus.current) {
      return;
    }

    wantsFocus.current = false;
    grid.current?.querySelector<HTMLElement>(`[data-day="${focusKey}"]`)?.focus();
  }, [focusKey]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, date: CalendarDate) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(date);

      return;
    }

    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    const next = moveFocus(event.key, date);

    if (next !== null) {
      event.preventDefault();
      wantsFocus.current = true;
      onFocusChange(next);
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sh" ref={grid}>
      <ul
        aria-hidden="true"
        className="grid grid-cols-[repeat(7,minmax(0,1fr))] border-b border-border bg-sidebar"
      >
        {WEEKDAYS.short.map((name, index) => (
          <li
            className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground md:text-left"
            key={name}
          >
            <span className="md:hidden">{WEEKDAYS.narrow[index]}</span>
            <span className="hidden md:inline">{name}</span>
          </li>
        ))}
      </ul>
      <ol
        aria-label={copy.calendar.gridLabel(monthLabel(year, month))}
        className="grid grid-cols-[repeat(7,minmax(0,1fr))]"
      >
        {cells.map((cell, index) => {
          const key = dayKeyOf(cell);
          const isSelected = key === selectedKey;
          const label = cellLabel(cell, buckets.get(key) ?? []);

          return (
            <li
              className={`min-w-0 border-b border-r border-border p-0 [&:nth-child(7n)]:border-r-0 [&:nth-child(n+36)]:border-b-0 ${
                index % 7 >= 5 ? "bg-sidebar" : "bg-card"
              }`}
              key={key}
            >
              <button
                aria-current={key === todayKey ? "date" : undefined}
                aria-pressed={isSelected}
                className={`block w-full min-w-0 cursor-pointer text-left text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal ${
                  cell.inMonth ? "" : "text-muted-foreground"
                } ${isSelected ? "shadow-[inset_0_0_0_2px_var(--color-foreground)]" : ""}`}
                data-day={key}
                onClick={() => {
                  onSelect(cell);
                }}
                onKeyDown={(event) => {
                  onKeyDown(event, cell);
                }}
                tabIndex={key === focusKey ? 0 : -1}
                type="button"
              >
                <span className="sr-only">{label}</span>
                <span
                  aria-hidden="true"
                  className="flex min-h-[52px] min-w-0 flex-col items-center gap-1 p-1.5 md:min-h-32 md:items-stretch md:p-1.5 lg:p-2"
                >
                  <span
                    className={`flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full text-[13px] font-semibold tabular-nums ${
                      key === todayKey
                        ? "bg-foreground text-background shadow-[0_0_0_3px_var(--color-card),0_0_0_4.5px_var(--color-signal)]"
                        : ""
                    }`}
                  >
                    {cell.day}
                  </span>
                  <CalendarCellBody items={buckets.get(key) ?? []} />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
