import { ArrowUpRight, Calendar } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { useCalendar } from "../lib/calendar-api.ts";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsMono } from "./ui/ds.ts";
import { PanelEmpty } from "./ui/panel-empty.tsx";
import { PanelHeader } from "./ui/panel-header.tsx";
import { PanelList } from "./ui/panel-list.tsx";

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
    <Card ariaLabelledBy="home-schedule" className="flex h-full flex-col overflow-hidden">
      <PanelHeader
        action={
          <Button asChild size="sm" variant="outline">
            <Link to="/calendar">
              {copy.home.schedule.open}
              <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
          </Button>
        }
        icon={<Calendar aria-hidden="true" className="h-4 w-4" />}
        title={copy.home.schedule.title}
        titleId="home-schedule"
      />

      {upcoming.length === 0 ? (
        <PanelEmpty
          description={copy.home.schedule.emptyBody}
          title={copy.home.schedule.emptyTitle}
        />
      ) : (
        <PanelList className="flex-1">
          {upcoming.map((item) => {
            const isToday = dayKey(item.at, effectiveZone) === todayKey;

            return (
              <Link
                className="group -mx-2 flex items-center justify-between gap-4 rounded-md px-2 py-3 transition hover:bg-muted"
                key={item.id}
                to={`/tracker?card=${encodeURIComponent(item.applicationId)}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">{item.company}</p>
                    <Badge variant={isToday ? "outline" : "ok"}>
                      {isToday ? copy.home.schedule.todayBadge : copy.home.schedule.upcomingBadge}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.title}</p>
                </div>
                <span className={`${dsMono} shrink-0`}>
                  {formatEventTime(item.at, effectiveZone, isToday)}
                </span>
              </Link>
            );
          })}
        </PanelList>
      )}
    </Card>
  );
}
