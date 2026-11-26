import { ArrowUpRight, Clock, Trash2 } from "lucide-react";
import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import type { CalendarItem } from "../lib/calendar-api.ts";
import type {
  CustomCalendarEvent,
  CustomCalendarEventKind,
} from "../lib/calendar-custom-events.ts";
import { detailOf, timeOf } from "../lib/calendar-format.ts";
import { chipKindOf } from "../lib/calendar-grid.ts";
import { CompanyAvatar } from "./company-avatar.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsMono } from "./ui/ds.ts";

function apiBadgeFor(item: CalendarItem) {
  const kind = chipKindOf(item);

  if (kind === "offer") {
    return { label: copy.calendar.kinds.offer, variant: "signal" as const };
  }

  if (kind === "interview") {
    return { label: copy.calendar.kinds.interview, variant: "ok" as const };
  }

  if (kind === "checkin") {
    return { label: copy.calendar.kinds.checkin, variant: "signal" as const };
  }

  if (kind === "closed") {
    return { label: copy.calendar.kinds.closed, variant: "outline" as const };
  }

  return { label: copy.calendar.kinds[kind], variant: "secondary" as const };
}

function customBadgeVariant(kind: CustomCalendarEventKind) {
  if (kind === "interview") {
    return "ok" as const;
  }

  if (kind === "followup") {
    return "signal" as const;
  }

  return "secondary" as const;
}

export function CalendarDayEntry(
  props:
    | {
        event: CustomCalendarEvent;
        kind: "custom";
        onDelete: (event: CustomCalendarEvent) => void;
      }
    | {
        item: CalendarItem;
        kind: "api";
        zone: string;
      },
) {
  if (props.kind === "custom") {
    const { event, onDelete } = props;

    return (
      <Card className="border-border bg-sidebar/35 p-3.5 shadow-none">
        <div className="flex items-start gap-2.5">
          <CompanyAvatar company={event.company || event.title} tone="signal" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">{event.title}</p>
            {event.company === "" ? null : (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{event.company}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant={customBadgeVariant(event.kind)}>
                {copy.calendar.eventTypes[event.kind]}
              </Badge>
              {event.time === "" ? null : (
                <span className={`${dsMono} inline-flex items-center gap-1`}>
                  <Clock aria-hidden="true" size={11} />
                  {event.time}
                </span>
              )}
            </div>
          </div>
          <Button
            ariaLabel={copy.calendar.deleteEventAria}
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-need"
            onClick={() => {
              onDelete(event);
            }}
            size="icon"
            variant="ghost"
          >
            <Trash2 aria-hidden="true" size={14} />
          </Button>
        </div>
      </Card>
    );
  }

  const { item, zone } = props;
  const badge = apiBadgeFor(item);

  return (
    <Card className="border-border bg-sidebar/35 p-3.5 shadow-none">
      <div className="flex items-start gap-2.5">
        <CompanyAvatar company={item.company} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-semibold text-foreground">{item.company}</p>
            <span className={`${dsMono} shrink-0`}>{timeOf(item.at, zone)}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{detailOf(item)}</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <Badge variant={badge.variant}>{badge.label}</Badge>
            <Link
              className="inline-flex items-center gap-0.5 text-xs font-semibold text-signal-text hover:underline"
              to={`/tracker?application=${item.applicationId}`}
            >
              <span>{copy.calendar.viewApplication}</span>
              <ArrowUpRight aria-hidden="true" size={12} />
            </Link>
          </div>
        </div>
      </div>
    </Card>
  );
}
