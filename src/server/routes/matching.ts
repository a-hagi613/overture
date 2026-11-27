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
import { jobPostingById } from "../jobs/job-posting.ts";
import { demoLocked } from "../demo/guard.ts";
import { API_ERRORS } from "../../shared/api-errors.ts";

const stateBody = z.object({ state: z.enum(["saved", "hidden"]).nullable() });

const UP_NEXT_LIMIT = 6;

export interface PostingDetail {
  id: string;
  title: string;
  companyId: string;
  url: string | null;
  applyUrl: string | null;
  locationRaw: string | null;
  workplace: string | null;
  employmentType: string | null;
  salaryMinMinor: number | null;
  salaryMaxMinor: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  postedAt: number | null;
}

/**
 * The posting drawer's fields, read from the freehire job first and the legacy catalog second.
 *
 * @param deps The app database and the catalog fallback.
 * @param postingId The posting the drawer opened.
 * @returns The fields the drawer renders, or null when neither table holds the posting.
 */
export function postingDetailOf(
  deps: { db: AppDatabase; catalogDb: CatalogDatabase },
  postingId: string,
) {
  const posting = jobPostingById(deps, postingId);

  if (posting === undefined) {
    return null;
  }

  return {
    applyUrl: posting.applyUrl,
    companyId: posting.companyId,
    employmentType: posting.employmentType,
    id: posting.postingId,
    locationRaw: posting.locationRaw,
    postedAt: posting.postedAt,
    salaryCurrency: posting.salaryCurrency,
    salaryMaxMinor: posting.salaryMaxMinor,
    salaryMinMinor: posting.salaryMinMinor,
    salaryPeriod: posting.salaryPeriod,
    title: posting.title,
    url: posting.url,
    workplace: posting.workplace,
  } satisfies PostingDetail;
}

export function createMatchingRoutes(deps: {
  db: AppDatabase;
  catalogDb: CatalogDatabase;
  clock: Clock;
  auth: Auth;
  matching: MatchingService;
}) {
  const { db, catalogDb, clock, auth, matching } = deps;

  const routes = new Hono();

  routes.get("/matching/up-next", async (context) => {
    context.header("Cache-Control", "private, no-store");

    const account = await readSessionUser(auth, context.req.raw.headers);

    if (account === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    return context.json({ items: await matching.upNext(account.id, UP_NEXT_LIMIT) });
  });

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
    const detail = postingDetailOf({ catalogDb, db }, id);

    if (detail === null) {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    const scored = await matching.scoreOnOpen(account.id, id);

    const state = db
      .select({ state: postingUserState.state })
      .from(postingUserState)
      .where(and(eq(postingUserState.userId, account.id), eq(postingUserState.postingId, id)))
      .get();

    return context.json({
      ...detail,
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

    const posting = jobPostingById({ catalogDb, db }, id);

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
