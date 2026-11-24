import {
  Bell,
  CircleHelp,
  Home,
  Inbox,
  MessageCircle,
  PanelLeftOpen,
  Search,
  Send,
  SquareKanban,
} from "lucide-react";
import { NavLink } from "react-router";

import type { NavCounts, PrimaryNavKey } from "../lib/nav-api.ts";

import { copy } from "../../shared/copy.ts";
import { NAV_DESTINATIONS, navBadgeClass, navBadgeCount, navLabel } from "../lib/nav-api.ts";
import { BrandMark } from "./brand-mark.tsx";
import { SidebarJobProfile } from "./sidebar-job-profile.tsx";
import { SidebarNavUser } from "./sidebar-nav-user.tsx";
import { Button } from "./ui/button.tsx";
import { Separator } from "./ui/separator.tsx";
import { TooltipHint } from "./ui/tooltip-hint.tsx";
import { UsageRing } from "./usage-ring.tsx";

const RAIL_ICONS: Record<PrimaryNavKey, typeof Home> = {
  applications: SquareKanban,
  home: Home,
  inbox: Inbox,
  ready: Send,
  review: CircleHelp,
};

const RAIL_ITEM_CLASS =
  "relative flex h-10 w-10 items-center justify-center rounded-md border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground";

const RAIL_IDLE = "border-transparent text-foreground hover:bg-muted";
const RAIL_ACTIVE = "border-border bg-card text-foreground shadow-sh";

export function BoardRail({
  counts,
  onExpand,
  onOpenSearch,
  unreadNotifications = 0,
}: {
  counts: NavCounts;
  onExpand: () => void;
  onOpenSearch: () => void;
  unreadNotifications?: number;
}) {
  const notificationsLabel =
    unreadNotifications > 0
      ? copy.shell.notifications(unreadNotifications)
      : copy.shell.notificationsEmpty;

  return (
    <aside
      className="hidden bg-sidebar px-2 py-4 md:fixed md:inset-y-0 md:left-0 md:z-20 md:flex md:w-18 md:flex-none md:flex-col md:items-center md:border-r md:border-border"
      data-shell-sidebar
    >
      <NavLink
        aria-label={copy.brand.homeAria}
        className="flex transition hover:opacity-80"
        to="/home"
      >
        <BrandMark size={32} />
      </NavLink>
      <TooltipHint label={copy.shell.expandSidebar}>
        <Button
          ariaLabel={copy.shell.expandSidebar}
          className="mt-3 h-9 w-9"
          onClick={onExpand}
          size="icon"
          variant="ghost"
        >
          <PanelLeftOpen aria-hidden="true" className="h-4 w-4" />
        </Button>
      </TooltipHint>
      <Separator className="mt-2.5 w-8" />
      <TooltipHint label={copy.shell.searchLabel}>
        <Button
          ariaLabel={copy.shell.searchLabel}
          className="mt-2.5 h-10 w-10"
          onClick={onOpenSearch}
          size="icon"
          variant="secondary"
        >
          <Search aria-hidden="true" className="h-4 w-4" />
        </Button>
      </TooltipHint>
      <Separator className="mt-2.5 w-8" />
      <nav
        aria-label={copy.nav.label}
        className="mt-2 flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 overflow-x-hidden overflow-y-auto px-2 py-1.5"
      >
        {NAV_DESTINATIONS.map((destination) => {
          const count = navBadgeCount(counts, destination.glyph);
          const Icon = RAIL_ICONS[destination.glyph];
          const label = navLabel(destination.glyph, count);

          return (
            <TooltipHint key={destination.to} label={label}>
              <NavLink end={destination.to === "/home"} to={destination.to}>
                {({ isActive }) => (
                  <span className={`${RAIL_ITEM_CLASS} ${isActive ? RAIL_ACTIVE : RAIL_IDLE}`}>
                    <span className="sr-only">{label}</span>
                    {isActive ? (
                      <span
                        aria-hidden="true"
                        className="absolute -left-px bottom-2 top-2 w-0.5 rounded-full bg-signal"
                      />
                    ) : null}
                    <Icon aria-hidden="true" size={20} />
                    {count === 0 ? null : (
                      <span
                        aria-hidden="true"
                        className={`absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-xs font-semibold leading-none tabular-nums ${navBadgeClass(destination.glyph)}`}
                        data-nav-badge={destination.glyph}
                      >
                        {count}
                      </span>
                    )}
                  </span>
                )}
              </NavLink>
            </TooltipHint>
          );
        })}
        <Separator className="my-1 w-8" />
        <SidebarJobProfile wide={false} />
        <Separator className="my-1 w-8" />
        <TooltipHint label={notificationsLabel}>
          <NavLink aria-label={notificationsLabel} to="/notifications">
            {({ isActive }) => (
              <span className={`${RAIL_ITEM_CLASS} ${isActive ? RAIL_ACTIVE : RAIL_IDLE}`}>
                {isActive ? (
                  <span
                    aria-hidden="true"
                    className="absolute -left-px bottom-2 top-2 w-0.5 rounded-full bg-signal"
                  />
                ) : null}
                <Bell aria-hidden="true" size={20} />
                {unreadNotifications > 0 ? (
                  <span
                    aria-hidden="true"
                    className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-signal px-1 text-xs font-semibold leading-none tabular-nums text-primary-ink"
                  >
                    {unreadNotifications}
                  </span>
                ) : null}
              </span>
            )}
          </NavLink>
        </TooltipHint>
        <TooltipHint label={copy.nav.support}>
          <NavLink aria-label={copy.nav.support} to="/support">
            {({ isActive }) => (
              <span className={`${RAIL_ITEM_CLASS} ${isActive ? RAIL_ACTIVE : RAIL_IDLE}`}>
                {isActive ? (
                  <span
                    aria-hidden="true"
                    className="absolute -left-px bottom-2 top-2 w-0.5 rounded-full bg-signal"
                  />
                ) : null}
                <MessageCircle aria-hidden="true" size={20} />
              </span>
            )}
          </NavLink>
        </TooltipHint>
      </nav>
      <div className="mt-auto flex flex-col items-center gap-2.5 pt-2">
        <UsageRing />
        <Separator className="w-8" />
        <SidebarNavUser compact />
      </div>
    </aside>
  );
}
