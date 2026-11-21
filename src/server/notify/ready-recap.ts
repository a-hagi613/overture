import { and, asc, count, eq, gte, isNotNull } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { MailSender } from "../platform/mail/port.ts";

import { copy } from "../../shared/copy.ts";
import {
  applications,
  companies,
  notifications,
  postings,
  reviews,
  users,
} from "../platform/db/schema.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import { localDayStart } from "../platform/local-time.ts";
import { effectiveTimeZone } from "../profile/time-zone.ts";

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

/**
 * The one Recap email after a user's Daily run. It lists the Applications that
 * became Ready during the run and how many Reviews are open, and links to the
 * Ready page. Nothing is ever approved or sent from the link.
 * @param deps The database, clock, mail port and app origin.
 * @param userId The user the run prepared for.
 * @param since When the run started, so only its new Ready Applications count.
 * @returns The counts sent, or null when there is nothing to email.
 */
export async function runReadyNotifyJob(deps: ReadyNotifyDeps, userId: string, since: number) {
  const now = deps.clock.now();
  const dayStart = localDayStart(now, effectiveTimeZone(deps.db, userId, now));

  const alreadyEmailed = deps.db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.kind, "ready"),
        isNotNull(notifications.emailedAt),
        gte(notifications.createdAt, dayStart),
      ),
    )
    .get();

  if (alreadyEmailed !== undefined) {
    return null;
  }

  const ready = deps.db
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
    deps.db
      .select({ total: count() })
      .from(reviews)
      .where(and(eq(reviews.userId, userId), eq(reviews.status, "open")))
      .get()?.total ?? 0;

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

  const to = deps.db
    .select({ email: users.email, verified: users.emailVerified })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  if (to === undefined || !to.verified) {
    return null;
  }

  const url = readyRecapUrl(deps.appOrigin);
  const subject = copy.mail.recapSubject(ready.length, openReviews);
  const body = copy.mail.recapBody({ needAnswer: openReviews, ready, url });

  await deps.mail.sendReadyRecap({ body, subject, to: to.email });

  deps.db
    .insert(notifications)
    .values({
      id: crypto.randomUUID(),
      userId,
      kind: "ready",
      title: subject,
      body: `${String(ready.length)} ready to approve, ${String(openReviews)} need an answer`,
      url,
      createdAt: now,
      emailedAt: new Date(now),
    })
    .run();

  return { openReviews, ready: ready.length };
}
