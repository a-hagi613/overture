import { eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase, DatabaseWriter } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { PushSender } from "../platform/ports/push.ts";

import { notifications, pushSubscriptions } from "../platform/db/schema.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import { isDemoUser } from "../demo/role.ts";
import { isNotificationKind } from "../../shared/notifications.ts";
import { notificationPreferenceEnabled } from "./preferences.ts";

export const PUSH_NOTIFY_JOB_KIND = "push.notify";

const payloadSchema = z.object({ notificationId: z.string().min(1) });

export interface PushNotifyDeps {
  db: AppDatabase;
  clock: Clock;
  push: PushSender | null;
}

export function pushNotifyPayload(notificationId: string) {
  return JSON.stringify({ notificationId });
}

export function parsePushNotifyPayload(payload: string) {
  return payloadSchema.parse(JSON.parse(payload));
}

/**
 * Whether the user still holds a push endpoint. Rows exist only for granted
 * subscriptions and are deleted the moment a push service answers 404/410 in
 * `runNotificationPushJob`, so a row is the whole answer and no migration is
 * needed (#565).
 * @param db The application database.
 * @param userId The user whose endpoints are counted.
 * @returns True when at least one subscription row exists.
 */
export function hasActivePushEndpoint(db: Pick<AppDatabase, "select">, userId: string) {
  return (
    db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .get() !== undefined
  );
}

/**
 * Queue one push for a notification row. The notification itself is written
 * first, so the in-app list never waits on a push endpoint.
 * @param db The application database.
 * @param clock The clock the job is scheduled from.
 * @param notificationId The notification to push.
 * @returns The queue receipt, with `inserted` false on a repeated request.
 */
export function enqueueNotificationPush(db: DatabaseWriter, clock: Clock, notificationId: string) {
  return enqueueJob(db, clock, PUSH_NOTIFY_JOB_KIND, pushNotifyPayload(notificationId), {
    dedupeKey: `${PUSH_NOTIFY_JOB_KIND}:${notificationId}`,
  });
}

/**
 * Send one notification to every push subscription the user still holds.
 * Endpoints that answer "gone" are deleted; endpoints that fail are retried on
 * the next job attempt unless another subscription received the push.
 * @param deps The database, clock and push sender.
 * @param notificationId The notification to push.
 * @returns The delivery counts and the notification's user, so the caller can
 * fall back to email once the rows are pruned (#565).
 */
export async function runNotificationPushJob(deps: PushNotifyDeps, notificationId: string) {
  const notification = deps.db
    .select()
    .from(notifications)
    .where(eq(notifications.id, notificationId))
    .get();

  if (notification === undefined || notification.pushedAt !== null) {
    return {
      gone: 0,
      kind: notification?.kind ?? null,
      sent: 0,
      skipped: true,
      userId: notification?.userId ?? null,
    };
  }

  if (isDemoUser(deps.db, notification.userId)) {
    return {
      gone: 0,
      kind: notification.kind,
      sent: 0,
      skipped: true,
      userId: notification.userId,
    };
  }

  if (
    isNotificationKind(notification.kind) &&
    !notificationPreferenceEnabled(deps.db, notification.userId, notification.kind)
  ) {
    return {
      gone: 0,
      kind: notification.kind,
      sent: 0,
      skipped: true,
      userId: notification.userId,
    };
  }

  const subscriptions = deps.db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, notification.userId))
    .all();

  if (deps.push === null || subscriptions.length === 0) {
    return {
      gone: 0,
      kind: notification.kind,
      sent: 0,
      skipped: true,
      userId: notification.userId,
    };
  }

  const payload = {
    body: notification.body,
    tag: `overture.${notification.kind}.${notification.id}`,
    title: notification.title,
    url: notification.url,
  };

  const now = deps.clock.now();
  const { push } = deps;

  const results = await Promise.allSettled(
    subscriptions.map(async (subscription) =>
      push.send(
        {
          endpoint: subscription.endpoint,
          keys: { auth: subscription.auth, p256dh: subscription.p256dh },
        },
        payload,
      ),
    ),
  );

  const failures: Error[] = [];
  let sent = 0;
  let gone = 0;

  for (const [index, result] of results.entries()) {
    const subscription = subscriptions[index];

    if (subscription === undefined) {
      continue;
    }

    if (result.status === "rejected") {
      failures.push(
        result.reason instanceof Error
          ? result.reason
          : new Error("Push delivery failed.", { cause: result.reason }),
      );
    } else if (result.value === "gone") {
      deps.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id)).run();
      gone += 1;
    } else {
      deps.db
        .update(pushSubscriptions)
        .set({ lastOkAt: new Date(now) })
        .where(eq(pushSubscriptions.id, subscription.id))
        .run();
      sent += 1;
    }
  }

  if (sent === 0 && failures[0] !== undefined) {
    throw failures[0];
  }

  if (sent > 0) {
    deps.db
      .update(notifications)
      .set({ pushedAt: new Date(now) })
      .where(eq(notifications.id, notification.id))
      .run();
  }

  return { gone, kind: notification.kind, sent, skipped: false, userId: notification.userId };
}
