import { eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { PushSender } from "../platform/ports/push.ts";

import { notifications, pushSubscriptions } from "../platform/db/schema.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";

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
 * Queue one push for a notification row. The notification itself is written
 * first, so the in-app list never waits on a push endpoint.
 * @param db The application database.
 * @param clock The clock the job is scheduled from.
 * @param notificationId The notification to push.
 * @returns The queue receipt, with `inserted` false on a repeated request.
 */
export function enqueueNotificationPush(db: AppDatabase, clock: Clock, notificationId: string) {
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
 * @returns The delivery counts.
 */
export async function runNotificationPushJob(deps: PushNotifyDeps, notificationId: string) {
  const notification = deps.db
    .select()
    .from(notifications)
    .where(eq(notifications.id, notificationId))
    .get();

  if (notification === undefined || notification.pushedAt !== null) {
    return { gone: 0, sent: 0, skipped: true };
  }

  const subscriptions = deps.db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, notification.userId))
    .all();

  if (deps.push === null || subscriptions.length === 0) {
    return { gone: 0, sent: 0, skipped: true };
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

  return { gone, sent, skipped: false };
}
