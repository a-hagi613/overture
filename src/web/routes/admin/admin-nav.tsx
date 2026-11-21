import { NavLink } from "react-router";

import { copy } from "../../../shared/copy.ts";
import { NavGlyph } from "../../components/nav-glyph.tsx";
import { adminDestinations } from "./admin-destinations.ts";

export function AdminSideNav() {
  return (
    <nav aria-label={copy.admin.navLabel} className="mt-7 flex w-full flex-col gap-[3px]">
      {adminDestinations.map((destination) => (
        <NavLink end={destination.end} key={destination.to} to={destination.to}>
          {({ isActive }) => (
            <span
              className={`relative flex min-h-10 items-center gap-3 rounded-md border px-3 text-[13.5px] font-medium leading-[21px] ${
                isActive
                  ? "border-border bg-card text-foreground shadow-sh"
                  : "border-transparent text-foreground hover:bg-muted"
              }`}
            >
              {isActive ? (
                <span className="absolute -left-px bottom-[9px] top-[9px] w-[3px] rounded-[2px] bg-signal" />
              ) : null}
              <NavGlyph name={destination.glyph} />
              <span className="whitespace-nowrap">{destination.label}</span>
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
