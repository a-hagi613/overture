import { useEffect, useId, useState } from "react";
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
  const customEvents = customEventsQuery.data ?? [];

  const { month, year } = focus;
  const range = monthRange(year, month, localZone);
  const { data, isError, isFetching, refetch } = useCalendar(range, localZone);
  const zone = data?.timeZone ?? localZone;
  const today = dateIn(currentTime(), zone);
  const buckets = bucketByDay(data?.items ?? [], zone);
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
      setParams({ month: monthKey }, { replace: true });
    }
  }, [monthKey, params, setParams]);

  const customByDay = new Map<string, CustomCalendarEvent[]>();

  for (const event of customEvents) {
    const existing = customByDay.get(event.dayKey) ?? [];

    existing.push(event);
    customByDay.set(event.dayKey, existing);
  }

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
    <div>
      <PageHeader
        lead={copy.calendar.lead}
        titleNode={
          <>
            {copy.calendar.titlePlain}{" "}
            <em className="italic text-signal">{copy.calendar.titleItalic}</em>
          </>
        }
      />

      {isError && data === undefined ? (
        <Card className="mt-6 px-7 py-11 text-center">
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
        <div className="mt-6">
          <RouteFallback />
        </div>
      ) : null}
      {loaded ? (
        <div className="mt-6 grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
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

          <aside aria-label={copy.calendar.dayPanel} className="min-w-0 lg:sticky lg:top-6">
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
