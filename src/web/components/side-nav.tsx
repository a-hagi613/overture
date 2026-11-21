import { NavLink } from "react-router";

import { copy } from "../../shared/copy.ts";
import { NavGlyph } from "./nav-glyph.tsx";

const destinations = [
  { glyph: "home", to: "/" },
  {
    badge: copy.sample.readyToSend,
    badgeTone: "ok",
    glyph: "ready",
    to: "/ready",
  },
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

function badgeClass(tone: "ok" | "need" | "well") {
  if (tone === "need") {
    return "bg-need-soft text-need";
  }

  return tone === "ok" ? "bg-ok-soft text-ok" : "bg-muted text-foreground";
}

export function SideNav({ showLabels }: { showLabels: boolean }) {
  return (
    <nav aria-label={copy.nav.label} className="flex w-full flex-col gap-[3px]">
      {destinations.map((destination) => (
        <NavLink key={destination.to} to={destination.to} end={destination.to === "/"}>
          {({ isActive }) => (
            <span
              className={`relative flex min-h-10 items-center gap-3 rounded-md border px-3 text-sm font-medium leading-[21px] ${
                isActive
                  ? "border-border bg-card text-foreground shadow-sh"
                  : "border-transparent text-foreground hover:bg-muted"
              } ${showLabels ? "" : "justify-center"}`}
            >
              {isActive ? (
                <span className="absolute -left-px bottom-[9px] top-[9px] w-[3px] rounded-[2px] bg-signal" />
              ) : null}
              <NavGlyph name={destination.glyph} />
              {showLabels ? (
                <span className="whitespace-nowrap">{copy.nav[destination.glyph]}</span>
              ) : null}
              {"badge" in destination ? (
                <span
                  className={`${
                    showLabels
                      ? "ml-auto inline-flex min-w-[20px] px-1.5"
                      : "absolute right-1 top-[2px] inline-flex min-w-4 px-1"
                  } ${badgeClass(
                    destination.badgeTone,
                  )} ${showLabels ? "h-5 text-[11.5px]" : "h-4 text-[10px]"} items-center justify-center rounded-full font-bold`}
                >
                  {destination.badge}
                </span>
              ) : null}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
