import { NavLink, Outlet } from "react-router";

import { copy } from "../shared/copy.ts";

const destinations = [
  { to: "/", label: copy.nav.home },
  { to: "/board", label: copy.nav.board },
  { to: "/review", label: copy.nav.review },
  { to: "/inbox", label: copy.nav.inbox },
  { to: "/profile", label: copy.nav.profile },
];

export function AppShell() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground md:flex-row">
      <aside className="border-b border-border bg-sidebar px-6 py-4 md:w-[268px] md:border-r md:border-b-0 md:py-8">
        <p className="font-display text-2xl tracking-tight">{copy.app.name}</p>
        <nav aria-label={copy.nav.label} className="mt-6">
          <ul className="flex flex-wrap gap-2 md:flex-col md:gap-1">
            {destinations.map((destination) => (
              <li key={destination.to}>
                <NavLink
                  to={destination.to}
                  end={destination.to === "/"}
                  className="block rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground aria-[current=page]:bg-card aria-[current=page]:text-foreground"
                >
                  {destination.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <div className="min-w-0 flex-1 px-[18px] py-4 md:px-9 md:py-[26px]">
        <Outlet />
      </div>
    </div>
  );
}
