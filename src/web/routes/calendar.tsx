import { useEffect, useId, useState } from "react";
import { useSearchParams } from "react-router";

import type { CalendarDate } from "../lib/calendar-grid.ts";

import { copy } from "../../shared/copy.ts";
import { CalendarAgenda } from "../components/calendar-agenda.tsx";
import { CalendarChip } from "../components/calendar-chip.tsx";
import { CalendarDayPanel } from "../components/calendar-day-panel.tsx";
import { CalendarDaySheet } from "../components/calendar-day-sheet.tsx";
import { CalendarMonthGrid } from "../components/calendar-month-grid.tsx";
import { NavGlyph } from "../components/nav-glyph.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { useCalendar } from "../lib/calendar-api.ts";
import { CHIP_KINDS, monthName } from "../lib/calendar-format.ts";
import { anchorFocus, initialFocus } from "../lib/calendar-focus.ts";
import {
  bucketByDay,
  dateIn,
  dayKeyOf,
  monthKeyOf,
  monthRange,
  parseMonthKey,
  shiftMonth,
} from "../lib/calendar-grid.ts";
import { browserZone, currentTime } from "../lib/inbox-time.ts";
import { useMediaQuery } from "../lib/media-query.ts";

const NAV_BUTTON =
  "flex h-11 w-11 items-center justify-center rounded-md border border-input bg-card hover:bg-muted md:h-10 md:w-10";

export function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const tablet = useMediaQuery("(min-width: 768px)");
  const headingId = useId();
  const localZone = browserZone();
  const asked = parseMonthKey(params.get("month"));

  const [focus, setFocus] = useState<CalendarDate>(() =>
    initialFocus({ asked, now: currentTime(), zone: localZone }),
  );

  const [selected, setSelected] = useState<CalendarDate>(focus);
  const [navigated, setNavigated] = useState(false);
  const [zoneSynced, setZoneSynced] = useState(localZone);
  const [panelOpen, setPanelOpen] = useState(tablet);
  const { month, year } = focus;
  const range = monthRange(year, month, localZone);
  const { data, isError, isFetching, refetch } = useCalendar(range, localZone);
  const zone = data?.timeZone ?? localZone;
  const today = dateIn(currentTime(), zone);
  const buckets = bucketByDay(data?.items ?? [], zone);
  const monthKey = monthKeyOf(focus);

  const [seenTablet, setSeenTablet] = useState(tablet);

  if (seenTablet !== tablet) {
    setSeenTablet(tablet);
    setPanelOpen(tablet);
  }

  if (data !== undefined && data.timeZone !== zoneSynced) {
    setZoneSynced(data.timeZone);

    const anchored = anchorFocus({
      focus,
      localZone,
      navigated,
      now: currentTime(),
      savedZone: data.timeZone,
    });

    if (anchored !== focus) {
      setFocus(anchored);
      setSelected(anchored);
    }
  }

  useEffect(() => {
    if (params.get("month") !== monthKey) {
      setParams({ month: monthKey }, { replace: true });
    }
  }, [monthKey, params, setParams]);

  const empty = data?.items.length === 0;
  const selectedItems = buckets.get(dayKeyOf(selected)) ?? [];

  const go = (date: CalendarDate) => {
    setNavigated(true);
    setFocus(date);
    setSelected(date);
  };

  const select = (date: CalendarDate) => {
    setNavigated(true);
    setFocus(date);
    setSelected(date);
    setPanelOpen(true);
  };

  const moveFocus = (date: CalendarDate) => {
    setNavigated(true);
    setFocus(date);
  };

  const closePanel = () => {
    setPanelOpen(false);

    globalThis.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-day="${dayKeyOf(selected)}"]`)?.focus();
    });
  };

  const panel = (
    <CalendarDayPanel
      date={selected}
      headingId={headingId}
      items={selectedItems}
      onClose={closePanel}
      today={dayKeyOf(selected) === dayKeyOf(today)}
      zone={zone}
    />
  );

  let body;

  if (isError && data === undefined) {
    body = (
      <section className="mt-[18px] rounded-lg border border-border bg-card px-7 py-11 text-center shadow-sh">
        <h2 className="font-serif text-[26px] leading-[1.1]">{copy.calendar.errorTitle}</h2>
        <p className="mt-2 text-[14.5px] text-muted-foreground">{copy.calendar.errorBody}</p>
        <button
          className="mt-4 inline-flex min-h-10 items-center justify-center rounded-md border border-input bg-card px-4 text-[13.5px] font-semibold hover:bg-muted max-md:min-h-11"
          onClick={() => {
            void refetch();
          }}
          type="button"
        >
          {copy.calendar.retry}
        </button>
      </section>
    );
  } else {
    body = (
      <div className="mt-[18px] flex flex-col gap-5 lg:flex-row lg:items-start">
        <section aria-busy={isFetching} aria-labelledby="calendar-month" className="min-w-0 flex-1">
          <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
            <h2
              aria-live="polite"
              className="font-serif text-[28px] leading-[1.1]"
              id="calendar-month"
            >
              {monthName(month)} <span className="italic">{year}</span>
            </h2>
            <div className="flex items-center gap-2">
              <button
                aria-label={copy.calendar.previousMonth}
                className={NAV_BUTTON}
                onClick={() => {
                  go(shiftMonth(focus, -1));
                }}
                type="button"
              >
                <NavGlyph name="back" />
              </button>
              <button
                aria-label={copy.calendar.nextMonth}
                className={NAV_BUTTON}
                onClick={() => {
                  go(shiftMonth(focus, 1));
                }}
                type="button"
              >
                <NavGlyph name="forward" />
              </button>
              <button
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-input bg-card px-3.5 text-[13px] font-semibold hover:bg-muted md:min-h-10"
                onClick={() => {
                  go(today);
                }}
                type="button"
              >
                {copy.calendar.today}
              </button>
            </div>
          </div>
          {empty ? (
            <output className="mb-3.5 block text-[14px] text-muted-foreground">
              {copy.calendar.emptyMonth}
            </output>
          ) : null}
          <CalendarMonthGrid
            buckets={buckets}
            focus={focus}
            month={month}
            onFocusChange={moveFocus}
            onSelect={select}
            selected={selected}
            today={today}
            year={year}
          />
          <ul
            aria-label={copy.calendar.legendLabel}
            className="mt-3.5 flex flex-wrap gap-x-5 gap-y-2"
          >
            {CHIP_KINDS.map((kind) => (
              <li key={kind}>
                <CalendarChip kind={kind} />
              </li>
            ))}
          </ul>
          <CalendarAgenda
            buckets={buckets}
            month={month}
            onSelect={select}
            today={today}
            year={year}
            zone={zone}
          />
        </section>
        {panelOpen && tablet ? (
          <aside
            aria-label={copy.calendar.dayPanel}
            className="min-w-0 rounded-lg border border-border bg-card p-5 pb-3 shadow-sh lg:sticky lg:top-5 lg:w-80 lg:flex-none"
          >
            {panel}
          </aside>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        lead={copy.calendar.lead}
        titleNode={
          <>
            {copy.calendar.titlePlain} <span className="italic">{copy.calendar.titleItalic}</span>
          </>
        }
      />
      {body}
      {panelOpen && !tablet ? (
        <CalendarDaySheet headingId={headingId} onClose={closePanel}>
          {panel}
        </CalendarDaySheet>
      ) : null}
    </div>
  );
}
