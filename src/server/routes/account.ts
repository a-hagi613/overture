import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { verifyPassword } from "better-auth/crypto";
import { z } from "zod";

import type { AccountEraser } from "../account/erase.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import type { Auth } from "../auth/index.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { copy } from "../../shared/copy.ts";
import { env } from "../config/env.ts";
import { accounts, rateLimits, sessions } from "../platform/db/schema.ts";
import { ERASURE_COMPLETES_WITHIN_MS, REAUTH_WINDOW_MS } from "../account/erase.ts";

const passwordSchema = z.object({ password: z.string().min(1).max(1024) });
const deleteSchema = z.object({ confirm: z.literal(true) });

const REAUTH_MAX_ATTEMPTS = 5;
const LINK_MAX_ATTEMPTS = 3;

function reauthLimitKey(userId: string) {
  return `account-reauth:${userId}`;
}

function linkLimitKey(userId: string) {
  return `account-reauth-link:${userId}`;
}

export function createAccountRoutes(deps: {
  db: AppDatabase;
  clock: Clock;
  auth: Auth;
  eraser: AccountEraser;
}) {
  const { db, clock, auth, eraser } = deps;

  const routes = new Hono();

  async function sessionOf(raw: Request) {
    return auth.api.getSession({ headers: raw.headers }).catch(() => null);
  }

  function passwordHashFor(userId: string) {
    const row = db
      .select({ password: accounts.password })
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "credential")))
      .get();

    return row?.password ?? null;
  }

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

  function clearAttempts(key: string) {
    db.delete(rateLimits).where(eq(rateLimits.key, key)).run();
  }

  routes.get("/account/deletion", async (context) => {
    const result = await sessionOf(context.req.raw);

    if (result === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    context.header("Cache-Control", "no-store");

    return context.json({
      email: result.user.email,
      hasPassword: passwordHashFor(result.user.id) !== null,
      reauthenticated: sessionReauthenticated(result.session.id, clock.now()),
    });
  });

  routes.post("/account/reauth", async (context) => {
    const result = await sessionOf(context.req.raw);

    if (result === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    const body = passwordSchema.safeParse(await context.req.json().catch(() => null));

    if (!body.success) {
      return context.json({ error: "invalid_body" }, 400);
    }

    const now = clock.now();

    if (tooManyAttempts(reauthLimitKey(result.user.id), now, REAUTH_MAX_ATTEMPTS)) {
      return context.json({ error: "too_many", message: copy.deleteAccount.errors.tooMany }, 429);
    }

    const hash = passwordHashFor(result.user.id);

    if (hash === null) {
      return context.json(
        { error: "password_not_set", message: copy.deleteAccount.errors.passwordNotSet },
        409,
      );
    }

    const verified = await verifyPassword({ hash, password: body.data.password }).catch(
      () => false,
    );

    if (!verified) {
      recordFailedAttempt(reauthLimitKey(result.user.id), now);

      return context.json(
        { error: "invalid_password", message: copy.deleteAccount.errors.wrongPassword },
        403,
      );
    }

    clearAttempts(reauthLimitKey(result.user.id));

    db.update(sessions)
      .set({ reauthAt: new Date(now), updatedAt: new Date(now) })
      .where(eq(sessions.id, result.session.id))
      .run();

    return context.json({ reauthenticated: true });
  });

  routes.post("/account/reauth/link", async (context) => {
    const result = await sessionOf(context.req.raw);

    if (result === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    const now = clock.now();
    const key = linkLimitKey(result.user.id);

    if (tooManyAttempts(key, now, LINK_MAX_ATTEMPTS)) {
      return context.json({ error: "too_many", message: copy.deleteAccount.errors.tooMany }, 429);
    }

    recordFailedAttempt(key, now);

    const origin = env.APP_ORIGIN ?? new URL(context.req.url).origin;

    await auth.api.signInMagicLink({
      body: { email: result.user.email, callbackURL: `${origin}/settings/delete` },
      headers: context.req.raw.headers,
    });

    return context.json({ sent: true });
  });

  routes.post("/account/delete", async (context) => {
    const result = await sessionOf(context.req.raw);

    if (result === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    const body = deleteSchema.safeParse(await context.req.json().catch(() => null));

    if (!body.success) {
      return context.json({ error: "invalid_body" }, 400);
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

  return routes;
}
