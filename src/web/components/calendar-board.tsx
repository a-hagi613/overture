import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";
import type { DayButtonProps } from "react-day-picker";

import { copy } from "../../shared/copy.ts";
import type { CalendarItem } from "../lib/calendar-api.ts";
import type { CustomCalendarEvent } from "../lib/calendar-custom-events.ts";
import { chipKindOf, dayKeyOf } from "../lib/calendar-grid.ts";
import type { CalendarDate } from "../lib/calendar-grid.ts";
import { CalendarDatePickerPopover } from "./calendar-date-picker-popover.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";

function toCalendarDate(date: Date) {
  return { day: date.getDate(), month: date.getMonth() + 1, year: date.getFullYear() };
}

function toJsDate(date: CalendarDate) {
  return new Date(date.year, date.month - 1, date.day);
}

const DAY_PICKER_CLASSES = {
  day: "p-0.5 align-top",
  month: "w-full",
  month_caption: "hidden",
  month_grid: "w-full table-fixed border-collapse",
  months: "w-full",
  nav: "hidden",
  outside: "opacity-40",
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

export function CalendarBoard({
  buckets,
  customByDay,
  focus,
  isFetching,
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

  const renderDayButton = (props: DayButtonProps) => {
    const cellDate = toCalendarDate(props.day.date);
    const key = dayKeyOf(cellDate);
    const apiEvents = buckets.get(key) ?? [];
    const customEvents = customByDay.get(key) ?? [];
    const totalEvents = apiEvents.length + customEvents.length;
    const isSelected = key === selectedKey;
    const isToday = key === todayKey;

    const firstLabel = customEvents[0]?.title ?? apiEvents[0]?.company ?? null;

    let cellStyle = "border-border bg-background text-foreground hover:border-input hover:bg-muted";

    if (isSelected) {
      cellStyle = "border-signal bg-card text-foreground ring-1 ring-signal shadow-sh";
    } else if (isToday) {
      cellStyle = "border-signal/60 bg-card text-foreground";
    }

    return (
      <button
        aria-label={props["aria-label"]}
        aria-pressed={isSelected}
        className={`flex h-16 w-full cursor-pointer flex-col items-start justify-between rounded-lg border p-1.5 text-left transition md:h-24 md:p-2 ${cellStyle}`}
        data-day={key}
        onClick={() => {
          onSelectDate(cellDate);
        }}
        type="button"
      >
        <div className="flex w-full items-center justify-between gap-1">
          <span
            className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-semibold tabular-nums ${
              isToday ? "bg-signal text-primary-ink" : "text-foreground"
            }`}
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
          <div className="hidden w-full md:block">
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
  };

  return (
    <Card ariaLabelledBy="calendar-month" className="min-w-0 p-4 md:p-6" variant="elevated">
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
            className="h-9 w-9"
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
            className="h-9 w-9"
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

      <div aria-busy={isFetching}>
        <DayPicker
          classNames={DAY_PICKER_CLASSES}
          components={{ DayButton: renderDayButton }}
          mode="single"
          month={monthDate}
          onMonthChange={(nextMonth) => {
            onSelectDate({
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
      </div>

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
