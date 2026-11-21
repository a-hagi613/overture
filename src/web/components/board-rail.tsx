import { NavLink } from "react-router";

import { copy } from "../../shared/copy.ts";
import { AvatarLink } from "./avatar-link.tsx";
import { BrandMark } from "./brand-mark.tsx";
import { NavGlyph } from "./nav-glyph.tsx";
import { UsageRing } from "./usage-ring.tsx";

const destinations = [
  { glyph: "home", to: "/" },
  { badge: copy.sample.readyToSend, badgeTone: "ok", glyph: "ready", to: "/ready" },
  { glyph: "board", to: "/board" },
  { badge: copy.sample.reviewWaiting, badgeTone: "need", glyph: "review", to: "/review" },
  { badge: copy.sample.inboxUnread, badgeTone: "well", glyph: "inbox", to: "/inbox" },
  { glyph: "profile", to: "/profile" },
] as const;

function labelFor(destination: (typeof destinations)[number]) {
  if (!("badge" in destination)) {
    return copy.nav[destination.glyph];
  }

  if (destination.glyph === "ready") {
    return copy.sample.readyAria;
  }

  if (destination.glyph === "review") {
    return copy.shell.counters.reviewAria;
  }

  return copy.shell.counters.inboxAria;
}

function badgeClass(tone: "ok" | "need" | "well") {
  if (tone === "need") {
    return "bg-need-soft text-need";
  }

  return tone === "ok" ? "bg-ok-soft text-ok" : "bg-muted text-foreground";
}

export function BoardRail({ onExpand, name }: { onExpand: () => void; name: string | null }) {
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
        {destinations.map((destination) => (
          <NavLink
            aria-label={labelFor(destination)}
            className={({ isActive }) => `rl ${isActive ? "on" : ""}`}
            end={destination.to === "/"}
            key={destination.to}
            to={destination.to}
          >
            <NavGlyph name={destination.glyph} size={20} />
            {"badge" in destination ? (
              <span className={`rb num ${badgeClass(destination.badgeTone)}`}>
                {destination.badge}
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto flex flex-col items-center gap-3.5">
        <UsageRing />
        <AvatarLink name={name} wide={false} />
      </div>
    </aside>
  );
}
