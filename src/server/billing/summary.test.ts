import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createClock } from "../platform/ports/clock.ts";
import { subscriptions, users } from "../platform/db/schema.ts";
import { openCountingDatabase } from "../testing/query-counter.ts";

import {
  billingSummary,
  commitForApplication,
  grantApplications,
  postLedgerEntry,
  releaseForApplication,
  reserveForApplication,
} from "./ledger.ts";
import { billingAccountOf } from "./plan-account.ts";

const DAY_MS = 24 * 60 * 60_000;

function freshLedger() {
  const { counter, db } = openCountingDatabase();

  const clock = createClock();
  const at = clock.now();

  db.insert(users)
    .values({
      id: "user-1",
      name: "Owner",
      email: "owner@example.com",
      emailVerified: true,
      role: "owner",
      createdAt: new Date(at),
      updatedAt: new Date(at),
    })
    .run();

  return { clock, counter, db, userId: "user-1" };
}

function seeded() {
  const fixture = freshLedger();
  const at = fixture.clock.now();

  const { grantId } = grantApplications(fixture.db, fixture.clock, {
    expiresAt: at + 30 * DAY_MS,
    idempotencyKey: "grant:invite",
    quantity: 12,
    source: "admin",
    startsAt: at,
    userId: fixture.userId,
  });

  grantApplications(fixture.db, fixture.clock, {
    expiresAt: at + 365 * DAY_MS,
    idempotencyKey: "grant:period",
    quantity: 40,
    source: "period",
    startsAt: at,
    userId: fixture.userId,
  });

  return { ...fixture, grantId };
}

describe("the billing summary Home reads", () => {
  test("answers the three counters Home shows in two reads, not six", () => {
    const { clock, counter, db, userId } = seeded();
    const at = clock.now();

    counter.reset();

    const summary = billingSummary(db, userId, at);

    expect(counter.count()).toBe(2);
    expect(summary.applicationsLeft).toBe(52);
    expect(summary.planApplications).toBe(12 + 40);
    expect(summary.endingGrant?.applicationsLeft).toBe(12);
  });

  test("counts a reservation against what is left, exactly as the separate reads do", () => {
    const { clock, db, grantId, userId } = seeded();
    const at = clock.now();

    postLedgerEntry(db, at, {
      amount: 1,
      applicationId: "application-1",
      grantId,
      idempotencyKey: "reserve:application-1",
      kind: "reserve",
      userId,
    });

    expect(billingSummary(db, userId, at).applicationsLeft).toBe(51);
    expect(billingSummary(db, userId, at).planApplications).toBe(52);
  });
});

function useApplication(
  fixture: ReturnType<typeof freshLedger>,
  applicationId: string,
  outcome: "commit" | "release",
) {
  reserveForApplication(fixture.db, fixture.clock, {
    applicationId,
    idempotencyKey: `reserve:${applicationId}`,
    userId: fixture.userId,
  });

  if (outcome === "commit") {
    commitForApplication(fixture.db, fixture.clock, {
      applicationId,
      idempotencyKey: `commit:${applicationId}`,
      userId: fixture.userId,
    });

    return;
  }

  releaseForApplication(fixture.db, fixture.clock, {
    applicationId,
    idempotencyKey: `release:${applicationId}`,
    userId: fixture.userId,
  });
}

describe("the plan account the sidebar and Billing read", () => {
  test("keeps the totals and the ending invite grant Home already showed", () => {
    const { clock, db, userId } = seeded();
    const account = billingAccountOf(db, userId, clock.now());

    expect(account.applicationsLeft).toBe(52);
    expect(account.planApplications).toBe(52);
    expect(account.endingGrant?.applicationsLeft).toBe(12);
    expect(account.planKind).toBe("none");
  });

  test("a sent-out trial is the plan, with its three applications used and none left", () => {
    const fixture = freshLedger();
    const at = fixture.clock.now();

    grantApplications(fixture.db, fixture.clock, {
      expiresAt: null,
      idempotencyKey: "grant:trial",
      quantity: 3,
      source: "trial",
      startsAt: at,
      userId: fixture.userId,
    });

    for (const applicationId of ["app-1", "app-2", "app-3"]) {
      useApplication(fixture, applicationId, "commit");
    }

    const account = billingAccountOf(fixture.db, fixture.userId, at);

    expect(account.planKind).toBe("trial");
    expect(account.trialUsed).toBe(true);
    expect(account.applicationsLeft).toBe(0);
    expect(account.balance.trial).toStrictEqual({ granted: 3, left: 0, used: 3 });
    expect(account.balance.used).toBe(3);
  });

  test("a paid period is paid applications, and a failed send comes back as returned", () => {
    const fixture = freshLedger();
    const at = fixture.clock.now();

    grantApplications(fixture.db, fixture.clock, {
      expiresAt: at + 7 * DAY_MS,
      idempotencyKey: "grant:period",
      quantity: 50,
      source: "period",
      startsAt: at,
      userId: fixture.userId,
    });

    useApplication(fixture, "app-sent", "commit");
    useApplication(fixture, "app-failed", "release");
    useApplication(fixture, "app-held", "release");

    reserveForApplication(fixture.db, fixture.clock, {
      applicationId: "app-in-flight",
      idempotencyKey: "reserve:app-in-flight",
      userId: fixture.userId,
    });

    const account = billingAccountOf(fixture.db, fixture.userId, at);

    expect(account.balance.paid).toStrictEqual({ granted: 50, left: 48, used: 1 });
    expect(account.balance.reserved).toBe(1);
    expect(account.balance.released).toBe(2);
    expect(account.balance.expiring).toStrictEqual({
      applications: 48,
      expiresAt: at + 7 * DAY_MS,
    });
    expect(account.trialUsed).toBe(false);
  });

  test("an active subscription names its plan, and a finished one falls back to the trial", () => {
    const fixture = freshLedger();
    const at = fixture.clock.now();

    grantApplications(fixture.db, fixture.clock, {
      expiresAt: null,
      idempotencyKey: "grant:trial",
      quantity: 3,
      source: "trial",
      startsAt: at,
      userId: fixture.userId,
    });

    fixture.db
      .insert(subscriptions)
      .values({
        cancelAtPeriodEnd: false,
        currentPeriodEnd: at + 7 * DAY_MS,
        currentPeriodStart: at,
        id: "subscription-1",
        plan: "week",
        status: "active",
        stripeSubscriptionId: "sub_account_test",
        updatedAt: at,
        userId: fixture.userId,
      })
      .run();

    expect(billingAccountOf(fixture.db, fixture.userId, at).planKind).toBe("week");

    fixture.db
      .update(subscriptions)
      .set({ status: "canceled" })
      .where(eq(subscriptions.id, "subscription-1"))
      .run();

    expect(billingAccountOf(fixture.db, fixture.userId, at).planKind).toBe("trial");
  });
});
