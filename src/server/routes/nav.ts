import { Hono } from "hono";
import { and, eq, isNull, or, sql } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Auth } from "../auth/index.ts";
import type { ReviewService } from "../pipeline/reviews.ts";

import { applications, messages } from "../platform/db/schema.ts";

export function createNavRoutes(deps: { auth: Auth; db: AppDatabase; reviews: ReviewService }) {
  const { auth, db, reviews } = deps;

  const routes = new Hono();

  routes.get("/nav", async (context) => {
    context.header("Cache-Control", "no-store");

    const session = await auth.api
      .getSession({ headers: context.req.raw.headers })
      .catch(() => null);

    const user = session?.user ?? null;

    if (user === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    const ready = db
      .select({ total: sql<number>`count(*)` })
      .from(applications)
      .where(and(eq(applications.userId, user.id), eq(applications.status, "ready")))
      .get();

    const inboxUnread = db
      .select({ total: sql<number>`count(*)` })
      .from(messages)
      .where(
        and(
          eq(messages.userId, user.id),
          eq(messages.direction, "in"),
          eq(messages.auth, "pass"),
          isNull(messages.readAt),
          or(isNull(messages.classification), sql`${messages.classification} IS NOT 'code'`),
        ),
      )
      .get();

    return context.json({
      inboxUnread: inboxUnread?.total ?? 0,
      ready: ready?.total ?? 0,
      review: reviews.list(user.id).length,
    });
  });

  return routes;
}
