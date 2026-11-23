import { NavLink } from "react-router";

import { copy } from "../../../shared/copy.ts";
import { adminDestinations } from "./admin-destinations.ts";

export function AdminChipNav() {
  return (
    <nav aria-label={copy.admin.navLabel} className="flex flex-wrap gap-2 lg:hidden">
      {adminDestinations.map((destination) => (
        <NavLink end={destination.end} key={destination.to} to={destination.to}>
          {({ isActive }) => (
            <span
              className={`inline-flex min-h-11 items-center rounded-full border px-3.5 text-xs font-semibold ${
                isActive
                  ? "border-foreground bg-foreground text-card"
                  : "border-input bg-card text-foreground hover:bg-muted"
              }`}
            >
              {destination.label}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
