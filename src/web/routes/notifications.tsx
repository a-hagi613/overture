import { useState } from "react";
import { Link } from "react-router";

import { copy } from "../../shared/copy.ts";
import { NavGlyph } from "../components/nav-glyph.tsx";
import { NotificationItem } from "../components/notification-item.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { PushOptIn } from "../components/push-opt-in.tsx";
import { dateKey } from "../lib/home-time.ts";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "../lib/notifications-api.ts";
import type { NotificationRow } from "../lib/notifications-api.ts";

const TIME_ZONE = new Intl.DateTimeFormat().resolvedOptions().timeZone;
const PERIOD = ".";

function leadDate(now: Date) {
  const weekday = now.toLocaleDateString(copy.home.dateLocale, { weekday: "long" });
  const month = now.toLocaleDateString(copy.home.dateLocale, { month: "long" });

  return `${weekday}, ${String(now.getDate())} ${month}`;
}

function undoApplicationId(url: string) {
  try {
    return new URL(url, "https://overture.local").searchParams.get("undo");
  } catch {
    return null;
  }
}

export function NotificationsPage() {
  const { data } = useNotifications();
  const markAll = useMarkAllNotificationsRead();
  const markRead = useMarkNotificationRead();
  const [undoError, setUndoError] = useState(false);
  const now = data?.now ?? 0;
  const rows = data?.notifications ?? [];
  const today = rows.filter((row) => dateKey(row.at, TIME_ZONE) === dateKey(now, TIME_ZONE));
  const earlier = rows.filter((row) => dateKey(row.at, TIME_ZONE) !== dateKey(now, TIME_ZONE));

  const undo = async (row: NotificationRow) => {
    const id = undoApplicationId(row.url);

    if (id === null) {
      return;
    }

    setUndoError(false);

    const response = await fetch(`/api/applications/${id}/undo-stage`, { method: "POST" });

    if (!response.ok) {
      setUndoError(true);

      return;
    }

    markRead.mutate(row.id);
  };

  const lead = data === undefined ? "" : leadDate(new Date(now));
  const empty = data !== undefined && rows.length === 0;
  const populated = data !== undefined && rows.length > 0;

  return (
    <div className="mx-auto max-w-[940px]">
      <PageHeader lead={lead} titleNode={copy.notifications.page.title} />
      {empty ? (
        <section
          className="mt-[26px] flex flex-col items-center gap-3.5 rounded-lg border border-border bg-card px-7 py-11 shadow-sh max-[767px]:px-4"
          data-testid="notifications-empty"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <NavGlyph name="bell" size={22} />
          </span>
          <h2 className="font-serif text-[30px] leading-[33px]">
            {copy.notifications.page.emptyTitle}
          </h2>
          <p className="max-w-[460px] text-center text-[14.5px] leading-[1.55] text-muted-foreground">
            {copy.notifications.page.emptyBody}
          </p>
          <Link
            className="mt-1.5 flex h-10 items-center justify-center rounded-md border border-foreground bg-foreground px-[18px] text-[13.5px] font-semibold text-card shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] max-[767px]:h-11"
            to="/settings"
          >
            {copy.notifications.page.emptyAction}
          </Link>
        </section>
      ) : null}
      {populated ? (
        <>
          <div className="mt-[22px] flex items-center justify-between gap-3">
            <h2 className="font-serif text-[26px] leading-[39px]">
              {copy.notifications.page.today}
            </h2>
            {data.unread > 0 ? (
              <button
                className="flex h-9 items-center justify-center rounded-md border border-input bg-card px-3.5 text-[13px] font-semibold hover:bg-muted"
                onClick={() => {
                  markAll.mutate();
                }}
                type="button"
              >
                {copy.notifications.page.markAll}
              </button>
            ) : null}
          </div>
          {today.length > 0 ? (
            <section
              aria-label="Notifications from today"
              className="mt-3.5 rounded-lg border border-border bg-card px-[22px] pb-[6px] pt-1 shadow-sh max-[767px]:px-4"
              data-testid="notifications-today"
            >
              <ul className="list-none pl-3.5">
                {today.map((row) => (
                  <NotificationItem
                    key={row.id}
                    now={now}
                    onAction={(target) => {
                      void undo(target);
                    }}
                    onRead={(id) => {
                      markRead.mutate(id);
                    }}
                    row={row}
                    zone={TIME_ZONE}
                  />
                ))}
              </ul>
            </section>
          ) : null}
          {earlier.length > 0 ? (
            <>
              <div className="mt-[26px] flex items-baseline gap-3.5">
                <h2 className="font-serif text-[26px] leading-[39px]">
                  {copy.notifications.page.earlier}
                </h2>
              </div>
              <section
                aria-label="Notifications from earlier"
                className="mt-3.5 rounded-lg border border-border bg-card px-[22px] pb-[6px] pt-1 shadow-sh max-[767px]:px-4"
                data-testid="notifications-earlier"
              >
                <ul className="list-none pl-3.5">
                  {earlier.map((row) => (
                    <NotificationItem
                      key={row.id}
                      now={now}
                      onAction={(target) => {
                        void undo(target);
                      }}
                      onRead={(id) => {
                        markRead.mutate(id);
                      }}
                      row={row}
                      zone={TIME_ZONE}
                    />
                  ))}
                </ul>
              </section>
            </>
          ) : null}
        </>
      ) : null}
      {undoError ? (
        <p className="mt-3 text-[12.5px] text-need">{copy.notifications.push.failed}</p>
      ) : null}
      <p className="mt-4 text-[12.5px] leading-[1.55] text-muted-foreground">
        {copy.notifications.page.footer}
        <Link className="underline decoration-border underline-offset-2" to="/settings">
          {copy.notifications.page.settings}
        </Link>
        {PERIOD}
      </p>
      <PushOptIn />
    </div>
  );
}
