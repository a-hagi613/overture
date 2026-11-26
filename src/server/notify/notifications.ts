import { and, desc, eq, gte } from "drizzle-orm";

import type { AppDatabase, DatabaseWriter } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import {
  NOTIFICATION_BATCH_WINDOW_MS,
  isNotificationKind,
  isNotificationPreferenceKey,
} from "../../shared/notifications.ts";
import type { NotificationKind } from "../../shared/notifications.ts";

import { notifications } from "../platform/db/schema.ts";
import { publishEvent } from "../platform/sse/stream.ts";
import { NOTIFICATION_BATCH_COPY } from "./batches.ts";
import type { NotificationBatchCopy } from "./batches.ts";
import { deferNotificationPush, enqueueNotificationPush } from "./push.ts";
import { notificationPreferenceEnabled } from "./preferences.ts";

export interface NotificationInput {
  userId: string;
  kind: NotificationKind | "alert";
  title: string;
  body: string;
  url: string;
}

/**
 * Write one in-app notification, tell open tabs, and queue its push. A kind the
 * user turned off never reaches the list or a phone (SPEC §15.1).
 *
 * A kind that arrives in bursts joins the row of the same kind written in the
 * last two minutes instead of adding another: sixteen questions, or several
 * stage moves, become one grouped row and one push (#705). A grouped row waits
 * out its window before the push runs, so the phone gets the grouped copy.
 * @param db The application database.
 * @param clock The clock the row is stamped from.
 * @param input The user, kind and copy.
 * @returns The notification id, or null when the user turned that kind off.
 */
export function createNotification(db: AppDatabase, clock: Clock, input: NotificationInput) {
  if (
    isNotificationPreferenceKey(input.kind) &&
    !notificationPreferenceEnabled(db, input.userId, input.kind)
  ) {
    return null;
  }

  const batch = isNotificationKind(input.kind) ? NOTIFICATION_BATCH_COPY[input.kind] : undefined;

  if (batch === undefined) {
    return insertNotification(db, clock, input);
  }

  return upsertBatchedNotification(db, clock, input, batch);
}

function upsertBatchedNotification(
  db: AppDatabase,
  clock: Clock,
  input: NotificationInput,
  batch: NotificationBatchCopy,
) {
  const now = clock.now();

  const existing = db
    .select({
      batchCount: notifications.batchCount,
      id: notifications.id,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, input.userId),
        eq(notifications.kind, input.kind),
        gte(notifications.createdAt, now - NOTIFICATION_BATCH_WINDOW_MS),
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(1)
    .get();

  if (existing === undefined) {
    return insertNotification(db, clock, input, {
      pushDelayMs: NOTIFICATION_BATCH_WINDOW_MS,
    });
  }

  const count = existing.batchCount + 1;

  db.update(notifications)
    .set({
      batchCount: count,
      body: batch.body,
      createdAt: now,
      readAt: null,
      title: batch.title(count),
      url: batch.url ?? input.url,
    })
    .where(eq(notifications.id, existing.id))
    .run();

  deferNotificationPush(db, clock, existing.id, NOTIFICATION_BATCH_WINDOW_MS);

  publishEvent(
    db,
    clock,
    "notification",
    JSON.stringify({ id: existing.id, kind: input.kind }),
    input.userId,
  );

  return existing.id;
}

/**
 * Write a notification row whatever the user's preferences say. Only the one
 * Recap row uses this: it is also the per-day marker the email send reads, so
 * turning the push off must not make a retried run email twice. The caller says
 * whether a push should go out for it.
 * @param db The application database.
 * @param clock The clock the row is stamped from.
 * @param input The user, kind and copy.
 * @param options The push switch and delay; `options.push` defaults to true, the
 * delay defaults to none (a grouped row waits out its window).
 * @returns The notification id.
 */
export function insertNotification(
  db: DatabaseWriter,
  clock: Clock,
  input: NotificationInput,
  options: { push?: boolean; pushDelayMs?: number } = {},
) {
  const id = crypto.randomUUID();

  db.insert(notifications)
    .values({
      id,
      userId: input.userId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      url: input.url,
      createdAt: clock.now(),
    })
    .run();

  publishEvent(db, clock, "notification", JSON.stringify({ id, kind: input.kind }), input.userId);

  if (options.push !== false) {
    enqueueNotificationPush(db, clock, id, { delayMs: options.pushDelayMs ?? 0 });
  }

  return id;
}
