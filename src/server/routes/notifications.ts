import { and, asc, count, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { Auth } from "../auth/index.ts";

import { notifications, pushSubscriptions } from "../platform/db/schema.ts";
import { env } from "../config/env.ts";
import { isAllowedPushEndpoint } from "../platform/push/endpoint.ts";

const LIST_LIMIT = 100;

const subscriptionBody = z.object({
  endpoint: z.url().refine((value) => isAllowedPushEndpoint(value, env.NODE_ENV), {
    message: "A push endpoint must be an HTTPS address of a known push service.",
  }),
  keys: z.object({
    auth: z.string().min(8).max(200),
    p256dh: z.string().min(20).max(400),
  }),
});

const unsubscribeBody = z.object({ endpoint: z.url() });

const readBody = z.object({ id: z.string().min(1) });

function view(row: typeof notifications.$inferSelect) {
  return {
    at: row.createdAt,
    body: row.body,
    id: row.id,
    kind: row.kind,
    pushedAt: row.pushedAt?.getTime() ?? null,
    readAt: row.readAt?.getTime() ?? null,
    title: row.title,
    url: row.url,
  };
}

export function createNotificationRoutes(db: AppDatabase, clock: Clock, auth: Auth) {
  const routes = new Hono();

  async function sessionUser(headers: Headers) {
    const result = await auth.api.getSession({ headers }).catch(() => null);

    return result?.user ?? null;
  }

  routes.get("/notifications", async (context) => {
    const user = await sessionUser(context.req.raw.headers);

    if (user === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    const rows = db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, user.id))
      .orderBy(asc(notifications.createdAt))
      .limit(LIST_LIMIT)
      .all();

    const unread =
      db
        .select({ total: count() })
        .from(notifications)
        .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)))
        .get()?.total ?? 0;

    return context.json({ notifications: rows.map((row) => view(row)), now: clock.now(), unread });
  });

  routes.post("/notifications/read", zValidator("json", readBody), async (context) => {
    const user = await sessionUser(context.req.raw.headers);

    if (user === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    const { id } = context.req.valid("json");
    const now = clock.now();

    db.update(notifications)
      .set({ readAt: new Date(now) })
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.userId, user.id),
          isNull(notifications.readAt),
        ),
      )
      .run();

    return context.json({ ok: true });
  });

  routes.post("/notifications/read-all", async (context) => {
    const user = await sessionUser(context.req.raw.headers);

    if (user === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    db.update(notifications)
      .set({ readAt: new Date(clock.now()) })
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)))
      .run();

    return context.json({ ok: true });
  });

  routes.get("/push", async (context) => {
    const user = await sessionUser(context.req.raw.headers);

    if (user === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    return context.json({ publicKey: env.VAPID_PUBLIC_KEY ?? null });
  });

  routes.post("/push/subscribe", zValidator("json", subscriptionBody), async (context) => {
    const user = await sessionUser(context.req.raw.headers);

    if (user === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    const { endpoint, keys } = context.req.valid("json");
    const now = clock.now();

    db.insert(pushSubscriptions)
      .values({
        auth: keys.auth,
        createdAt: now,
        endpoint,
        id: crypto.randomUUID(),
        p256dh: keys.p256dh,
        userId: user.id,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { auth: keys.auth, lastOkAt: null, p256dh: keys.p256dh, userId: user.id },
      })
      .run();

    return context.json({ ok: true });
  });

  routes.post("/push/unsubscribe", zValidator("json", unsubscribeBody), async (context) => {
    const user = await sessionUser(context.req.raw.headers);

    if (user === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    const { endpoint } = context.req.valid("json");

    db.delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, user.id)))
      .run();

    return context.json({ ok: true });
  });

  return routes;
}
