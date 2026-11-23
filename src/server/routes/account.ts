import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";

import type { AccountEraser } from "../account/erase.ts";
import type { ExportService } from "../export/service.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import type { Auth } from "../auth/index.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { readSession, readSessionUser } from "../auth/session.ts";
import { copy } from "../../shared/copy.ts";
import { env } from "../config/env.ts";
import { rateLimits, sessions } from "../platform/db/schema.ts";
import { ERASURE_COMPLETES_WITHIN_MS, REAUTH_WINDOW_MS } from "../account/erase.ts";
import { EXPORT_VALID_MS } from "../export/service.ts";
import { API_ERRORS } from "../../shared/api-errors.ts";

const deleteSchema = z.object({ confirm: z.literal(true) });

const LINK_MAX_ATTEMPTS = 3;

function linkLimitKey(userId: string) {
  return `account-reauth-link:${userId}`;
}

export function createAccountRoutes(deps: {
  db: AppDatabase;
  clock: Clock;
  auth: Auth;
  eraser: AccountEraser;
  exports: ExportService;
}) {
  const { db, clock, auth, eraser, exports } = deps;

  const routes = new Hono();

  function sessionReauthenticated(sessionId: string, now: number) {
    const row = db
      .select({ createdAt: sessions.createdAt, reauthAt: sessions.reauthAt })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .get();

    if (row === undefined) {
      return false;
    }

    return (
      (row.reauthAt !== null && now - row.reauthAt.getTime() <= REAUTH_WINDOW_MS) ||
      now - row.createdAt.getTime() <= REAUTH_WINDOW_MS
    );
  }

  function tooManyAttempts(key: string, now: number, max: number) {
    const row = db
      .select({ count: rateLimits.count, lastRequest: rateLimits.lastRequest })
      .from(rateLimits)
      .where(eq(rateLimits.key, key))
      .get();

    return row !== undefined && now - row.lastRequest <= REAUTH_WINDOW_MS && row.count >= max;
  }

  function recordFailedAttempt(key: string, now: number) {
    const row = db.select().from(rateLimits).where(eq(rateLimits.key, key)).get();

    if (row === undefined) {
      db.insert(rateLimits)
        .values({ id: crypto.randomUUID(), key, count: 1, lastRequest: now })
        .onConflictDoNothing()
        .run();

      return;
    }

    const count = now - row.lastRequest > REAUTH_WINDOW_MS ? 1 : row.count + 1;

    db.update(rateLimits).set({ count, lastRequest: now }).where(eq(rateLimits.id, row.id)).run();
  }

  routes.get("/account/deletion", async (context) => {
    const result = await readSession(auth, context.req.raw.headers);

    if (result === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    context.header("Cache-Control", "no-store");

    return context.json({
      email: result.user.email,
      reauthenticated: sessionReauthenticated(result.session.id, clock.now()),
    });
  });

  routes.post("/account/reauth/link", async (context) => {
    const result = await readSession(auth, context.req.raw.headers);

    if (result === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const now = clock.now();
    const key = linkLimitKey(result.user.id);

    if (tooManyAttempts(key, now, LINK_MAX_ATTEMPTS)) {
      return context.json({ error: "too_many", message: copy.deleteAccount.errors.tooMany }, 429);
    }

    recordFailedAttempt(key, now);

    const origin = env.APP_ORIGIN ?? new URL(context.req.url).origin;

    await auth.api.signInMagicLink({
      body: { email: result.user.email, callbackURL: `${origin}/profile/account` },
      headers: context.req.raw.headers,
    });

    return context.json({ sent: true });
  });

  routes.post("/account/delete", async (context) => {
    const result = await readSession(auth, context.req.raw.headers);

    if (result === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const body = deleteSchema.safeParse(await context.req.json().catch(() => null));

    if (!body.success) {
      return context.json({ error: API_ERRORS.invalidRequest }, 400);
    }

    if (!sessionReauthenticated(result.session.id, clock.now())) {
      return context.json(
        { error: "reauth_required", message: copy.deleteAccount.errors.reauthRequired },
        403,
      );
    }

    const { inserted } = eraser.request(result.user.id);

    return context.json(
      {
        status: "erasing",
        completesWithinMs: ERASURE_COMPLETES_WITHIN_MS,
        queued: inserted,
      },
      202,
    );
  });

  routes.get("/account/export", async (context) => {
    const user = await readSessionUser(auth, context.req.raw.headers);

    if (user === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    return context.json(await exports.state(user.id), 200, { "cache-control": "no-store" });
  });

  routes.post("/account/export", async (context) => {
    const user = await readSessionUser(auth, context.req.raw.headers);

    if (user === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const result = await exports.request(user.id);

    return context.json({ ...result.state, replaced: result.replaced }, 202, {
      "cache-control": "no-store",
    });
  });

  routes.get("/account/export/:id/download", async (context) => {
    const user = await readSessionUser(auth, context.req.raw.headers);

    if (user === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const result = await exports.download(user.id, context.req.param("id"));

    if (result === "not_found") {
      return context.json({ error: "not_found" }, 404);
    }

    if (result === "expired") {
      return context.json({ error: "export_expired" }, 410);
    }

    const headers = new Headers({
      "cache-control": "no-store",
      "content-disposition": 'attachment; filename="overture-export.ovex"',
      "content-type": "application/octet-stream",
      "x-export-valid-for-seconds": String(Math.floor(EXPORT_VALID_MS / 1000)),
    });

    if (result.bytes > 0) {
      headers.set("content-length", String(result.bytes));
    }

    return new Response(result.stream, { headers });
  });

  return routes;
}
