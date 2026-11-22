import { NavLink } from "react-router";

import type { NavCounts } from "../lib/nav-api.ts";

import { copy } from "../../shared/copy.ts";
import { NavGlyph } from "./nav-glyph.tsx";
import { SettingsMenu } from "./settings-menu.tsx";
import { NAV_DESTINATIONS, navBadgeClass, navBadgeCount, navLabel } from "../lib/nav-api.ts";

export function SideNav({ counts, showLabels }: { counts: NavCounts; showLabels: boolean }) {
  return (
    <nav aria-label={copy.nav.label} className="flex w-full flex-col gap-[3px]">
      {NAV_DESTINATIONS.map((destination) => {
        const count = navBadgeCount(counts, destination.glyph);

        return (
          <NavLink key={destination.to} to={destination.to} end={destination.to === "/"}>
            {({ isActive }) => (
              <span
                className={`relative flex min-h-10 items-center gap-3 rounded-md border px-3 text-sm font-medium leading-[21px] ${
                  isActive
                    ? "border-border bg-card text-foreground shadow-sh"
                    : "border-transparent text-foreground hover:bg-muted"
                } ${showLabels ? "" : "justify-center"}`}
              >
                <span className="sr-only">{navLabel(destination.glyph, count)}</span>
                {isActive ? (
                  <span
                    aria-hidden="true"
                    className="absolute -left-px bottom-[9px] top-[9px] w-[3px] rounded-[2px] bg-signal"
                  />
                ) : null}
                <NavGlyph name={destination.glyph} />
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
                        ? "ml-auto inline-flex min-w-[20px] px-1.5"
                        : "absolute right-1 top-[2px] inline-flex min-w-4 px-1"
                    } ${navBadgeClass(
                      destination.glyph,
                    )} ${showLabels ? "h-5 text-[11.5px]" : "h-4 text-[10px]"} items-center justify-center rounded-full font-bold`}
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
      <SettingsMenu showLabels={showLabels} />
    </nav>
  );
}
