import {
  Bell,
  Calendar,
  CircleHelp,
  Inbox,
  MessageCircle,
  Send,
  SquareKanban,
  X,
} from "lucide-react";
import { useRef } from "react";
import { Link } from "react-router";

import type { NavCounts } from "../lib/nav-api.ts";

import { copy } from "../../shared/copy.ts";
import { PROFILE_SUBMENU } from "../lib/nav-api.ts";
import { useModalSheet } from "../lib/use-modal-sheet.ts";
import { AdminPortalMenuItem } from "./admin-portal-menu-item.tsx";
import { SidebarThemeToggle } from "./sidebar-theme-toggle.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { dsEyebrow } from "./ui/ds.ts";
import { Separator } from "./ui/separator.tsx";

export type MobileSheetKind = "board" | "profile" | "more";

function sheetTitleFor(kind: MobileSheetKind) {
  if (kind === "board") {
    return copy.nav.board;
  }

  if (kind === "profile") {
    return copy.nav.profile;
  }

  return copy.nav.profilePages.mobileMore;
}

function rowClass(active: boolean) {
  return `flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition ${
    active ? "bg-muted font-semibold text-signal-text" : "text-foreground hover:bg-muted"
  }`;
}

export function MobileNavSheet({
  counts,
  kind,
  onClose,
  pathname,
  unreadNotifications,
}: {
  counts: NavCounts;
  kind: MobileSheetKind;
  onClose: () => void;
  pathname: string;
  unreadNotifications: number;
}) {
  const title = sheetTitleFor(kind);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useModalSheet(dialogRef, onClose);

  return (
    <dialog
      aria-labelledby="mobile-nav-sheet-title"
      aria-modal="true"
      className="fixed inset-x-3 bottom-[72px] top-auto z-40 m-0 max-h-[75dvh] w-auto max-w-none overflow-y-auto rounded-xl border border-input bg-card p-4 text-foreground shadow-lift md:hidden"
      ref={dialogRef}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className={dsEyebrow} id="mobile-nav-sheet-title">
            {title}
          </h2>
          <Button
            ariaLabel={copy.ready.dismiss}
            className="h-11 w-11"
            onClick={onClose}
            size="icon"
            variant="ghost"
          >
            <X aria-hidden="true" size={16} />
          </Button>
        </div>

        {kind === "board" ? (
          <div className="flex flex-col gap-1">
            <Link className={rowClass(pathname === "/board")} onClick={onClose} to="/board">
              <SquareKanban aria-hidden="true" size={18} />
              <span className="flex-1">{copy.nav.board}</span>
            </Link>
            <Link className={rowClass(pathname === "/ready")} onClick={onClose} to="/ready">
              <Send aria-hidden="true" size={18} />
              <span className="flex-1">{copy.nav.ready}</span>
              {counts.ready > 0 ? (
                <Badge variant="ok">
                  <span data-nav-badge="ready">{counts.ready}</span>
                </Badge>
              ) : null}
            </Link>
            <Link className={rowClass(pathname === "/review")} onClick={onClose} to="/review">
              <CircleHelp aria-hidden="true" size={18} />
              <span className="flex-1">{copy.nav.review}</span>
              {counts.review > 0 ? (
                <Badge variant="need">
                  <span data-nav-badge="review">{counts.review}</span>
                </Badge>
              ) : null}
            </Link>
            <Link
              className={rowClass(pathname === "/inbox" || pathname.startsWith("/inbox/"))}
              onClick={onClose}
              to="/inbox"
            >
              <Inbox aria-hidden="true" size={18} />
              <span className="flex-1">{copy.nav.inbox}</span>
              {counts.inboxUnread > 0 ? (
                <Badge variant="secondary">
                  <span data-nav-badge="inbox">{counts.inboxUnread}</span>
                </Badge>
              ) : null}
            </Link>
            <Link className={rowClass(pathname === "/calendar")} onClick={onClose} to="/calendar">
              <Calendar aria-hidden="true" size={18} />
              <span className="flex-1">{copy.nav.calendar}</span>
            </Link>
          </div>
        ) : null}

        {kind === "profile" ? (
          <div className="flex flex-col gap-1">
            {PROFILE_SUBMENU.map((item) => (
              <Link
                className={rowClass(pathname === item.to)}
                key={item.key}
                onClick={onClose}
                to={item.to}
              >
                {item.label}
              </Link>
            ))}
            <AdminPortalMenuItem className={rowClass(false)} onSelect={onClose} />
          </div>
        ) : null}

        {kind === "more" ? (
          <div className="flex flex-col gap-2">
            <Link
              className={rowClass(pathname === "/notifications")}
              onClick={onClose}
              to="/notifications"
            >
              <Bell aria-hidden="true" size={18} />
              <span className="flex-1">{copy.shell.notificationsEmpty}</span>
              {unreadNotifications > 0 ? (
                <Badge variant="signal">{unreadNotifications}</Badge>
              ) : null}
            </Link>
            <Link className={rowClass(pathname === "/support")} onClick={onClose} to="/support">
              <MessageCircle aria-hidden="true" size={18} />
              <span className="flex-1">{copy.nav.support}</span>
            </Link>
            <Separator />
            <SidebarThemeToggle />
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
