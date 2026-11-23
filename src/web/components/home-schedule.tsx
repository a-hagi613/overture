import { ArrowUpRight } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { useCalendar } from "../lib/calendar-api.ts";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsCardTitle, dsMono } from "./ui/ds.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(at: number, zone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: zone,
    year: "numeric",
  }).format(new Date(at));
}

function formatEventTime(at: number, zone: string, isToday: boolean) {
  if (isToday) {
    return new Intl.DateTimeFormat(copy.home.dateLocale, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: zone,
    }).format(new Date(at));
  }

  return new Intl.DateTimeFormat(copy.home.dateLocale, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: zone,
  }).format(new Date(at));
}

export function HomeSchedule({ now, zone }: { now: number; zone: string }) {
  const range = useMemo(() => {
    const startOfWindow = now - DAY_MS;
    const endOfWindow = now + 14 * DAY_MS;

    return { from: startOfWindow, to: endOfWindow };
  }, [now]);

  const { data } = useCalendar(range, zone);
  const effectiveZone = data?.timeZone ?? zone;
  const todayKey = dayKey(now, effectiveZone);

  const upcoming = (data?.items ?? [])
    .filter((item) => item.kind === "interview" || item.kind === "checkin")
    .filter((item) => dayKey(item.at, effectiveZone) >= todayKey)
    .toSorted((left, right) => left.at - right.at)
    .slice(0, 5);

  return (
    <Card ariaLabelledBy="home-schedule" className="flex h-full flex-col p-5 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className={dsCardTitle} id="home-schedule">
          {copy.home.schedule.title}
        </h2>
        <Button asChild size="sm" variant="secondary">
          <Link to="/calendar">
            {copy.home.schedule.open}
            <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>

      {upcoming.length === 0 ? (
        <div className="mt-6 flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted px-5 py-8 text-center">
          <p className="text-sm font-semibold text-foreground">{copy.home.schedule.emptyTitle}</p>
          <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
            {copy.home.schedule.emptyBody}
          </p>
        </div>
      ) : (
        <div className="mt-4 flex flex-1 flex-col divide-y divide-border">
          {upcoming.map((item) => {
            const isToday = dayKey(item.at, effectiveZone) === todayKey;

            return (
              <Link
                className="group -mx-2 flex flex-1 items-center justify-between gap-4 rounded-lg px-2 py-4 transition hover:bg-muted"
                key={item.id}
                to={`/board?application=${encodeURIComponent(item.applicationId)}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-foreground group-hover:text-signal-text">
                      {item.company}
                    </p>
                    <Badge variant={isToday ? "outline" : "ok"}>
                      {isToday ? copy.home.schedule.todayBadge : copy.home.schedule.upcomingBadge}
                    </Badge>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{item.title}</p>
                </div>
                <span className={`${dsMono} shrink-0`}>
                  {formatEventTime(item.at, effectiveZone, isToday)}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </Card>
  );
}
