import { ArrowRight, Bell, CircleHelp, Clock, Hash, Mail, Pause, Send } from "lucide-react";
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
      return <Send size={16} />;
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

function undoApplicationId(url: string) {
  try {
    return new URL(url, "https://overture.local").searchParams.get("undo");
  } catch {
    return null;
  }
}

export function NotificationItem({
  now,
  onAction,
  onRead,
  row,
  zone,
}: {
  now: number;
  onAction: (row: NotificationRow) => void;
  onRead: (id: string) => void;
  row: NotificationRow;
  zone: string;
}) {
  const label = ACTIONS.get(row.kind) ?? null;
  const undoId = undoApplicationId(row.url);
  const unread = row.readAt === null;

  return (
    <li className="flex items-start gap-3.5 border-t border-border py-4 first:border-t-0">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-foreground"
      >
        {renderKindIcon(row.kind)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {unread ? (
              <>
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-signal" />
                <span className="sr-only">{copy.notifications.page.unread}</span>
              </>
            ) : null}
            <span>{row.title}</span>
          </p>
          <span className={dsMono}>{stampFor(row, now, zone)}</span>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{row.body}</p>
        {label === null ? null : (
          <div className="mt-3">
            {undoId === null ? (
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
            ) : (
              <Button
                onClick={() => {
                  onAction(row);
                }}
                size="sm"
                variant="outline"
              >
                {label}
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
