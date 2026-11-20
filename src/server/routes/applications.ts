import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { Auth } from "../auth/index.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";

import {
  applications,
  applicationEvents,
  applicationSnapshots,
  companies,
  matches,
  postings,
  reviewApplications,
  reviews,
} from "../platform/db/schema.ts";

const STAGES = ["queued", "applied", "screening", "interviewing", "offer", "closed"] as const;

const STRONG_SCORE = 80;

const snapshotAnswerSchema = z.array(
  z.object({
    answer: z.string().nullable(),
    fact_key: z.string().nullable(),
    fact_revision: z.number().nullable(),
    kind: z.string(),
    label: z.string(),
    question_id: z.string(),
    resume_line_ids: z.array(z.string()),
  }),
);

const coverLetterSchema = z.array(
  z.object({ resume_line_ids: z.array(z.string()), sentence: z.string() }),
);

interface CardRow {
  id: string;
  status: string;
  stage: string | null;
  stageLocked: boolean;
  company: string;
  title: string;
  location: string | null;
  score: number | null;
  sentAt: number | null;
  updatedAt: number;
}

export function createApplicationRoutes(
  db: AppDatabase,
  clock: Clock,
  auth: Auth,
  personal: PersonalCrypto,
) {
  const routes = new Hono();

  async function sessionOf(headers: Headers) {
    const result = await auth.api.getSession({ headers }).catch(() => null);

    return result ?? null;
  }

  routes.get("/board", async (context) => {
    const session = await sessionOf(context.req.raw.headers);

    if (session === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    const userId = session.user.id;

    const rows = db
      .select({
        company: companies.name,
        id: applications.id,
        location: postings.locationRaw,
        score: matches.score,
        sentAt: applications.sentAt,
        stage: applications.stage,
        stageLocked: applications.stageLocked,
        status: applications.status,
        title: postings.title,
        updatedAt: applications.updatedAt,
      })
      .from(applications)
      .innerJoin(postings, eq(postings.id, applications.postingId))
      .innerJoin(companies, eq(companies.id, applications.companyId))
      .leftJoin(
        matches,
        and(eq(matches.userId, applications.userId), eq(matches.postingId, applications.postingId)),
      )
      .where(eq(applications.userId, userId))
      .orderBy(asc(applications.boardPosition), asc(applications.updatedAt))
      .all();

    const blocked = new Set(
      db
        .select({ applicationId: reviewApplications.applicationId })
        .from(reviewApplications)
        .innerJoin(reviews, eq(reviews.id, reviewApplications.reviewId))
        .where(and(eq(reviews.userId, userId), eq(reviews.status, "open")))
        .all()
        .map((row) => row.applicationId),
    );

    const cards = (rows satisfies CardRow[]).map((row) => ({
      company: row.company,
      id: row.id,
      location: row.location,
      needsYou: blocked.has(row.id),
      score: row.score,
      sentAt: row.sentAt,
      stage: row.stage,
      stageLocked: row.stageLocked,
      status: row.status,
      strong: row.score !== null && row.score >= STRONG_SCORE,
      title: row.title,
      updatedAt: row.updatedAt,
    }));

    return context.json({
      columns: STAGES.map((stage) => ({
        cards: cards.filter((card) => card.stage === stage),
        stage,
      })),
      updatedAt: clock.now(),
    });
  });

  routes.get("/applications/:id", async (context) => {
    const session = await sessionOf(context.req.raw.headers);

    if (session === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    const { id } = context.req.param();

    const row = db
      .select({
        application: applications,
        company: companies.name,
        posting: postings,
      })
      .from(applications)
      .innerJoin(postings, eq(postings.id, applications.postingId))
      .innerJoin(companies, eq(companies.id, applications.companyId))
      .where(and(eq(applications.id, id), eq(applications.userId, session.user.id)))
      .get();

    if (row === undefined) {
      return context.json({ error: "not_found" }, 404);
    }

    const snapshot = db
      .select()
      .from(applicationSnapshots)
      .where(eq(applicationSnapshots.applicationId, id))
      .get();

    const snapshotView =
      snapshot === undefined
        ? null
        : {
            answers: snapshotAnswerSchema.parse(
              JSON.parse(
                await personal.openFor(
                  session.user.id,
                  { column: "answers_enc", rowId: id, table: "application_snapshots" },
                  snapshot.answersEnc,
                ),
              ),
            ),
            confirmedBy: snapshot.confirmedBy,
            consentVersion: snapshot.consentVersion,
            costMicros: snapshot.costMicros,
            coverLetter:
              snapshot.coverLetterEnc === null
                ? null
                : coverLetterSchema.parse(
                    JSON.parse(
                      await personal.openFor(
                        session.user.id,
                        { column: "cover_letter_enc", rowId: id, table: "application_snapshots" },
                        snapshot.coverLetterEnc,
                      ),
                    ),
                  ),
            provider: snapshot.provider,
            resumeSha256: snapshot.resumeSha256,
            submittedAt: snapshot.submittedAt,
          };

    const timeline = db
      .select()
      .from(applicationEvents)
      .where(eq(applicationEvents.applicationId, id))
      .orderBy(asc(applicationEvents.at))
      .all();

    return context.json({
      application: row.application,
      company: row.company,
      posting: {
        ats: row.posting.ats,
        id: row.posting.id,
        location: row.posting.locationRaw,
        title: row.posting.title,
        url: row.posting.url,
      },
      snapshot: snapshotView,
      timeline,
    });
  });

  return routes;
}
