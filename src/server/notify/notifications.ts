import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import { isNotificationPreferenceKey } from "../../shared/notifications.ts";
import type { NotificationKind } from "../../shared/notifications.ts";

import { notifications } from "../platform/db/schema.ts";
import { publishEvent } from "../platform/sse/stream.ts";
import { enqueueNotificationPush } from "./push.ts";
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

  return insertNotification(db, clock, input);
}

/**
 * Write a notification row whatever the user's preferences say. Only the one
 * Recap row uses this: it is also the per-day marker the email send reads, so
 * turning the push off must not make a retried run email twice. The caller says
 * whether a push should go out for it.
 * @param db The application database.
 * @param clock The clock the row is stamped from.
 * @param input The user, kind and copy.
 * @param options The push switch; `options.push` defaults to true.
 * @returns The notification id.
 */
export function insertNotification(
  db: AppDatabase,
  clock: Clock,
  input: NotificationInput,
  options: { push?: boolean } = {},
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
    enqueueNotificationPush(db, clock, id);
  }

  return id;
}
