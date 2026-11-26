import { expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";

import { bgJobs, notifications, users } from "../platform/db/schema.ts";
import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { NOTIFICATION_BATCH_WINDOW_MS } from "../../shared/notifications.ts";
import {
  notifyCardMoved,
  notifyEmployerReply,
  notifyInterviewDetected,
  notifyReviewOpened,
} from "./events.ts";
import { setNotificationPreference } from "./preferences.ts";
import { PUSH_NOTIFY_JOB_KIND } from "./push.ts";

Bun.env.BETTER_AUTH_SECRET ??= "batches-test-secret-0123456789";

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SITE_KEY ??= "batches-test-site-key";

Bun.env.TURNSTILE_SECRET ??= "batches-test-secret";

Bun.env.MASTER_KEY_V1 ??= Buffer.alloc(32, 7).toString("base64");

const NOW = Date.UTC(2026, 10, 26, 12, 0, 0);
const USER_ID = "batched-notifications-user";

function seeded() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  db.insert(users)
    .values({
      createdAt: new Date(NOW),
      email: "maya@example.test",
      emailVerified: true,
      id: USER_ID,
      name: "Maya",
      role: "user",
      updatedAt: new Date(NOW),
    })
    .run();

  return { db, sqlite };
}

function clockAt(now: number) {
  return { now: () => now };
}

function rows(db: AppDatabase) {
  return db.select().from(notifications).where(eq(notifications.userId, USER_ID)).all();
}

function pushJobs(db: AppDatabase) {
  return db
    .select({ id: bgJobs.id, runAt: bgJobs.runAt })
    .from(bgJobs)
    .where(and(eq(bgJobs.kind, PUSH_NOTIFY_JOB_KIND), eq(bgJobs.status, "queued")))
    .all();
}

test("a burst of sixteen question events becomes one notification", () => {
  const { db, sqlite } = seeded();

  for (let index = 0; index < 16; index += 1) {
    notifyReviewOpened(db, clockAt(NOW + index * 100), { userId: USER_ID });
  }

  const all = rows(db);

  expect(all).toHaveLength(1);
  expect(all[0]?.kind).toBe("review");
  expect(all[0]?.batchCount).toBe(16);
  expect(all[0]?.title).toBe("16 questions need an answer");
  expect(all[0]?.body).toBe("Answer them in Review so these applications can go ahead.");
  expect(all[0]?.url).toBe("/review");

  const pushes = pushJobs(db);

  expect(pushes).toHaveLength(1);
  expect(pushes[0]?.runAt).toBe(NOW + 15 * 100 + NOTIFICATION_BATCH_WINDOW_MS);

  sqlite.close();
});

test("the same event after the window starts a second notification", () => {
  const { db, sqlite } = seeded();

  notifyReviewOpened(db, clockAt(NOW), { userId: USER_ID });
  notifyReviewOpened(db, clockAt(NOW + NOTIFICATION_BATCH_WINDOW_MS + 1), { userId: USER_ID });

  expect(rows(db)).toHaveLength(2);

  sqlite.close();
});

test("three kinds in a burst become three notifications", () => {
  const { db, sqlite } = seeded();

  for (let index = 0; index < 4; index += 1) {
    const at = NOW + index * 100;

    notifyReviewOpened(db, clockAt(at), { userId: USER_ID });
    notifyEmployerReply(db, clockAt(at), {
      company: "Acme",
      title: "Senior Backend Engineer",
      userId: USER_ID,
    });
    notifyInterviewDetected(db, clockAt(at), {
      company: "Larkspur",
      title: "Staff Platform Engineer",
      userId: USER_ID,
    });
  }

  const all = rows(db);
  const kinds = all.map((row) => row.kind).toSorted();

  expect(all).toHaveLength(3);
  expect(kinds).toEqual(["interview", "reply", "review"]);
  expect(all.every((row) => row.batchCount === 4)).toBe(true);

  sqlite.close();
});

test("a kind the user turned off writes nothing", () => {
  const { db, sqlite } = seeded();

  setNotificationPreference(db, clockAt(NOW), USER_ID, "review", false);

  notifyReviewOpened(db, clockAt(NOW), { userId: USER_ID });
  notifyEmployerReply(db, clockAt(NOW), {
    company: "Acme",
    title: "Senior Backend Engineer",
    userId: USER_ID,
  });

  const all = rows(db);

  expect(all).toHaveLength(1);
  expect(all[0]?.kind).toBe("reply");

  sqlite.close();
});

test("a merged row becomes unread again and keeps the single rows' links", () => {
  const { db, sqlite } = seeded();

  const id = notifyCardMoved(db, clockAt(NOW), {
    applicationId: "app-1",
    company: "Acme",
    stage: "screening",
    title: "Senior Backend Engineer",
    userId: USER_ID,
  });

  if (id === null) {
    throw new Error("the notification was not written");
  }

  const [single] = rows(db);

  expect(single?.id).toBe(id);
  expect(single?.url).toBe("/tracker?application=app-1");

  db.update(notifications)
    .set({ readAt: new Date(NOW) })
    .where(eq(notifications.id, id))
    .run();

  notifyCardMoved(db, clockAt(NOW + 1000), {
    applicationId: "app-2",
    company: "Larkspur",
    stage: "closed",
    title: "Staff Platform Engineer",
    userId: USER_ID,
  });

  const [merged] = rows(db);

  expect(merged?.batchCount).toBe(2);
  expect(merged?.readAt).toBeNull();
  expect(merged?.title).toBe("2 applications moved");
  expect(merged?.url).toBe("/tracker");

  sqlite.close();
});
