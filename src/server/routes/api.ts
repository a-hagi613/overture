import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { Auth } from "../auth/index.ts";

import { createSseStream } from "../platform/sse/stream.ts";
import { getAllKillSwitches, getAllSettings, getSetting } from "../platform/settings/index.ts";
import { searchPostings } from "../platform/search/search.ts";
import { EMPLOYMENT_TYPES, SENIORITIES, WORKPLACES } from "../../shared/tag-taxonomy.ts";

const searchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  role: z.string().min(1).max(60).optional(),
  seniority: z.enum(SENIORITIES).optional(),
  workplace: z.enum(WORKPLACES).optional(),
  location: z.string().min(1).max(120).optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
});

export function createApiRoutes(db: AppDatabase, clock: Clock, auth: Auth) {
  const routes = new Hono();

  routes.get("/search", zValidator("query", searchQuerySchema), (context) => {
    const { q, limit, role, seniority, workplace, location, employmentType } =
      context.req.valid("query");

    const startedAt = performance.now();

    const hits = searchPostings(db, {
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

    const session = await auth.api
      .getSession({ headers: context.req.raw.headers })
      .catch(() => null);

    context.req.raw.signal.addEventListener("abort", () => {
      abortController.abort();
    });

    const stream = createSseStream(
      db,
      clock,
      lastEventId,
      session?.user.id ?? null,
      abortController.signal,
    );

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
      return context.json({ error: "not found" }, 404);
    }

    return context.json({ key, value });
  });

  routes.get("/kill-switches", (context) => {
    const all = getAllKillSwitches(db);

    return context.json(all);
  });

  return routes;
}
