import { Bell, CircleHelp, Home, Inbox, MessageCircle, Send, SquareKanban } from "lucide-react";
import { NavLink } from "react-router";

import type { NavCounts, PrimaryNavKey } from "../lib/nav-api.ts";

import { copy } from "../../shared/copy.ts";
import { NAV_DESTINATIONS, navBadgeClass, navBadgeCount, navLabel } from "../lib/nav-api.ts";
import { SidebarProfileMenu } from "./sidebar-profile-menu.tsx";
import { Badge } from "./ui/badge.tsx";
import { Separator } from "./ui/separator.tsx";

const NAV_ICONS: Record<PrimaryNavKey, typeof Home> = {
  applications: SquareKanban,
  home: Home,
  inbox: Inbox,
  ready: Send,
  review: CircleHelp,
};

const ROW_CLASS =
  "relative flex min-h-11 items-center gap-3.5 rounded-md border px-3 text-base font-medium transition";

const ROW_IDLE = "border-transparent text-foreground hover:bg-muted";
const ROW_ACTIVE = "border-border bg-card text-foreground shadow-sh";

export function SideNav({
  counts,
  showLabels,
  unreadNotifications = 0,
}: {
  counts: NavCounts;
  showLabels: boolean;
  unreadNotifications?: number;
}) {
  return (
    <nav aria-label={copy.nav.label} className="flex w-full flex-col gap-0.5">
      {NAV_DESTINATIONS.map((destination) => {
        const count = navBadgeCount(counts, destination.glyph);
        const Icon = NAV_ICONS[destination.glyph];

        return (
          <NavLink end={destination.to === "/home"} key={destination.to} to={destination.to}>
            {({ isActive }) => (
              <span
                className={`${ROW_CLASS} ${isActive ? ROW_ACTIVE : ROW_IDLE} ${showLabels ? "" : "justify-center"}`}
              >
                <span className="sr-only">{navLabel(destination.glyph, count)}</span>
                {isActive ? (
                  <span
                    aria-hidden="true"
                    className="absolute -left-px bottom-2 top-2 w-0.5 rounded-full bg-signal"
                  />
                ) : null}
                <Icon aria-hidden="true" className="shrink-0" size={20} />
                {showLabels ? (
                  <span aria-hidden="true" className="whitespace-nowrap">
                    {copy.nav[destination.glyph]}
                  </span>
                ) : null}
                {count === 0 ? null : (
                  <span
                    aria-hidden="true"
                    className={`${
                      showLabels
                        ? "ml-auto inline-flex min-w-5 px-1.5"
                        : "absolute right-1 top-0.5 inline-flex min-w-4 px-1"
                    } ${navBadgeClass(
                      destination.glyph,
                    )} h-5 items-center justify-center rounded-full text-xs font-semibold tabular-nums`}
                    data-nav-badge={destination.glyph}
                  >
                    {count}
                  </span>
                )}
              </span>
            )}
          </NavLink>
        );
      })}
      <Separator className="my-1.5" />
      <NavLink to="/notifications">
        {({ isActive }) => (
          <span className={`${ROW_CLASS} ${isActive ? ROW_ACTIVE : ROW_IDLE}`}>
            <span className="sr-only">
              {unreadNotifications > 0
                ? copy.shell.notifications(unreadNotifications)
                : copy.shell.notificationsEmpty}
            </span>
            {isActive ? (
              <span
                aria-hidden="true"
                className="absolute -left-px bottom-2 top-2 w-0.5 rounded-full bg-signal"
              />
            ) : null}
            <Bell aria-hidden="true" className="shrink-0" size={20} />
            {showLabels ? (
              <span aria-hidden="true" className="whitespace-nowrap">
                {copy.shell.notificationsEmpty}
              </span>
            ) : null}
            {unreadNotifications > 0 ? (
              <Badge ariaHidden className="ml-auto tabular-nums" variant="signal">
                {unreadNotifications}
              </Badge>
            ) : null}
          </span>
        )}
      </NavLink>
      <NavLink to="/support">
        {({ isActive }) => (
          <span
            className={`${ROW_CLASS} ${isActive ? ROW_ACTIVE : ROW_IDLE} ${showLabels ? "" : "justify-center"}`}
          >
            {isActive ? (
              <span
                aria-hidden="true"
                className="absolute -left-px bottom-2 top-2 w-0.5 rounded-full bg-signal"
              />
            ) : null}
            <MessageCircle aria-hidden="true" className="shrink-0" size={20} />
            {showLabels ? (
              <span className="whitespace-nowrap">{copy.nav.support}</span>
            ) : (
              <span className="sr-only">{copy.nav.support}</span>
            )}
          </span>
        )}
      </NavLink>
      <SidebarProfileMenu wide={showLabels} />
    </nav>
  );
}
