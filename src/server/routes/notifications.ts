import { and, count, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { validJson } from "./validators.ts";
import { z } from "zod";

import type { MiddlewareHandler } from "hono";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { Auth } from "../auth/index.ts";

import { notifications, pushSubscriptions } from "../platform/db/schema.ts";
import { env } from "../config/env.ts";
import { isAllowedPushEndpoint } from "../platform/push/endpoint.ts";
import { NOTIFICATION_PREFERENCE_KEYS } from "../../shared/notifications.ts";
import { readNotificationPreferences, setNotificationPreference } from "../notify/preferences.ts";
import { retryWhenBusy } from "../platform/db/busy.ts";

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

const preferenceBody = z.object({
  enabled: z.boolean(),
  kind: z.enum(NOTIFICATION_PREFERENCE_KEYS),
});

interface NotificationEnv {
  Variables: { user: { id: string } };
}

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
  const routes = new Hono<NotificationEnv>();

  async function sessionUser(headers: Headers) {
    const result = await auth.api.getSession({ headers }).catch(() => null);

    return result?.user ?? null;
  }

  const requireUser: MiddlewareHandler<NotificationEnv> = async (context, next) => {
    context.header("Cache-Control", "private, no-store");

    const user = await sessionUser(context.req.raw.headers);

    if (user === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    context.set("user", { id: user.id });
    await next();

    return context.res;
  };

  routes.get("/notifications", requireUser, (context) => {
    const user = context.get("user");

    const rows = db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, user.id))
      .orderBy(desc(notifications.createdAt))
      .limit(LIST_LIMIT)
      .all()
      .toReversed();

    const unread =
      db
        .select({ total: count() })
        .from(notifications)
        .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)))
        .get()?.total ?? 0;

    return context.json({ notifications: rows.map((row) => view(row)), now: clock.now(), unread });
  });

  routes.post("/notifications/read", requireUser, validJson(readBody), (context) => {
    const user = context.get("user");
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

  routes.post("/notifications/read-all", requireUser, (context) => {
    const user = context.get("user");

    db.update(notifications)
      .set({ readAt: new Date(clock.now()) })
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)))
      .run();

    return context.json({ ok: true });
  });

  routes.get("/push", requireUser, (context) =>
    context.json({ publicKey: env.VAPID_PUBLIC_KEY ?? null }),
  );

  routes.get("/notifications/preferences", requireUser, (context) => {
    const user = context.get("user");

    return context.json({ preferences: readNotificationPreferences(db, user.id) });
  });

  routes.put(
    "/notifications/preferences",
    requireUser,
    validJson(preferenceBody),
    async (context) => {
      const user = context.get("user");
      const { enabled, kind } = context.req.valid("json");

      const preferences = await retryWhenBusy(
        () => setNotificationPreference(db, clock, user.id, kind, enabled),
        "notifications.preferences",
      );

      return context.json({ preferences });
    },
  );

  routes.post("/push/subscribe", requireUser, validJson(subscriptionBody), (context) => {
    const user = context.get("user");
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

  routes.post("/push/unsubscribe", requireUser, validJson(unsubscribeBody), (context) => {
    const user = context.get("user");
    const { endpoint } = context.req.valid("json");

    db.delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, user.id)))
      .run();

    return context.json({ ok: true });
  });

  return routes;
}
