import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { copy } from "../../shared/copy.ts";
import type { PauseReason } from "../../shared/copy.ts";
import { createNotification } from "./notifications.ts";

/**
 * A new Review opened, so the user hears once per question and can answer it
 * from their phone (SPEC §15.1).
 * @param db The application database.
 * @param clock The clock the row is stamped from.
 * @param input The user the Review belongs to.
 * @returns The notification id, or null when the kind is off.
 */
export function notifyReviewOpened(db: AppDatabase, clock: Clock, input: { userId: string }) {
  return createNotification(db, clock, {
    body: copy.notifications.review.body,
    kind: copy.notifications.review.kind,
    title: copy.notifications.review.title,
    url: copy.notifications.review.url,
    userId: input.userId,
  });
}

/**
 * An authenticated employer message that says none of the stages: a human
 * reply, not a receipt or a code.
 * @param db The application database.
 * @param clock The clock the row is stamped from.
 * @param input The user, the employer and the job title.
 * @returns The notification id, or null when the kind is off.
 */
export function notifyEmployerReply(
  db: AppDatabase,
  clock: Clock,
  input: { userId: string; company: string; title: string },
) {
  return createNotification(db, clock, {
    body: copy.notifications.reply.body(input.title),
    kind: copy.notifications.reply.kind,
    title: copy.notifications.reply.title(input.company),
    url: copy.notifications.reply.url,
    userId: input.userId,
  });
}

/**
 * Mail moved a card into Interviewing.
 * @param db The application database.
 * @param clock The clock the row is stamped from.
 * @param input The user, the employer and the job title.
 * @returns The notification id, or null when the kind is off.
 */
export function notifyInterviewDetected(
  db: AppDatabase,
  clock: Clock,
  input: { userId: string; company: string; title: string },
) {
  return createNotification(db, clock, {
    body: copy.notifications.interview.body(input.title),
    kind: copy.notifications.interview.kind,
    title: copy.notifications.interview.title(input.company),
    url: copy.notifications.interview.url,
    userId: input.userId,
  });
}

/**
 * Mail moved a card into Offer.
 * @param db The application database.
 * @param clock The clock the row is stamped from.
 * @param input The user, the employer and the job title.
 * @returns The notification id, or null when the kind is off.
 */
export function notifyOfferDetected(
  db: AppDatabase,
  clock: Clock,
  input: { userId: string; company: string; title: string },
) {
  return createNotification(db, clock, {
    body: copy.notifications.offer.body(input.title),
    kind: copy.notifications.offer.kind,
    title: copy.notifications.offer.title(input.company),
    url: copy.notifications.offer.url,
    userId: input.userId,
  });
}

/**
 * A card moved without the user touching it; the notification carries the
 * Undo link the Board uses.
 * @param db The application database.
 * @param clock The clock the row is stamped from.
 * @param input The user, the application, its employer and job, and the stage.
 * @returns The notification id, or null when the kind is off.
 */
export function notifyCardMoved(
  db: AppDatabase,
  clock: Clock,
  input: {
    userId: string;
    applicationId: string;
    company: string;
    title: string;
    stage: string;
  },
) {
  const labels: Readonly<Record<string, string>> = copy.stages;
  const label = labels[input.stage] ?? input.stage;

  return createNotification(db, clock, {
    body: copy.notifications.stageMove.body({
      company: input.company,
      stage: label,
      title: input.title,
    }),
    kind: copy.notifications.stageMove.kind,
    title: copy.notifications.stageMove.title(label),
    url: `${copy.notifications.stageMove.url}?application=${encodeURIComponent(input.applicationId)}`,
    userId: input.userId,
  });
}

/**
 * Sending stopped, with the reason Home shows and its fix.
 * @param db The application database.
 * @param clock The clock the row is stamped from.
 * @param input The user and the reason sending stopped.
 * @returns The notification id, or null when the kind is off.
 */
export function notifyPaused(
  db: AppDatabase,
  clock: Clock,
  input: { userId: string; reason: PauseReason },
) {
  const reason = copy.home.pauseReasons[input.reason];

  return createNotification(db, clock, {
    body: reason.copy,
    kind: copy.notifications.paused.kind,
    title: reason.title,
    url: copy.notifications.paused.url,
    userId: input.userId,
  });
}
