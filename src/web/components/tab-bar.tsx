import { CircleHelp, Home, Inbox, Send, SquareKanban } from "lucide-react";
import { NavLink } from "react-router";

import type { PrimaryNavKey, NavCounts } from "../lib/nav-api.ts";

import { copy } from "../../shared/copy.ts";
import { NAV_DESTINATIONS, navBadgeClass, navBadgeCount, navLabel } from "../lib/nav-api.ts";

const TAB_ICONS: Record<PrimaryNavKey, typeof Home> = {
  applications: SquareKanban,
  home: Home,
  inbox: Inbox,
  ready: Send,
  review: CircleHelp,
};

export function TabBar({ counts }: { counts: NavCounts }) {
  return (
    <nav
      aria-label={copy.nav.tabBarLabel}
      className="sticky bottom-0 z-50 flex h-16 w-full flex-none items-stretch border-t border-border bg-sidebar md:hidden"
    >
      {NAV_DESTINATIONS.map((destination) => {
        const count = navBadgeCount(counts, destination.glyph);
        const Icon = TAB_ICONS[destination.glyph];

        return (
          <NavLink
            aria-label={navLabel(destination.glyph, count)}
            className={({ isActive }) =>
              `relative flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground ${
                isActive ? "text-foreground" : "text-foreground hover:bg-muted"
              }`
            }
            end={destination.to === "/home"}
            key={destination.to}
            to={destination.to}
          >
            {({ isActive }) => (
              <>
                {isActive ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-4 top-0 h-0.5 rounded-b-sm bg-signal"
                  />
                ) : null}
                <Icon aria-hidden="true" size={20} />
                <span aria-hidden="true">{copy.nav[destination.glyph]}</span>
                {count === 0 ? null : (
                  <span
                    aria-hidden="true"
                    className={`absolute right-4 top-2 flex h-4 min-w-4 items-center justify-center rounded-lg px-1 text-xs font-semibold tabular-nums ${navBadgeClass(destination.glyph)}`}
                    data-nav-badge={destination.glyph}
                  >
                    {count}
                  </span>
                )}
              </>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}
