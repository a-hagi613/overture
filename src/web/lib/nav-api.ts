import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { copy } from "../../shared/copy.ts";

const navCountsSchema = z.object({
  inboxUnread: z.number(),
  ready: z.number(),
  review: z.number(),
});

export type NavCounts = z.infer<typeof navCountsSchema>;

export type NavKey =
  | "home"
  | "tracker"
  | "ready"
  | "review"
  | "inbox"
  | "calendar"
  | "profile"
  | "support";

/**
 * The five primary destinations, in the same order on the phone tab bar.
 */
export const NAV_DESTINATIONS = [
  { glyph: "home", to: "/home" },
  { glyph: "tracker", to: "/tracker" },
  { glyph: "ready", to: "/ready" },
  { glyph: "review", to: "/review" },
  { glyph: "inbox", to: "/inbox" },
] as const satisfies readonly { glyph: NavKey; to: string }[];

export type PrimaryNavKey = (typeof NAV_DESTINATIONS)[number]["glyph"];

/**
 * Workspace destinations rendered across the desktop sidebar and drawer.
 */
export const SIDEBAR_DESTINATIONS = [
  ...NAV_DESTINATIONS,
  { glyph: "calendar", to: "/calendar" },
] as const satisfies readonly { glyph: NavKey; to: string }[];

export type SidebarNavKey = (typeof SIDEBAR_DESTINATIONS)[number]["glyph"];

/**
 * Computes mutually exclusive active highlight state for sidebar destinations, keeping Tracker
 * and Calendar distinct across `/calendar` and legacy `/tracker?view=calendar` links.
 * @param key Sidebar destination key.
 * @param pathname Current router pathname.
 * @param search Current router search string.
 * @returns Whether the destination should be shown as active.
 */
export function isSidebarNavActive(key: SidebarNavKey, pathname: string, search: string) {
  const isTrackerPath = pathname.startsWith("/tracker") || pathname.startsWith("/applications");

  const isCalendarView =
    pathname === "/calendar" ||
    (isTrackerPath && new URLSearchParams(search).get("view") === "calendar");

  if (key === "calendar") {
    return isCalendarView;
  }

  if (key === "tracker") {
    return isTrackerPath && !isCalendarView;
  }

  if (key === "home") {
    return pathname === "/home";
  }

  const base = `/${key}`;

  return pathname === base || pathname.startsWith(`${base}/`);
}

export const APPLICATIONS_SUBMENU = [
  { key: "tracker", label: copy.nav.tracker, to: "/tracker" },
  { key: "ready", label: copy.nav.ready, to: "/ready" },
  { key: "review", label: copy.nav.review, to: "/review" },
] as const;

export const JOB_PROFILE_SUBMENU = [
  { key: "resume", label: copy.nav.profileMenu.resume, to: "/profile/resume" },
  { key: "preferences", label: copy.nav.profileMenu.preferences, to: "/profile/preferences" },
  { key: "details", label: copy.nav.profileMenu.details, to: "/profile/details" },
] as const;

export const RESPONSES_SUBMENU = [
  { key: "inbox", label: copy.nav.inbox, to: "/inbox" },
  { key: "calendar", label: copy.nav.calendar, to: "/calendar" },
] as const;

export const ACCOUNT_SUBMENU = [
  { key: "billing", label: copy.nav.profileMenu.billing, to: "/profile/billing" },
  { key: "account", label: copy.nav.accountSettings, to: "/profile/account" },
] as const;

export const PROFILE_SUBMENU = [...JOB_PROFILE_SUBMENU, ...ACCOUNT_SUBMENU] as const;

export function isJobProfilePath(pathname: string) {
  return (
    pathname === "/profile/resume" ||
    pathname === "/profile/details" ||
    pathname === "/profile/preferences"
  );
}

export const NO_NAV_COUNTS: NavCounts = { inboxUnread: 0, ready: 0, review: 0 };

async function loadNavCounts() {
  const response = await fetch("/api/nav");

  if (!response.ok) {
    throw new Error(`The nav request did not go through (${String(response.status)}).`);
  }

  return navCountsSchema.parse(await response.json());
}

export function useNavCounts() {
  const { data } = useQuery({ queryKey: ["nav"], queryFn: loadNavCounts, retry: false });

  return data ?? NO_NAV_COUNTS;
}

export function navBadgeCount(counts: NavCounts, key: NavKey) {
  if (key === "ready") {
    return counts.ready;
  }

  if (key === "review") {
    return counts.review;
  }

  return key === "inbox" ? counts.inboxUnread : 0;
}

export function navBadgeClass(key: NavKey) {
  if (key === "review") {
    return "bg-need-soft text-need";
  }

  return key === "ready" ? "bg-ok-soft text-ok" : "bg-muted text-foreground";
}

export function navLabel(key: NavKey, count: number) {
  if (count === 0) {
    return copy.nav[key];
  }

  if (key === "ready") {
    return copy.nav.readyCount(count);
  }

  if (key === "review") {
    return copy.nav.reviewCount(count);
  }

  return key === "inbox" ? copy.nav.inboxCount(count) : copy.nav[key];
}

/**
 * The page title the slim phone header shows for a workspace path.
 *
 * @param pathname The current location pathname.
 * @param search The current location search, used to name the calendar view.
 * @returns The destination title, or the product name for an unknown path.
 */
export function navTitleForPath(pathname: string, search = "") {
  if (pathname.startsWith("/tracker") || pathname.startsWith("/applications")) {
    return new URLSearchParams(search).get("view") === "calendar"
      ? copy.nav.calendar
      : copy.nav.tracker;
  }

  if (pathname.startsWith("/profile")) {
    return copy.nav.profile;
  }

  if (pathname.startsWith("/inbox")) {
    return copy.nav.inbox;
  }

  if (pathname === "/ready") {
    return copy.nav.ready;
  }

  if (pathname === "/review") {
    return copy.nav.review;
  }

  if (pathname === "/home") {
    return copy.nav.home;
  }

  if (pathname === "/notifications") {
    return copy.shell.notificationsEmpty;
  }

  if (pathname === "/support") {
    return copy.nav.support;
  }

  if (pathname === "/calendar") {
    return copy.nav.calendar;
  }

  return copy.app.name;
}
