import { and, asc, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
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
  mailThreads,
  matches,
  messages,
  postings,
  resumes,
  reviewApplications,
  reviews,
} from "../platform/db/schema.ts";
import { localDayStart, localPartsAt } from "../platform/local-time.ts";
import { restartCheckinAfterUndo } from "../pipeline/checkins.ts";
import { publishEvent } from "../platform/sse/stream.ts";
import { createTimeZoneService } from "../profile/time-zone.ts";
import { resumeLines as splitResumeLines } from "../pipeline/grounding.ts";

const MOVE_STAGES = ["queued", "applied", "screening", "interviewing", "offer", "closed"] as const;

const STAGES = [
  "queued",
  "ready",
  "applied",
  "screening",
  "interviewing",
  "offer",
  "closed",
] as const;

const STRONG_SCORE = 80;

const DAY_MS = 24 * 60 * 60_000;

const stageMoveSchema = z.object({
  stage: z.enum(MOVE_STAGES),
  position: z.number().nullable().default(null),
});

const snapshotAnswerSchema = z.array(
  z.object({
    answer: z.string().nullable(),
    by_user: z.boolean().optional(),
    fact_key: z.string().nullable(),
    fact_revision: z.number().nullable(),
    kind: z.string(),
    label: z.string(),
    question_id: z.string(),
    resume_line_ids: z.array(z.string()),
  }),
);

const coverLetterSchema = z.array(
  z.object({
    by_user: z.boolean().optional(),
    resume_line_ids: z.array(z.string()),
    sentence: z.string(),
  }),
);

function isStage(value: string): value is (typeof STAGES)[number] {
  switch (value) {
    case "queued":
    case "applied":
    case "screening":
    case "interviewing":
    case "offer":
    case "closed": {
      return true;
    }

    default: {
      return false;
    }
  }
}

function closedNote(reason: string | null) {
  switch (reason) {
    case "no_response": {
      return { label: "Ghosted", tone: "ghost" };
    }

    case "offer_accepted": {
      return { label: "Accepted", tone: "ok" };
    }

    case "offer_declined": {
      return { label: "Declined", tone: "declined" };
    }

    case "rejected": {
      return { label: "Rejected", tone: "rejected" };
    }

    case "withdrawn": {
      return { label: "Withdrawn", tone: "withdrawn" };
    }

    default: {
      return { label: "Closed", tone: "muted" };
    }
  }
}

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
  createdAt: number;
  scheduledFor: number | null;
  closedReason: string | null;
  boardPosition: number | null;
  salaryMinMinor: number | null;
  salaryMaxMinor: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
}

function clockLabel(at: number, timeZone: string) {
  const parts = localPartsAt(at, timeZone);

  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function noteFor(
  row: CardRow,
  options: { needsYou: boolean; emailNote: string | null; dayStart: number; timeZone: string },
) {
  if (row.status === "confirming") {
    return { label: "Checking with the employer", tone: "ink" };
  }

  if (options.needsYou) {
    return { label: "Needs you", tone: "need" };
  }

  if (row.stage === "ready") {
    if (row.status === "approved") {
      return {
        label:
          row.scheduledFor === null
            ? "Approved"
            : `Approved · ~${clockLabel(row.scheduledFor, options.timeZone)}`,
        tone: "ok",
      };
    }

    if (row.status === "ready") {
      return { label: "Ready to send", tone: "ok" };
    }

    if (row.status === "sending") {
      return { label: "Sending", tone: "muted" };
    }

    return { label: "Checking with the employer", tone: "ink" };
  }

  if (row.stage === "queued") {
    return row.scheduledFor === null
      ? null
      : { label: `Sends about ${clockLabel(row.scheduledFor, options.timeZone)}`, tone: "muted" };
  }

  if (row.stage === "applied") {
    if (row.sentAt === null) {
      return null;
    }

    return row.sentAt >= options.dayStart
      ? { label: "Sent today", tone: "accent" }
      : { label: "Sent", tone: "accent" };
  }

  if (row.stage === "closed") {
    return closedNote(row.closedReason);
  }

  if (row.stage === "screening") {
    return { label: options.emailNote ?? "Reply received", tone: "ok" };
  }

  if (row.stage === "interviewing") {
    return { label: options.emailNote ?? "Interviewing", tone: "ok" };
  }

  if (row.stage === "offer") {
    return { label: options.emailNote ?? "Offer received", tone: "ok" };
  }

  return null;
}

export function createApplicationRoutes(
  db: AppDatabase,
  clock: Clock,
  auth: Auth,
  personal: PersonalCrypto,
) {
  const routes = new Hono();
  const zones = createTimeZoneService({ db, clock });

  async function sessionOf(headers: Headers) {
    const result = await auth.api.getSession({ headers }).catch(() => null);

    return result ?? null;
  }

  async function timeZoneOf(userId: string) {
    const { timezone } = await zones.current(userId);

    return timezone ?? "UTC";
  }

  function latestEmailNotes(userId: string) {
    const notes = new Map<string, string>();

    const rows = db
      .select({
        applicationId: applicationEvents.applicationId,
        detail: applicationEvents.detail,
        toValue: applicationEvents.toValue,
      })
      .from(applicationEvents)
      .where(and(eq(applicationEvents.userId, userId), eq(applicationEvents.kind, "email")))
      .orderBy(asc(applicationEvents.at))
      .all();

    for (const row of rows) {
      const note = row.toValue ?? row.detail;

      if (note !== null && note.trim() !== "") {
        notes.set(row.applicationId, note);
      }
    }

    return notes;
  }

  function blockedApplicationIds(userId: string) {
    return new Set(
      db
        .select({ applicationId: reviewApplications.applicationId })
        .from(reviewApplications)
        .innerJoin(reviews, eq(reviews.id, reviewApplications.reviewId))
        .where(and(eq(reviews.userId, userId), eq(reviews.status, "open")))
        .all()
        .map((row) => row.applicationId),
    );
  }

  async function boardResponse(userId: string) {
    const now = clock.now();
    const timeZone = await timeZoneOf(userId);
    const dayStart = localDayStart(now, timeZone);

    const rows = db
      .select({
        boardPosition: applications.boardPosition,
        closedReason: applications.closedReason,
        company: companies.name,
        createdAt: applications.createdAt,
        id: applications.id,
        location: postings.locationRaw,
        salaryCurrency: postings.salaryCurrency,
        salaryMaxMinor: postings.salaryMaxMinor,
        salaryMinMinor: postings.salaryMinMinor,
        salaryPeriod: postings.salaryPeriod,
        scheduledFor: applications.scheduledFor,
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

    const blocked = blockedApplicationIds(userId);
    const emailNotes = latestEmailNotes(userId);

    const cards = (rows satisfies CardRow[]).map((row) => ({
      ageDays: Math.max(0, Math.floor((now - row.createdAt) / DAY_MS)),
      company: row.company,
      id: row.id,
      location: row.location,
      needsYou: blocked.has(row.id),
      note: noteFor(row, {
        dayStart,
        emailNote: emailNotes.get(row.id) ?? null,
        needsYou: blocked.has(row.id),
        timeZone,
      }),
      position: row.boardPosition,
      salary:
        row.salaryMinMinor === null
          ? null
          : {
              currency: row.salaryCurrency,
              maxMinor: row.salaryMaxMinor,
              minMinor: row.salaryMinMinor,
              period: row.salaryPeriod,
            },
      score: row.score,
      sentAt: row.sentAt,
      stage: row.stage,
      stageLocked: row.stageLocked,
      status: row.status,
      strong: row.score !== null && row.score >= STRONG_SCORE,
      title: row.title,
      updatedAt: row.updatedAt,
    }));

    return {
      columns: STAGES.map((stage) => ({
        cards: cards.filter((card) => card.stage === stage),
        stage,
      })),
      total: cards.filter((card) => card.stage !== null).length,
      updatedAt: now,
    };
  }

  routes.get("/board", async (context) => {
    const session = await sessionOf(context.req.raw.headers);

    if (session === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    return context.json(await boardResponse(session.user.id));
  });

  routes.patch("/applications/:id/stage", zValidator("json", stageMoveSchema), async (context) => {
    const session = await sessionOf(context.req.raw.headers);

    if (session === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    const { id } = context.req.param();
    const { stage, position } = context.req.valid("json");
    const now = clock.now();

    const row = db
      .select({
        id: applications.id,
        stage: applications.stage,
        stageLocked: applications.stageLocked,
      })
      .from(applications)
      .where(and(eq(applications.id, id), eq(applications.userId, session.user.id)))
      .get();

    if (row === undefined) {
      return context.json({ error: "not_found" }, 404);
    }

    if (row.stage === null) {
      return context.json({ error: "off_board" }, 409);
    }

    db.transaction((tx) => {
      tx.update(applications)
        .set({
          boardPosition: position,
          stage,
          stageLocked: true,
          updatedAt: now,
        })
        .where(eq(applications.id, id))
        .run();

      tx.insert(applicationEvents)
        .values({
          at: now,
          applicationId: id,
          detail: null,
          fromValue: row.stage,
          id: crypto.randomUUID(),
          kind: "stage",
          source: "user",
          toValue: stage,
          userId: session.user.id,
        })
        .run();
    });

    publishEvent(
      db,
      clock,
      "board.moved",
      JSON.stringify({ applicationId: id, stage }),
      session.user.id,
    );
    publishEvent(
      db,
      clock,
      "application.updated",
      JSON.stringify({ applicationId: id }),
      session.user.id,
    );

    return context.json({ stage, stageLocked: true });
  });

  routes.post("/applications/:id/undo-stage", async (context) => {
    const session = await sessionOf(context.req.raw.headers);

    if (session === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    const { id } = context.req.param();

    const row = db
      .select({
        closedReason: applications.closedReason,
        id: applications.id,
        stage: applications.stage,
      })
      .from(applications)
      .where(and(eq(applications.id, id), eq(applications.userId, session.user.id)))
      .get();

    if (row === undefined) {
      return context.json({ error: "not_found" }, 404);
    }

    const last = db
      .select()
      .from(applicationEvents)
      .where(and(eq(applicationEvents.applicationId, id), eq(applicationEvents.kind, "stage")))
      .orderBy(desc(applicationEvents.at))
      .get();

    if (last === undefined || last.source === "user" || last.fromValue === null) {
      return context.json({ error: "cannot_undo" }, 409);
    }

    const restored = last.fromValue;

    if (!isStage(restored)) {
      return context.json({ error: "cannot_undo" }, 409);
    }

    const now = clock.now();

    db.transaction((tx) => {
      tx.update(applications)
        .set({
          closedReason: restored === "closed" ? row.closedReason : null,
          stage: restored,
          stageLocked: false,
          updatedAt: now,
        })
        .where(eq(applications.id, id))
        .run();

      tx.insert(applicationEvents)
        .values({
          at: now,
          applicationId: id,
          detail: null,
          fromValue: row.stage,
          id: crypto.randomUUID(),
          kind: "stage",
          source: "user",
          toValue: restored,
          userId: session.user.id,
        })
        .run();
    });

    if (restored === "applied") {
      restartCheckinAfterUndo({ clock, db }, id);
    }

    publishEvent(
      db,
      clock,
      "board.moved",
      JSON.stringify({ applicationId: id, stage: restored }),
      session.user.id,
    );
    publishEvent(
      db,
      clock,
      "application.updated",
      JSON.stringify({ applicationId: id }),
      session.user.id,
    );

    return context.json({ stage: restored, stageLocked: false });
  });

  routes.post("/applications/:id/withdraw", async (context) => {
    const session = await sessionOf(context.req.raw.headers);

    if (session === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    const { id } = context.req.param();

    const row = db
      .select({ id: applications.id, stage: applications.stage, status: applications.status })
      .from(applications)
      .where(and(eq(applications.id, id), eq(applications.userId, session.user.id)))
      .get();

    if (row === undefined) {
      return context.json({ error: "not_found" }, 404);
    }

    const withdrawable =
      row.status === "ready" || row.status === "approved" || row.stage === "queued";

    if (!withdrawable) {
      return context.json({ error: "not_queued" }, 409);
    }

    const now = clock.now();

    db.transaction((tx) => {
      tx.update(applications)
        .set({
          approvedAt: null,
          approvedPlanEnc: null,
          approvedPlanSha256: null,
          changes: null,
          closedReason: "withdrawn",
          scheduledFor: null,
          stage: null,
          stageLocked: true,
          status: "withdrawn",
          statusReason: "withdrawn",
          updatedAt: now,
        })
        .where(eq(applications.id, id))
        .run();

      tx.insert(applicationEvents)
        .values({
          at: now,
          applicationId: id,
          detail: null,
          fromValue: row.stage,
          id: crypto.randomUUID(),
          kind: "stage",
          source: "user",
          toValue: null,
          userId: session.user.id,
        })
        .run();
    });

    publishEvent(
      db,
      clock,
      "board.moved",
      JSON.stringify({ applicationId: id, stage: null }),
      session.user.id,
    );

    return context.json({ stage: null, status: "withdrawn" });
  });

  routes.get("/applications/:id", async (context) => {
    const session = await sessionOf(context.req.raw.headers);

    if (session === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    const { id } = context.req.param();
    const userId = session.user.id;

    const row = db
      .select({
        application: applications,
        company: companies.name,
        posting: postings,
      })
      .from(applications)
      .innerJoin(postings, eq(postings.id, applications.postingId))
      .innerJoin(companies, eq(companies.id, applications.companyId))
      .where(and(eq(applications.id, id), eq(applications.userId, userId)))
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
                  userId,
                  { column: "answers_enc", rowId: id, table: "application_snapshots" },
                  snapshot.answersEnc,
                ),
              ),
            ),
            approvedAt: snapshot.approvedAt,
            approvedPlanSha256: snapshot.approvedPlanSha256,
            confirmedBy: snapshot.confirmedBy,
            consentVersion: snapshot.consentVersion,
            costMicros: snapshot.costMicros,
            coverLetter:
              snapshot.coverLetterEnc === null
                ? null
                : coverLetterSchema.parse(
                    JSON.parse(
                      await personal.openFor(
                        userId,
                        { column: "cover_letter_enc", rowId: id, table: "application_snapshots" },
                        snapshot.coverLetterEnc,
                      ),
                    ),
                  ),
            provider: snapshot.provider,
            resumeSha256: snapshot.resumeSha256,
            resume: await resumeFile(userId, snapshot.resumeId),
            submittedAt: snapshot.submittedAt,
          };

    const match = db
      .select()
      .from(matches)
      .where(and(eq(matches.userId, userId), eq(matches.postingId, row.posting.id)))
      .get();

    const now = clock.now();
    const timeZone = await timeZoneOf(userId);
    const dayStart = localDayStart(now, timeZone);
    const emailNotes = latestEmailNotes(userId);

    const note = noteFor(
      {
        boardPosition: row.application.boardPosition,
        closedReason: row.application.closedReason,
        company: row.company,
        createdAt: row.application.createdAt,
        id: row.application.id,
        location: row.posting.locationRaw,
        salaryCurrency: row.posting.salaryCurrency,
        salaryMaxMinor: row.posting.salaryMaxMinor,
        salaryMinMinor: row.posting.salaryMinMinor,
        salaryPeriod: row.posting.salaryPeriod,
        scheduledFor: row.application.scheduledFor,
        score: match?.score ?? null,
        sentAt: row.application.sentAt,
        stage: row.application.stage,
        stageLocked: row.application.stageLocked,
        status: row.application.status,
        title: row.posting.title,
        updatedAt: row.application.updatedAt,
      },
      {
        dayStart,
        emailNote: emailNotes.get(id) ?? null,
        needsYou: blockedApplicationIds(userId).has(id),
        timeZone,
      },
    );

    const timeline = db
      .select()
      .from(applicationEvents)
      .where(eq(applicationEvents.applicationId, id))
      .orderBy(asc(applicationEvents.at))
      .all();

    return context.json({
      ageDays: Math.max(0, Math.floor((now - row.application.createdAt) / DAY_MS)),
      application: row.application,
      company: row.company,
      mail: await linkedMail(userId, id),
      match:
        match === undefined
          ? null
          : {
              reason: match.reason,
              score: match.score,
              strong: match.score !== null && match.score >= STRONG_SCORE,
            },
      note,
      posting: {
        ats: row.posting.ats,
        id: row.posting.id,
        location: row.posting.locationRaw,
        salaryCurrency: row.posting.salaryCurrency,
        salaryMaxMinor: row.posting.salaryMaxMinor,
        salaryMinMinor: row.posting.salaryMinMinor,
        salaryPeriod: row.posting.salaryPeriod,
        title: row.posting.title,
        url: row.posting.url,
      },
      snapshot:
        snapshotView === null
          ? null
          : {
              ...snapshotView,
              resumeLines: await citedResumeLines(userId, snapshot?.resumeId ?? null, snapshotView),
            },
      timeZone,
      timeline,
    });
  });

  async function citedResumeLines(
    userId: string,
    resumeId: string | null,
    snapshot: {
      answers: { resume_line_ids: string[] }[];
      coverLetter: { resume_line_ids: string[] }[] | null;
    },
  ) {
    if (resumeId === null) {
      return [];
    }

    const row = db.select().from(resumes).where(eq(resumes.id, resumeId)).get();

    if (row === undefined) {
      return [];
    }

    const cited = new Set<string>();

    for (const answer of snapshot.answers) {
      for (const id of answer.resume_line_ids) {
        cited.add(id);
      }
    }

    for (const line of snapshot.coverLetter ?? []) {
      for (const id of line.resume_line_ids) {
        cited.add(id);
      }
    }

    const text = await personal.openFor(
      userId,
      { column: "text_enc", rowId: row.id, table: "resumes" },
      row.textEnc,
    );

    return splitResumeLines(text).filter((line) => cited.has(line.id));
  }

  async function resumeFile(userId: string, resumeId: string) {
    const row = db.select().from(resumes).where(eq(resumes.id, resumeId)).get();

    if (row === undefined) {
      return null;
    }

    const filename = await personal.openFor(
      userId,
      { column: "filename_enc", rowId: row.id, table: "resumes" },
      row.filenameEnc,
    );

    return { bytes: row.bytes, filename, sha256: row.sha256 };
  }

  async function linkedMail(userId: string, applicationId: string) {
    const threads = db
      .select()
      .from(mailThreads)
      .where(and(eq(mailThreads.userId, userId), eq(mailThreads.applicationId, applicationId)))
      .orderBy(desc(mailThreads.lastMessageAt))
      .all();

    return Promise.all(
      threads.map(async (thread) => {
        const subject = await personal.openFor(
          userId,
          { column: "subject_enc", rowId: thread.id, table: "mail_threads" },
          thread.subjectEnc,
        );

        const rows = db
          .select()
          .from(messages)
          .where(eq(messages.threadId, thread.id))
          .orderBy(asc(messages.createdAt))
          .all();

        const items = await Promise.all(
          rows.map(async (message) => {
            const [from, snippet, messageSubject] = await Promise.all([
              personal.openFor(
                userId,
                { column: "from_enc", rowId: message.id, table: "messages" },
                message.fromEnc,
              ),
              personal.openFor(
                userId,
                { column: "snippet_enc", rowId: message.id, table: "messages" },
                message.snippetEnc,
              ),
              personal.openFor(
                userId,
                { column: "subject_enc", rowId: message.id, table: "messages" },
                message.subjectEnc,
              ),
            ]);

            return {
              at: message.createdAt.getTime(),
              classification: message.classification,
              direction: message.direction,
              from,
              id: message.id,
              snippet,
              subject: messageSubject,
            };
          }),
        );

        return {
          id: thread.id,
          lastMessageAt: thread.lastMessageAt.getTime(),
          messages: items,
          subject,
        };
      }),
    );
  }

  return routes;
}
