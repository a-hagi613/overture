import { readFileSync } from "node:fs";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";

import type { AdminAuditRow } from "../../src/server/platform/audit/index.ts";

import { openDatabase } from "../../src/server/platform/db/client.ts";
import {
  adminAudit,
  bgJobs,
  billingReconciliations,
  grants,
  ledger,
} from "../../src/server/platform/db/schema.ts";

import { createClock } from "../../src/server/platform/ports/clock.ts";
import { createStripePayments } from "../../src/server/billing/stripe.ts";
import { refundGrant, REFUND_AUDIT_ACTION } from "../../src/server/billing/refunds.ts";
import type { AppServer } from "./app-server.ts";
import type { IdentityServer } from "./identity-server-test.fixture.ts";

import { expect, startFreshAppServer, test } from "./app.fixture.ts";
import {
  appNowSeconds,
  BILLING_PRICE_MONTH,
  BILLING_PRICE_WEEK,
  BILLING_SECRET_KEY,
  BILLING_WEBHOOK_SECRET,
  postWebhook,
  signInOwner,
  signPayload,
} from "./billing-harness.ts";
import { startStripeMock } from "./stripe-mock.fixture.ts";
import type {
  StripeMock,
  StripeMockInvoiceRecord,
  StripeMockRefundRecord,
} from "./stripe-mock.fixture.ts";

const invoiceFixture = readFileSync("test/e2e/fixtures/stripe/invoice-paid.json", "utf8");

const MINUTE_SECONDS = 60;
const DAY_SECONDS = 86_400;
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

const notificationsSchema = z.object({
  notifications: z.array(z.object({ body: z.string(), kind: z.string(), title: z.string() })),
});

const alertBodySchema = z.object({ day: z.string(), mismatches: z.number() });

const detailSchema = z.object({
  items: z.array(
    z.object({
      amountCents: z.number().nullable(),
      id: z.string(),
      result: z.enum(["matched", "not_in_overture", "not_in_stripe"]),
      userId: z.string().nullable(),
    }),
  ),
  itemsTotal: z.number(),
  matched: z.number(),
  unrecorded: z.number(),
  mismatchTotal: z.number(),
  mismatches: z.array(
    z.object({
      amountCents: z.number().nullable(),
      id: z.string(),
      kind: z.string(),
    }),
  ),
});

interface InvoiceInput {
  eventId: string;
  invoiceId: string;
  userId: string;
  periodStart: number;
  periodEnd: number;
}

function invoicePayload(input: InvoiceInput) {
  return invoiceFixture
    .replaceAll("__EVENT_ID__", input.eventId)
    .replaceAll("__INVOICE_ID__", input.invoiceId)
    .replaceAll("__USER_ID__", input.userId)
    .replaceAll("__PLAN__", "month")
    .replaceAll("__PRICE_ID__", BILLING_PRICE_MONTH)
    .replaceAll('"__PERIOD_START__"', String(input.periodStart))
    .replaceAll('"__PERIOD_END__"', String(input.periodEnd));
}

async function deliverInvoice(request: APIRequestContext, appUrl: string, payload: string) {
  const response = await postWebhook(
    request,
    appUrl,
    payload,
    signPayload(payload, await appNowSeconds(request, appUrl)),
  );

  expect(response.ok()).toBe(true);
}

function paidInvoiceAt(invoiceId: string, paidAtSeconds: number) {
  return {
    amount_paid: 3500,
    created: paidAtSeconds,
    currency: "usd",
    customer: "cus_reconcile",
    id: invoiceId,
    object: "invoice",
    status: "paid",
    status_transitions: { paid_at: paidAtSeconds },
  } satisfies StripeMockInvoiceRecord;
}

function refundAt(refundId: string, createdAtSeconds: number) {
  return {
    amount: 3500,
    created: createdAtSeconds,
    currency: "usd",
    id: refundId,
    object: "refund",
    status: "succeeded",
  } satisfies StripeMockRefundRecord;
}

async function startBillingServer(identityServer: IdentityServer, stripe: StripeMock) {
  return startFreshAppServer(identityServer, {
    STRIPE_API_BASE_URL: stripe.url,
    STRIPE_PRICE_MONTH: BILLING_PRICE_MONTH,
    STRIPE_PRICE_WEEK: BILLING_PRICE_WEEK,
    STRIPE_SECRET_KEY: BILLING_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: BILLING_WEBHOOK_SECRET,
  });
}

async function runReconciliation(
  request: APIRequestContext,
  appUrl: string,
  window: { sinceMs: number; untilMs: number },
) {
  const response = await request.post(`${appUrl}/__test__/jobs/run-now`, {
    data: { kind: "billing.reconcile", payload: JSON.stringify(window) },
  });

  expect(response.ok()).toBe(true);
}

function storedDays(server: AppServer) {
  const { db, sqlite } = openDatabase(server.databasePath);

  try {
    return db
      .select()
      .from(billingReconciliations)
      .all()
      .map((row) => ({
        detail: detailSchema.parse(JSON.parse(row.detail)),
        row,
      }));
  } finally {
    sqlite.close();
  }
}

function queuedReconciles(server: AppServer) {
  const { db, sqlite } = openDatabase(server.databasePath);

  try {
    return db
      .select()
      .from(bgJobs)
      .where(and(eq(bgJobs.kind, "billing.reconcile"), eq(bgJobs.status, "queued")))
      .all();
  } finally {
    sqlite.close();
  }
}

function grantIdOfInvoice(server: AppServer, invoiceId: string) {
  const { db, sqlite } = openDatabase(server.databasePath);

  try {
    const grant = db.select().from(grants).where(eq(grants.stripeInvoiceId, invoiceId)).get();

    return grant?.id ?? null;
  } finally {
    sqlite.close();
  }
}

async function ownerNotifications(request: APIRequestContext, appUrl: string, ownerId: string) {
  const response = await request.get(`${appUrl}/__test__/notifications?userId=${ownerId}`);

  return notificationsSchema.parse(await response.json()).notifications;
}

test.describe("the daily Stripe reconciliation against stripe-mock", () => {
  let stripe: StripeMock;

  test.beforeAll(async () => {
    stripe = await startStripeMock();
  });

  test.afterAll(async () => {
    await stripe.stop();
  });

  test("a clean day is stored as clean and stays quiet, while a deliberate mismatch stores the result and alerts the owner", async ({
    identityServer,
    request,
  }) => {
    const server = await startBillingServer(identityServer, stripe);

    try {
      const ownerId = await signInOwner(request, server.url);
      const nowSeconds = await appNowSeconds(request, server.url);

      const window = {
        sinceMs: nowSeconds * 1000 - HOUR_MS,
        untilMs: nowSeconds * 1000 + HOUR_MS,
      };

      await deliverInvoice(
        request,
        server.url,
        invoicePayload({
          eventId: "evt_reconcile_clean",
          invoiceId: "in_reconcile_clean",
          periodEnd: nowSeconds + 30 * DAY_SECONDS,
          periodStart: nowSeconds,
          userId: ownerId,
        }),
      );

      stripe.seed({
        invoices: [paidInvoiceAt("in_reconcile_clean", nowSeconds - MINUTE_SECONDS)],
        refunds: [],
      });

      await runReconciliation(request, server.url, window);

      const [clean] = storedDays(server);

      expect(clean?.row.status).toBe("clean");
      expect(clean?.row.mismatches).toBe(0);
      expect(clean?.row.stripeInvoices).toBe(1);
      expect(clean?.row.stripeRefunds).toBe(0);
      expect(clean?.row.ledgerGrants).toBe(1);
      expect(clean?.detail.mismatches).toEqual([]);
      expect(clean?.detail.items).toEqual([
        { amountCents: 3500, id: "in_reconcile_clean", result: "matched", userId: ownerId },
      ]);
      expect(clean?.detail.matched).toBe(1);
      expect(clean?.detail.unrecorded).toBe(0);
      expect(clean?.detail.itemsTotal).toBe(1);
      expect(storedDays(server)).toHaveLength(1);

      expect(await ownerNotifications(request, server.url, ownerId)).toEqual([]);

      stripe.seed({
        invoices: [
          paidInvoiceAt("in_reconcile_clean", nowSeconds - MINUTE_SECONDS),
          paidInvoiceAt("in_reconcile_ghost", nowSeconds - MINUTE_SECONDS),
        ],
        refunds: [refundAt("re_reconcile_ghost", nowSeconds - MINUTE_SECONDS)],
      });

      await runReconciliation(request, server.url, window);

      const [mismatch] = storedDays(server);

      expect(mismatch?.row.status).toBe("mismatch");
      expect(mismatch?.row.mismatches).toBe(2);
      expect(mismatch?.detail.mismatchTotal).toBe(2);
      expect(mismatch?.detail.mismatches).toEqual([
        { amountCents: 3500, id: "in_reconcile_ghost", kind: "invoice_without_grant" },
        { amountCents: 3500, id: "re_reconcile_ghost", kind: "refund_without_ledger" },
      ]);
      expect(mismatch?.detail.items).toEqual([
        { amountCents: 3500, id: "in_reconcile_clean", result: "matched", userId: ownerId },
        { amountCents: 3500, id: "in_reconcile_ghost", result: "not_in_overture", userId: null },
      ]);
      expect(mismatch?.detail.matched).toBe(1);
      expect(mismatch?.detail.unrecorded).toBe(1);
      expect(mismatch?.detail.itemsTotal).toBe(2);
      expect(storedDays(server)).toHaveLength(1);

      const alerts = await ownerNotifications(request, server.url, ownerId);

      expect(alerts).toHaveLength(1);
      expect(alerts[0]?.kind).toBe("alert");
      expect(alerts[0]?.title).toContain("billing.mismatch");

      const body = alertBodySchema.parse(JSON.parse(alerts[0]?.body ?? "{}"));

      expect(body.mismatches).toBe(2);
      expect(body.day).toBe(mismatch?.row.day);

      const [queued] = queuedReconciles(server);

      if (queued === undefined) {
        throw new Error("expected a queued reconciliation");
      }

      expect(queued.runAt).toBeGreaterThan(nowSeconds * 1000);
      expect(queued.runAt % DAY_MS).toBe(10 * MINUTE_SECONDS * 1000);
    } finally {
      await server.stop();
    }
  });

  test("a paid grant Stripe does not report is a mismatch", async ({ identityServer, request }) => {
    const server = await startBillingServer(identityServer, stripe);

    try {
      const ownerId = await signInOwner(request, server.url);
      const nowSeconds = await appNowSeconds(request, server.url);

      const window = {
        sinceMs: nowSeconds * 1000 - HOUR_MS,
        untilMs: nowSeconds * 1000 + HOUR_MS,
      };

      await deliverInvoice(
        request,
        server.url,
        invoicePayload({
          eventId: "evt_reconcile_unreported",
          invoiceId: "in_reconcile_unreported",
          periodEnd: nowSeconds + 30 * DAY_SECONDS,
          periodStart: nowSeconds,
          userId: ownerId,
        }),
      );

      stripe.seed({ invoices: [], refunds: [] });

      await runReconciliation(request, server.url, window);

      const [stored] = storedDays(server);

      expect(stored?.row.status).toBe("mismatch");
      expect(stored?.detail.mismatches).toEqual([
        { amountCents: null, id: "in_reconcile_unreported", kind: "grant_without_invoice" },
      ]);
    } finally {
      await server.stop();
    }
  });

  test("a refund recorded in the ledger matches Stripe's, and a refund Stripe does not report is a mismatch", async ({
    identityServer,
    request,
  }) => {
    const server = await startBillingServer(identityServer, stripe);

    try {
      const ownerId = await signInOwner(request, server.url);
      const nowSeconds = await appNowSeconds(request, server.url);

      const window = {
        sinceMs: nowSeconds * 1000 - HOUR_MS,
        untilMs: nowSeconds * 1000 + HOUR_MS,
      };

      await deliverInvoice(
        request,
        server.url,
        invoicePayload({
          eventId: "evt_reconcile_refund",
          invoiceId: "in_reconcile_refund",
          periodEnd: nowSeconds + 30 * DAY_SECONDS,
          periodStart: nowSeconds,
          userId: ownerId,
        }),
      );

      const grantId = grantIdOfInvoice(server, "in_reconcile_refund");

      expect(grantId).not.toBeNull();

      const { db, sqlite } = openDatabase(server.databasePath);
      const shipped: AdminAuditRow[] = [];
      let refundedId: string | null = null;

      try {
        const payments = createStripePayments({
          apiBaseUrl: stripe.url,
          clock: createClock(),
          secretKey: BILLING_SECRET_KEY,
          webhookSecret: BILLING_WEBHOOK_SECRET,
        });

        const outcome = await refundGrant(
          {
            clock: createClock(),
            db,
            payments,
            shipAudit: async (row) => {
              shipped.push(row);
              await Promise.resolve();
            },
          },
          {
            actorId: "owner-1",
            amountCents: null,
            grantId: grantId ?? "",
            idempotencyKey: "reconcile-refund-1",
            note: "Charged twice in the same period",
            reason: "charged_twice",
          },
        );

        expect(outcome.kind).toBe("refunded");

        if (outcome.kind !== "refunded") {
          throw new Error("expected a refund");
        }

        refundedId = outcome.refund.refundId;

        expect(shipped.map((row) => row.action)).toEqual([REFUND_AUDIT_ACTION]);

        const refundRows = db.select().from(ledger).where(eq(ledger.kind, "refund")).all();
        const auditRows = db.select().from(adminAudit).all();

        expect(refundRows).toHaveLength(1);
        expect(auditRows).toHaveLength(1);
      } finally {
        sqlite.close();
      }

      stripe.seed({
        invoices: [paidInvoiceAt("in_reconcile_refund", nowSeconds - MINUTE_SECONDS)],
        refunds: [refundAt(refundedId, nowSeconds - MINUTE_SECONDS)],
      });

      await runReconciliation(request, server.url, window);

      const [clean] = storedDays(server);

      expect(clean?.row.status).toBe("clean");
      expect(clean?.row.stripeRefunds).toBe(1);
      expect(clean?.row.ledgerRefunds).toBe(1);

      stripe.seed({
        invoices: [paidInvoiceAt("in_reconcile_refund", nowSeconds - MINUTE_SECONDS)],
        refunds: [
          refundAt(refundedId, nowSeconds - MINUTE_SECONDS),
          refundAt("re_reconcile_unreported", nowSeconds - MINUTE_SECONDS),
        ],
      });

      await runReconciliation(request, server.url, window);

      const [mismatch] = storedDays(server);

      expect(mismatch?.row.status).toBe("mismatch");
      expect(mismatch?.detail.mismatches).toEqual([
        { amountCents: 3500, id: "re_reconcile_unreported", kind: "refund_without_ledger" },
      ]);
      expect(storedDays(server)).toHaveLength(1);
    } finally {
      await server.stop();
    }
  });

  test("an invoice paid just before the window still matches the grant recorded inside it", async ({
    identityServer,
    request,
  }) => {
    const server = await startBillingServer(identityServer, stripe);

    try {
      const ownerId = await signInOwner(request, server.url);
      const nowSeconds = await appNowSeconds(request, server.url);

      const window = {
        sinceMs: nowSeconds * 1000 - 30 * MINUTE_SECONDS * 1000,
        untilMs: nowSeconds * 1000 + 30 * MINUTE_SECONDS * 1000,
      };

      await deliverInvoice(
        request,
        server.url,
        invoicePayload({
          eventId: "evt_reconcile_slack",
          invoiceId: "in_reconcile_slack",
          periodEnd: nowSeconds + 30 * DAY_SECONDS,
          periodStart: nowSeconds,
          userId: ownerId,
        }),
      );

      stripe.seed({
        invoices: [paidInvoiceAt("in_reconcile_slack", nowSeconds - 4 * 60 * MINUTE_SECONDS)],
        refunds: [],
      });

      await runReconciliation(request, server.url, window);

      const [stored] = storedDays(server);

      expect(stored?.row.status).toBe("clean");
      expect(stored?.row.stripeInvoices).toBe(0);
      expect(stored?.row.ledgerGrants).toBe(1);
    } finally {
      await server.stop();
    }
  });
});
