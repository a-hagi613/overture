import { eq } from "drizzle-orm";

import { expect, test } from "@playwright/test";

import { openDatabase } from "../../src/server/platform/db/client.ts";
import { migrateDatabase } from "../../src/server/platform/db/migrate.ts";
import { adminAudit, grants, ledger, users } from "../../src/server/platform/db/schema.ts";
import { createClock } from "../../src/server/platform/ports/clock.ts";
import type { AdminAuditRow } from "../../src/server/platform/audit/index.ts";
import { billingUserView } from "../../src/server/billing/admin-view.ts";
import { applicationsLeft, grantApplications } from "../../src/server/billing/ledger.ts";
import { grantPaidPeriod } from "../../src/server/billing/periods.ts";
import { REFUND_AUDIT_ACTION, refundGrant } from "../../src/server/billing/refunds.ts";
import { createStripePayments } from "../../src/server/billing/stripe.ts";

import { startStripeMock } from "./stripe-mock.fixture.ts";
import type { StripeMock } from "./stripe-mock.fixture.ts";

const DAY_MS = 24 * 60 * 60_000;
const SECRET_KEY = ["sk", "test", "refunds"].join("_");
const WEBHOOK_SECRET = ["whsec", "refunds"].join("_");

const NOTE = "Charged twice in the same billing period";

function freshBilling(stripe: StripeMock) {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  const clock = createClock();
  const at = clock.now();

  db.insert(users)
    .values({
      id: "user-1",
      name: "Ana",
      email: "ana@example.com",
      emailVerified: true,
      role: "user",
      createdAt: new Date(at),
      updatedAt: new Date(at),
    })
    .run();

  const payments = createStripePayments({
    apiBaseUrl: stripe.url,
    clock,
    secretKey: SECRET_KEY,
    webhookSecret: WEBHOOK_SECRET,
  });

  const shipped: AdminAuditRow[] = [];

  const deps = {
    clock,
    db,
    payments,
    shipAudit: async (row: AdminAuditRow) => {
      shipped.push(row);
      await Promise.resolve();
    },
  };

  return { clock, db, deps, shipped, sqlite, userId: "user-1" };
}

function paidMonth(fixture: ReturnType<typeof freshBilling>, invoiceId: string) {
  const at = fixture.clock.now();

  return grantPaidPeriod(fixture.db, fixture.clock, {
    invoiceId,
    periodEndMs: at + 30 * DAY_MS,
    periodStartMs: at,
    plan: "month",
    userId: fixture.userId,
  }).grantId;
}

function refundInput(grantId: string, idempotencyKey: string) {
  return {
    actorId: "owner-1",
    amountCents: null,
    grantId,
    idempotencyKey,
    note: NOTE,
    reason: "charged_twice" as const,
  };
}

test.describe("refunding a paid period against stripe-mock", () => {
  let stripe: StripeMock;

  test.beforeAll(async () => {
    stripe = await startStripeMock();
  });

  test.afterAll(async () => {
    await stripe.stop();
  });

  test("refunds the payment at Stripe, stops the unused Applications, and audits it", async () => {
    const fixture = freshBilling(stripe);
    const grantId = paidMonth(fixture, "in_paid_1");
    const before = applicationsLeft(fixture.db, fixture.userId, fixture.clock.now());
    const requestsBefore = stripe.requests.length;

    const outcome = await refundGrant(fixture.deps, refundInput(grantId, "refund-key-1"));

    expect(outcome.kind).toBe("refunded");

    if (outcome.kind !== "refunded") {
      throw new Error("expected a refund");
    }

    expect(outcome.replayed).toBe(false);
    expect(outcome.refund.refundId.startsWith("re_")).toBe(true);
    expect(outcome.refund.applicationsStopped).toBe(before);

    const refundCalls = stripe.requests
      .slice(requestsBefore)
      .filter((request) => request.method === "POST");

    expect(refundCalls).toHaveLength(1);
    expect(refundCalls[0]?.path).toBe("/v1/refunds");
    expect(refundCalls[0]?.body).toContain("payment_intent=");

    expect(applicationsLeft(fixture.db, fixture.userId, fixture.clock.now())).toBe(0);

    const entries = fixture.db.select().from(ledger).where(eq(ledger.kind, "refund")).all();

    expect(entries).toHaveLength(1);
    expect(entries[0]?.amount).toBe(before);
    expect(entries[0]?.idempotencyKey).toBe("refund:refund-key-1");

    const audits = fixture.db
      .select()
      .from(adminAudit)
      .where(eq(adminAudit.action, REFUND_AUDIT_ACTION))
      .all();

    expect(audits).toHaveLength(1);
    expect(audits[0]?.targetUserId).toBe(fixture.userId);
    expect(audits[0]?.actorId).toBe("owner-1");
    expect(JSON.parse(audits[0]?.detail ?? "{}")).toMatchObject({
      grantId,
      reason: "charged_twice",
      refundId: outcome.refund.refundId,
    });
    expect(fixture.shipped.map((row) => row.action)).toEqual([REFUND_AUDIT_ACTION]);
  });

  test("a retry with the same key replays the first refund and never calls Stripe again", async () => {
    const fixture = freshBilling(stripe);
    const grantId = paidMonth(fixture, "in_paid_retry");

    const first = await refundGrant(fixture.deps, refundInput(grantId, "retry-key"));
    const requestsAfterFirst = stripe.requests.length;
    const second = await refundGrant(fixture.deps, refundInput(grantId, "retry-key"));

    expect(first.kind).toBe("refunded");
    expect(second.kind).toBe("refunded");

    if (first.kind !== "refunded" || second.kind !== "refunded") {
      throw new Error("expected two refunds");
    }

    expect(second.replayed).toBe(true);
    expect(second.refund.refundId).toBe(first.refund.refundId);
    expect(stripe.requests.length).toBe(requestsAfterFirst);
    expect(fixture.db.select().from(ledger).where(eq(ledger.kind, "refund")).all()).toHaveLength(1);
    expect(
      fixture.db.select().from(adminAudit).where(eq(adminAudit.action, REFUND_AUDIT_ACTION)).all(),
    ).toHaveLength(1);
  });

  test("a second refund of the same period under a new key is refused and never reaches Stripe", async () => {
    const fixture = freshBilling(stripe);
    const grantId = paidMonth(fixture, "in_paid_double");

    await refundGrant(fixture.deps, refundInput(grantId, "first-key"));
    const requestsBefore = stripe.requests.length;

    const outcome = await refundGrant(fixture.deps, refundInput(grantId, "second-key"));

    expect(outcome.kind).toBe("already_refunded");
    expect(stripe.requests.length).toBe(requestsBefore);
  });

  test("a grant the admin gave, with no paid invoice, is not refundable", async () => {
    const fixture = freshBilling(stripe);

    const { grantId } = grantApplications(fixture.db, fixture.clock, {
      idempotencyKey: "admin-grant-1",
      quantity: 5,
      source: "admin",
      userId: fixture.userId,
    });

    const outcome = await refundGrant(fixture.deps, refundInput(grantId, "admin-refund"));

    expect(outcome.kind).toBe("not_refundable");
    expect(fixture.db.select().from(grants).all()).toHaveLength(1);
  });

  test("the per-user billing view shows the period and refund state, and never card details", () => {
    const fixture = freshBilling(stripe);
    paidMonth(fixture, "in_paid_view");

    const view = billingUserView(fixture.db, fixture.clock, fixture.userId);

    expect(view?.state).toBe("paying");
    expect(view?.current?.plan).toBe("month");
    expect(view?.current?.quantity).toBe(300);
    expect(view?.refundable).toBe(true);

    const serialized = JSON.stringify(view).toLowerCase();

    for (const forbidden of ["card", "last4", "brand", "payment_method", "exp_month", "cvc"]) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
  });

  test("an unknown user has no billing view", () => {
    const fixture = freshBilling(stripe);

    expect(billingUserView(fixture.db, fixture.clock, "missing-user")).toBeNull();
  });
});
