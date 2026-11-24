import { Bell, Search, User } from "lucide-react";
import { Link, useLocation } from "react-router";

import { copy } from "../../shared/copy.ts";
import { navTitleForPath } from "../lib/nav-api.ts";

const ACTION_CLASS =
  "relative inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar";

export function MobileTopHeader({
  onOpenSearch,
  unreadNotifications = 0,
}: {
  onOpenSearch: () => void;
  unreadNotifications?: number;
}) {
  const { pathname, search } = useLocation();

  return (
    <header
      className="sticky top-0 z-30 flex h-14 w-full flex-none items-center justify-between gap-2 border-b border-border bg-sidebar px-2 md:hidden"
      data-mobile-header
    >
      <p className="min-w-0 truncate px-2 text-base font-semibold text-foreground">
        {navTitleForPath(pathname, search)}
      </p>
      <nav aria-label={copy.nav.mobileActionsLabel} className="flex shrink-0 items-center gap-0.5">
        <button
          aria-label={copy.shell.searchLabel}
          className={ACTION_CLASS}
          onClick={onOpenSearch}
          type="button"
        >
          <Search aria-hidden="true" size={20} />
        </button>
        <Link
          aria-label={
            unreadNotifications > 0
              ? copy.shell.notifications(unreadNotifications)
              : copy.shell.notificationsEmpty
          }
          className={ACTION_CLASS}
          to="/notifications"
        >
          <Bell aria-hidden="true" size={20} />
          {unreadNotifications > 0 ? (
            <span
              aria-hidden="true"
              className="absolute right-2 top-2 h-2 w-2 rounded-full bg-signal"
              data-unread-dot
            />
          ) : null}
        </Link>
        <Link aria-label={copy.nav.profile} className={ACTION_CLASS} to="/profile">
          <User aria-hidden="true" size={20} />
        </Link>
      </nav>
    </header>
  );
}
