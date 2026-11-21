import { NavLink } from "react-router";

import type { NavCounts } from "../lib/nav-api.ts";

import { copy } from "../../shared/copy.ts";
import { AvatarLink } from "./avatar-link.tsx";
import { BrandMark } from "./brand-mark.tsx";
import { NavGlyph } from "./nav-glyph.tsx";
import { UsageRing } from "./usage-ring.tsx";
import { NAV_DESTINATIONS, navBadgeClass, navBadgeCount, navLabel } from "../lib/nav-api.ts";

export function BoardRail({
  counts,
  name,
  onExpand,
}: {
  counts: NavCounts;
  name: string | null;
  onExpand: () => void;
}) {
  return (
    <aside
      className="board hidden bg-sidebar px-0 pb-[18px] pt-5 shadow-[1px_0_0_var(--color-hl)] md:fixed md:left-0 md:top-0 md:z-20 md:flex md:h-dvh md:w-[76px] md:flex-none md:flex-col md:items-center md:self-start md:border-r md:border-border"
      data-shell-sidebar
    >
      <NavLink aria-label={copy.brand.homeAria} className="flex" to="/">
        <BrandMark size={34} />
      </NavLink>
      <button
        aria-label={copy.shell.expandSidebar}
        className="mt-[21px] hidden h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground xl:flex"
        onClick={onExpand}
        type="button"
      >
        <NavGlyph name="rail" size={18} />
      </button>
      <hr className="rule mt-4 w-9" />
      <nav
        aria-label={copy.nav.label}
        className="mt-4 flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto"
        data-scroll-region
      >
        {NAV_DESTINATIONS.map((destination) => {
          const count = navBadgeCount(counts, destination.glyph);

          return (
            <NavLink
              className={({ isActive }) => `rl ${isActive ? "on" : ""}`}
              end={destination.to === "/"}
              key={destination.to}
              to={destination.to}
            >
              <span className="sr-only">{navLabel(destination.glyph, count)}</span>
              <NavGlyph name={destination.glyph} size={20} />
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
      </nav>
      <div className="mt-auto flex flex-col items-center gap-3.5">
        <UsageRing />
        <AvatarLink name={name} wide={false} />
      </div>
    </aside>
  );
}
