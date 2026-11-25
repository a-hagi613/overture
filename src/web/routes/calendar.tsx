import { useEffect, useId, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import type { CalendarDate } from "../lib/calendar-grid.ts";

import { copy } from "../../shared/copy.ts";
import { CalendarBoard } from "../components/calendar-board.tsx";
import { CalendarDayPanel } from "../components/calendar-day-panel.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card } from "../components/ui/card.tsx";
import { dsBody, dsCardTitle } from "../components/ui/ds.ts";
import { useCalendar } from "../lib/calendar-api.ts";
import {
  useCalendarCustomEvents,
  useCreateCalendarCustomEvent,
  useDeleteCalendarCustomEvent,
} from "../lib/calendar-custom-events.ts";
import type {
  CustomCalendarEvent,
  CustomCalendarEventKind,
} from "../lib/calendar-custom-events.ts";
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
import { RouteFallback } from "../components/route-fallback.tsx";

export function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const headingId = useId();
  const localZone = browserZone();
  const asked = parseMonthKey(params.get("month"));

  const [focus, setFocus] = useState<CalendarDate>(() =>
    initialFocus({ asked, now: currentTime(), zone: localZone }),
  );

  const [selected, setSelected] = useState<CalendarDate>(focus);
  const [navigated, setNavigated] = useState(false);
  const [zoneSynced, setZoneSynced] = useState(localZone);

  const customEventsQuery = useCalendarCustomEvents();
  const createCustomEvent = useCreateCalendarCustomEvent();
  const deleteCustomEvent = useDeleteCalendarCustomEvent();

  const { month, year } = focus;
  const range = monthRange(year, month, localZone);
  const { data, isError, isFetching, refetch } = useCalendar(range, localZone);
  const zone = data?.timeZone ?? localZone;
  const today = dateIn(currentTime(), zone);
  const buckets = useMemo(() => bucketByDay(data?.items ?? [], zone), [data?.items, zone]);
  const monthKey = monthKeyOf(focus);

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
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);

          next.set("month", monthKey);

          return next;
        },
        { replace: true },
      );
    }
  }, [monthKey, params, setParams]);

  const customByDay = useMemo(() => {
    const grouped = new Map<string, CustomCalendarEvent[]>();

    for (const event of customEventsQuery.data ?? []) {
      const existing = grouped.get(event.dayKey) ?? [];

      existing.push(event);
      grouped.set(event.dayKey, existing);
    }

    return grouped;
  }, [customEventsQuery.data]);

  const selectedKey = dayKeyOf(selected);
  const selectedApiItems = buckets.get(selectedKey) ?? [];
  const selectedCustomEvents = customByDay.get(selectedKey) ?? [];

  const selectDate = (date: CalendarDate) => {
    setNavigated(true);
    setFocus(date);
    setSelected(date);
  };

  const handleAddEvent = (input: {
    company: string;
    kind: CustomCalendarEventKind;
    time: string;
    title: string;
  }) => {
    createCustomEvent.mutate(
      {
        company: input.company,
        dayKey: selectedKey,
        kind: input.kind,
        time: input.time,
        title: input.title,
      },
      {
        onError: () => {
          toast.error(copy.settings.notificationsSaveError);
        },
        onSuccess: (created) => {
          toast.success(copy.calendar.eventAddedToast(created.title));
        },
      },
    );
  };

  const handleDeleteEvent = (target: CustomCalendarEvent) => {
    deleteCustomEvent.mutate(target.id, {
      onError: () => {
        toast.error(copy.settings.notificationsSaveError);
      },
      onSuccess: () => {
        toast.success(copy.calendar.eventRemovedToast(target.title), {
          action: {
            label: copy.board.undo,
            onClick: () => {
              createCustomEvent.mutate(
                {
                  company: target.company,
                  dayKey: target.dayKey,
                  kind: target.kind,
                  time: target.time,
                  title: target.title,
                },
                {
                  onError: () => {
                    toast.error(copy.settings.notificationsSaveError);
                  },
                },
              );
            },
          },
        });
      },
    });
  };

  const loaded = data !== undefined;
  const initialLoading = data === undefined && !isError;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader titleNode={copy.calendar.titlePlain} />
      {isError && data === undefined ? (
        <Card className="mt-4 px-7 py-11 text-center">
          <div role="alert">
            <h2 className={dsCardTitle}>{copy.calendar.errorTitle}</h2>
            <p className={`${dsBody} mt-2`}>{copy.calendar.errorBody}</p>
          </div>
          <Button
            className="mt-4"
            onClick={() => {
              void refetch();
            }}
            size="default"
            variant="outline"
          >
            {copy.calendar.retry}
          </Button>
        </Card>
      ) : null}
      {initialLoading ? (
        <div className="mt-4">
          <RouteFallback />
        </div>
      ) : null}
      {loaded ? (
        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:items-stretch">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <CalendarBoard
              buckets={buckets}
              customByDay={customByDay}
              focus={focus}
              isFetching={isFetching}
              onFocusMonth={(next) => {
                setNavigated(true);
                setFocus(next);
              }}
              onSelectDate={selectDate}
              onShiftMonth={(delta) => {
                selectDate(shiftMonth(focus, delta));
              }}
              onToday={() => {
                selectDate(today);
              }}
              selected={selected}
              today={today}
            />
          </div>

          <aside
            aria-label={copy.calendar.dayPanel}
            className="flex min-h-0 min-w-0 flex-col lg:w-96 lg:shrink-0"
          >
            <CalendarDayPanel
              customEvents={selectedCustomEvents}
              date={selected}
              headingId={headingId}
              items={selectedApiItems}
              onAddEvent={handleAddEvent}
              onDeleteEvent={handleDeleteEvent}
              today={selectedKey === dayKeyOf(today)}
              zone={zone}
            />
          </aside>
        </div>
      ) : null}
    </div>
  );
}
