import { Bell, CheckCheck } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import { NotificationItem } from "../components/notification-item.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card } from "../components/ui/card.tsx";
import { dsBody, dsCardTitle } from "../components/ui/ds.ts";
import { useHomeData } from "../lib/home-api.ts";
import { dateKey } from "../lib/home-time.ts";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "../lib/notifications-api.ts";

const BROWSER_TIME_ZONE = new Intl.DateTimeFormat().resolvedOptions().timeZone;
const INITIAL_VISIBLE_NOTIFICATIONS = 5;
const PERIOD = ".";

export function NotificationsPage() {
  const { data, isError, isPending, refetch } = useNotifications();
  const home = useHomeData();
  const markAll = useMarkAllNotificationsRead();
  const markRead = useMarkNotificationRead();
  const [showAllToday, setShowAllToday] = useState(false);
  const [showAllEarlier, setShowAllEarlier] = useState(false);
  const now = data?.now ?? 0;
  const rows = data?.notifications ?? [];
  const timeZone = home.data?.timeZone ?? BROWSER_TIME_ZONE;
  const today = rows.filter((row) => dateKey(row.at, timeZone) === dateKey(now, timeZone));
  const earlier = rows.filter((row) => dateKey(row.at, timeZone) !== dateKey(now, timeZone));
  const visibleToday = showAllToday ? today : today.slice(0, INITIAL_VISIBLE_NOTIFICATIONS);
  const visibleEarlier = showAllEarlier ? earlier : earlier.slice(0, INITIAL_VISIBLE_NOTIFICATIONS);

  const empty = !isPending && !isError && rows.length === 0;
  const populated = !isPending && !isError && rows.length > 0;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        actions={
          populated && data.unread > 0 ? (
            <Button
              ariaBusy={markAll.isPending}
              disabled={markAll.isPending}
              onClick={() => {
                markAll.mutate(undefined, {
                  onError: () => {
                    toast.error(copy.notifications.push.failed);
                  },
                  onSuccess: () => {
                    toast.success(copy.notifications.page.allMarkedRead);
                  },
                });
              }}
              size="sm"
              variant="outline"
            >
              <CheckCheck aria-hidden="true" size={15} />
              <span>{copy.notifications.page.markAll}</span>
            </Button>
          ) : undefined
        }
        titleNode={copy.notifications.page.title}
      />

      {isPending ? (
        <Card ariaBusy className="mt-6 p-6">
          <div className="animate-pulse space-y-3">
            <span className="sr-only">{copy.shell.loadingPage}</span>
            <div className="h-5 w-1/3 rounded bg-muted" />
            <div className="h-16 w-full rounded bg-muted" />
            <div className="h-16 w-full rounded bg-muted" />
          </div>
        </Card>
      ) : null}

      {isError ? (
        <Card className="mt-6 flex flex-wrap items-center justify-between gap-4 p-6">
          <p className="text-sm font-semibold text-foreground" role="alert">
            {copy.notifications.page.loadFailed}
          </p>
          <Button
            onClick={() => {
              void refetch();
            }}
            size="sm"
            variant="outline"
          >
            {copy.inbox.retry}
          </Button>
        </Card>
      ) : null}

      {empty ? (
        <Card
          className="mt-6 flex flex-col items-center gap-3 px-6 py-12 text-center"
          dataTestId="notifications-empty"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground">
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
                ariaLabel={copy.notifications.page.todayRegion}
                className="mt-3 px-5 py-1"
                dataTestId="notifications-today"
              >
                <ul className="list-none">
                  {visibleToday.map((row) => (
                    <NotificationItem
                      key={row.id}
                      now={now}
                      onRead={(id) => {
                        markRead.mutate(id);
                      }}
                      row={row}
                      zone={timeZone}
                    />
                  ))}
                </ul>
                {today.length > INITIAL_VISIBLE_NOTIFICATIONS ? (
                  <div className="border-t border-border py-3">
                    <Button
                      onClick={() => {
                        setShowAllToday((open) => !open);
                      }}
                      size="sm"
                      variant="outline"
                    >
                      {showAllToday
                        ? copy.notifications.page.showLess
                        : copy.notifications.page.showMore(
                            today.length - INITIAL_VISIBLE_NOTIFICATIONS,
                          )}
                    </Button>
                  </div>
                ) : null}
              </Card>
            </div>
          ) : null}

          {earlier.length > 0 ? (
            <div>
              <h2 className={dsCardTitle}>{copy.notifications.page.earlier}</h2>
              <Card
                ariaLabel={copy.notifications.page.earlierRegion}
                className="mt-3 px-5 py-1"
                dataTestId="notifications-earlier"
              >
                <ul className="list-none">
                  {visibleEarlier.map((row) => (
                    <NotificationItem
                      key={row.id}
                      now={now}
                      onRead={(id) => {
                        markRead.mutate(id);
                      }}
                      row={row}
                      zone={timeZone}
                    />
                  ))}
                </ul>
                {earlier.length > INITIAL_VISIBLE_NOTIFICATIONS ? (
                  <div className="border-t border-border py-3">
                    <Button
                      onClick={() => {
                        setShowAllEarlier((open) => !open);
                      }}
                      size="sm"
                      variant="outline"
                    >
                      {showAllEarlier
                        ? copy.notifications.page.showLess
                        : copy.notifications.page.showMore(
                            earlier.length - INITIAL_VISIBLE_NOTIFICATIONS,
                          )}
                    </Button>
                  </div>
                ) : null}
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
    </div>
  );
}
