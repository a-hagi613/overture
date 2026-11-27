import { Hono } from "hono";

import type { Auth } from "../auth/index.ts";
import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";

import { readSessionUser } from "../auth/session.ts";
import { newMatchesOf } from "../matching/new-matches.ts";
import { API_ERRORS } from "../../shared/api-errors.ts";

const MATCHES_PAGE_SIZE = 50;

/**
 * The read-only Matches list Home opens: newest matches with the stored AI score only.
 * #690 grows this into the full paged Matches page; Home's count and rows already read it.
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

    return context.json(newMatchesOf({ catalogDb, db }, user.id, MATCHES_PAGE_SIZE));
  });

  return routes;
}
