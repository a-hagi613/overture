import { ArrowRight, Bell, CircleHelp, Clock, Hash, ListChecks, Mail, Pause } from "lucide-react";
import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { dateKey, timeText } from "../lib/home-time.ts";
import type { NotificationRow } from "../lib/notifications-api.ts";
import { Button } from "./ui/button.tsx";
import { dsMono } from "./ui/ds.ts";

const ACTIONS = new Map(Object.entries(copy.notifications.page.actions));

function renderKindIcon(kind: string) {
  switch (kind) {
    case "ready": {
      return <ListChecks size={16} />;
    }

    case "review": {
      return <CircleHelp size={16} />;
    }

    case "reply":
    case "interview":
    case "offer": {
      return <Mail size={16} />;
    }

    case "stage_move": {
      return <ArrowRight size={16} />;
    }

    case "code_wait": {
      return <Hash size={16} />;
    }

    case "paused": {
      return <Pause size={16} />;
    }

    case "failed":
    case "alert": {
      return <Clock size={16} />;
    }

    default: {
      return <Bell size={16} />;
    }
  }
}

function stampFor(row: NotificationRow, now: number, zone: string) {
  const today = dateKey(row.at, zone) === dateKey(now, zone);

  if (today) {
    return timeText(row.at, zone);
  }

  const formatter = new Intl.DateTimeFormat(copy.home.dateLocale, {
    day: "numeric",
    month: "short",
    timeZone: zone,
    weekday: "short",
  });

  return formatter.format(new Date(row.at)).replace(",", "");
}

function kindBadgeClass(kind: string) {
  switch (kind) {
    case "interview":
    case "offer": {
      return "border-ok/30 bg-ok-soft text-ok";
    }

    case "ready":
    case "review":
    case "code_wait": {
      return "border-signal/30 bg-signal-soft text-signal-text";
    }

    case "paused":
    case "failed":
    case "alert": {
      return "border-need/30 bg-need-soft text-need";
    }

    default: {
      return "border-border bg-muted text-foreground";
    }
  }
}

export function NotificationItem({
  now,
  onRead,
  row,
  zone,
}: {
  now: number;
  onRead: (id: string) => void;
  row: NotificationRow;
  zone: string;
}) {
  const label = ACTIONS.get(row.kind) ?? null;
  const unread = row.readAt === null;

  return (
    <li className="flex items-start gap-3.5 border-t border-border py-4 first:border-t-0">
      <span
        aria-hidden="true"
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${kindBadgeClass(row.kind)}`}
      >
        {renderKindIcon(row.kind)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
            {unread ? (
              <>
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-signal" />
                <span className="sr-only">{copy.notifications.page.unread}</span>
              </>
            ) : null}
            <span className="break-words">{row.title}</span>
          </p>
          <span className={dsMono}>{stampFor(row, now, zone)}</span>
        </div>
        <p className="mt-1 break-words text-sm leading-relaxed text-muted-foreground">{row.body}</p>
        {label === null ? null : (
          <div className="mt-3">
            <Button asChild size="sm" variant="outline">
              <Link
                onClick={() => {
                  onRead(row.id);
                }}
                to={row.url}
              >
                {label}
              </Link>
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}
