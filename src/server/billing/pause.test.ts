import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { migrateDatabase } from "../platform/db/migrate.ts";
import { openDatabase } from "../platform/db/client.ts";
import { createClock } from "../platform/ports/clock.ts";
import { applications, profiles, users } from "../platform/db/schema.ts";

import {
  applicationsLeft,
  balancesPerGrant,
  commitForApplication,
  expireDueGrants,
  releaseForApplication,
  reserveForApplication,
} from "./ledger.ts";
import { grantPaidPeriod } from "./periods.ts";
import { pauseForBilling, resumeAfterPayment } from "./pause.ts";

const DAY_MS = 24 * 60 * 60_000;

function freshBilling() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  const clock = createClock();
  const at = clock.now();

  db.insert(users)
    .values({
      createdAt: new Date(at),
      email: "owner@example.com",
      emailVerified: true,
      id: "user-1",
      name: "Owner",
      role: "owner",
      updatedAt: new Date(at),
    })
    .run();

  db.insert(profiles)
    .values({
      createdAt: new Date(at),
      languages: "[]",
      pauseReason: null,
      running: true,
      timezone: "UTC",
      updatedAt: new Date(at),
      userId: "user-1",
    })
    .run();

  return { at, clock, db, sqlite, userId: "user-1" };
}

function profileOf(db: ReturnType<typeof freshBilling>["db"], userId: string) {
  return db.select().from(profiles).where(eq(profiles.userId, userId)).get();
}

function seedSendingApplication(
  db: ReturnType<typeof freshBilling>["db"],
  userId: string,
  applicationId: string,
  at: number,
  status: "sending" | "confirming" = "sending",
) {
  db.insert(applications)
    .values({
      ats: "greenhouse",
      companyId: "company-1",
      companyName: "Acme",
      companyNameNorm: "acme",
      createdAt: at,
      id: applicationId,
      origin: "auto",
      postingId: `posting-${applicationId}`,
      postingTitle: "Engineer",
      postingUrl: `https://example.com/jobs/${applicationId}`,
      status,
      updatedAt: at,
      userId,
    })
    .run();
}

describe("a billing pause", () => {
  test("pauses a running user with the plan-ended reason and is idempotent", () => {
    const { clock, db, sqlite, userId } = freshBilling();

    const first = pauseForBilling(db, clock, { reason: "plan_ended", userId });

    expect(first.changed).toBe(true);
    expect(profileOf(db, userId)).toMatchObject({ pauseReason: "plan_ended", running: false });

    const second = pauseForBilling(db, clock, { reason: "plan_ended", userId });

    expect(second.changed).toBe(false);
    expect(profileOf(db, userId)).toMatchObject({ pauseReason: "plan_ended", running: false });

    sqlite.close();
  });

  test("a failed payment replaces a plan-ended reason, but a plan end never hides a failed payment", () => {
    const { clock, db, sqlite, userId } = freshBilling();

    pauseForBilling(db, clock, { reason: "plan_ended", userId });

    const failed = pauseForBilling(db, clock, { reason: "payment_failed", userId });

    expect(failed.changed).toBe(true);
    expect(profileOf(db, userId)?.pauseReason).toBe("payment_failed");

    const ended = pauseForBilling(db, clock, { reason: "plan_ended", userId });

    expect(ended.changed).toBe(false);
    expect(profileOf(db, userId)?.pauseReason).toBe("payment_failed");

    sqlite.close();
  });

  test("leaves a setup, manual or suspended pause alone", () => {
    const { clock, db, sqlite, userId } = freshBilling();

    for (const reason of ["onboarding", "no_resume", "no_mailbox", "suspended", "user"] as const) {
      db.update(profiles)
        .set({ pauseReason: reason, running: false })
        .where(eq(profiles.userId, userId))
        .run();

      expect(pauseForBilling(db, clock, { reason: "payment_failed", userId }).changed).toBe(false);
      expect(profileOf(db, userId)?.pauseReason).toBe(reason);
    }

    sqlite.close();
  });

  test("never pauses the demo account", () => {
    const { clock, db, sqlite, userId } = freshBilling();

    db.update(users).set({ role: "demo" }).where(eq(users.id, userId)).run();

    expect(pauseForBilling(db, clock, { reason: "payment_failed", userId }).changed).toBe(false);
    expect(profileOf(db, userId)).toMatchObject({ pauseReason: null, running: true });

    sqlite.close();
  });

  test("a successful payment resumes only a billing pause", () => {
    const { clock, db, sqlite, userId } = freshBilling();

    pauseForBilling(db, clock, { reason: "payment_failed", userId });

    expect(resumeAfterPayment(db, clock, { userId }).resumed).toBe(true);
    expect(profileOf(db, userId)).toMatchObject({ pauseReason: null, running: true });

    for (const reason of ["onboarding", "user"] as const) {
      db.update(profiles)
        .set({ pauseReason: reason, running: false })
        .where(eq(profiles.userId, userId))
        .run();

      expect(resumeAfterPayment(db, clock, { userId }).resumed).toBe(false);
      expect(profileOf(db, userId)?.pauseReason).toBe(reason);
    }

    db.update(users).set({ role: "demo" }).where(eq(users.id, userId)).run();
    db.update(profiles)
      .set({ pauseReason: "plan_ended", running: false })
      .where(eq(profiles.userId, userId))
      .run();

    expect(resumeAfterPayment(db, clock, { userId }).resumed).toBe(false);
    expect(profileOf(db, userId)?.pauseReason).toBe("plan_ended");

    sqlite.close();
  });
});

describe("a period grant that ends while a send is in flight", () => {
  test("keeps the in-flight reservation so a sent application is charged and a failed one is not", () => {
    const { at, clock, db, sqlite, userId } = freshBilling();
    const periodEnd = at + DAY_MS;

    const granted = grantPaidPeriod(db, clock, {
      invoiceId: "in_week_1",
      periodEndMs: periodEnd,
      periodStartMs: at,
      plan: "week",
      userId,
    });

    seedSendingApplication(db, userId, "app-in-flight", at);
    seedSendingApplication(db, userId, "app-fails", at, "confirming");

    reserveForApplication(db, clock, {
      applicationId: "app-in-flight",
      idempotencyKey: "reserve:app-in-flight:1",
      userId,
    });
    reserveForApplication(db, clock, {
      applicationId: "app-fails",
      idempotencyKey: "reserve:app-fails:1",
      userId,
    });

    clock.setOffset(DAY_MS + 1);

    expect(expireDueGrants(db, clock, userId)).toStrictEqual([granted.grantId]);
    expect(applicationsLeft(db, userId, clock.now())).toBe(0);

    expect(balancesPerGrant(db, userId).get(granted.grantId)).toStrictEqual({
      available: 0,
      expired: 68,
      issued: -70,
      reserved: 2,
      used: 0,
    });

    commitForApplication(db, clock, {
      applicationId: "app-in-flight",
      idempotencyKey: "commit:app-in-flight",
      userId,
    });
    releaseForApplication(db, clock, {
      applicationId: "app-fails",
      idempotencyKey: "release:app-fails",
      userId,
    });

    expect(balancesPerGrant(db, userId).get(granted.grantId)).toStrictEqual({
      available: 1,
      expired: 68,
      issued: -70,
      reserved: 0,
      used: 1,
    });

    expect(expireDueGrants(db, clock, userId)).toStrictEqual([granted.grantId]);
    expect(balancesPerGrant(db, userId).get(granted.grantId)).toStrictEqual({
      available: 0,
      expired: 69,
      issued: -70,
      reserved: 0,
      used: 1,
    });
    expect(applicationsLeft(db, userId, clock.now())).toBe(0);

    sqlite.close();
  });
});
