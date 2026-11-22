import { Hono } from "hono";
import { validQuery } from "./validators.ts";
import { z } from "zod";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { Auth } from "../auth/index.ts";

import { readSession } from "../auth/session.ts";
import { createSseStream } from "../platform/sse/stream.ts";
import { getAllKillSwitches, getAllSettings, getSetting } from "../platform/settings/index.ts";
import { searchPostings } from "../platform/search/search.ts";
import { EMPLOYMENT_TYPES, SENIORITIES, WORKPLACES } from "../../shared/tag-taxonomy.ts";
import { API_ERRORS } from "../../shared/api-errors.ts";

const searchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  role: z.string().min(1).max(60).optional(),
  seniority: z.enum(SENIORITIES).optional(),
  workplace: z.enum(WORKPLACES).optional(),
  location: z.string().min(1).max(120).optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
});

export function createApiRoutes(
  db: AppDatabase,
  catalogDb: CatalogDatabase,
  clock: Clock,
  auth: Auth,
  options: { shutdown?: AbortSignal } = {},
) {
  const routes = new Hono();

  routes.get("/search", validQuery(searchQuerySchema), (context) => {
    const { q, limit, role, seniority, workplace, location, employmentType } =
      context.req.valid("query");

    const startedAt = performance.now();

    const hits = searchPostings(catalogDb, {
      text: q,
      openOnly: true,
      limit,
      filters: {
        role: role ?? null,
        seniority: seniority ?? null,
        workplace: workplace ?? null,
        location: location ?? null,
        employmentType: employmentType ?? null,
      },
    });

    const durationMs = performance.now() - startedAt;

    return context.json({
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
    });
  });

  routes.get("/events", async (context) => {
    const lastEventId = context.req.header("Last-Event-ID") ?? null;
    const abortController = new AbortController();

    const session = await readSession(auth, context.req.raw.headers);

    context.req.raw.signal.addEventListener("abort", () => {
      abortController.abort();
    });

    const signal =
      options.shutdown === undefined
        ? abortController.signal
        : AbortSignal.any([abortController.signal, options.shutdown]);

    const stream = createSseStream(db, lastEventId, session?.user.id ?? null, signal);

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  routes.get("/settings", (context) => {
    const all = getAllSettings(db);

    return context.json(all);
  });

  routes.get("/settings/:key", (context) => {
    const { key } = context.req.param();
    const value = getSetting(db, key);

    if (value === null) {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    return context.json({ key, value });
  });

  routes.get("/kill-switches", (context) => {
    const all = getAllKillSwitches(db);

    return context.json(all);
  });

  return routes;
}
