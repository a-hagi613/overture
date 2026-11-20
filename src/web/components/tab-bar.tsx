import { NavLink } from "react-router";

import { copy } from "../../shared/copy.ts";
import { NavGlyph } from "./nav-glyph.tsx";

const destinations = [
  { glyph: "home", to: "/" },
  { glyph: "board", to: "/board" },
  {
    badge: copy.sample.reviewWaiting,
    badgeTone: "need",
    glyph: "review",
    to: "/review",
  },
  {
    badge: copy.sample.inboxUnread,
    badgeTone: "well",
    glyph: "inbox",
    to: "/inbox",
  },
  { glyph: "profile", to: "/profile" },
] as const;

export function TabBar() {
  return (
    <nav
      aria-label={copy.nav.tabBarLabel}
      className="sticky bottom-0 z-10 flex h-16 w-full flex-none items-stretch border-t border-border bg-sidebar shadow-[0_-1px_0_var(--color-bloom)] md:hidden"
    >
      {destinations.map((destination) => (
        <NavLink
          key={destination.to}
          to={destination.to}
          end={destination.to === "/"}
          className={({ isActive }) =>
            `relative flex min-w-0 flex-1 flex-col items-center justify-center gap-[3px] text-[10.5px] font-semibold ${
              isActive ? "text-foreground" : "text-muted-foreground"
            }`
          }
        >
          {({ isActive }) => (
            <>
              {isActive ? (
                <span className="absolute inset-x-[22%] top-0 h-[2px] rounded-b-[2px] bg-signal" />
              ) : null}
              <NavGlyph name={destination.glyph} size={21} />
              {copy.nav[destination.glyph]}
              {"badge" in destination ? (
                <span
                  className={`absolute left-[calc(50%+6px)] top-[5px] flex h-4 min-w-4 items-center justify-center rounded-lg px-1 text-[10px] font-bold tabular-nums ${
                    destination.badgeTone === "need"
                      ? "bg-need-soft text-need"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {destination.badge}
                </span>
              ) : null}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
