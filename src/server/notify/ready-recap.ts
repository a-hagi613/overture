import { and, asc, count, eq, gte } from "drizzle-orm";

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

export interface ReadyRecapDeps {
  db: AppDatabase;
  clock: Clock;
  mail: MailSender;
  appOrigin: string;
}

export function readyRecapUrl(appOrigin: string) {
  return `${appOrigin.replace(/\/+$/u, "")}/ready`;
}

/**
 * The one Recap email after a user's daily run. It lists the Applications that
 * became Ready during the run and how many Reviews are open, and links to the
 * Ready page. Nothing is ever approved or sent from the link.
 * @param deps The database, clock, mail port and app origin.
 * @param userId The user the run prepared for.
 * @param since When the run started, so only its new Ready Applications count.
 * @returns The counts sent, or null when the run produced nothing.
 */
export async function sendReadyRecap(deps: ReadyRecapDeps, userId: string, since: number) {
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

  const alreadyEmailed = deps.db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.kind, "ready"),
        gte(notifications.createdAt, since),
      ),
    )
    .get();

  if (alreadyEmailed !== undefined) {
    return null;
  }

  const to = deps.db.select({ email: users.email }).from(users).where(eq(users.id, userId)).get();

  if (to === undefined) {
    return null;
  }

  const url = readyRecapUrl(deps.appOrigin);
  const subject = copy.mail.recapSubject(ready.length, openReviews);
  const body = copy.mail.recapBody({ needAnswer: openReviews, ready, url });
  const now = deps.clock.now();

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
