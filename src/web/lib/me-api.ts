import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

function parseHttpUrl(raw: string) {
  try {
    const parsed = new URL(raw);

    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

const httpUrlSchema = z.string().refine((value) => parseHttpUrl(value) !== null, {
  message: "Must be an http or https URL.",
});

const meUserSchema = z.object({
  email: z.string(),
  emailVerified: z.boolean(),
  id: z.string(),
  name: z.string(),
  role: z.string(),
});

const meSchema = z.object({
  adminOrigin: httpUrlSchema.nullable(),
  adminOwnerEmail: z.string().nullable().default(null),
  socialProviders: z.array(z.string()).default([]),
  turnstileScriptUrl: z.string().optional(),
  turnstileSiteKey: z.string().optional(),
  user: meUserSchema.nullable(),
});

export type Me = z.infer<typeof meSchema>;

export const ME_QUERY_KEY = ["me"] as const;

const ME_STALE_TIME_MS = 5 * 60 * 1000;

async function loadMe() {
  const response = await fetch("/api/me");

  if (!response.ok) {
    throw new Error(`The session request did not go through (${String(response.status)}).`);
  }

  return meSchema.parse(await response.json());
}

/**
 * Full query state for `GET /api/me`, including pending status before session resolution.
 * @returns The React Query result for `/api/me`.
 */
export function useMeQuery() {
  return useQuery({
    queryFn: loadMe,
    queryKey: ME_QUERY_KEY,
    retry: false,
    staleTime: ME_STALE_TIME_MS,
  });
}

/**
 * The signed-in session as `GET /api/me` reports it.
 * @returns The session payload, or undefined while it is loading or unreadable.
 */
export function useMe() {
  return useMeQuery().data;
}

/**
 * The Admin Portal entry for an owner, and null for everyone else.
 * @param me The session payload from `useMe`.
 * @returns The admin host origin with the portal path, or null.
 */
export function adminPortalHref(me: Me | undefined) {
  if (me?.user?.role !== "owner") {
    return null;
  }

  if (me.adminOrigin === null) {
    return null;
  }

  const parsed = parseHttpUrl(me.adminOrigin);

  return parsed === null ? null : `${parsed.origin}/admin`;
}

/**
 * Whether a URL points at a different origin than the page rendering it.
 * @param href The absolute URL to compare.
 * @param pageOrigin The origin of the page that would link to it.
 * @returns True when the two do not share an origin.
 */
export function isCrossOrigin(href: string, pageOrigin: string) {
  const parsed = parseHttpUrl(href);

  return parsed !== null && parsed.origin !== pageOrigin;
}

/**
 * The admin handoff target: the admin host with the page's own path, query and hash.
 * @param adminOrigin The admin host from `GET /api/me`.
 * @param pathname The current pathname.
 * @param search The current query string, including its leading `?`.
 * @param hash Optional hash fragment, including its leading `#`.
 * @returns The absolute URL the handoff card links to.
 */
export function handoffHref(adminOrigin: string, pathname: string, search: string, hash = "") {
  const parsed = parseHttpUrl(adminOrigin);

  return parsed === null
    ? `${pathname}${search}${hash}`
    : `${parsed.origin}${pathname}${search}${hash}`;
}

/**
 * The admin host a cross-origin handoff would open.
 * @param adminOrigin The admin host from `GET /api/me`.
 * @returns The hostname shown to the owner.
 */
export function adminHostOf(adminOrigin: string) {
  const parsed = parseHttpUrl(adminOrigin);

  return parsed === null ? adminOrigin : parsed.host;
}
