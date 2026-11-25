import { Hono } from "hono";
import { validQuery } from "./validators.ts";
import { z } from "zod";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { Auth } from "../auth/index.ts";

import { readSession } from "../auth/session.ts";
import { consumeRateLimit } from "../platform/rate-limit.ts";
import { createSseStream } from "../platform/sse/stream.ts";
import { postedWithinMs, searchPostings } from "../platform/search/search.ts";
import { EMPLOYMENT_TYPES, SENIORITIES, WORKPLACES } from "../../shared/tag-taxonomy.ts";
import { supplyQuerySchema } from "../../shared/supply.ts";
import { API_ERRORS } from "../../shared/api-errors.ts";

export const searchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** The original Level-1 filter; a granular role name here still matches legacy catalogs. */
  role: z.string().min(1).max(60).optional(),
  /** The explicit category alias (WS-17b): a role-taxonomy id or name, or a retired category name. */
  category: supplyQuerySchema.shape.category,
  /** A role or subcategory; when present it is the role filter and the category is only a hint. */
  granularRole: supplyQuerySchema.shape.granularRole,
  seniority: z.enum(SENIORITIES).optional(),
  workplace: z.enum(WORKPLACES).optional(),
  location: z.string().min(1).max(120).optional(),
  /** The radius around a resolved city; absent keeps an exact city match. */
  radius: z.enum(["25", "40", "80"]).optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  language: z
    .string()
    .trim()
    .regex(/^[a-z]{2}$/u)
    .optional(),
  salaryMin: z.coerce.number().int().nonnegative().max(100_000_000).optional(),
  salaryMax: z.coerce.number().int().nonnegative().max(100_000_000).optional(),
  postedWithin: z.enum(["24h", "7d", "30d"]).optional(),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;

const SEARCH_RATE_LIMIT = { windowMs: 60_000, max: 60 } as const;

/**
 * Runs one catalog search and shapes the JSON body the web client and test routes share.
 * @param catalogDb The catalog database the postings live in.
 * @param query The validated search query.
 * @param nowMs The clock reading the posted-age filter uses.
 * @returns The hits the client renders and how long the search took.
 */
export function searchResponse(catalogDb: CatalogDatabase, query: SearchQuery, nowMs: number) {
  const {
    q,
    limit,
    role,
    category,
    granularRole,
    seniority,
    workplace,
    location,
    radius,
    employmentType,
    language,
    salaryMin,
    salaryMax,
    postedWithin: postedWithinValue,
  } = query;

  const startedAt = performance.now();

  const hits = searchPostings(catalogDb, {
    text: q,
    openOnly: true,
    limit,
    nowMs,
    filters: {
      role: granularRole ?? role ?? category ?? null,
      granularRole: granularRole ?? null,
      seniority: seniority ?? null,
      workplace: workplace ?? null,
      location: location ?? null,
      radiusKm: radius === undefined ? null : Number(radius),
      employmentType: employmentType ?? null,
      language: language ?? null,
      salaryMinUsd: salaryMin ?? null,
      salaryMaxUsd: salaryMax ?? null,
      postedWithinMs: postedWithinMs(postedWithinValue ?? null),
    },
  });

  const durationMs = performance.now() - startedAt;

  return {
    hits: hits.map((hit) => ({
      id: hit.id,
      title: hit.title,
      company: hit.company,
      location: hit.location,
      department: hit.department,
      url: hit.url,
      ats: hit.ats,
      postedAt: hit.postedAt,
    })),
    durationMs: Math.round(durationMs * 100) / 100,
  };
}

export function createApiRoutes(
  db: AppDatabase,
  catalogDb: CatalogDatabase,
  clock: Clock,
  auth: Auth,
  options: { shutdown?: AbortSignal } = {},
) {
  const routes = new Hono();

  routes.get("/search", validQuery(searchQuerySchema), async (context) => {
    const session = await readSession(auth, context.req.raw.headers);

    if (session === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const allowed = consumeRateLimit(
      db,
      `api.search:${session.user.id}`,
      clock.now(),
      SEARCH_RATE_LIMIT,
    );

    if (!allowed) {
      return context.json({ error: API_ERRORS.rateLimited }, 429);
    }

    return context.json(searchResponse(catalogDb, context.req.valid("query"), clock.now()));
  });

  routes.get("/events", async (context) => {
    const session = await readSession(auth, context.req.raw.headers);

    if (session === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const lastEventId = context.req.header("Last-Event-ID") ?? null;
    const abortController = new AbortController();

    context.req.raw.signal.addEventListener(
      "abort",
      () => {
        abortController.abort();
      },
      { once: true },
    );

    const signal =
      options.shutdown === undefined
        ? abortController.signal
        : AbortSignal.any([abortController.signal, options.shutdown]);

    const stream = createSseStream(db, lastEventId, session.user.id, signal);

    if (stream === null) {
      return context.json({ error: API_ERRORS.rateLimited }, 429);
    }

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  return routes;
}
