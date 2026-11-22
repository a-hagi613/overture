import { readFileSync } from "node:fs";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test } from "./app.fixture.ts";
import {
  appNowSeconds,
  BILLING_PRICE_MONTH,
  BILLING_PRICE_WEEK,
  BILLING_SECRET_KEY,
  BILLING_WEBHOOK_SECRET,
  DEMO_LOGIN_EMAIL,
  postWebhook,
  signInOwner,
  signPayload,
  signedInUserId,
} from "./billing-harness.ts";
import { startStripeMock } from "./stripe-mock.fixture.ts";

const invoiceFixture = readFileSync("test/e2e/fixtures/stripe/invoice-paid.json", "utf8");

const DAY_SECONDS = 86_400;

const billingUrlSchema = z.object({ url: z.url() });

const webhookResultSchema = z.object({ result: z.enum(["processed", "duplicate"]) });

const homeSchema = z.object({
  applicationsLeft: z.number(),
  planApplications: z.number(),
});

const grantSchema = z.object({
  expiresAt: z.number().nullable(),
  id: z.string(),
  quantity: z.number(),
  source: z.string(),
  startsAt: z.number(),
  stripeInvoiceId: z.string().nullable(),
});

const ledgerSchema = z.object({
  amount: z.number(),
  applicationId: z.string().nullable(),
  creditAccount: z.string(),
  debitAccount: z.string(),
  grantId: z.string(),
  id: z.string(),
  idempotencyKey: z.string(),
  kind: z.string(),
});

const billingStateSchema = z.object({
  applicationsLeft: z.number(),
  grants: z.array(grantSchema),
  ledger: z.array(ledgerSchema),
});

const runDueSchema = z.object({ ran: z.number() });

const reservationSchema = z.object({ applicationsLeft: z.number(), reserved: z.boolean() });

interface InvoiceInput {
  eventId: string;
  invoiceId: string;
  userId: string;
  periodStart: number;
  periodEnd: number;
  plan?: string;
}

function invoicePayload(input: InvoiceInput) {
  return invoiceFixture
    .replaceAll("__EVENT_ID__", input.eventId)
    .replaceAll("__INVOICE_ID__", input.invoiceId)
    .replaceAll("__USER_ID__", input.userId)
    .replaceAll("__PLAN__", input.plan ?? "month")
    .replaceAll("__PRICE_ID__", BILLING_PRICE_MONTH)
    .replaceAll('"__PERIOD_START__"', String(input.periodStart))
    .replaceAll('"__PERIOD_END__"', String(input.periodEnd));
}

async function deliverInvoice(request: APIRequestContext, appUrl: string, payload: string) {
  return postWebhook(
    request,
    appUrl,
    payload,
    signPayload(payload, await appNowSeconds(request, appUrl)),
  );
}

async function homeState(request: APIRequestContext, appUrl: string) {
  return homeSchema.parse(await (await request.get(`${appUrl}/api/home`)).json());
}

async function billingState(request: APIRequestContext, appUrl: string, userId: string) {
  return billingStateSchema.parse(
    await (await request.get(`${appUrl}/__test__/billing-state?userId=${userId}`)).json(),
  );
}

async function waitForExpirySweep(request: APIRequestContext, appUrl: string, userId: string) {
  await expect
    .poll(
      async () => {
        const { ledger } = await billingState(request, appUrl, userId);

        return {
          expire: ledger.some((row) => row.kind === "expire"),
          release: ledger.some((row) => row.kind === "release"),
        };
      },
      { timeout: 30_000 },
    )
    .toStrictEqual({ expire: true, release: true });
}

async function reserveApplication(
  request: APIRequestContext,
  appUrl: string,
  input: { applicationId: string; commit: boolean; email: string },
) {
  return reservationSchema.parse(
    await (
      await request.post(`${appUrl}/__test__/ledger/application`, {
        data: input,
      })
    ).json(),
  );
}

test("a paid month grants 300, a replay grants once, expiry releases then expires, and renewal grants the next period", async ({
  identityServer,
  request,
}) => {
  const stripe = await startStripeMock();

  const server = await startFreshAppServer(identityServer, {
    STRIPE_API_BASE_URL: stripe.url,
    STRIPE_PRICE_MONTH: BILLING_PRICE_MONTH,
    STRIPE_PRICE_WEEK: BILLING_PRICE_WEEK,
    STRIPE_SECRET_KEY: BILLING_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: BILLING_WEBHOOK_SECRET,
  });

  try {
    const ownerId = await signInOwner(request, server.url);
    const { ownerEmail } = authTestIdentity;
    const nowSeconds = await appNowSeconds(request, server.url);
    const firstPeriodEnd = nowSeconds + 30 * DAY_SECONDS;

    const checkout = await request.post(`${server.url}/api/billing/checkout`, {
      data: { plan: "month" },
    });

    expect(checkout.status()).toBe(200);
    expect(
      billingUrlSchema.parse(await checkout.json()).url.startsWith("https://checkout.stripe.com/"),
    ).toBe(true);
    expect(stripe.requests).toHaveLength(1);

    const checkoutParams = new URLSearchParams(stripe.requests[0]?.body ?? "");

    expect(checkoutParams.get("line_items[0][price]")).toBe(BILLING_PRICE_MONTH);
    expect(checkoutParams.get("metadata[plan]")).toBe("month");
    expect(checkoutParams.get("subscription_data[metadata][plan]")).toBe("month");
    expect(checkoutParams.get("client_reference_id")).toBe(ownerId);
    expect(checkoutParams.get("subscription_data[metadata][user_id]")).toBe(ownerId);

    expect((await homeState(request, server.url)).applicationsLeft).toBe(0);

    const firstInvoice = invoicePayload({
      eventId: "evt_e2e_invoice_paid_1",
      invoiceId: "in_e2e_month_1",
      periodEnd: firstPeriodEnd,
      periodStart: nowSeconds,
      userId: ownerId,
    });

    const paid = await deliverInvoice(request, server.url, firstInvoice);

    expect(paid.status()).toBe(200);
    expect(webhookResultSchema.parse(await paid.json())).toStrictEqual({ result: "processed" });

    const afterPaid = await homeState(request, server.url);

    expect(afterPaid).toStrictEqual({ applicationsLeft: 300, planApplications: 300 });

    const granted = await billingState(request, server.url, ownerId);

    expect(granted.grants).toHaveLength(1);
    expect(granted.grants[0]).toMatchObject({
      expiresAt: firstPeriodEnd * 1000,
      quantity: 300,
      source: "period",
      stripeInvoiceId: "in_e2e_month_1",
    });
    expect(granted.grants[0]?.startsAt).toBeGreaterThanOrEqual(nowSeconds * 1000);

    const replay = await deliverInvoice(request, server.url, firstInvoice);

    expect(replay.status()).toBe(200);
    expect(webhookResultSchema.parse(await replay.json())).toStrictEqual({ result: "duplicate" });
    expect((await homeState(request, server.url)).applicationsLeft).toBe(300);
    expect((await billingState(request, server.url, ownerId)).grants).toHaveLength(1);

    const held = await reserveApplication(request, server.url, {
      applicationId: "app-expiring",
      commit: false,
      email: ownerEmail,
    });

    expect(held).toStrictEqual({ applicationsLeft: 299, reserved: true });

    const sent = await reserveApplication(request, server.url, {
      applicationId: "app-sent",
      commit: true,
      email: ownerEmail,
    });

    expect(sent).toStrictEqual({ applicationsLeft: 298, reserved: true });

    const clock = z
      .object({ now: z.number() })
      .parse(await (await request.get(`${server.url}/__test__/clock`)).json());

    await request.post(`${server.url}/__test__/clock/offset`, {
      data: { offsetMs: firstPeriodEnd * 1000 + 60_000 - clock.now },
    });

    expect((await homeState(request, server.url)).applicationsLeft).toBe(0);

    const swept = await request.post(`${server.url}/__test__/jobs/run-due`);

    expect(swept.ok()).toBe(true);
    runDueSchema.parse(await swept.json());

    const [firstGrant] = granted.grants;
    const grantId = firstGrant?.id ?? "";

    await waitForExpirySweep(request, server.url, ownerId);

    const expired = await billingState(request, server.url, ownerId);

    const reserveRow = expired.ledger.find(
      (row) => row.kind === "reserve" && row.applicationId === "app-expiring",
    );

    const releaseRow = expired.ledger.find((row) => row.kind === "release");
    const expireRow = expired.ledger.find((row) => row.kind === "expire");

    expect(reserveRow).toBeDefined();
    expect(releaseRow?.applicationId).toBe("app-expiring");
    expect(releaseRow?.idempotencyKey).toBe(`expire-release:${reserveRow?.id ?? ""}`);
    expect(expireRow).toMatchObject({
      amount: 299,
      applicationId: null,
      creditAccount: "expired",
      debitAccount: "available",
      grantId,
      idempotencyKey: `expire:${grantId}`,
    });
    expect(expired.applicationsLeft).toBe(0);

    const secondPeriodEnd = firstPeriodEnd + 30 * DAY_SECONDS;

    const renewal = invoicePayload({
      eventId: "evt_e2e_invoice_paid_2",
      invoiceId: "in_e2e_month_2",
      periodEnd: secondPeriodEnd,
      periodStart: firstPeriodEnd,
      userId: ownerId,
    });

    const renewed = await deliverInvoice(request, server.url, renewal);

    expect(renewed.status()).toBe(200);
    expect(webhookResultSchema.parse(await renewed.json())).toStrictEqual({ result: "processed" });

    const afterRenewal = await homeState(request, server.url);

    expect(afterRenewal).toStrictEqual({ applicationsLeft: 300, planApplications: 300 });

    const renewedState = await billingState(request, server.url, ownerId);

    expect(renewedState.grants).toHaveLength(2);
    expect(renewedState.grants.map((grant) => grant.stripeInvoiceId)).toStrictEqual([
      "in_e2e_month_1",
      "in_e2e_month_2",
    ]);

    const fallback = invoicePayload({
      eventId: "evt_e2e_invoice_paid_3",
      invoiceId: "in_e2e_month_3",
      periodEnd: secondPeriodEnd + 30 * DAY_SECONDS,
      periodStart: secondPeriodEnd,
      plan: "annual",
      userId: ownerId,
    });

    const fallbackPaid = await deliverInvoice(request, server.url, fallback);

    expect(fallbackPaid.status()).toBe(200);
    expect(webhookResultSchema.parse(await fallbackPaid.json())).toStrictEqual({
      result: "processed",
    });

    const fallbackState = await billingState(request, server.url, ownerId);

    expect(fallbackState.grants).toHaveLength(3);
    expect(fallbackState.grants[2]).toMatchObject({
      quantity: 300,
      source: "period",
      stripeInvoiceId: "in_e2e_month_3",
    });

    stripe.clear();

    const week = await request.post(`${server.url}/api/billing/checkout`, {
      data: { plan: "week" },
    });

    expect(week.status()).toBe(200);
    expect(new URLSearchParams(stripe.requests[0]?.body ?? "").get("line_items[0][price]")).toBe(
      BILLING_PRICE_WEEK,
    );
  } finally {
    await server.stop();
    await stripe.stop();
  }
});

test("the demo account is locked out of checkout with no Stripe call and never receives a period grant", async ({
  identityServer,
}) => {
  const stripe = await startStripeMock();

  const server = await startFreshAppServer(identityServer, {
    DEMO_LOGIN_ENABLED: "true",
    STRIPE_API_BASE_URL: stripe.url,
    STRIPE_PRICE_MONTH: BILLING_PRICE_MONTH,
    STRIPE_PRICE_WEEK: BILLING_PRICE_WEEK,
    STRIPE_SECRET_KEY: BILLING_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: BILLING_WEBHOOK_SECRET,
  });

  try {
    const demo = await apiRequest.newContext();

    try {
      const signIn = await demo.post(`${server.url}/api/auth/demo/sign-in`, {
        data: { email: DEMO_LOGIN_EMAIL },
        headers: {
          "x-captcha-response": authTestIdentity.turnstilePassToken,
          "x-turnstile-action": "magiclink",
          origin: server.url,
        },
      });

      expect(signIn.ok()).toBe(true);

      const demoId = await signedInUserId(demo, server.url, DEMO_LOGIN_EMAIL);
      const before = await billingState(demo, server.url, demoId);

      const week = await demo.post(`${server.url}/api/billing/checkout`, {
        data: { plan: "week" },
      });

      const month = await demo.post(`${server.url}/api/billing/checkout`, {
        data: { plan: "month" },
      });

      expect(week.status()).toBe(403);
      expect(month.status()).toBe(403);
      expect(await week.json()).toMatchObject({ error: "demo_locked" });
      expect(await month.json()).toMatchObject({ error: "demo_locked" });
      expect(stripe.requests).toHaveLength(0);

      const nowSeconds = await appNowSeconds(demo, server.url);

      const invoice = invoicePayload({
        eventId: "evt_e2e_demo_invoice_paid",
        invoiceId: "in_e2e_demo_month",
        periodEnd: nowSeconds + 30 * DAY_SECONDS,
        periodStart: nowSeconds,
        userId: demoId,
      });

      const paid = await deliverInvoice(demo, server.url, invoice);

      expect(paid.status()).toBe(200);

      const after = await billingState(demo, server.url, demoId);

      expect(after.applicationsLeft).toBe(before.applicationsLeft);
      expect(after.grants.filter((grant) => grant.source === "period")).toHaveLength(0);
      expect(stripe.requests).toHaveLength(0);
    } finally {
      await demo.dispose();
    }
  } finally {
    await server.stop();
    await stripe.stop();
  }
});

test("a plan with no configured price is refused before any Stripe call", async ({
  identityServer,
  request,
}) => {
  const stripe = await startStripeMock();

  const server = await startFreshAppServer(identityServer, {
    STRIPE_API_BASE_URL: stripe.url,
    STRIPE_PRICE_MONTH: BILLING_PRICE_MONTH,
    STRIPE_PRICE_WEEK: "",
    STRIPE_SECRET_KEY: BILLING_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: BILLING_WEBHOOK_SECRET,
  });

  try {
    await signInOwner(request, server.url);

    const week = await request.post(`${server.url}/api/billing/checkout`, {
      data: { plan: "week" },
    });

    expect(week.status()).toBe(503);
    expect(await week.json()).toMatchObject({ error: "billing_not_configured" });
    expect(stripe.requests).toHaveLength(0);
  } finally {
    await server.stop();
    await stripe.stop();
  }
});
