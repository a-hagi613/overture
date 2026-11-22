import { and, asc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import type { CheckinAnswer } from "../../shared/checkins.ts";

import { copy } from "../../shared/copy.ts";
import {
  applications,
  applicationEvents,
  checkins,
  mailThreads,
  messages,
  users,
} from "../platform/db/schema.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import { getSetting } from "../platform/settings/index.ts";
import { createNotification } from "../notify/notifications.ts";
import { publishEvent } from "../platform/sse/stream.ts";

export const CHECKIN_SWEEP_JOB_KIND = "checkin.sweep";

export const CHECKIN_SWEEP_INTERVAL_MS = 60 * 60_000;

const DAY_MS = 24 * 60 * 60_000;

const DEFAULT_AFTER_DAYS = 21;
const DEFAULT_CLOSE_DAYS = 45;

function daysSetting(db: AppDatabase, key: string, fallback: number) {
  const configured = Number(getSetting(db, key));

  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}

function afterDaysOf(db: AppDatabase) {
  return daysSetting(db, "checkin.after_days", DEFAULT_AFTER_DAYS);
}

function closeDaysOf(db: AppDatabase) {
  return Math.max(afterDaysOf(db), daysSetting(db, "checkin.close_after_days", DEFAULT_CLOSE_DAYS));
}

/**
 * Queues the next Check-in pass. One pass covers every user, so the job is a singleton and a restart only
 * ever replaces a queued copy.
 * @param db The application database.
 * @param clock The clock the pass runs against.
 * @returns Whether a new job was queued.
 */
export function ensureCheckinSweepQueued(db: AppDatabase, clock: Clock) {
  const job = enqueueJob(db, clock, CHECKIN_SWEEP_JOB_KIND, "{}", {
    dedupeKey: CHECKIN_SWEEP_JOB_KIND,
    maxAttempts: 1,
    runAt: clock.now() + CHECKIN_SWEEP_INTERVAL_MS,
  });

  return job.inserted;
}

function linkedApplicationIds(db: AppDatabase, applicationIds: string[]) {
  const linked = new Set<string>();
  const chunkSize = 500;

  for (let start = 0; start < applicationIds.length; start += chunkSize) {
    const rows = db
      .select({ applicationId: mailThreads.applicationId })
      .from(mailThreads)
      .innerJoin(messages, eq(messages.threadId, mailThreads.id))
      .where(
        and(
          eq(messages.direction, "in"),
          eq(messages.auth, "pass"),
          inArray(mailThreads.applicationId, applicationIds.slice(start, start + chunkSize)),
        ),
      )
      .all();

    for (const row of rows) {
      if (row.applicationId !== null) {
        linked.add(row.applicationId);
      }
    }
  }

  return linked;
}

/**
 * Opens a Check-in for every Application that has sat in Applied for `checkin.after_days` with no linked
 * employer mail, and closes the ones that reach `checkin.close_after_days` with neither mail nor an answer.
 * @param deps The database and clock the pass runs against.
 * @returns What the pass opened, closed and expired.
 */
export function runCheckinSweep(deps: { db: AppDatabase; clock: Clock }) {
  const { db, clock } = deps;
  const now = clock.now();
  const after = afterDaysOf(db);
  const close = closeDaysOf(db);
  const closeAfterDueMs = (close - after) * DAY_MS;

  const rows = db
    .select({
      company: applications.companyName,
      id: applications.id,
      sentAt: applications.sentAt,
      title: applications.postingTitle,
      userId: applications.userId,
    })
    .from(applications)
    .innerJoin(users, eq(users.id, applications.userId))
    .where(
      and(
        eq(applications.stage, "applied"),
        eq(applications.status, "sent"),
        isNotNull(applications.sentAt),
        sql`${users.role} <> 'demo'`,
      ),
    )
    .all();

  const open = db.select().from(checkins).where(eq(checkins.status, "open")).all();

  const existingByApplication = new Map(
    db
      .select({
        applicationId: checkins.applicationId,
        dueAt: checkins.dueAt,
        status: checkins.status,
      })
      .from(checkins)
      .innerJoin(applications, eq(applications.id, checkins.applicationId))
      .where(and(eq(applications.stage, "applied"), eq(applications.status, "sent")))
      .all()
      .map((row) => [row.applicationId, row]),
  );

  const applied = new Set(rows.map((row) => row.id));
  const opened: string[] = [];
  const closed: string[] = [];
  const expired: string[] = [];

  const withMail = linkedApplicationIds(
    db,
    rows.map((row) => row.id),
  );

  for (const row of open) {
    if (applied.has(row.applicationId) && !withMail.has(row.applicationId)) {
      continue;
    }

    db.update(checkins).set({ status: "expired" }).where(eq(checkins.id, row.id)).run();
    expired.push(row.applicationId);
  }

  for (const row of rows) {
    if (row.sentAt === null || withMail.has(row.id)) {
      continue;
    }

    const existing = existingByApplication.get(row.id);
    const dueAt = existing?.dueAt ?? row.sentAt + after * DAY_MS;

    if (existing === undefined) {
      if (now < dueAt) {
        continue;
      }

      db.insert(checkins)
        .values({
          answer: null,
          applicationId: row.id,
          createdAt: now,
          dueAt,
          id: crypto.randomUUID(),
          status: "open",
          userId: row.userId,
        })
        .run();
      opened.push(row.id);
    } else if (existing.status !== "open") {
      continue;
    }

    if (now < dueAt + closeAfterDueMs) {
      continue;
    }

    closeAsNoResponse(
      { clock, company: row.company, db, title: row.title, userId: row.userId },
      row,
    );
    closed.push(row.id);
  }

  return { closed, expired, opened };
}

function closeAsNoResponse(
  input: {
    clock: Clock;
    db: AppDatabase;
    userId: string;
    company: string;
    title: string;
  },
  row: { id: string },
) {
  const { clock, db } = input;
  const now = clock.now();

  db.transaction((tx) => {
    tx.update(applications)
      .set({ closedReason: "no_response", stage: "closed", updatedAt: now })
      .where(eq(applications.id, row.id))
      .run();

    tx.update(checkins).set({ status: "expired" }).where(eq(checkins.applicationId, row.id)).run();

    tx.insert(applicationEvents)
      .values({
        applicationId: row.id,
        at: now,
        detail: null,
        fromValue: "applied",
        id: crypto.randomUUID(),
        kind: "stage",
        source: "system",
        toValue: "closed",
        userId: input.userId,
      })
      .run();

    tx.insert(applicationEvents)
      .values({
        applicationId: row.id,
        at: now,
        detail: null,
        fromValue: "open",
        id: crypto.randomUUID(),
        kind: "checkin",
        source: "checkin",
        toValue: "no_response",
        userId: input.userId,
      })
      .run();
  });

  publishEvent(
    db,
    clock,
    "board.moved",
    JSON.stringify({
      applicationId: row.id,
      fromStage: "applied",
      source: "system",
      stage: "closed",
    }),
    input.userId,
  );
  publishEvent(
    db,
    clock,
    "application.updated",
    JSON.stringify({ applicationId: row.id }),
    input.userId,
  );

  createNotification(db, clock, {
    body: copy.notifications.noResponse.body({ company: input.company, title: input.title }),
    kind: copy.notifications.noResponse.kind,
    title: copy.notifications.noResponse.title,
    url: copy.notifications.noResponse.url,
    userId: input.userId,
  });
}

/**
 * Marks a Check-in answered and moves the card the answer implies. Still waiting restarts the wait, so the
 * next Check-in falls due one `checkin.after_days` later and the card can close there.
 * @param deps The database and clock the answer is recorded against.
 * @param input The user, the Check-in and the answer.
 * @returns The answer's stage, or null when the Check-in is not open for that user.
 */
export function answerCheckin(
  deps: { db: AppDatabase; clock: Clock },
  input: { userId: string; checkinId: string; answer: CheckinAnswer },
) {
  const { db, clock } = deps;

  const row = db
    .select({
      applicationId: applications.id,
      id: checkins.id,
      stage: applications.stage,
    })
    .from(checkins)
    .innerJoin(applications, eq(applications.id, checkins.applicationId))
    .where(
      and(
        eq(checkins.id, input.checkinId),
        eq(checkins.userId, input.userId),
        eq(checkins.status, "open"),
        eq(applications.stage, "applied"),
      ),
    )
    .get();

  if (row === undefined) {
    return null;
  }

  const now = clock.now();
  const after = afterDaysOf(db);

  if (input.answer === "still_waiting") {
    db.transaction((tx) => {
      tx.update(checkins)
        .set({ answer: input.answer, dueAt: now + after * DAY_MS })
        .where(eq(checkins.id, row.id))
        .run();

      tx.insert(applicationEvents)
        .values({
          applicationId: row.applicationId,
          at: now,
          detail: null,
          fromValue: "open",
          id: crypto.randomUUID(),
          kind: "checkin",
          source: "user",
          toValue: input.answer,
          userId: input.userId,
        })
        .run();
    });

    publishEvent(
      db,
      clock,
      "application.updated",
      JSON.stringify({ applicationId: row.applicationId }),
      input.userId,
    );
    publishEvent(
      db,
      clock,
      "home.updated",
      JSON.stringify({ applicationId: row.applicationId }),
      input.userId,
    );

    return { answer: input.answer, stage: "applied" };
  }

  const stage = input.answer === "rejected" ? "closed" : "interviewing";
  const closedReason = input.answer === "rejected" ? "rejected" : null;

  db.transaction((tx) => {
    tx.update(checkins)
      .set({ answer: input.answer, status: "answered" })
      .where(eq(checkins.id, row.id))
      .run();

    tx.update(applications)
      .set({ closedReason, stage, updatedAt: now })
      .where(eq(applications.id, row.applicationId))
      .run();

    tx.insert(applicationEvents)
      .values({
        applicationId: row.applicationId,
        at: now,
        detail: null,
        fromValue: row.stage,
        id: crypto.randomUUID(),
        kind: "stage",
        source: "checkin",
        toValue: stage,
        userId: input.userId,
      })
      .run();

    tx.insert(applicationEvents)
      .values({
        applicationId: row.applicationId,
        at: now,
        detail: null,
        fromValue: "open",
        id: crypto.randomUUID(),
        kind: "checkin",
        source: "user",
        toValue: input.answer,
        userId: input.userId,
      })
      .run();
  });

  publishEvent(
    db,
    clock,
    "board.moved",
    JSON.stringify({
      applicationId: row.applicationId,
      fromStage: row.stage,
      source: "checkin",
      stage,
    }),
    input.userId,
  );
  publishEvent(
    db,
    clock,
    "application.updated",
    JSON.stringify({ applicationId: row.applicationId }),
    input.userId,
  );

  return { answer: input.answer, stage };
}

/**
 * Restarts the wait when an Undo restores a card to Applied, so an undone answer or close is not repeated
 * on the next pass.
 * @param deps The database and clock the Undo runs against.
 * @param applicationId The Application the Undo restored.
 */
export function restartCheckinAfterUndo(
  deps: { db: AppDatabase; clock: Clock },
  applicationId: string,
) {
  const row = deps.db
    .select()
    .from(checkins)
    .where(eq(checkins.applicationId, applicationId))
    .get();

  if (row === undefined || (row.status === "open" && row.answer === null)) {
    return;
  }

  deps.db
    .update(checkins)
    .set({
      answer: null,
      dueAt: deps.clock.now() + afterDaysOf(deps.db) * DAY_MS,
      status: "open",
    })
    .where(eq(checkins.id, row.id))
    .run();
}

export interface DueCheckin {
  id: string;
  applicationId: string;
  company: string;
  title: string;
  sentAt: number;
  dueAt: number;
  days: number;
}

/**
 * Lists the Check-ins that are due on Home: open, at or past their due date, and still without a linked
 * employer message.
 * @param deps The database and the reference time.
 * @param userId The user whose Home is read.
 * @returns The due Check-ins, oldest first.
 */
export function dueCheckins(deps: { db: AppDatabase; now: number }, userId: string) {
  const rows = deps.db
    .select({
      applicationId: applications.id,
      company: applications.companyName,
      dueAt: checkins.dueAt,
      id: checkins.id,
      sentAt: applications.sentAt,
      title: applications.postingTitle,
    })
    .from(checkins)
    .innerJoin(applications, eq(applications.id, checkins.applicationId))
    .where(
      and(
        eq(checkins.userId, userId),
        eq(checkins.status, "open"),
        eq(applications.stage, "applied"),
        lte(checkins.dueAt, deps.now),
      ),
    )
    .orderBy(asc(checkins.dueAt))
    .all();

  const withMail = linkedApplicationIds(
    deps.db,
    rows.map((row) => row.applicationId),
  );

  const due: DueCheckin[] = [];

  for (const row of rows) {
    if (withMail.has(row.applicationId) || row.sentAt === null) {
      continue;
    }

    due.push({
      applicationId: row.applicationId,
      company: row.company,
      days: Math.max(0, Math.floor((deps.now - row.sentAt) / DAY_MS)),
      dueAt: row.dueAt,
      id: row.id,
      sentAt: row.sentAt,
      title: row.title,
    });
  }

  return due;
}
