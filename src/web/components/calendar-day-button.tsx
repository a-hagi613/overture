import { useContext, useEffect, useRef } from "react";
import type { DayButtonProps } from "react-day-picker";

import { copy } from "../../shared/copy.ts";
import type { CalendarItem } from "../lib/calendar-api.ts";
import { CalendarDayContext, toCalendarDate } from "../lib/calendar-day-context.ts";
import { countText } from "../lib/calendar-format.ts";
import { chipKindOf, dayKeyOf } from "../lib/calendar-grid.ts";

function firstPillTone(customKind: string | undefined, apiItem: CalendarItem | undefined) {
  if (customKind === "interview") {
    return "bg-ok-soft text-ok";
  }

  if (customKind !== undefined) {
    return "bg-signal-soft text-signal-text";
  }

  if (apiItem === undefined) {
    return "bg-muted text-foreground";
  }

  const kind = chipKindOf(apiItem);

  if (kind === "interview") {
    return "bg-ok-soft text-ok";
  }

  if (kind === "offer" || kind === "checkin") {
    return "bg-signal-soft text-signal-text";
  }

  return "bg-muted text-foreground";
}

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

export function CalendarDayButton(props: DayButtonProps) {
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
    cellStyle = "border-signal bg-card text-foreground ring-1 ring-signal";
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
    ...(customEvents.length > 0 ? [copy.calendar.customEventCount(customEvents.length)] : []),
  ];

  const dayAriaLabel = [
    formattedDay,
    summaryParts.length === 0 ? copy.calendar.nothing : summaryParts.join(", "),
    ...(firstLabel === null ? [] : [firstLabel]),
    ...(totalEvents > 1 ? [copy.calendar.more(totalEvents - 1)] : []),
  ].join(", ");

  return (
    <button
      aria-current={isToday ? "date" : undefined}
      aria-disabled={ariaDisabled}
      aria-pressed={isSelected}
      className={`flex h-14 w-full cursor-pointer flex-col items-start justify-between rounded-lg border p-1.5 text-left transition md:h-20 md:p-2 2xl:h-24 ${cellStyle}`}
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
      <span className="sr-only">{dayAriaLabel}</span>
      <div aria-hidden="true" className="flex w-full items-center justify-between gap-1">
        <span
          className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-xs font-semibold tabular-nums sm:h-6 sm:w-6 ${numeralStyle}`}
        >
          {cellDate.day}
        </span>
        {totalEvents > 0 ? (
          <span className="flex min-w-0 items-center justify-end gap-0.5 overflow-hidden">
            {customEvents.slice(0, 2).map((event) => (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-signal" key={event.id} />
            ))}
            {apiEvents.slice(0, 3).map((item) => (
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotColorFor(item)}`}
                key={item.id}
              />
            ))}
          </span>
        ) : null}
      </div>

      {firstLabel === null ? null : (
        <div aria-hidden="true" className="hidden w-full md:block">
          <p
            className={`truncate rounded px-1.5 py-0.5 text-xs font-medium ${firstPillTone(
              customEvents[0]?.kind,
              customEvents[0] === undefined ? apiEvents[0] : undefined,
            )}`}
          >
            {firstLabel}
          </p>
          {totalEvents > 1 ? (
            <p className="mt-0.5 px-0.5 text-xs font-medium text-muted-foreground tabular-nums">
              {copy.calendar.more(totalEvents - 1)}
            </p>
          ) : null}
        </div>
      )}
    </button>
  );
}
