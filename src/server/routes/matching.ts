import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { Auth } from "../auth/index.ts";
import type { MatchingService } from "../matching/score.ts";

import { postingUserState, postings } from "../platform/db/schema.ts";

const stateBody = z.object({ state: z.enum(["saved", "hidden"]).nullable() });

export function createMatchingRoutes(deps: {
  db: AppDatabase;
  clock: Clock;
  auth: Auth;
  matching: MatchingService;
}) {
  const { db, clock, auth, matching } = deps;

  const routes = new Hono();

  routes.get("/postings/:id", async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    const { id } = context.req.param();
    const row = db.select().from(postings).where(eq(postings.id, id)).get();

    if (row === undefined) {
      return context.json({ error: "not found" }, 404);
    }

    const scored = await matching.scoreOnOpen(account.id, id);

    const state = db
      .select({ state: postingUserState.state })
      .from(postingUserState)
      .where(and(eq(postingUserState.userId, account.id), eq(postingUserState.postingId, id)))
      .get();

    return context.json({
      id: row.id,
      title: row.title,
      companyId: row.companyId,
      url: row.url,
      applyUrl: row.applyUrl,
      locationRaw: row.locationRaw,
      workplace: row.workplace,
      employmentType: row.employmentType,
      salaryMinMinor: row.salaryMinMinor,
      salaryMaxMinor: row.salaryMaxMinor,
      salaryCurrency: row.salaryCurrency,
      salaryPeriod: row.salaryPeriod,
      postedAt: row.postedAt,
      score: scored?.score ?? null,
      reason: scored?.reason ?? null,
      applicationId: scored?.applicationId ?? null,
      state: state?.state ?? null,
    });
  });

  routes.post("/postings/:id/apply", async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    const { id } = context.req.param();
    const applied = await matching.applyManually(account.id, id);

    if (applied === null) {
      return context.json({ error: "not found" }, 404);
    }

    return context.json(applied);
  });

  routes.put("/postings/:id/state", zValidator("json", stateBody), async (context) => {
    const account = await sessionUser(auth, context.req.raw);

    if (account === null) {
      return context.json({ error: "unauthorised" }, 401);
    }

    const { id } = context.req.param();
    const { state } = context.req.valid("json");
    const posting = db.select({ id: postings.id }).from(postings).where(eq(postings.id, id)).get();

    if (posting === undefined) {
      return context.json({ error: "not found" }, 404);
    }

    if (state === null) {
      db.delete(postingUserState)
        .where(and(eq(postingUserState.userId, account.id), eq(postingUserState.postingId, id)))
        .run();

      return context.json({ id, state: null });
    }

    db.insert(postingUserState)
      .values({ userId: account.id, postingId: id, state, updatedAt: clock.now() })
      .onConflictDoUpdate({
        target: [postingUserState.userId, postingUserState.postingId],
        set: { state, updatedAt: clock.now() },
      })
      .run();

    return context.json({ id, state });
  });

  return routes;
}

async function sessionUser(auth: Auth, raw: Request) {
  const result = await auth.api.getSession({ headers: raw.headers }).catch(() => null);

  return result?.user ?? null;
}
