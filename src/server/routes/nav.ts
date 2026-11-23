import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Auth } from "../auth/index.ts";

import { readSessionUser } from "../auth/session.ts";
import type { ReviewService } from "../pipeline/reviews.ts";

import { applications } from "../platform/db/schema.ts";
import { unreadThreadCountOf } from "../inbox/threads.ts";

export function createNavRoutes(deps: { auth: Auth; db: AppDatabase; reviews: ReviewService }) {
  const { auth, db, reviews } = deps;

  const routes = new Hono();

  routes.get("/nav", async (context) => {
    context.header("Cache-Control", "no-store");

    const user = await readSessionUser(auth, context.req.raw.headers);

    if (user === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    const ready = db
      .select({ total: sql<number>`count(*)` })
      .from(applications)
      .where(and(eq(applications.userId, user.id), eq(applications.status, "ready")))
      .get();

    return context.json({
      inboxUnread: unreadThreadCountOf(db, user.id),
      ready: ready?.total ?? 0,
      review: reviews.list(user.id).length,
    });
  });

  return routes;
}
