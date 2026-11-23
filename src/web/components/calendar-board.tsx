import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { DayPicker } from "react-day-picker";

import { copy } from "../../shared/copy.ts";
import type { CalendarItem } from "../lib/calendar-api.ts";
import type { CustomCalendarEvent } from "../lib/calendar-custom-events.ts";
import { CalendarDayContext, toCalendarDate } from "../lib/calendar-day-context.ts";
import { dayKeyOf } from "../lib/calendar-grid.ts";
import type { CalendarDate } from "../lib/calendar-grid.ts";
import { CalendarDatePickerPopover } from "./calendar-date-picker-popover.tsx";
import { CalendarDayButton } from "./calendar-day-button.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";

function toJsDate(date: CalendarDate) {
  return new Date(date.year, date.month - 1, date.day);
}

const DAY_PICKER_CLASSES = {
  day: "p-px sm:p-0.5 align-top",
  month: "w-full",
  month_caption: "hidden",
  month_grid: "w-full table-fixed border-collapse",
  months: "w-full",
  nav: "hidden",
  outside: "",
  week: "",
  weekday: "pb-2 text-center font-mono text-xs font-medium uppercase text-muted-foreground",
  weekdays: "",
};

const DAY_PICKER_COMPONENTS = {
  DayButton: CalendarDayButton,
};

export function CalendarBoard({
  buckets,
  customByDay,
  focus,
  isFetching,
  onFocusMonth,
  onSelectDate,
  onShiftMonth,
  onToday,
  selected,
  today,
}: {
  buckets: ReadonlyMap<string, readonly CalendarItem[]>;
  customByDay: ReadonlyMap<string, readonly CustomCalendarEvent[]>;
  focus: CalendarDate;
  isFetching: boolean;
  onFocusMonth: (date: CalendarDate) => void;
  onSelectDate: (date: CalendarDate) => void;
  onShiftMonth: (delta: number) => void;
  onToday: () => void;
  selected: CalendarDate;
  today: CalendarDate;
}) {
  const monthDate = new Date(focus.year, focus.month - 1, 1);
  const selectedJs = toJsDate(selected);
  const todayKey = dayKeyOf(today);
  const selectedKey = dayKeyOf(selected);
  const monthPrefix = `${String(focus.year)}-${String(focus.month).padStart(2, "0")}-`;

  const hasMonthEvents =
    [...buckets.keys()].some((key) => key.startsWith(monthPrefix)) ||
    [...customByDay.keys()].some((key) => key.startsWith(monthPrefix));

  const dayContext = useMemo(
    () => ({ buckets, customByDay, onSelectDate, selectedKey, todayKey }),
    [buckets, customByDay, onSelectDate, selectedKey, todayKey],
  );

  return (
    <Card
      ariaBusy={isFetching}
      ariaLabelledBy="calendar-month"
      className="min-w-0 p-2 sm:p-4 md:p-6"
      variant="elevated"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <CalendarDatePickerPopover
          month={monthDate}
          onSelectDate={(picked) => {
            onSelectDate(toCalendarDate(picked));
          }}
          selected={selectedJs}
        />

        <div className="flex items-center gap-1.5">
          <Button onClick={onToday} size="sm" variant="outline">
            {copy.calendar.today}
          </Button>
          <Button
            ariaLabel={copy.calendar.previousMonth}
            className="md:h-9 md:w-9"
            onClick={() => {
              onShiftMonth(-1);
            }}
            size="icon"
            variant="outline"
          >
            <ChevronLeft aria-hidden="true" size={16} />
          </Button>
          <Button
            ariaLabel={copy.calendar.nextMonth}
            className="md:h-9 md:w-9"
            onClick={() => {
              onShiftMonth(1);
            }}
            size="icon"
            variant="outline"
          >
            <ChevronRight aria-hidden="true" size={16} />
          </Button>
        </div>
      </div>

      <CalendarDayContext.Provider value={dayContext}>
        <DayPicker
          classNames={DAY_PICKER_CLASSES}
          components={DAY_PICKER_COMPONENTS}
          mode="single"
          month={monthDate}
          onMonthChange={(nextMonth) => {
            onFocusMonth({
              day: 1,
              month: nextMonth.getMonth() + 1,
              year: nextMonth.getFullYear(),
            });
          }}
          onSelect={(picked) => {
            if (picked !== undefined) {
              onSelectDate(toCalendarDate(picked));
            }
          }}
          selected={selectedJs}
          showOutsideDays
          weekStartsOn={1}
        />
      </CalendarDayContext.Provider>

      {!isFetching && !hasMonthEvents ? (
        <p className="mt-3 text-center text-xs text-muted-foreground">{copy.calendar.emptyMonth}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-3.5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-ok" />
          <span>{copy.calendar.kinds.interview}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-signal" />
          <span>{`${copy.calendar.kinds.offer} / ${copy.calendar.eventTypes.followup}`}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-muted-foreground" />
          <span>{`${copy.calendar.kinds.sent} / ${copy.calendar.kinds.stage}`}</span>
        </span>
      </div>
    </Card>
  );
}
