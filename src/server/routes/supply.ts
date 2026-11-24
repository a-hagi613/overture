import { Hono } from "hono";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";
import type { ClientIpConfig } from "../auth/client-ip.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { clientIp } from "../auth/client-ip.ts";
import { countSupportedSupply } from "../catalog/supply.ts";
import { consumeRateLimit } from "../platform/rate-limit.ts";
import { defaultMetrics } from "../platform/telemetry/metrics.ts";
import { measureSqliteQuery } from "../platform/telemetry/sqlite-metrics.ts";
import { supplyFiltersOf, supplyQuerySchema } from "../../shared/supply.ts";
import { validQuery } from "./validators.ts";
import { API_ERRORS } from "../../shared/api-errors.ts";

const SUPPLY_RATE_LIMIT = { windowMs: 60_000, max: 120 } as const;
const SHARED_CLIENT_KEY = "shared";

/**
 * The public, read-only supply count behind the landing's supply preview (issue #567). No session is
 * read and no user row is touched: the whole answer is an aggregate over the open, apply-supported
 * catalog, so it is safe to cache at the edge and safe to serve to a stranger.
 * @param deps The application database that stores the rate limit, the catalog database that holds the
 * counts, the clock, and the proxy configuration that makes a client IP trustworthy.
 * @returns The Hono routes mounted at `/api`.
 */
export function createSupplyRoutes(deps: {
  db: AppDatabase;
  catalogDb: CatalogDatabase;
  clock: Clock;
  clientIpConfig: ClientIpConfig;
}) {
  const { db, catalogDb, clock, clientIpConfig } = deps;

  const routes = new Hono();

  routes.get("/supply", validQuery(supplyQuerySchema), (context) => {
    const clientKey = clientIp(context.req.raw, clientIpConfig) ?? SHARED_CLIENT_KEY;

    if (!consumeRateLimit(db, `api.supply:${clientKey}`, clock.now(), SUPPLY_RATE_LIMIT)) {
      context.header("Retry-After", "60");

      return context.json({ error: API_ERRORS.rateLimited }, 429);
    }

    const startedAt = performance.now();

    const totals = measureSqliteQuery("catalog", "select", () =>
      countSupportedSupply(catalogDb, supplyFiltersOf(context.req.valid("query"))),
    );

    defaultMetrics().recordSupplyQuery(performance.now() - startedAt);

    context.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    context.header("CDN-Cache-Control", "public, max-age=300");

    return context.json({ ...totals, generatedAt: clock.now() });
  });

  return routes;
}
