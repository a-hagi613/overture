import {
  Bell,
  Calendar,
  CircleHelp,
  Home,
  Inbox,
  MessageCircle,
  Moon,
  PanelLeftOpen,
  Search,
  Send,
  SquareKanban,
  Sun,
} from "lucide-react";
import { NavLink } from "react-router";

import type { NavCounts, NavKey } from "../lib/nav-api.ts";

import { copy } from "../../shared/copy.ts";
import { BrandMark } from "./brand-mark.tsx";
import { SidebarProfileMenu } from "./sidebar-profile-menu.tsx";
import { Button } from "./ui/button.tsx";
import { Separator } from "./ui/separator.tsx";
import { UsageRing } from "./usage-ring.tsx";
import { NAV_DESTINATIONS, navBadgeClass, navBadgeCount, navLabel } from "../lib/nav-api.ts";
import { useTheme } from "../lib/theme-context.ts";

const RAIL_ICONS: Record<Exclude<NavKey, "profile" | "support">, typeof Home> = {
  board: SquareKanban,
  calendar: Calendar,
  home: Home,
  inbox: Inbox,
  ready: Send,
  review: CircleHelp,
};

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
  const { label, theme, toggleTheme } = useTheme();

  return (
    <aside
      className="board hidden overflow-visible bg-sidebar px-0 pb-4 pt-5 md:fixed md:left-0 md:top-0 md:z-20 md:flex md:h-dvh md:w-[76px] md:flex-none md:flex-col md:items-center md:self-start md:border-r md:border-border"
      data-shell-sidebar
    >
      <NavLink aria-label={copy.brand.homeAria} className="flex" to="/home">
        <BrandMark size={34} />
      </NavLink>
      <Button
        ariaLabel={copy.shell.expandSidebar}
        className="mt-4 hidden h-9 w-9 xl:flex"
        onClick={onExpand}
        size="icon"
        variant="ghost"
      >
        <PanelLeftOpen aria-hidden="true" size={18} />
      </Button>
      <Separator className="mt-3 w-9" />
      <Button
        ariaLabel={copy.shell.searchLabel}
        className="mt-3 h-10 w-10"
        onClick={onOpenSearch}
        size="icon"
        variant="secondary"
      >
        <Search aria-hidden="true" size={18} />
      </Button>
      <Separator className="mt-3 w-9" />
      <nav aria-label={copy.nav.label} className="mt-3 flex flex-1 flex-col items-center gap-1">
        {NAV_DESTINATIONS.map((destination) => {
          const count = navBadgeCount(counts, destination.glyph);
          const Icon = RAIL_ICONS[destination.glyph];

          return (
            <NavLink
              className={({ isActive }) => `rl ${isActive ? "on" : ""}`}
              end={destination.to === "/home"}
              key={destination.to}
              to={destination.to}
            >
              <span className="sr-only">{navLabel(destination.glyph, count)}</span>
              <Icon aria-hidden="true" size={20} />
              {count === 0 ? null : (
                <span
                  aria-hidden="true"
                  className={`rb num ${navBadgeClass(destination.glyph)}`}
                  data-nav-badge={destination.glyph}
                >
                  {count}
                </span>
              )}
            </NavLink>
          );
        })}
        <SidebarProfileMenu wide={false} />
        <NavLink
          aria-label={copy.nav.support}
          className={({ isActive }) => `rl ${isActive ? "on" : ""}`}
          to="/support"
        >
          <MessageCircle aria-hidden="true" size={20} />
        </NavLink>
        <NavLink
          aria-label={
            unreadNotifications > 0
              ? copy.shell.notifications(unreadNotifications)
              : copy.shell.notificationsEmpty
          }
          className={({ isActive }) => `rl ${isActive ? "on" : ""}`}
          to="/notifications"
        >
          <Bell aria-hidden="true" size={20} />
          {unreadNotifications > 0 ? (
            <span aria-hidden="true" className="rb num bg-signal text-primary-ink">
              {unreadNotifications}
            </span>
          ) : null}
        </NavLink>
      </nav>
      <div className="mt-auto flex flex-col items-center gap-2.5">
        <Button
          ariaLabel={label}
          ariaPressed={theme === "dark"}
          className="h-9 w-9"
          onClick={toggleTheme}
          size="icon"
          variant="secondary"
        >
          {theme === "dark" ? (
            <Sun aria-hidden="true" size={18} />
          ) : (
            <Moon aria-hidden="true" size={18} />
          )}
        </Button>
        <UsageRing />
      </div>
    </aside>
  );
}
