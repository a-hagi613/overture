import { Hono } from "hono";
import { z } from "zod";

import type { Auth } from "../auth/index.ts";
import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";

import { readSessionUser } from "../auth/session.ts";
import { matchesPageOf } from "../matching/matches-page.ts";
import { API_ERRORS } from "../../shared/api-errors.ts";

const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

/**
 * The server-paged Matches list: stored scores only, highest first, with a stable tie-break so a
 * page never repeats or skips a row. A job that is not scored yet stays `null` for "Scoring…".
 *
 * @param deps The session auth plus the app and catalog databases.
 * @returns The `/api/matches` route group.
 */
export function createMatchesRoutes(deps: {
  auth: Auth;
  catalogDb: CatalogDatabase;
  db: AppDatabase;
}) {
  const { auth, catalogDb, db } = deps;

  const routes = new Hono();

  routes.get("/matches", async (context) => {
    context.header("Cache-Control", "private, no-store");

    const user = await readSessionUser(auth, context.req.raw.headers);

    if (user === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const url = new URL(context.req.url);

    const parsed = pageQuerySchema.safeParse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });

    if (!parsed.success) {
      return context.json({ error: API_ERRORS.invalidRequest, issues: parsed.error.issues }, 400);
    }

    return context.json(matchesPageOf({ catalogDb, db }, user.id, parsed.data));
  });

  return routes;
}
