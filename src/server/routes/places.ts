import { Hono } from "hono";

import type { AppDatabase } from "../platform/db/client.ts";
import type { ClientIpConfig } from "../auth/client-ip.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { clientIp } from "../auth/client-ip.ts";
import { suggestPlaces } from "../catalog/geo-suggest.ts";
import { consumeRateLimit } from "../platform/rate-limit.ts";
import { placeSuggestQuerySchema } from "../../shared/places.ts";
import { validQuery } from "./validators.ts";
import { API_ERRORS } from "../../shared/api-errors.ts";

const PLACES_RATE_LIMIT = { windowMs: 60_000, max: 240 } as const;
const SHARED_CLIENT_KEY = "shared";

/**
 * The public, read-only place picker's search (issue #683). It returns canonical place ids from the committed geo
 * catalog and freehire's region list; no session or user row is read, so a stranger can only search public place
 * names.
 * @param deps The application database that stores the rate limit, the clock, and the proxy configuration that makes a
 * client IP trustworthy.
 * @returns The Hono routes mounted at `/api`.
 */
export function createPlaceRoutes(deps: {
  db: AppDatabase;
  clock: Clock;
  clientIpConfig: ClientIpConfig;
}) {
  const { db, clock, clientIpConfig } = deps;

  const routes = new Hono();

  routes.get("/places/suggest", validQuery(placeSuggestQuerySchema), (context) => {
    const clientKey = clientIp(context.req.raw, clientIpConfig) ?? SHARED_CLIENT_KEY;

    if (!consumeRateLimit(db, `api.places:${clientKey}`, clock.now(), PLACES_RATE_LIMIT)) {
      context.header("Retry-After", "60");

      return context.json({ error: API_ERRORS.rateLimited }, 429);
    }

    const { q } = context.req.valid("query");

    context.header("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
    context.header("CDN-Cache-Control", "public, max-age=600");

    return context.json({ suggestions: suggestPlaces(q ?? "") });
  });

  return routes;
}
