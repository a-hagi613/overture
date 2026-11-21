import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { copy } from "../../shared/copy.ts";

const navCountsSchema = z.object({
  inboxUnread: z.number(),
  ready: z.number(),
  review: z.number(),
});

export type NavCounts = z.infer<typeof navCountsSchema>;

export type NavKey = "home" | "ready" | "board" | "review" | "inbox" | "profile";

export const NAV_DESTINATIONS = [
  { glyph: "home", to: "/" },
  { glyph: "ready", to: "/ready" },
  { glyph: "board", to: "/board" },
  { glyph: "review", to: "/review" },
  { glyph: "inbox", to: "/inbox" },
  { glyph: "profile", to: "/profile" },
] as const satisfies readonly { glyph: NavKey; to: string }[];

export const NO_NAV_COUNTS: NavCounts = { inboxUnread: 0, ready: 0, review: 0 };

async function loadNavCounts() {
  const response = await fetch("/api/nav");

  if (!response.ok) {
    throw new Error(`The nav request did not go through (${String(response.status)}).`);
  }

  return navCountsSchema.parse(await response.json());
}

/**
 * Live counts for the shell's nav badges.
 *
 * @returns The counts, all zero until the request lands (which renders no badge).
 */
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
