import { validJson } from "./validators.ts";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { AdminEnv } from "./admin-refusals.ts";
import type { RevealSession } from "../platform/audit/reveal.ts";

import { buildActAsView } from "../admin/reveal-view.ts";
import { users } from "../platform/db/schema.ts";
import {
  activeReveal,
  closeReveal,
  openReveal,
  REVEAL_PASSKEY_WINDOW_MS,
  recordRevealView,
} from "../platform/audit/reveal.ts";
import { lastPasskeyAssertionAt } from "../platform/passkey/index.ts";
import { ADMIN_REFUSAL_CODES } from "./admin-refusals.ts";

const revealBody = z.object({ reason: z.string().trim().min(1).max(500) });

function revealViewOf(session: RevealSession, now: number) {
  return {
    expiresAt: session.expiresAt,
    id: session.id,
    openedAt: session.openedAt,
    reason: session.reason,
    remainingMs: Math.max(0, session.expiresAt - now),
    targetUserId: session.targetUserId,
  };
}

export function createAdminRevealRoutes(db: AppDatabase, clock: Clock, personal: PersonalCrypto) {
  const routes = new Hono<AdminEnv>();

  routes.post("/users/:id/reveal", validJson(revealBody), async (context) => {
    const owner = context.get("owner");
    const { reason } = context.req.valid("json");

    const target = db
      .select()
      .from(users)
      .where(eq(users.id, context.req.param("id")))
      .get();

    if (target === undefined) {
      return context.json({ error: "not_found" }, 404);
    }

    const assertedAt = lastPasskeyAssertionAt(db, owner.userId);

    if (assertedAt === null || clock.now() - assertedAt.getTime() >= REVEAL_PASSKEY_WINDOW_MS) {
      return context.json({ error: ADMIN_REFUSAL_CODES.passkeyRequired }, 403);
    }

    const session = await openReveal(db, clock, {
      actorId: owner.userId,
      targetUserId: target.id,
      reason,
      passkeyAssertedAt: assertedAt.getTime(),
    });

    return context.json({ reveal: revealViewOf(session, clock.now()) }, 201);
  });

  routes.get("/users/:id/reveal", async (context) => {
    const owner = context.get("owner");

    const target = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, context.req.param("id")))
      .get();

    if (target === undefined) {
      return context.json({ error: "not_found" }, 404);
    }

    const session = await activeReveal(db, clock, owner.userId);

    if (session === null || session.targetUserId !== target.id) {
      return context.json({ reveal: null });
    }

    return context.json({ reveal: revealViewOf(session, clock.now()) });
  });

  routes.delete("/users/:id/reveal", async (context) => {
    const owner = context.get("owner");

    const target = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, context.req.param("id")))
      .get();

    if (target === undefined) {
      return context.json({ error: "not_found" }, 404);
    }

    const session = await activeReveal(db, clock, owner.userId);

    if (session !== null && session.targetUserId === target.id) {
      await closeReveal(db, clock, owner.userId);
    }

    return context.json({ reveal: null });
  });

  const actAsGuard = async (context: Context<AdminEnv>, next: Next) => {
    const owner = context.get("owner");
    const session = await activeReveal(db, clock, owner.userId);

    if (session === null || session.targetUserId !== context.req.param("userId")) {
      return context.json({ error: ADMIN_REFUSAL_CODES.revealRequired }, 403);
    }

    if (!["GET", "HEAD"].includes(context.req.method)) {
      return context.json({ error: ADMIN_REFUSAL_CODES.readOnly }, 403);
    }

    context.set("reveal", session);
    await recordRevealView(db, clock, session, "overview");
    await next();

    return context.res;
  };

  routes.use("/act-as/:userId", actAsGuard);
  routes.use("/act-as/:userId/*", actAsGuard);

  routes.get("/act-as/:userId", async (context) => {
    const session = context.get("reveal");
    const view = await buildActAsView(db, clock, personal, session.targetUserId, session);

    if (view === null) {
      return context.json({ error: "not_found" }, 404);
    }

    return context.json({ view });
  });

  return routes;
}
