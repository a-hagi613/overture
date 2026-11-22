import { eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { MailSender } from "../platform/mail/port.ts";
import type { BillingPauseReason } from "../billing/pause.ts";

import { copy } from "../../shared/copy.ts";
import { isDemoRole } from "../../shared/demo.ts";
import { notifications, users } from "../platform/db/schema.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import { insertNotification } from "./notifications.ts";
import { mailLogoUrl, renderMailHtml } from "./mail-html.ts";

export const BILLING_NOTICE_JOB_KIND = "billing.notice";

const payloadSchema = z.object({
  notificationId: z.string().min(1),
  reason: z.enum(["plan_ended", "payment_failed"]),
});

export interface BillingNoticeDeps {
  db: AppDatabase;
  clock: Clock;
  mail: MailSender;
  appOrigin: string;
}

export function billingNoticePayload(notificationId: string, reason: BillingPauseReason) {
  return JSON.stringify({ notificationId, reason });
}

export function parseBillingNoticePayload(payload: string) {
  return payloadSchema.parse(JSON.parse(payload));
}

/**
 * Queue the one email that explains a billing pause and its fix. The in-app
 * notification is already written, so the notice list and a push never wait
 * on the mail sender; a failed email is retried on its own.
 * @param db The application database.
 * @param clock The clock the job is scheduled from.
 * @param input The notification row and the pause reason it carries.
 * @returns The queue receipt.
 */
export function enqueueBillingNotice(
  db: AppDatabase,
  clock: Clock,
  input: { notificationId: string; reason: BillingPauseReason },
) {
  return enqueueJob(
    db,
    clock,
    BILLING_NOTICE_JOB_KIND,
    billingNoticePayload(input.notificationId, input.reason),
    { dedupeKey: `${BILLING_NOTICE_JOB_KIND}:${input.notificationId}` },
  );
}

/**
 * Record a billing pause in the notification list and queue its push and
 * email. A billing stop is a required account notice, so it is written even
 * when the optional `paused` push preference is off. The caller sends this
 * only on a real transition, so a retried or replayed Stripe webhook never
 * doubles the notice.
 * @param db The application database.
 * @param clock The clock stamping the notification.
 * @param input The user and the reason sending stopped.
 * @returns The notification id.
 */
export function createBillingPauseNotice(
  db: AppDatabase,
  clock: Clock,
  input: { userId: string; reason: BillingPauseReason },
) {
  const pause = copy.home.pauseReasons[input.reason];

  const id = insertNotification(db, clock, {
    body: pause.copy,
    kind: "paused",
    title: pause.title,
    url: "/",
    userId: input.userId,
  });

  enqueueBillingNotice(db, clock, { notificationId: id, reason: input.reason });

  return id;
}

/**
 * Send the email for one billing pause notification. It names the reason and
 * the one action that fixes it in Settings, and says in-flight sends finish.
 * The demo account never receives mail, and an already-emailed notification
 * is skipped so a retried job sends once.
 * @param deps The database, clock, mail sender and app origin.
 * @param input The notification row and the pause reason it carries.
 * @returns Whether this run sent the email.
 */
export async function runBillingNoticeJob(
  deps: BillingNoticeDeps,
  input: { notificationId: string; reason: BillingPauseReason },
) {
  const notification = deps.db
    .select({ emailedAt: notifications.emailedAt, userId: notifications.userId })
    .from(notifications)
    .where(eq(notifications.id, input.notificationId))
    .get();

  if (notification === undefined || notification.emailedAt !== null) {
    return { sent: false };
  }

  const to = deps.db
    .select({ email: users.email, role: users.role, verified: users.emailVerified })
    .from(users)
    .where(eq(users.id, notification.userId))
    .get();

  if (to === undefined || !to.verified || isDemoRole(to.role)) {
    return { sent: false };
  }

  const pause = copy.home.pauseReasons[input.reason];
  const path = input.reason === "plan_ended" ? "/settings/billing/plans" : "/settings/billing";
  const url = `${deps.appOrigin.replace(/\/+$/u, "")}${path}`;

  await deps.mail.sendBillingNotice({
    body: copy.mail.billingPauseBody({
      copy: pause.copy,
      fix: pause.fix,
      title: pause.title,
      url,
    }),
    html: renderMailHtml({
      blocks: [{ kind: "text", text: pause.copy }],
      cta: { label: pause.fix, url },
      footer: [
        "Applications already in flight will finish. Nothing new is sent until this is fixed.",
        `${pause.fix}: ${url}`,
        "Overture",
      ],
      heading: pause.title,
      logoUrl: mailLogoUrl(deps.appOrigin),
      preheader: pause.copy,
    }),
    subject: copy.mail.billingPauseSubject(input.reason),
    to: to.email,
  });

  deps.db
    .update(notifications)
    .set({ emailedAt: new Date(deps.clock.now()) })
    .where(eq(notifications.id, input.notificationId))
    .run();

  return { sent: true };
}
