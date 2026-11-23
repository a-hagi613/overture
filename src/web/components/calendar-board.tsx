import { ChevronLeft, ChevronRight } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { DayPicker } from "react-day-picker";
import type { DayButtonProps } from "react-day-picker";

import { copy } from "../../shared/copy.ts";
import type { CalendarItem } from "../lib/calendar-api.ts";
import type { CustomCalendarEvent } from "../lib/calendar-custom-events.ts";
import { countText } from "../lib/calendar-format.ts";
import { chipKindOf, dayKeyOf } from "../lib/calendar-grid.ts";
import type { CalendarDate } from "../lib/calendar-grid.ts";
import { CalendarDatePickerPopover } from "./calendar-date-picker-popover.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";

interface CalendarDayContextValue {
  buckets: ReadonlyMap<string, readonly CalendarItem[]>;
  customByDay: ReadonlyMap<string, readonly CustomCalendarEvent[]>;
  onSelectDate: (date: CalendarDate) => void;
  selectedKey: string;
  todayKey: string;
}

const CalendarDayContext = createContext<CalendarDayContextValue | null>(null);

function toCalendarDate(date: Date) {
  return { day: date.getDate(), month: date.getMonth() + 1, year: date.getFullYear() };
}

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

function dotColorFor(item: CalendarItem) {
  const kind = chipKindOf(item);

  if (kind === "interview") {
    return "bg-ok";
  }

  if (kind === "offer" || kind === "checkin") {
    return "bg-signal";
  }

  return "bg-muted-foreground";
}

function CalendarDayButton(props: DayButtonProps) {
  const {
    "aria-disabled": ariaDisabled,
    day,
    disabled,
    modifiers,
    onBlur,
    onClick,
    onFocus,
    onKeyDown,
    onMouseEnter,
    onMouseLeave,
    tabIndex,
  } = props;

  const context = useContext(CalendarDayContext);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (modifiers.focused === true) {
      buttonRef.current?.focus();
    }
  }, [modifiers.focused]);

  if (context === null) {
    return null;
  }

  const cellDate = toCalendarDate(day.date);
  const key = dayKeyOf(cellDate);
  const apiEvents = context.buckets.get(key) ?? [];
  const customEvents = context.customByDay.get(key) ?? [];
  const totalEvents = apiEvents.length + customEvents.length;
  const isSelected = key === context.selectedKey;
  const isToday = key === context.todayKey;
  const isOutside = Boolean(modifiers.outside);
  const firstLabel = customEvents[0]?.title ?? apiEvents[0]?.company ?? null;

  let cellStyle = isOutside
    ? "border-border/70 bg-muted/40 text-muted-foreground hover:border-input hover:bg-muted"
    : "border-border bg-background text-foreground hover:border-input hover:bg-muted";

  if (isSelected) {
    cellStyle = "border-signal bg-card text-foreground ring-1 ring-signal shadow-sh";
  } else if (isToday) {
    cellStyle = "border-signal/60 bg-card text-foreground";
  }

  let numeralStyle = "text-foreground";

  if (isToday) {
    numeralStyle = "bg-signal-text text-primary-ink";
  } else if (isOutside && !isSelected) {
    numeralStyle = "text-muted-foreground";
  }

  const formattedDay = new Intl.DateTimeFormat(copy.home.dateLocale, {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
  }).format(day.date);

  const summaryParts = [
    ...countText(apiEvents),
    ...(customEvents.length > 0
      ? [`${String(customEvents.length)} custom ${customEvents.length === 1 ? "event" : "events"}`]
      : []),
  ];

  const dayAriaLabel = `${formattedDay}, ${
    summaryParts.length === 0 ? copy.calendar.nothing : summaryParts.join(", ")
  }`;

  return (
    <button
      aria-current={isToday ? "date" : undefined}
      aria-disabled={ariaDisabled}
      aria-label={dayAriaLabel}
      aria-pressed={isSelected}
      className={`flex h-16 w-full cursor-pointer flex-col items-start justify-between rounded-lg border p-1.5 text-left transition md:h-24 md:p-2 ${cellStyle}`}
      data-day={key}
      disabled={disabled}
      onBlur={onBlur}
      onClick={(event) => {
        onClick?.(event);
        context.onSelectDate(cellDate);
      }}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      ref={buttonRef}
      tabIndex={tabIndex}
      type="button"
    >
      <div className="flex w-full items-center justify-between gap-1">
        <span
          className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-semibold tabular-nums ${numeralStyle}`}
        >
          {cellDate.day}
        </span>
        {totalEvents > 0 ? (
          <span className="flex items-center gap-0.5">
            {customEvents.slice(0, 2).map((event) => (
              <span className="h-1.5 w-1.5 rounded-full bg-signal" key={event.id} />
            ))}
            {apiEvents.slice(0, 3).map((item) => (
              <span className={`h-1.5 w-1.5 rounded-full ${dotColorFor(item)}`} key={item.id} />
            ))}
          </span>
        ) : null}
      </div>

      {firstLabel === null ? null : (
        <div aria-hidden="true" className="hidden w-full md:block">
          <p className="truncate rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground">
            {firstLabel}
          </p>
          {totalEvents > 1 ? (
            <p className="mt-0.5 px-0.5 text-xs font-medium text-muted-foreground tabular-nums">
              {`+${String(totalEvents - 1)} more`}
            </p>
          ) : null}
        </div>
      )}
    </button>
  );
}

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
