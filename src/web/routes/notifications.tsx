import { Bell, CheckCheck } from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import { NotificationItem } from "../components/notification-item.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { PushOptIn } from "../components/push-opt-in.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card } from "../components/ui/card.tsx";
import { dsBody, dsCardTitle } from "../components/ui/ds.ts";
import { dateKey } from "../lib/home-time.ts";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "../lib/notifications-api.ts";
import type { NotificationRow } from "../lib/notifications-api.ts";

const TIME_ZONE = new Intl.DateTimeFormat().resolvedOptions().timeZone;
const PERIOD = ".";

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
  const now = data?.now ?? 0;
  const rows = data?.notifications ?? [];
  const today = rows.filter((row) => dateKey(row.at, TIME_ZONE) === dateKey(now, TIME_ZONE));
  const earlier = rows.filter((row) => dateKey(row.at, TIME_ZONE) !== dateKey(now, TIME_ZONE));

  const undo = async (row: NotificationRow) => {
    const id = undoApplicationId(row.url);

    if (id === null) {
      return;
    }

    const response = await fetch(`/api/applications/${id}/undo-stage`, { method: "POST" });

    if (!response.ok) {
      toast.error(copy.notifications.push.failed);

      return;
    }

    markRead.mutate(row.id);
    toast.success("Stage move undone.");
  };

  const empty = data !== undefined && rows.length === 0;
  const populated = data !== undefined && rows.length > 0;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader
          lead="Application updates, interview alerts, and items that need your attention."
          titleNode={
            <>
              {"Activity "}
              <em className="italic text-signal">{copy.notifications.page.title}</em>
            </>
          }
        />
        {populated && data.unread > 0 ? (
          <Button
            onClick={() => {
              markAll.mutate(undefined, {
                onSuccess: () => {
                  toast.success("All notifications marked as read.");
                },
              });
            }}
            size="sm"
            variant="outline"
          >
            <CheckCheck aria-hidden="true" size={15} />
            <span>{copy.notifications.page.markAll}</span>
          </Button>
        ) : null}
      </div>

      {empty ? (
        <Card
          className="mt-6 flex flex-col items-center gap-3 px-6 py-12 text-center"
          dataTestId="notifications-empty"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground">
            <Bell aria-hidden="true" size={20} />
          </span>
          <h2 className={dsCardTitle}>{copy.notifications.page.emptyTitle}</h2>
          <p className={`${dsBody} max-w-md`}>{copy.notifications.page.emptyBody}</p>
          <Button asChild className="mt-2" size="default" variant="primary">
            <Link to="/profile/account">{copy.notifications.page.emptyAction}</Link>
          </Button>
        </Card>
      ) : null}

      {populated ? (
        <div className="mt-6 space-y-6">
          {today.length > 0 ? (
            <div>
              <h2 className={dsCardTitle}>{copy.notifications.page.today}</h2>
              <Card
                ariaLabel="Notifications from today"
                className="mt-3 px-5 py-1"
                dataTestId="notifications-today"
              >
                <ul className="list-none">
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
              </Card>
            </div>
          ) : null}

          {earlier.length > 0 ? (
            <div>
              <h2 className={dsCardTitle}>{copy.notifications.page.earlier}</h2>
              <Card
                ariaLabel="Notifications from earlier"
                className="mt-3 px-5 py-1"
                dataTestId="notifications-earlier"
              >
                <ul className="list-none">
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
              </Card>
            </div>
          ) : null}
        </div>
      ) : null}

      <p className="mt-5 text-xs text-muted-foreground">
        {copy.notifications.page.footer}
        <Link className="font-semibold text-signal-text hover:underline" to="/profile/account">
          {copy.notifications.page.settings}
        </Link>
        {PERIOD}
      </p>
      <PushOptIn />
    </div>
  );
}
