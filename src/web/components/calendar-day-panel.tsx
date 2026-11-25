import { CalendarDays, Plus } from "lucide-react";
import { useState } from "react";

import { copy } from "../../shared/copy.ts";
import type { CalendarItem } from "../lib/calendar-api.ts";
import type {
  CustomCalendarEvent,
  CustomCalendarEventKind,
} from "../lib/calendar-custom-events.ts";
import { summaryText } from "../lib/calendar-format.ts";
import type { CalendarDate } from "../lib/calendar-grid.ts";
import { CalendarDayEntry } from "./calendar-day-entry.tsx";
import { CalendarEventForm } from "./calendar-event-form.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle } from "./ui/ds.ts";

function compactDateLabel(date: CalendarDate) {
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day, 12));
  const locale = copy.calendar.dateLocale;

  return {
    day: new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(utc),
    weekday: new Intl.DateTimeFormat(locale, {
      timeZone: "UTC",
      weekday: "short",
    }).format(utc),
  };
}

export function CalendarDayPanel({
  customEvents,
  date,
  headingId,
  items,
  onAddEvent,
  onDeleteEvent,
  today,
  zone,
}: {
  customEvents: readonly CustomCalendarEvent[];
  date: CalendarDate;
  headingId: string;
  items: readonly CalendarItem[];
  onAddEvent: (input: {
    company: string;
    kind: CustomCalendarEventKind;
    time: string;
    title: string;
  }) => void;
  onDeleteEvent: (event: CustomCalendarEvent) => void;
  today: boolean;
  zone: string;
}) {
  const [adding, setAdding] = useState(false);
  const { day, weekday } = compactDateLabel(date);
  const totalCount = items.length + customEvents.length;

  return (
    <Card className="flex min-h-0 flex-1 flex-col p-5" variant="default">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h2 className={`${dsCardTitle} whitespace-nowrap`} id={headingId}>
          {`${weekday}, ${day}`}
        </h2>
        {today ? <Badge variant="signal">{copy.calendar.today}</Badge> : null}
      </div>

      {totalCount > 0 ? (
        <p className={`${dsBody} mt-1 shrink-0 text-xs`}>
          {`${copy.calendar.itemCount(totalCount)} · ${summaryText(items, today)}`}
        </p>
      ) : null}

      <Button
        className="mt-4 shrink-0 w-full"
        onClick={() => {
          setAdding((current) => !current);
        }}
        size="sm"
        variant={adding ? "secondary" : "primary"}
      >
        <Plus aria-hidden="true" size={14} />
        <span>{copy.calendar.addEvent}</span>
      </Button>

      {adding || totalCount > 0 ? (
        <div className="relative mt-4 min-h-0 flex-1 border-t border-border">
          <div
            className="space-y-2.5 pt-4 lg:absolute lg:inset-0 lg:overflow-y-auto"
            data-scroll-region
          >
            {adding ? (
              <CalendarEventForm
                onCancel={() => {
                  setAdding(false);
                }}
                onSubmit={(input) => {
                  onAddEvent(input);
                  setAdding(false);
                }}
              />
            ) : null}

            {customEvents.map((event) => (
              <CalendarDayEntry
                event={event}
                key={event.id}
                kind="custom"
                onDelete={onDeleteEvent}
              />
            ))}

            {items.map((item) => (
              <CalendarDayEntry item={item} key={item.id} kind="api" zone={zone} />
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-8 text-center">
          <CalendarDays aria-hidden="true" className="text-muted-foreground" size={20} />
          <p className="max-w-xs text-xs text-muted-foreground">{copy.calendar.emptyDay}</p>
        </div>
      )}
    </Card>
  );
}
