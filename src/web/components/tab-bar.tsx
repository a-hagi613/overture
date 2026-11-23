import { Home, MoreHorizontal, Search, SquareKanban, User } from "lucide-react";
import { useState } from "react";
import { NavLink, useLocation } from "react-router";

import type { NavCounts } from "../lib/nav-api.ts";

import { copy } from "../../shared/copy.ts";
import { MobileNavSheet } from "./mobile-nav-sheet.tsx";
import type { MobileSheetKind } from "./mobile-nav-sheet.tsx";
import { navLabel } from "../lib/nav-api.ts";

const BOARD_PATHS = new Set(["/board", "/ready", "/review", "/inbox", "/calendar"]);

export function TabBar({
  counts,
  onOpenSearch,
  unreadNotifications = 0,
}: {
  counts: NavCounts;
  onOpenSearch: () => void;
  unreadNotifications?: number;
}) {
  const { pathname } = useLocation();
  const [openSheet, setOpenSheet] = useState<MobileSheetKind | null>(null);

  const boardAlerts = counts.ready + counts.review + counts.inboxUnread;
  const boardActive = openSheet === "board" || BOARD_PATHS.has(pathname);

  const profileActive = openSheet === "profile" || pathname.startsWith("/profile");

  const moreActive =
    openSheet === "more" || pathname === "/notifications" || pathname === "/support";

  const closeSheet = () => {
    setOpenSheet(null);
  };

  const toggleSheet = (kind: MobileSheetKind) => {
    setOpenSheet((current) => (current === kind ? null : kind));
  };

  return (
    <>
      {openSheet === null ? null : (
        <MobileNavSheet
          counts={counts}
          kind={openSheet}
          onClose={closeSheet}
          pathname={pathname}
          unreadNotifications={unreadNotifications}
        />
      )}

      <nav
        aria-label={copy.nav.tabBarLabel}
        className="sticky bottom-0 z-50 flex h-16 w-full flex-none items-stretch border-t border-border bg-sidebar md:hidden"
      >
        <NavLink
          className="relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-xs font-semibold text-foreground transition hover:bg-muted"
          end
          onClick={closeSheet}
          to="/home"
        >
          {({ isActive }) => (
            <>
              <span className="sr-only">{navLabel("home", 0)}</span>
              {isActive && openSheet === null ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-4 top-0 h-0.5 rounded-b-sm bg-signal"
                />
              ) : null}
              <Home aria-hidden="true" size={20} />
              <span aria-hidden="true">{copy.nav.home}</span>
            </>
          )}
        </NavLink>

        <button
          aria-expanded={openSheet === "board"}
          aria-haspopup="menu"
          className="relative flex min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-1 text-xs font-semibold text-foreground transition hover:bg-muted"
          onClick={() => {
            toggleSheet("board");
          }}
          type="button"
        >
          {boardActive ? (
            <span
              aria-hidden="true"
              className="absolute inset-x-4 top-0 h-0.5 rounded-b-sm bg-signal"
            />
          ) : null}
          <SquareKanban aria-hidden="true" size={20} />
          <span>{copy.nav.board}</span>
          {boardAlerts > 0 ? (
            <span
              aria-hidden="true"
              className="absolute right-4 top-2 h-2 w-2 rounded-full bg-signal"
              data-nav-badge-dot="board"
            />
          ) : null}
        </button>

        <div className="flex flex-1 items-center justify-center">
          <button
            aria-label={copy.shell.searchLabel}
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-signal bg-signal text-primary-ink shadow-sh transition hover:opacity-90"
            onClick={() => {
              closeSheet();
              onOpenSearch();
            }}
            type="button"
          >
            <Search aria-hidden="true" size={20} />
          </button>
        </div>

        <button
          aria-expanded={openSheet === "profile"}
          aria-haspopup="menu"
          className="relative flex min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-1 text-xs font-semibold text-foreground transition hover:bg-muted"
          onClick={() => {
            toggleSheet("profile");
          }}
          type="button"
        >
          {profileActive ? (
            <span
              aria-hidden="true"
              className="absolute inset-x-4 top-0 h-0.5 rounded-b-sm bg-signal"
            />
          ) : null}
          <User aria-hidden="true" size={20} />
          <span>{copy.nav.profile}</span>
        </button>

        <button
          aria-expanded={openSheet === "more"}
          aria-haspopup="menu"
          className="relative flex min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-1 text-xs font-semibold text-foreground transition hover:bg-muted"
          onClick={() => {
            toggleSheet("more");
          }}
          type="button"
        >
          {moreActive ? (
            <span
              aria-hidden="true"
              className="absolute inset-x-4 top-0 h-0.5 rounded-b-sm bg-signal"
            />
          ) : null}
          <MoreHorizontal aria-hidden="true" size={20} />
          <span>{copy.nav.profilePages.mobileMore}</span>
          {unreadNotifications > 0 ? (
            <span
              aria-hidden="true"
              className="absolute right-4 top-2 h-2 w-2 rounded-full bg-signal"
            />
          ) : null}
        </button>
      </nav>
    </>
  );
}
