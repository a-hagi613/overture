import { Hono } from "hono";
import { validJson } from "./validators.ts";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { Auth } from "../auth/index.ts";
import { readSessionUser } from "../auth/session.ts";
import type { MatchingService } from "../matching/score.ts";

import { postingUserState } from "../platform/db/schema.ts";
import { postings } from "../platform/db/catalog-schema.ts";
import { demoLocked } from "../demo/guard.ts";
import { API_ERRORS } from "../../shared/api-errors.ts";

const stateBody = z.object({ state: z.enum(["saved", "hidden"]).nullable() });

export function createMatchingRoutes(deps: {
  db: AppDatabase;
  catalogDb: CatalogDatabase;
  clock: Clock;
  auth: Auth;
  matching: MatchingService;
}) {
  const { db, catalogDb, clock, auth, matching } = deps;

  const routes = new Hono();

  routes.get("/postings/:id", async (context) => {
    const account = await readSessionUser(auth, context.req.raw.headers);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const locked = demoLocked(account.role);

    if (locked !== null) {
      return locked;
    }

    const { id } = context.req.param();
    const row = catalogDb.select().from(postings).where(eq(postings.id, id)).get();

    if (row === undefined) {
      return context.json({ error: API_ERRORS.notFound }, 404);
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
    const account = await readSessionUser(auth, context.req.raw.headers);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const locked = demoLocked(account.role);

    if (locked !== null) {
      return locked;
    }

    const { id } = context.req.param();
    const applied = await matching.applyManually(account.id, id);

    if (applied === null) {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    if ("refused" in applied) {
      return context.json({ error: "filtered", reason: applied.refused }, 409);
    }

    return context.json(applied);
  });

  routes.put("/postings/:id/state", validJson(stateBody), async (context) => {
    const account = await readSessionUser(auth, context.req.raw.headers);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const { id } = context.req.param();
    const { state } = context.req.valid("json");

    const posting = catalogDb
      .select({ id: postings.id })
      .from(postings)
      .where(eq(postings.id, id))
      .get();

    if (posting === undefined) {
      return context.json({ error: API_ERRORS.notFound }, 404);
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
