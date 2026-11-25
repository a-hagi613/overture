import {
  Bell,
  Calendar,
  CalendarClock,
  CircleHelp,
  ClipboardList,
  Columns3,
  Files,
  FileText,
  Home,
  Inbox,
  ListChecks,
  MessageCircle,
  SlidersHorizontal,
  UserSearch,
} from "lucide-react";
import { Link, NavLink, useLocation } from "react-router";

import type { NavCounts } from "../lib/nav-api.ts";

import { copy } from "../../shared/copy.ts";
import { isSidebarNavActive, navBadgeClass, navBadgeCount, navLabel } from "../lib/nav-api.ts";
import { SidebarNavGroup } from "./sidebar-nav-group.tsx";
import type { SidebarGroupItem } from "./sidebar-nav-group.tsx";
import { Separator } from "./ui/separator.tsx";

const ROW_CLASS =
  "relative flex min-h-8 items-center gap-3 rounded-md border px-2.5 text-sm font-medium transition";

const ROW_IDLE = "border-transparent text-foreground hover:bg-muted";
const ROW_ACTIVE = "border-border bg-card text-foreground";

export function SideNav({
  counts,
  onNavigate,
  showLabels,
  unreadNotifications = 0,
}: {
  counts: NavCounts;
  onNavigate?: (() => void) | undefined;
  showLabels: boolean;
  unreadNotifications?: number;
}) {
  const { pathname, search } = useLocation();
  const homeActive = isSidebarNavActive("home", pathname, search);
  const readyCount = navBadgeCount(counts, "ready");
  const reviewCount = navBadgeCount(counts, "review");
  const inboxCount = navBadgeCount(counts, "inbox");

  const applicationsItems: SidebarGroupItem[] = [
    {
      badgeClass: navBadgeClass("ready"),
      badgeCount: readyCount,
      badgeKey: "ready",
      icon: ListChecks,
      isActive: isSidebarNavActive("ready", pathname, search),
      key: "ready",
      label: copy.nav.ready,
      srLabel: navLabel("ready", readyCount),
      to: "/ready",
    },
    {
      badgeClass: navBadgeClass("review"),
      badgeCount: reviewCount,
      badgeKey: "review",
      icon: CircleHelp,
      isActive: isSidebarNavActive("review", pathname, search),
      key: "review",
      label: copy.nav.review,
      srLabel: navLabel("review", reviewCount),
      to: "/review",
    },
    {
      icon: Columns3,
      isActive: isSidebarNavActive("tracker", pathname, search),
      key: "tracker",
      label: copy.nav.tracker,
      srLabel: navLabel("tracker", 0),
      to: "/tracker",
    },
  ];

  const profileItems: SidebarGroupItem[] = [
    {
      icon: FileText,
      isActive: pathname === "/profile/resume",
      key: "resume",
      label: copy.nav.profileMenu.resume,
      to: "/profile/resume",
    },
    {
      icon: SlidersHorizontal,
      isActive: pathname === "/profile/preferences",
      key: "preferences",
      label: copy.nav.profileMenu.preferences,
      to: "/profile/preferences",
    },
    {
      icon: ClipboardList,
      isActive: pathname === "/profile/details",
      key: "details",
      label: copy.nav.profileMenu.details,
      to: "/profile/details",
    },
  ];

  const followUpsItems: SidebarGroupItem[] = [
    {
      badgeClass: navBadgeClass("inbox"),
      badgeCount: inboxCount,
      badgeKey: "inbox",
      icon: Inbox,
      isActive: isSidebarNavActive("inbox", pathname, search),
      key: "inbox",
      label: copy.nav.inbox,
      srLabel: navLabel("inbox", inboxCount),
      to: "/inbox",
    },
    {
      icon: Calendar,
      isActive: isSidebarNavActive("calendar", pathname, search),
      key: "calendar",
      label: copy.nav.calendar,
      srLabel: navLabel("calendar", 0),
      to: "/calendar",
    },
  ];

  const applicationsBadgeClass = reviewCount > 0 ? navBadgeClass("review") : navBadgeClass("ready");

  return (
    <nav aria-label={copy.nav.label} className="flex w-full flex-col gap-0.5">
      <Link
        aria-current={homeActive ? "page" : undefined}
        className={`${ROW_CLASS} ${homeActive ? ROW_ACTIVE : ROW_IDLE} ${showLabels ? "" : "justify-center"}`}
        onClick={onNavigate}
        to="/home"
      >
        <span className="sr-only">{navLabel("home", 0)}</span>
        {homeActive ? (
          <span
            aria-hidden="true"
            className="absolute -left-px bottom-1.5 top-1.5 w-0.5 rounded-full bg-signal"
          />
        ) : null}
        <Home aria-hidden="true" className="shrink-0" size={18} />
        {showLabels ? (
          <span aria-hidden="true" className="whitespace-nowrap">
            {copy.nav.home}
          </span>
        ) : null}
      </Link>

      <Separator className="my-2.5" />

      <SidebarNavGroup
        badgeClass={applicationsBadgeClass}
        badgeCount={readyCount + reviewCount}
        icon={Files}
        items={applicationsItems}
        label={copy.nav.applicationsGroup}
        menuLabel={copy.nav.applicationsMenuLabel}
        onNavigate={onNavigate}
        storageKey="overture.sidebar.applicationsOpen"
        wide={showLabels}
      />

      <Separator className="my-1.5" />

      <SidebarNavGroup
        icon={UserSearch}
        items={profileItems}
        label={copy.nav.jobProfile}
        menuLabel={copy.nav.jobProfileMenuLabel}
        onNavigate={onNavigate}
        storageKey="overture.jobProfileOpen"
        wide={showLabels}
      />

      <Separator className="my-1.5" />

      <SidebarNavGroup
        badgeClass={navBadgeClass("inbox")}
        badgeCount={inboxCount}
        icon={CalendarClock}
        items={followUpsItems}
        label={copy.nav.followUpsGroup}
        menuLabel={copy.nav.followUpsMenuLabel}
        onNavigate={onNavigate}
        storageKey="overture.sidebar.followUpsOpen"
        wide={showLabels}
      />

      <Separator className="my-1.5" />

      <NavLink onClick={onNavigate} to="/notifications">
        {({ isActive }) => (
          <span className={`${ROW_CLASS} ${isActive ? ROW_ACTIVE : ROW_IDLE}`}>
            <span className="sr-only">
              {unreadNotifications > 0
                ? copy.shell.notifications(unreadNotifications)
                : copy.shell.notificationsEmpty}
            </span>
            {isActive ? (
              <span
                aria-hidden="true"
                className="absolute -left-px bottom-1.5 top-1.5 w-0.5 rounded-full bg-signal"
              />
            ) : null}
            <Bell aria-hidden="true" className="shrink-0" size={18} />
            {showLabels ? (
              <span aria-hidden="true" className="whitespace-nowrap">
                {copy.shell.notificationsEmpty}
              </span>
            ) : null}
            {unreadNotifications > 0 ? (
              <span
                aria-hidden="true"
                className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-signal-soft px-1.5 text-xs font-semibold tabular-nums text-signal-text"
              >
                {unreadNotifications}
              </span>
            ) : null}
          </span>
        )}
      </NavLink>

      <NavLink onClick={onNavigate} to="/support">
        {({ isActive }) => (
          <span
            className={`${ROW_CLASS} ${isActive ? ROW_ACTIVE : ROW_IDLE} ${showLabels ? "" : "justify-center"}`}
          >
            {isActive ? (
              <span
                aria-hidden="true"
                className="absolute -left-px bottom-1.5 top-1.5 w-0.5 rounded-full bg-signal"
              />
            ) : null}
            <MessageCircle aria-hidden="true" className="shrink-0" size={18} />
            {showLabels ? (
              <span className="whitespace-nowrap">{copy.nav.support}</span>
            ) : (
              <span className="sr-only">{copy.nav.support}</span>
            )}
          </span>
        )}
      </NavLink>
    </nav>
  );
}
