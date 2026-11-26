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
  PanelLeftOpen,
  Search,
  SlidersHorizontal,
  UserSearch,
} from "lucide-react";
import { Link, NavLink, useLocation } from "react-router";

import type { NavCounts } from "../lib/nav-api.ts";

import { copy } from "../../shared/copy.ts";
import { isSidebarNavActive, navBadgeClass, navBadgeCount, navLabel } from "../lib/nav-api.ts";
import { BrandMark } from "./brand-mark.tsx";
import { SidebarNavGroup } from "./sidebar-nav-group.tsx";
import type { SidebarGroupItem } from "./sidebar-nav-group.tsx";
import { SidebarNavUser } from "./sidebar-nav-user.tsx";
import { Button } from "./ui/button.tsx";
import { Separator } from "./ui/separator.tsx";
import { TooltipHint } from "./ui/tooltip-hint.tsx";
import { UsageRing } from "./usage-ring.tsx";

const RAIL_ITEM_CLASS =
  "relative flex h-10 w-10 items-center justify-center rounded-md border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground";

const RAIL_IDLE = "border-transparent text-foreground hover:bg-muted";
const RAIL_ACTIVE = "border-border bg-card text-foreground";

export function BoardRail({
  counts,
  onExpand,
  onOpenSearch,
  unreadNotifications = 0,
}: {
  counts: NavCounts;
  onExpand: () => void;
  onOpenSearch: () => void;
  unreadNotifications?: number;
}) {
  const { pathname, search } = useLocation();
  const homeActive = isSidebarNavActive("home", pathname, search);
  const homeLabel = navLabel("home", 0);
  const readyCount = navBadgeCount(counts, "ready");
  const reviewCount = navBadgeCount(counts, "review");
  const inboxCount = navBadgeCount(counts, "inbox");

  const applicationsBadgeClass = reviewCount > 0 ? navBadgeClass("review") : navBadgeClass("ready");

  const notificationsLabel =
    unreadNotifications > 0
      ? copy.shell.notifications(unreadNotifications)
      : copy.shell.notificationsEmpty;

  const applicationsItems: SidebarGroupItem[] = [
    {
      icon: Columns3,
      isActive: isSidebarNavActive("tracker", pathname, search),
      key: "tracker",
      label: copy.nav.tracker,
      srLabel: navLabel("tracker", 0),
      to: "/tracker",
    },
    {
      badgeClass: navBadgeClass("ready"),
      badgeCount: readyCount,
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
      icon: CircleHelp,
      isActive: isSidebarNavActive("review", pathname, search),
      key: "review",
      label: copy.nav.review,
      srLabel: navLabel("review", reviewCount),
      to: "/review",
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

  return (
    <aside
      className="hidden bg-sidebar px-2 py-4 md:fixed md:inset-y-0 md:left-0 md:z-20 md:flex md:w-18 md:flex-none md:flex-col md:items-center md:border-r md:border-border"
      data-shell-sidebar
    >
      <NavLink
        aria-label={copy.brand.homeAria}
        className="flex transition hover:opacity-80"
        to="/home"
      >
        <BrandMark size={32} />
      </NavLink>
      <TooltipHint label={copy.shell.expandSidebar}>
        <Button
          ariaLabel={copy.shell.expandSidebar}
          className="mt-3 h-9 w-9"
          onClick={onExpand}
          size="icon"
          variant="ghost"
        >
          <PanelLeftOpen aria-hidden="true" className="h-4 w-4" />
        </Button>
      </TooltipHint>
      <Separator className="mt-2.5 w-8" />
      <TooltipHint label={copy.shell.searchLabel}>
        <Button
          ariaLabel={copy.shell.searchLabel}
          className="mt-2.5 h-10 w-10"
          onClick={onOpenSearch}
          size="icon"
          variant="secondary"
        >
          <Search aria-hidden="true" className="h-4 w-4" />
        </Button>
      </TooltipHint>
      <Separator className="my-2 w-8" />
      <nav
        aria-label={copy.nav.label}
        className="flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 overflow-x-hidden overflow-y-auto px-2 py-1"
        data-scroll-region
      >
        <TooltipHint label={homeLabel}>
          <Link
            aria-current={homeActive ? "page" : undefined}
            className={`${RAIL_ITEM_CLASS} ${homeActive ? RAIL_ACTIVE : RAIL_IDLE}`}
            to="/home"
          >
            <span className="sr-only">{homeLabel}</span>
            {homeActive ? (
              <span
                aria-hidden="true"
                className="absolute -left-px bottom-2 top-2 w-0.5 rounded-full bg-signal"
              />
            ) : null}
            <Home aria-hidden="true" size={20} />
          </Link>
        </TooltipHint>

        <Separator className="my-2.5 w-8" />

        <SidebarNavGroup
          badgeClass={applicationsBadgeClass}
          badgeCount={readyCount + reviewCount}
          icon={Files}
          items={applicationsItems}
          label={copy.nav.applicationsGroup}
          menuLabel={copy.nav.applicationsMenuLabel}
          storageKey="overture.sidebar.applicationsOpen"
          wide={false}
        />

        <Separator className="my-1.5 w-8" />

        <SidebarNavGroup
          icon={UserSearch}
          items={profileItems}
          label={copy.nav.jobProfile}
          menuLabel={copy.nav.jobProfileMenuLabel}
          storageKey="overture.jobProfileOpen"
          wide={false}
        />

        <Separator className="my-1.5 w-8" />

        <SidebarNavGroup
          badgeClass={navBadgeClass("inbox")}
          badgeCount={inboxCount}
          icon={CalendarClock}
          items={followUpsItems}
          label={copy.nav.followUpsGroup}
          menuLabel={copy.nav.followUpsMenuLabel}
          storageKey="overture.sidebar.followUpsOpen"
          wide={false}
        />

        <Separator className="my-1.5 w-8" />

        <TooltipHint label={notificationsLabel}>
          <NavLink aria-label={notificationsLabel} to="/notifications">
            {({ isActive }) => (
              <span className={`${RAIL_ITEM_CLASS} ${isActive ? RAIL_ACTIVE : RAIL_IDLE}`}>
                {isActive ? (
                  <span
                    aria-hidden="true"
                    className="absolute -left-px bottom-2 top-2 w-0.5 rounded-full bg-signal"
                  />
                ) : null}
                <Bell aria-hidden="true" size={20} />
                {unreadNotifications > 0 ? (
                  <span
                    aria-hidden="true"
                    className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-signal px-1 text-xs font-semibold leading-none tabular-nums text-primary-ink"
                  >
                    {unreadNotifications}
                  </span>
                ) : null}
              </span>
            )}
          </NavLink>
        </TooltipHint>
        <TooltipHint label={copy.nav.support}>
          <NavLink aria-label={copy.nav.support} to="/support">
            {({ isActive }) => (
              <span className={`${RAIL_ITEM_CLASS} ${isActive ? RAIL_ACTIVE : RAIL_IDLE}`}>
                {isActive ? (
                  <span
                    aria-hidden="true"
                    className="absolute -left-px bottom-2 top-2 w-0.5 rounded-full bg-signal"
                  />
                ) : null}
                <MessageCircle aria-hidden="true" size={20} />
              </span>
            )}
          </NavLink>
        </TooltipHint>
      </nav>
      <div className="mt-auto flex flex-col items-center gap-2.5 pt-2">
        <UsageRing />
        <Separator className="w-8" />
        <SidebarNavUser compact />
      </div>
    </aside>
  );
}
