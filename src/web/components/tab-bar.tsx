import { NavLink } from "react-router";

import type { NavCounts } from "../lib/nav-api.ts";

import { copy } from "../../shared/copy.ts";
import { NavGlyph } from "./nav-glyph.tsx";
import { NAV_DESTINATIONS, navBadgeClass, navBadgeCount, navLabel } from "../lib/nav-api.ts";

export function TabBar({ counts }: { counts: NavCounts }) {
  return (
    <nav
      aria-label={copy.nav.tabBarLabel}
      className="sticky bottom-0 z-10 flex h-16 w-full flex-none items-stretch border-t border-border bg-sidebar shadow-[0_-1px_0_var(--color-bloom)] md:hidden"
    >
      {NAV_DESTINATIONS.map((destination) => {
        const count = navBadgeCount(counts, destination.glyph);

        return (
          <NavLink
            key={destination.to}
            to={destination.to}
            end={destination.to === "/"}
            className="relative flex min-w-0 flex-1 flex-col items-center justify-center gap-[3px] text-[10.5px] font-semibold text-foreground hover:bg-muted"
          >
            {({ isActive }) => (
              <>
                <span className="sr-only">{navLabel(destination.glyph, count)}</span>
                {isActive ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-[22%] top-0 h-[2px] rounded-b-[2px] bg-signal"
                  />
                ) : null}
                <NavGlyph name={destination.glyph} size={21} />
                <span aria-hidden="true">{copy.nav[destination.glyph]}</span>
                {count === 0 ? null : (
                  <span
                    aria-hidden="true"
                    className={`absolute left-[calc(50%+6px)] top-[5px] flex h-4 min-w-4 items-center justify-center rounded-lg px-1 text-[10px] font-bold tabular-nums ${navBadgeClass(destination.glyph)}`}
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
