import { NavLink } from "react-router";

import { copy } from "../../shared/copy.ts";
import { AvatarLink } from "./avatar-link.tsx";
import { BrandMark } from "./brand-mark.tsx";
import { NavGlyph } from "./nav-glyph.tsx";
import { UsageRing } from "./usage-ring.tsx";

const destinations = [
  { glyph: "home", to: "/" },
  { glyph: "board", to: "/board" },
  { badge: copy.sample.reviewWaiting, badgeTone: "need", glyph: "review", to: "/review" },
  { badge: copy.sample.inboxUnread, badgeTone: "well", glyph: "inbox", to: "/inbox" },
  { glyph: "profile", to: "/profile" },
] as const;

function labelFor(destination: (typeof destinations)[number]) {
  if (!("badge" in destination)) {
    return copy.nav[destination.glyph];
  }

  if (destination.glyph === "review") {
    return copy.shell.counters.reviewAria;
  }

  return copy.shell.counters.inboxAria;
}

export function BoardRail({ onExpand, name }: { onExpand: () => void; name: string | null }) {
  return (
    <aside className="board hidden bg-sidebar px-0 pb-[18px] pt-5 shadow-[1px_0_0_var(--color-hl)] md:flex md:w-[76px] md:flex-col md:items-center md:border-r md:border-border">
      <NavLink aria-label={copy.brand.homeAria} className="flex" to="/">
        <BrandMark size={34} />
      </NavLink>
      <button
        aria-label={copy.shell.expandSidebar}
        className="mt-[21px] flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={onExpand}
        type="button"
      >
        <NavGlyph name="rail" size={18} />
      </button>
      <hr className="rule mt-4 w-9" />
      <nav aria-label={copy.nav.label} className="mt-4 flex flex-col items-center gap-1.5">
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
              <span
                className={`rb num ${
                  destination.badgeTone === "need"
                    ? "bg-need-soft text-need"
                    : "bg-muted text-foreground"
                }`}
              >
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
