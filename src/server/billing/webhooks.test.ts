import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { createClock } from "../platform/ports/clock.ts";
import type { PaymentEvent } from "../platform/ports/payments.ts";
import {
  bgJobs,
  grants,
  notifications,
  profiles,
  stripeEvents,
  subscriptions,
  users,
} from "../platform/db/schema.ts";

import { applicationsLeft } from "./ledger.ts";
import { BILLING_NOTICE_JOB_KIND } from "../notify/billing-notice.ts";
import { PLANNER_DAY_JOB_KIND } from "../dispatch/planner.ts";
import { PREP_DAILY_JOB_KIND } from "../pipeline/daily-prep.ts";
import { createPaymentsWebhookService } from "./webhooks.ts";

const DAY_MS = 24 * 60 * 60_000;

const WEEK_PRICE = "price_week";
const MONTH_PRICE = "price_month";

function freshWebhooks() {
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

  const webhooks = createPaymentsWebhookService({
    clock,
    db,
    planForPrice: (priceId) => {
      if (priceId === WEEK_PRICE) {
        return "week";
      }

      return priceId === MONTH_PRICE ? "month" : null;
    },
  });

  return { at, clock, db, sqlite, userId: "user-1", webhooks };
}

function event(overrides: Partial<PaymentEvent> & Pick<PaymentEvent, "id" | "type">) {
  return {
    cancelAtPeriodEnd: null,
    customerId: "cus_1",
    invoiceId: null,
    mode: null,
    periodEndMs: null,
    periodStartMs: null,
    plan: null,
    priceId: null,
    sessionId: null,
    subscriptionId: "sub_1",
    subscriptionStatus: null,
    userId: "user-1",
    ...overrides,
  } satisfies PaymentEvent;
}

function pauseNoticeCount(db: ReturnType<typeof freshWebhooks>["db"]) {
  return db.select().from(notifications).all().length;
}

function jobKinds(db: ReturnType<typeof freshWebhooks>["db"]) {
  return db
    .select({ kind: bgJobs.kind })
    .from(bgJobs)
    .all()
    .map((row) => row.kind);
}

function profileOf(db: ReturnType<typeof freshWebhooks>["db"]) {
  return db.select().from(profiles).where(eq(profiles.userId, "user-1")).get();
}

describe("billing webhooks", () => {
  test("a stale payment_failed after a newer paid invoice leaves the paid user unpaused", () => {
    const { at, db, sqlite, webhooks } = freshWebhooks();

    const paid = webhooks.handle(
      event({
        id: "evt_paid_2",
        invoiceId: "in_2",
        periodEndMs: at + 60 * DAY_MS,
        periodStartMs: at,
        priceId: MONTH_PRICE,
        type: "invoice.paid",
      }),
    );

    expect(paid).toBe("processed");

    const staleFailure = webhooks.handle(
      event({
        id: "evt_failed_1",
        invoiceId: "in_1",
        periodEndMs: at + 30 * DAY_MS,
        periodStartMs: at - 30 * DAY_MS,
        priceId: MONTH_PRICE,
        type: "invoice.payment_failed",
      }),
    );

    expect(staleFailure).toBe("processed");
    expect(profileOf(db)).toMatchObject({ pauseReason: null, running: true });
    expect(pauseNoticeCount(db)).toBe(0);

    sqlite.close();
  });

  test("a stale payment_failed is ignored from the paid grant when no subscription row exists", () => {
    const { at, db, sqlite, webhooks } = freshWebhooks();

    expect(
      webhooks.handle(
        event({
          id: "evt_paid_grant_only",
          invoiceId: "in_paid_grant_only",
          periodEndMs: at + 60 * DAY_MS,
          periodStartMs: at + 30 * DAY_MS,
          priceId: MONTH_PRICE,
          subscriptionId: null,
          type: "invoice.paid",
        }),
      ),
    ).toBe("processed");

    expect(
      webhooks.handle(
        event({
          id: "evt_failed_stale_grant_only",
          invoiceId: "in_failed_stale_grant_only",
          periodEndMs: at + 30 * DAY_MS,
          periodStartMs: at,
          priceId: MONTH_PRICE,
          subscriptionId: null,
          type: "invoice.payment_failed",
        }),
      ),
    ).toBe("processed");

    expect(profileOf(db)).toMatchObject({ pauseReason: null, running: true });
    expect(pauseNoticeCount(db)).toBe(0);

    sqlite.close();
  });

  test("a failure for the same period still pauses even when it names another invoice", () => {
    const { at, db, sqlite, webhooks } = freshWebhooks();

    expect(
      webhooks.handle(
        event({
          id: "evt_paid_same_period",
          invoiceId: "in_paid_same_period",
          periodEndMs: at + 30 * DAY_MS,
          periodStartMs: at,
          priceId: MONTH_PRICE,
          type: "invoice.paid",
        }),
      ),
    ).toBe("processed");

    expect(
      webhooks.handle(
        event({
          id: "evt_failed_same_period",
          invoiceId: "in_failed_same_period",
          periodEndMs: at + 30 * DAY_MS,
          periodStartMs: at,
          priceId: MONTH_PRICE,
          type: "invoice.payment_failed",
        }),
      ),
    ).toBe("processed");

    expect(profileOf(db)).toMatchObject({ pauseReason: "payment_failed", running: false });
    expect(pauseNoticeCount(db)).toBe(1);

    sqlite.close();
  });

  test("an unrecognized Stripe price grants nothing and never falls back to metadata", () => {
    const { at, db, sqlite, webhooks } = freshWebhooks();

    db.update(profiles)
      .set({ pauseReason: "payment_failed", running: false })
      .where(eq(profiles.userId, "user-1"))
      .run();

    const result = webhooks.handle(
      event({
        id: "evt_unrelated_price",
        invoiceId: "in_unrelated",
        periodEndMs: at + 30 * DAY_MS,
        periodStartMs: at,
        plan: "month",
        priceId: "price_not_sold_by_overture",
        type: "invoice.paid",
      }),
    );

    expect(result).toBe("processed");
    expect(applicationsLeft(db, "user-1", at)).toBe(0);
    expect(db.select().from(grants).all()).toHaveLength(0);
    expect(db.select().from(subscriptions).all()).toHaveLength(0);
    expect(profileOf(db)).toMatchObject({ pauseReason: "payment_failed", running: false });
    expect(jobKinds(db)).not.toContain(PLANNER_DAY_JOB_KIND);

    sqlite.close();
  });

  test("a failed notice write rolls the event back so redelivery still writes the notice", () => {
    const { at, db, sqlite, webhooks } = freshWebhooks();

    const failedPayment = event({
      id: "evt_failed_atomic",
      invoiceId: "in_failed_atomic",
      periodEndMs: at + 30 * DAY_MS,
      periodStartMs: at,
      priceId: MONTH_PRICE,
      type: "invoice.payment_failed",
    });

    sqlite.run(
      `CREATE TRIGGER billing_test_block_notice
       BEFORE INSERT ON notifications
       BEGIN SELECT RAISE(ABORT, 'notice blocked'); END;`,
    );

    expect(() => webhooks.handle(failedPayment)).toThrow();

    sqlite.run("DROP TRIGGER billing_test_block_notice");

    expect(webhooks.handle(failedPayment)).toBe("processed");
    expect(profileOf(db)).toMatchObject({ pauseReason: "payment_failed", running: false });
    expect(pauseNoticeCount(db)).toBe(1);
    expect(jobKinds(db)).toContain(BILLING_NOTICE_JOB_KIND);

    const stored = db
      .select()
      .from(stripeEvents)
      .where(eq(stripeEvents.id, failedPayment.id))
      .get();

    expect(stored?.processedAt).not.toBeNull();

    sqlite.close();
  });

  test("a failed job write rolls the paid event back so redelivery still schedules resume work", () => {
    const { at, db, sqlite, webhooks } = freshWebhooks();

    expect(
      webhooks.handle(
        event({
          id: "evt_failed_before_paid",
          invoiceId: "in_failed_before_paid",
          periodEndMs: at + 30 * DAY_MS,
          periodStartMs: at,
          priceId: MONTH_PRICE,
          type: "invoice.payment_failed",
        }),
      ),
    ).toBe("processed");

    const paid = event({
      id: "evt_paid_atomic",
      invoiceId: "in_paid_atomic",
      periodEndMs: at + 60 * DAY_MS,
      periodStartMs: at + 30 * DAY_MS,
      priceId: MONTH_PRICE,
      type: "invoice.paid",
    });

    sqlite.run(
      `CREATE TRIGGER billing_test_block_jobs
       BEFORE INSERT ON bg_jobs
       BEGIN SELECT RAISE(ABORT, 'job blocked'); END;`,
    );

    expect(() => webhooks.handle(paid)).toThrow();

    sqlite.run("DROP TRIGGER billing_test_block_jobs");

    expect(webhooks.handle(paid)).toBe("processed");
    expect(profileOf(db)).toMatchObject({ pauseReason: null, running: true });
    expect(jobKinds(db)).toContain(PLANNER_DAY_JOB_KIND);
    expect(jobKinds(db)).toContain(PREP_DAILY_JOB_KIND);
    expect(
      db.select().from(stripeEvents).where(eq(stripeEvents.id, paid.id)).get()?.processedAt,
    ).not.toBeNull();

    sqlite.close();
  });
});
