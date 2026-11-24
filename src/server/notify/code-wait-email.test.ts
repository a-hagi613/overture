import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { notifications, pushSubscriptions, users } from "../platform/db/schema.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { openDatabase } from "../platform/db/client.ts";
import { sendCodeWaitEmailFallback } from "./code-wait-email.ts";

Bun.env.BETTER_AUTH_SECRET ??= "code-wait-email-test-secret-0123456789";

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SITE_KEY ??= "code-wait-email-test-site-key";

Bun.env.TURNSTILE_SECRET ??= "code-wait-email-test-secret";

Bun.env.MASTER_KEY_V1 ??= Buffer.alloc(32, 7).toString("base64");

const { clearSinkMail, createSinkMailSender, listSinkMail } =
  await import("../platform/mail/sink.ts");

const NOW = Date.UTC(2026, 10, 23, 9, 30, 0);

const USER_ID = "code-email-user";
const NOTIFICATION_ID = "code-email-notification";

const clock: Clock = { now: () => NOW };

const mail = createSinkMailSender(clock);

function sentCodeWaitMails() {
  return listSinkMail().filter((sent) => sent.subject.includes("verification code"));
}

function seeded(options: { push?: boolean; role?: "user" | "demo"; verified?: boolean } = {}) {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  db.insert(users)
    .values({
      createdAt: new Date(NOW),
      email: "maya@example.test",
      emailVerified: options.verified ?? true,
      id: USER_ID,
      name: "Maya",
      role: options.role ?? "user",
      updatedAt: new Date(NOW),
    })
    .run();

  db.insert(notifications)
    .values({
      body: "Paste the code.",
      createdAt: NOW,
      id: NOTIFICATION_ID,
      kind: "code_wait",
      title: "Needs a verification code",
      url: "/home?codeWait=code-email-wait",
      userId: USER_ID,
    })
    .run();

  if (options.push === true) {
    db.insert(pushSubscriptions)
      .values({
        auth: "auth",
        createdAt: NOW,
        endpoint: "https://push.example.test/subscription",
        id: "push-1",
        p256dh: "p256dh",
        userId: USER_ID,
      })
      .run();
  }

  return { db, sqlite };
}

async function send(db: AppDatabase) {
  return sendCodeWaitEmailFallback(
    { appOrigin: "https://overture.test/", clock, db, mail },
    { notificationId: NOTIFICATION_ID, userId: USER_ID },
  );
}

function emailedAt(db: AppDatabase) {
  return db
    .select({ emailedAt: notifications.emailedAt })
    .from(notifications)
    .where(eq(notifications.id, NOTIFICATION_ID))
    .get()?.emailedAt;
}

test("no push endpoint emails the paste ask once per wait (#565)", async () => {
  const { db, sqlite } = seeded();

  clearSinkMail();

  expect(await send(db)).toEqual({ sent: true });

  const sent = sentCodeWaitMails();

  expect(sent).toHaveLength(1);
  expect(sent[0]?.to).toBe("maya@example.test");
  expect(sent[0]?.body).toContain("https://overture.test/home?codeWait=code-email-wait");
  expect(emailedAt(db)?.getTime()).toBe(NOW);

  expect(await send(db)).toEqual({ sent: false });
  expect(sentCodeWaitMails()).toHaveLength(1);

  sqlite.close();
});

test("a live push endpoint suppresses the fallback email (#565)", async () => {
  const { db, sqlite } = seeded({ push: true });

  clearSinkMail();

  expect(await send(db)).toEqual({ sent: false });
  expect(sentCodeWaitMails()).toHaveLength(0);
  expect(emailedAt(db)).toBeNull();

  sqlite.close();
});

test("an unverified or demo user is never emailed the fallback (#565)", async () => {
  const unverified = seeded({ verified: false });

  clearSinkMail();

  expect(await send(unverified.db)).toEqual({ sent: false });
  expect(sentCodeWaitMails()).toHaveLength(0);
  unverified.sqlite.close();

  const demo = seeded({ role: "demo" });

  expect(await send(demo.db)).toEqual({ sent: false });
  expect(sentCodeWaitMails()).toHaveLength(0);
  demo.sqlite.close();
});
