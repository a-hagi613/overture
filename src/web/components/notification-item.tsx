import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { dateKey, timeText } from "../lib/home-time.ts";
import type { NotificationRow } from "../lib/notifications-api.ts";
import { NavGlyph } from "./nav-glyph.tsx";

type GlyphName = Parameters<typeof NavGlyph>[0]["name"];

const ACTIONS = new Map(Object.entries(copy.notifications.page.actions));

function glyphFor(kind: string) {
  switch (kind) {
    case "ready": {
      return "send";
    }

    case "review": {
      return "review";
    }

    case "reply":
    case "interview":
    case "offer": {
      return "mail";
    }

    case "stage_move": {
      return "forward";
    }

    case "code_wait": {
      return "hash";
    }

    case "paused": {
      return "pause";
    }

    case "failed":
    case "alert": {
      return "clock";
    }

    default: {
      return "bell";
    }
  }
}

function toneFor(kind: string) {
  switch (kind) {
    case "ready": {
      return "bg-ok-soft text-ok";
    }

    case "review":
    case "paused":
    case "failed":
    case "alert": {
      return "bg-need-soft text-need";
    }

    case "reply":
    case "interview":
    case "offer":
    case "code_wait": {
      return "bg-signal-soft text-signal-text";
    }

    default: {
      return "bg-muted text-foreground";
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

  const date = formatter.format(new Date(row.at));

  return date.replace(",", "");
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
  const glyph: GlyphName = glyphFor(row.kind);

  return (
    <li className="relative flex gap-3.5 border-t border-border py-4 first:border-t-0">
      {unread ? (
        <span
          aria-hidden="true"
          className="absolute -left-2.5 top-[22px] block h-[7px] w-[7px] rounded-full bg-signal"
        />
      ) : null}
      <span
        className={`flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full ${toneFor(row.kind)}`}
      >
        <NavGlyph name={glyph} size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3.5 gap-y-1">
          <p className="text-[14.5px] font-semibold leading-[1.35]">
            {unread ? <span className="sr-only">{copy.notifications.page.unread} </span> : null}
            {row.title}
          </p>
          <span className="text-xs leading-[18px] text-muted-foreground">
            {stampFor(row, now, zone)}
          </span>
        </div>
        <p className="mt-[3px] text-[13.5px] leading-[1.5] text-muted-foreground">{row.body}</p>
        {label === null ? null : (
          <div className="mt-2.5 flex gap-2">
            {undoId === null ? (
              <Link
                className="flex h-[34px] items-center justify-center rounded-md border border-input bg-card px-3 text-[12.5px] font-semibold hover:bg-muted"
                onClick={() => {
                  onRead(row.id);
                }}
                to={row.url}
              >
                {label}
              </Link>
            ) : (
              <button
                className="flex h-[34px] items-center justify-center rounded-md border border-input bg-card px-3 text-[12.5px] font-semibold hover:bg-muted"
                onClick={() => {
                  onAction(row);
                }}
                type="button"
              >
                {label}
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
