import { and, asc, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { validJson } from "./validators.ts";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { Auth } from "../auth/index.ts";
import { readSession } from "../auth/session.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import { openOrNull } from "../profile/personal-crypto.ts";

import {
  applications,
  applicationEvents,
  applicationSnapshots,
  matches,
  resumes,
  reviewApplications,
  reviews,
} from "../platform/db/schema.ts";
import { localDayStart, localPartsAt } from "../platform/local-time.ts";
import { restartCheckinAfterUndo } from "../pipeline/checkins.ts";
import { latestEmailNotesOf } from "../pipeline/email-notes.ts";
import { linkedMailOf } from "../inbox/linked-mail.ts";
import { publishEvent } from "../platform/sse/stream.ts";
import { createTimeZoneService } from "../profile/time-zone.ts";
import { resumeLines as splitResumeLines } from "../pipeline/grounding.ts";
import {
  BOARD_STAGES,
  canMoveApplicationToStage,
  canWithdrawApplication,
  isBoardStage,
} from "../../shared/board.ts";
import { buildDossier } from "../../shared/dossier.ts";
import { safeHttpUrl } from "../../shared/http-url.ts";

const STRONG_SCORE = 80;

const DAY_MS = 24 * 60 * 60_000;

const stageMoveSchema = z.object({
  stage: z.enum(BOARD_STAGES),
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

function clockLabel12(at: number, timeZone: string) {
  const parts = localPartsAt(at, timeZone);
  const suffix = parts.hour < 12 ? "AM" : "PM";
  const hour = parts.hour % 12 === 0 ? 12 : parts.hour % 12;

  return `${String(hour)}:${String(parts.minute).padStart(2, "0")} ${suffix}`;
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

  async function timeZoneOf(userId: string) {
    const { timezone } = await zones.current(userId);

    return timezone ?? "UTC";
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
        company: applications.companyName,
        createdAt: applications.createdAt,
        id: applications.id,
        location: applications.locationRaw,
        salaryCurrency: applications.salaryCurrency,
        salaryMaxMinor: applications.salaryMaxMinor,
        salaryMinMinor: applications.salaryMinMinor,
        salaryPeriod: applications.salaryPeriod,
        scheduledFor: applications.scheduledFor,
        score: matches.score,
        sentAt: applications.sentAt,
        stage: applications.stage,
        stageLocked: applications.stageLocked,
        status: applications.status,
        title: applications.postingTitle,
        updatedAt: applications.updatedAt,
      })
      .from(applications)
      .leftJoin(
        matches,
        and(eq(matches.userId, applications.userId), eq(matches.postingId, applications.postingId)),
      )
      .where(eq(applications.userId, userId))
      .orderBy(asc(applications.boardPosition), asc(applications.updatedAt))
      .all();

    const blocked = blockedApplicationIds(userId);

    const emailNotes = latestEmailNotesOf(
      db,
      userId,
      rows.map((row) => row.id),
    );

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
      sendsAt: row.scheduledFor === null ? null : clockLabel12(row.scheduledFor, timeZone),
      sentAt: row.sentAt,
      stage: row.stage,
      stageLocked: row.stageLocked,
      status: row.status,
      strong: row.score !== null && row.score >= STRONG_SCORE,
      title: row.title,
      updatedAt: row.updatedAt,
    }));

    const visibleCards = cards.filter((card) => card.stage !== null);

    const hidden = cards.filter(
      (card) =>
        card.stage === null &&
        (card.status === "skipped" || card.status === "withdrawn" || card.status === "failed"),
    );

    return {
      columns: BOARD_STAGES.map((stage) => ({
        cards: visibleCards.filter((card) => card.stage === stage),
        stage,
      })),
      hidden,
      total: visibleCards.length,
      updatedAt: now,
    };
  }

  routes.get("/board", async (context) => {
    const session = await readSession(auth, context.req.raw.headers);

    if (session === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    return context.json(await boardResponse(session.user.id));
  });

  routes.patch("/applications/:id/stage", validJson(stageMoveSchema), async (context) => {
    const session = await readSession(auth, context.req.raw.headers);

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
        status: applications.status,
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

    if (!canMoveApplicationToStage(row.status, stage)) {
      return context.json({ error: "invalid_transition" }, 409);
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
    const session = await readSession(auth, context.req.raw.headers);

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

    if (!isBoardStage(restored)) {
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
    const session = await readSession(auth, context.req.raw.headers);

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

    const withdrawable = canWithdrawApplication(row.status);

    if (!withdrawable) {
      return context.json({ error: "not_withdrawable" }, 409);
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
    const session = await readSession(auth, context.req.raw.headers);

    if (session === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    const { id } = context.req.param();
    const userId = session.user.id;

    const application = db
      .select()
      .from(applications)
      .where(and(eq(applications.id, id), eq(applications.userId, userId)))
      .get();

    if (application === undefined) {
      return context.json({ error: "not_found" }, 404);
    }

    const snapshot = db
      .select()
      .from(applicationSnapshots)
      .where(eq(applicationSnapshots.applicationId, id))
      .get();

    const answersJson =
      snapshot === undefined
        ? null
        : await openOrNull({
            personal,
            scope: { column: "answers_enc", rowId: id, table: "application_snapshots" },
            sealed: snapshot.answersEnc,
            userId,
          });

    const coverLetterJson =
      snapshot?.coverLetterEnc === null || snapshot === undefined
        ? null
        : await openOrNull({
            personal,
            scope: { column: "cover_letter_enc", rowId: id, table: "application_snapshots" },
            sealed: snapshot.coverLetterEnc,
            userId,
          });

    const snapshotView =
      snapshot === undefined ||
      answersJson === null ||
      (snapshot.coverLetterEnc !== null && coverLetterJson === null)
        ? null
        : {
            answers: snapshotAnswerSchema.parse(JSON.parse(answersJson)),
            approvedAt: snapshot.approvedAt,
            approvedPlanSha256: snapshot.approvedPlanSha256,
            confirmedBy: snapshot.confirmedBy,
            consentVersion: snapshot.consentVersion,
            costMicros: snapshot.costMicros,
            coverLetter:
              coverLetterJson === null
                ? null
                : coverLetterSchema.parse(JSON.parse(coverLetterJson)),
            provider: snapshot.provider,
            resumeSha256: snapshot.resumeSha256,
            resume: await resumeFile(userId, snapshot.resumeId),
            submittedAt: snapshot.submittedAt,
          };

    const match = db
      .select()
      .from(matches)
      .where(and(eq(matches.userId, userId), eq(matches.postingId, application.postingId)))
      .get();

    const now = clock.now();
    const timeZone = await timeZoneOf(userId);
    const dayStart = localDayStart(now, timeZone);
    const emailNotes = latestEmailNotesOf(db, userId, [id]);

    const note = noteFor(
      {
        boardPosition: application.boardPosition,
        closedReason: application.closedReason,
        company: application.companyName,
        createdAt: application.createdAt,
        id: application.id,
        location: application.locationRaw,
        salaryCurrency: application.salaryCurrency,
        salaryMaxMinor: application.salaryMaxMinor,
        salaryMinMinor: application.salaryMinMinor,
        salaryPeriod: application.salaryPeriod,
        scheduledFor: application.scheduledFor,
        score: match?.score ?? null,
        sentAt: application.sentAt,
        stage: application.stage,
        stageLocked: application.stageLocked,
        status: application.status,
        title: application.postingTitle,
        updatedAt: application.updatedAt,
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

    const resumeLines =
      snapshotView === null
        ? []
        : await citedResumeLines(userId, snapshot?.resumeId ?? null, snapshotView);

    return context.json({
      ageDays: Math.max(0, Math.floor((now - application.createdAt) / DAY_MS)),
      dossier:
        snapshotView === null
          ? null
          : buildDossier({
              answers: snapshotView.answers,
              confirmedBy: snapshotView.confirmedBy,
              coverLetter: snapshotView.coverLetter,
              provider: snapshotView.provider,
              resume: snapshotView.resume,
              resumeLines,
              resumeSha256: snapshotView.resumeSha256,
              submittedAt: snapshotView.submittedAt,
            }),
      application,
      company: application.companyName,
      mail: await linkedMailOf({
        applicationId: id,
        db,
        personal,
        userId,
      }),
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
        applyUrl: safeHttpUrl(application.applyUrl) ?? safeHttpUrl(application.postingUrl),
        ats: application.ats,
        id: application.postingId,
        location: application.locationRaw,
        salaryCurrency: application.salaryCurrency,
        salaryMaxMinor: application.salaryMaxMinor,
        salaryMinMinor: application.salaryMinMinor,
        salaryPeriod: application.salaryPeriod,
        title: application.postingTitle,
        url: application.postingUrl,
      },
      snapshot: snapshotView === null ? null : { ...snapshotView, resumeLines },
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

    const text = await openOrNull({
      personal,
      scope: { column: "text_enc", rowId: row.id, table: "resumes" },
      sealed: row.textEnc,
      userId,
    });

    return text === null ? [] : splitResumeLines(text).filter((line) => cited.has(line.id));
  }

  async function resumeFile(userId: string, resumeId: string) {
    const row = db.select().from(resumes).where(eq(resumes.id, resumeId)).get();

    if (row === undefined) {
      return null;
    }

    const filename =
      (await openOrNull({
        personal,
        scope: { column: "filename_enc", rowId: row.id, table: "resumes" },
        sealed: row.filenameEnc,
        userId,
      })) ?? "resume.pdf";

    return { bytes: row.bytes, filename, sha256: row.sha256 };
  }

  return routes;
}
