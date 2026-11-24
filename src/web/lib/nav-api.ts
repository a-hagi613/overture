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
  | "applications"
  | "ready"
  | "review"
  | "inbox"
  | "calendar"
  | "profile"
  | "support";

/**
 * The five primary destinations, in the same order on the phone tab bar and the desktop sidebar.
 */
export const NAV_DESTINATIONS = [
  { glyph: "home", to: "/home" },
  { glyph: "ready", to: "/ready" },
  { glyph: "review", to: "/review" },
  { glyph: "applications", to: "/applications" },
  { glyph: "inbox", to: "/inbox" },
] as const satisfies readonly { glyph: NavKey; to: string }[];

export type PrimaryNavKey = (typeof NAV_DESTINATIONS)[number]["glyph"];

export const JOB_PROFILE_SUBMENU = [
  { key: "resume", label: copy.nav.profileMenu.resume, to: "/profile/resume" },
  { key: "preferences", label: copy.nav.profileMenu.preferences, to: "/profile/preferences" },
  { key: "details", label: copy.nav.profileMenu.details, to: "/profile/details" },
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
  if (pathname.startsWith("/applications")) {
    return new URLSearchParams(search).get("view") === "calendar"
      ? copy.nav.calendar
      : copy.nav.applications;
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
