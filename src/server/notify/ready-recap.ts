import { and, asc, count, eq, gte, inArray, isNotNull, lt } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { MailSender } from "../platform/mail/port.ts";

import { copy } from "../../shared/copy.ts";
import { isDemoRole } from "../../shared/demo.ts";
import {
  applications,
  companies,
  mailThreads,
  messages,
  notifications,
  postings,
  reviews,
  users,
} from "../platform/db/schema.ts";
import { MailCapExceededError } from "../platform/mail/metered.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import {
  addLocalDays,
  localDateAt,
  localDayStart,
  localDayStartFor,
} from "../platform/local-time.ts";
import { effectiveTimeZone } from "../profile/time-zone.ts";
import { insertNotification } from "./notifications.ts";
import { notificationPreferenceEnabled } from "./preferences.ts";

export const READY_NOTIFY_JOB_KIND = "ready.notify";

const payloadSchema = z.object({
  since: z.number().int().nonnegative(),
  userId: z.string().min(1),
});

export interface ReadyNotifyDeps {
  db: AppDatabase;
  clock: Clock;
  mail: MailSender;
  appOrigin: string;
}

export function readyRecapUrl(appOrigin: string) {
  return `${appOrigin.replace(/\/+$/u, "")}/ready`;
}

export function readyNotifyPayload(userId: string, since: number) {
  return JSON.stringify({ since, userId });
}

export function parseReadyNotifyPayload(payload: string) {
  return payloadSchema.parse(JSON.parse(payload));
}

/**
 * Queue the one Recap email for a finished Daily run. The run never depends on
 * the mail sender: a failed email is retried on its own.
 * @param db The application database.
 * @param clock The clock the job is scheduled from.
 * @param userId The user the run prepared for.
 * @param since When the run started, so only its new work is listed.
 * @returns The queue receipt, with `inserted` false on a repeated run.
 */
export function enqueueReadyNotify(db: AppDatabase, clock: Clock, userId: string, since: number) {
  return enqueueJob(db, clock, READY_NOTIFY_JOB_KIND, readyNotifyPayload(userId, since), {
    dedupeKey: `${READY_NOTIFY_JOB_KIND}:${userId}:${String(since)}`,
  });
}

function sentYesterday(db: AppDatabase, userId: string, start: number, end: number) {
  return db
    .select({ company: companies.name, title: postings.title })
    .from(applications)
    .innerJoin(postings, eq(postings.id, applications.postingId))
    .innerJoin(companies, eq(companies.id, postings.companyId))
    .where(
      and(
        eq(applications.userId, userId),
        isNotNull(applications.sentAt),
        gte(applications.sentAt, start),
        lt(applications.sentAt, end),
      ),
    )
    .orderBy(asc(applications.sentAt))
    .all();
}

/**
 * The classifications that count as an employer replying in the Recap: a person
 * answered, rather than a receipt (`ack`) or a verification `code`. The inbox
 * raises its reply notice on the same set, so the two read the same way.
 */
export const REPLY_CLASSIFICATIONS = [
  "interview",
  "offer",
  "rejection",
  "screening",
  "other",
] as const;

function repliedYesterday(db: AppDatabase, userId: string, start: number, end: number) {
  return db
    .selectDistinct({ company: companies.name })
    .from(messages)
    .innerJoin(mailThreads, eq(mailThreads.id, messages.threadId))
    .innerJoin(applications, eq(applications.id, mailThreads.applicationId))
    .innerJoin(companies, eq(companies.id, applications.companyId))
    .where(
      and(
        eq(messages.userId, userId),
        eq(messages.auth, "pass"),
        inArray(messages.classification, REPLY_CLASSIFICATIONS),
        gte(messages.createdAt, new Date(start)),
        lt(messages.createdAt, new Date(end)),
      ),
    )
    .orderBy(asc(companies.name))
    .all();
}

function recapContent(db: AppDatabase, userId: string, since: number) {
  const ready = db
    .select({ company: companies.name, title: postings.title })
    .from(applications)
    .innerJoin(postings, eq(postings.id, applications.postingId))
    .innerJoin(companies, eq(companies.id, postings.companyId))
    .where(
      and(
        eq(applications.userId, userId),
        eq(applications.status, "ready"),
        gte(applications.readyAt, since),
      ),
    )
    .orderBy(asc(applications.readyAt))
    .all();

  const openReviews =
    db
      .select({ total: count() })
      .from(reviews)
      .where(and(eq(reviews.userId, userId), eq(reviews.status, "open")))
      .get()?.total ?? 0;

  return { openReviews, ready };
}

/**
 * The one Recap after a user's Daily run: a notification row, its push, and the
 * one daily email. It lists the Applications that became Ready during the run,
 * how many Reviews are open, and yesterday's sends and replies, and links to
 * the Ready page. Nothing is ever approved or sent from the link.
 * @param deps The database, clock, mail port and app origin.
 * @param userId The user the run prepared for.
 * @param since When the run started, so only its new Ready Applications count.
 * @returns The counts sent, or null when the run produced nothing or already sent.
 */
export async function runReadyNotifyJob(deps: ReadyNotifyDeps, userId: string, since: number) {
  const now = deps.clock.now();
  const timeZone = effectiveTimeZone(deps.db, userId, now);
  const dayStart = localDayStart(now, timeZone);

  const alreadySent = deps.db
    .select({ emailedAt: notifications.emailedAt, id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.kind, "ready"),
        gte(notifications.createdAt, dayStart),
      ),
    )
    .get();

  if (alreadySent !== undefined) {
    await emailIfStillNeeded(deps, userId, alreadySent.id, alreadySent.emailedAt, since);

    return null;
  }

  const { openReviews, ready } = recapContent(deps.db, userId, since);

  const newReviews =
    deps.db
      .select({ total: count() })
      .from(reviews)
      .where(
        and(eq(reviews.userId, userId), eq(reviews.status, "open"), gte(reviews.createdAt, since)),
      )
      .get()?.total ?? 0;

  if (ready.length === 0 && newReviews === 0) {
    return null;
  }

  const url = readyRecapUrl(deps.appOrigin);
  const subject = copy.mail.recapSubject(ready.length, openReviews);

  const notificationId = insertNotification(
    deps.db,
    deps.clock,
    {
      body: `${String(ready.length)} ready to approve, ${String(openReviews)} need an answer`,
      kind: "ready",
      title: subject,
      url,
      userId,
    },
    { push: notificationPreferenceEnabled(deps.db, userId, "ready") },
  );

  const emailedAt = await emailRecap(deps, userId, {
    notificationId,
    openReviews,
    ready,
    subject,
    url,
  });

  return { openReviews, ready: ready.length, emailed: emailedAt !== null };
}

async function emailIfStillNeeded(
  deps: ReadyNotifyDeps,
  userId: string,
  notificationId: string,
  emailedAt: Date | null,
  since: number,
) {
  if (emailedAt !== null) {
    return;
  }

  const { openReviews, ready } = recapContent(deps.db, userId, since);

  await emailRecap(deps, userId, {
    notificationId,
    openReviews,
    ready,
    subject: copy.mail.recapSubject(ready.length, openReviews),
    url: readyRecapUrl(deps.appOrigin),
  });
}

async function emailRecap(
  deps: ReadyNotifyDeps,
  userId: string,
  recap: {
    notificationId: string;
    openReviews: number;
    ready: { company: string; title: string }[];
    subject: string;
    url: string;
  },
) {
  if (!notificationPreferenceEnabled(deps.db, userId, "recap_email")) {
    return null;
  }

  const to = deps.db
    .select({ email: users.email, role: users.role, verified: users.emailVerified })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  if (to === undefined || !to.verified || isDemoRole(to.role)) {
    return null;
  }

  const now = deps.clock.now();
  const timeZone = effectiveTimeZone(deps.db, userId, now);
  const todayStart = localDayStart(now, timeZone);
  const yesterdayStart = localDayStartFor(addLocalDays(localDateAt(now, timeZone), -1), timeZone);

  const body = copy.mail.recapBody({
    needAnswer: recap.openReviews,
    ready: recap.ready,
    replied: repliedYesterday(deps.db, userId, yesterdayStart, todayStart),
    sent: sentYesterday(deps.db, userId, yesterdayStart, todayStart),
    url: recap.url,
  });

  try {
    await deps.mail.sendReadyRecap({ body, subject: recap.subject, to: to.email });
  } catch (error) {
    if (!(error instanceof MailCapExceededError)) {
      throw error;
    }

    return null;
  }

  const emailedAt = new Date(now);

  deps.db
    .update(notifications)
    .set({ emailedAt })
    .where(eq(notifications.id, recap.notificationId))
    .run();

  return emailedAt;
}
