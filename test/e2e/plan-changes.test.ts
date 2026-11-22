import { readFileSync } from "node:fs";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test } from "./app.fixture.ts";
import {
  appNowSeconds,
  BILLING_CUSTOMER_ID as CUSTOMER_ID,
  BILLING_PRICE_MONTH as PRICE_MONTH,
  BILLING_PRICE_WEEK as PRICE_WEEK,
  BILLING_SECRET_KEY as SECRET_KEY,
  BILLING_WEBHOOK_SECRET as WEBHOOK_SECRET,
  DEMO_LOGIN_EMAIL,
  postWebhook,
  signInOwner,
  signPayload,
  signedInUserId,
} from "./billing-harness.ts";
import { startStripeMock } from "./stripe-mock.fixture.ts";

const invoiceFixture = readFileSync("test/e2e/fixtures/stripe/invoice-paid.json", "utf8");

const checkoutFixture = readFileSync(
  "test/e2e/fixtures/stripe/checkout-session-completed.json",
  "utf8",
);

const subscriptionFixture = readFileSync(
  "test/e2e/fixtures/stripe/subscription-updated.json",
  "utf8",
);

const DAY_SECONDS = 86_400;

const SUBSCRIPTION_ID = "sub_e2e_plan";

const billingStateSchema = z.object({
  cancelAtPeriodEnd: z.boolean(),
  currentPeriodEnd: z.number().nullable(),
  customer: z.boolean(),
  enabled: z.boolean(),
  plan: z.enum(["week", "month"]).nullable(),
  status: z.string().nullable(),
});

const billingUrlSchema = z.object({ url: z.url() });

const webhookResultSchema = z.object({ result: z.enum(["processed", "duplicate"]) });

const homeSchema = z.object({ applicationsLeft: z.number(), planApplications: z.number() });

const grantSchema = z.object({
  expiresAt: z.number().nullable(),
  quantity: z.number(),
  source: z.string(),
  startsAt: z.number(),
  stripeInvoiceId: z.string().nullable(),
});

const billingLedgerSchema = z.object({
  applicationsLeft: z.number(),
  grants: z.array(grantSchema),
});

const clockSchema = z.object({ now: z.number() });

const stripeStateSchema = z.object({
  subscriptions: z.array(
    z.object({
      cancelAtPeriodEnd: z.boolean(),
      currentPeriodEnd: z.number(),
      currentPeriodStart: z.number(),
      plan: z.string(),
      status: z.string(),
      stripeSubscriptionId: z.string(),
      userId: z.string(),
    }),
  ),
});

interface InvoiceInput {
  plan: string;
  priceId: string;
  eventId: string;
  invoiceId: string;
  periodEnd: number;
  periodStart: number;
  userId: string;
}

function invoicePayload(input: InvoiceInput) {
  return invoiceFixture
    .replaceAll("__EVENT_ID__", input.eventId)
    .replaceAll("__INVOICE_ID__", input.invoiceId)
    .replaceAll("__USER_ID__", input.userId)
    .replaceAll("__PLAN__", input.plan)
    .replaceAll("__PRICE_ID__", input.priceId)
    .replaceAll("sub_e2e_month", SUBSCRIPTION_ID)
    .replaceAll('"__PERIOD_START__"', String(input.periodStart))
    .replaceAll('"__PERIOD_END__"', String(input.periodEnd));
}

interface SubscriptionInput {
  cancelAtPeriodEnd: boolean;
  eventId: string;
  eventType?: string;
  periodEnd: number;
  periodStart: number;
  plan: string;
  priceId: string;
  status: string;
  userId: string;
}

function subscriptionPayload(input: SubscriptionInput) {
  return subscriptionFixture
    .replaceAll("__EVENT_ID__", input.eventId)
    .replaceAll("__EVENT_TYPE__", input.eventType ?? "customer.subscription.updated")
    .replaceAll("__SUBSCRIPTION_ID__", SUBSCRIPTION_ID)
    .replaceAll("__USER_ID__", input.userId)
    .replaceAll("__CUSTOMER_ID__", CUSTOMER_ID)
    .replaceAll("__PLAN__", input.plan)
    .replaceAll("__PRICE_ID__", input.priceId)
    .replaceAll("__STATUS__", input.status)
    .replaceAll('"__CANCEL_AT_PERIOD_END__"', String(input.cancelAtPeriodEnd))
    .replaceAll('"__PERIOD_START__"', String(input.periodStart))
    .replaceAll('"__PERIOD_END__"', String(input.periodEnd));
}

async function deliver(request: APIRequestContext, appUrl: string, payload: string) {
  return postWebhook(
    request,
    appUrl,
    payload,
    signPayload(payload, await appNowSeconds(request, appUrl)),
  );
}

async function deliverProcessing(request: APIRequestContext, appUrl: string, payload: string) {
  const response = await deliver(request, appUrl, payload);

  expect(response.status()).toBe(200);
  expect(webhookResultSchema.parse(await response.json())).toStrictEqual({ result: "processed" });
}

async function homeState(request: APIRequestContext, appUrl: string) {
  return homeSchema.parse(await (await request.get(`${appUrl}/api/home`)).json());
}

async function billingState(request: APIRequestContext, appUrl: string) {
  return billingStateSchema.parse(await (await request.get(`${appUrl}/api/billing`)).json());
}

async function billingLedger(request: APIRequestContext, appUrl: string, userId: string) {
  return billingLedgerSchema.parse(
    await (await request.get(`${appUrl}/__test__/billing-state?userId=${userId}`)).json(),
  );
}

async function stripeState(request: APIRequestContext, appUrl: string) {
  return stripeStateSchema.parse(
    await (await request.get(`${appUrl}/__test__/stripe-state`)).json(),
  );
}

function clockFor(request: APIRequestContext, appUrl: string) {
  let offset = 0;

  return async (targetMs: number) => {
    const { now } = clockSchema.parse(await (await request.get(`${appUrl}/__test__/clock`)).json());

    offset += targetMs - now;

    const moved = await request.post(`${appUrl}/__test__/clock/offset`, {
      data: { offsetMs: offset },
    });

    expect(moved.status()).toBe(200);
  };
}

async function runDueJobs(request: APIRequestContext, appUrl: string) {
  expect((await request.post(`${appUrl}/__test__/jobs/run-due`)).status()).toBe(200);
}

const stripeEnvironment = {
  DEMO_LOGIN_ENABLED: "true",
  STRIPE_PRICE_MONTH: PRICE_MONTH,
  STRIPE_PRICE_WEEK: PRICE_WEEK,
  STRIPE_SECRET_KEY: SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
};

test("a trial upgrade applies at once, a Week switch lands at renewal from its price, and cancel keeps the paid period to its end", async ({
  identityServer,
  request,
}) => {
  const stripe = await startStripeMock();

  const server = await startFreshAppServer(identityServer, {
    ...stripeEnvironment,
    STRIPE_API_BASE_URL: stripe.url,
  });

  try {
    const moveClock = clockFor(request, server.url);
    const ownerId = await signInOwner(request, server.url);
    const nowSeconds = await appNowSeconds(request, server.url);
    const monthEnd = nowSeconds + 30 * DAY_SECONDS;

    const seededTrial = await request.post(`${server.url}/__test__/ledger/grant`, {
      data: {
        email: authTestIdentity.ownerEmail,
        idempotencyKey: "trial-grant:owner",
        quantity: 3,
        source: "trial",
      },
    });

    expect(seededTrial.status()).toBe(200);
    expect(await homeState(request, server.url)).toStrictEqual({
      applicationsLeft: 3,
      planApplications: 3,
    });

    const checkout = await request.post(`${server.url}/api/billing/checkout`, {
      data: { plan: "month" },
    });

    expect(checkout.status()).toBe(200);
    expect(new URLSearchParams(stripe.requests[0]?.body ?? "").get("line_items[0][price]")).toBe(
      PRICE_MONTH,
    );

    expect(await billingState(request, server.url)).toStrictEqual({
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      customer: false,
      enabled: true,
      plan: null,
      status: null,
    });

    await deliverProcessing(
      request,
      server.url,
      checkoutFixture.replaceAll("__USER_ID__", ownerId),
    );

    await deliverProcessing(
      request,
      server.url,
      invoicePayload({
        eventId: "evt_e2e_m3_245_month_paid",
        invoiceId: "in_e2e_m3_245_month",
        periodEnd: monthEnd,
        periodStart: nowSeconds,
        plan: "month",
        priceId: PRICE_MONTH,
        userId: ownerId,
      }),
    );

    expect(await homeState(request, server.url)).toStrictEqual({
      applicationsLeft: 253,
      planApplications: 253,
    });

    expect(await billingState(request, server.url)).toStrictEqual({
      cancelAtPeriodEnd: false,
      currentPeriodEnd: monthEnd * 1000,
      customer: true,
      enabled: true,
      plan: "month",
      status: "active",
    });

    const switchToWeek = subscriptionPayload({
      cancelAtPeriodEnd: false,
      eventId: "evt_e2e_m3_245_switch_week",
      periodEnd: monthEnd,
      periodStart: nowSeconds,
      plan: "week",
      priceId: PRICE_WEEK,
      status: "active",
      userId: ownerId,
    });

    await deliverProcessing(request, server.url, switchToWeek);

    const afterSwitch = await billingState(request, server.url);

    expect(afterSwitch).toStrictEqual({
      cancelAtPeriodEnd: false,
      currentPeriodEnd: monthEnd * 1000,
      customer: true,
      enabled: true,
      plan: "week",
      status: "active",
    });
    expect(await homeState(request, server.url)).toStrictEqual({
      applicationsLeft: 253,
      planApplications: 253,
    });

    const replayedSwitch = await deliver(request, server.url, switchToWeek);

    expect(replayedSwitch.status()).toBe(200);
    expect(webhookResultSchema.parse(await replayedSwitch.json())).toStrictEqual({
      result: "duplicate",
    });
    expect((await billingState(request, server.url)).plan).toBe("week");
    expect((await homeState(request, server.url)).applicationsLeft).toBe(253);

    await moveClock(monthEnd * 1000 + 60_000);
    await runDueJobs(request, server.url);

    expect(await homeState(request, server.url)).toStrictEqual({
      applicationsLeft: 3,
      planApplications: 3,
    });

    const weekEnd = monthEnd + 7 * DAY_SECONDS;

    const weekRenewal = invoicePayload({
      eventId: "evt_e2e_m3_245_week_renewal",
      invoiceId: "in_e2e_m3_245_week",
      periodEnd: weekEnd,
      periodStart: monthEnd,
      plan: "month",
      priceId: PRICE_WEEK,
      userId: ownerId,
    });

    await deliverProcessing(request, server.url, weekRenewal);

    const renewedLedger = await billingLedger(request, server.url, ownerId);

    const weekGrant = renewedLedger.grants.find(
      (grant) => grant.stripeInvoiceId === "in_e2e_m3_245_week",
    );

    expect(weekGrant).toMatchObject({ quantity: 50, source: "period" });
    expect(await homeState(request, server.url)).toStrictEqual({
      applicationsLeft: 53,
      planApplications: 53,
    });

    const cancelAtPeriodEnd = subscriptionPayload({
      cancelAtPeriodEnd: true,
      eventId: "evt_e2e_m3_245_cancel",
      periodEnd: weekEnd,
      periodStart: monthEnd,
      plan: "week",
      priceId: PRICE_WEEK,
      status: "active",
      userId: ownerId,
    });

    await deliverProcessing(request, server.url, cancelAtPeriodEnd);

    expect(await billingState(request, server.url)).toStrictEqual({
      cancelAtPeriodEnd: true,
      currentPeriodEnd: weekEnd * 1000,
      customer: true,
      enabled: true,
      plan: "week",
      status: "active",
    });

    await moveClock(weekEnd * 1000 - 3_600_000);
    await runDueJobs(request, server.url);

    expect(await homeState(request, server.url)).toStrictEqual({
      applicationsLeft: 53,
      planApplications: 53,
    });

    const replayedRenewal = await deliver(request, server.url, weekRenewal);

    expect(webhookResultSchema.parse(await replayedRenewal.json())).toStrictEqual({
      result: "duplicate",
    });
    expect((await homeState(request, server.url)).applicationsLeft).toBe(53);
    expect(
      (await billingLedger(request, server.url, ownerId)).grants.filter(
        (grant) => grant.stripeInvoiceId === "in_e2e_m3_245_week",
      ),
    ).toHaveLength(1);

    await moveClock(weekEnd * 1000 + 60_000);
    await runDueJobs(request, server.url);

    expect(await homeState(request, server.url)).toStrictEqual({
      applicationsLeft: 3,
      planApplications: 3,
    });

    await deliverProcessing(
      request,
      server.url,
      subscriptionPayload({
        cancelAtPeriodEnd: false,
        eventId: "evt_e2e_m3_245_canceled",
        eventType: "customer.subscription.deleted",
        periodEnd: weekEnd,
        periodStart: monthEnd,
        plan: "week",
        priceId: PRICE_WEEK,
        status: "canceled",
        userId: ownerId,
      }),
    );

    expect(await billingState(request, server.url)).toStrictEqual({
      cancelAtPeriodEnd: false,
      currentPeriodEnd: weekEnd * 1000,
      customer: true,
      enabled: true,
      plan: "week",
      status: "canceled",
    });

    const [stored] = (await stripeState(request, server.url)).subscriptions;

    expect(stored).toMatchObject({
      cancelAtPeriodEnd: false,
      currentPeriodEnd: weekEnd * 1000,
      currentPeriodStart: monthEnd * 1000,
      plan: "week",
      status: "canceled",
      stripeSubscriptionId: SUBSCRIPTION_ID,
      userId: ownerId,
    });

    await deliverProcessing(
      request,
      server.url,
      subscriptionPayload({
        cancelAtPeriodEnd: false,
        eventId: "evt_e2e_m3_245_stale_reactivation",
        periodEnd: weekEnd + 7 * DAY_SECONDS,
        periodStart: weekEnd,
        plan: "week",
        priceId: PRICE_WEEK,
        status: "active",
        userId: ownerId,
      }),
    );

    expect(await billingState(request, server.url)).toStrictEqual({
      cancelAtPeriodEnd: false,
      currentPeriodEnd: weekEnd * 1000,
      customer: true,
      enabled: true,
      plan: "week",
      status: "canceled",
    });

    stripe.clear();

    const portal = await request.post(`${server.url}/api/billing/portal`);

    expect(portal.status()).toBe(200);
    expect(billingUrlSchema.parse(await portal.json()).url.startsWith("https://")).toBe(true);
    expect(stripe.requests).toHaveLength(1);

    const [portalRequest] = stripe.requests;

    expect(portalRequest?.path).toBe("/v1/billing_portal/sessions");

    const portalParams = new URLSearchParams(portalRequest?.body ?? "");

    expect(portalParams.get("customer")).toBe(CUSTOMER_ID);
    expect(portalParams.get("return_url")).toBe("http://localhost:3000/settings/billing");
  } finally {
    await server.stop();
    await stripe.stop();
  }
});

test("the demo account is refused the plan state, checkout and portal without a Stripe call", async ({
  identityServer,
}) => {
  const stripe = await startStripeMock();

  const server = await startFreshAppServer(identityServer, {
    ...stripeEnvironment,
    STRIPE_API_BASE_URL: stripe.url,
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
      await signedInUserId(demo, server.url, DEMO_LOGIN_EMAIL);

      const state = await demo.get(`${server.url}/api/billing`);

      const checkout = await demo.post(`${server.url}/api/billing/checkout`, {
        data: { plan: "month" },
      });

      const portal = await demo.post(`${server.url}/api/billing/portal`);

      expect(state.status()).toBe(403);
      expect(checkout.status()).toBe(403);
      expect(portal.status()).toBe(403);
      expect(await state.json()).toMatchObject({ error: "demo_locked" });
      expect(await portal.json()).toMatchObject({ error: "demo_locked" });
      expect(stripe.requests).toHaveLength(0);
    } finally {
      await demo.dispose();
    }
  } finally {
    await server.stop();
    await stripe.stop();
  }
});

test("a subscription event that names no metadata still lands on the customer's account", async ({
  identityServer,
  request,
}) => {
  const stripe = await startStripeMock();

  const server = await startFreshAppServer(identityServer, {
    ...stripeEnvironment,
    STRIPE_API_BASE_URL: stripe.url,
  });

  try {
    const ownerId = await signInOwner(request, server.url);

    await deliverProcessing(
      request,
      server.url,
      checkoutFixture.replaceAll("__USER_ID__", ownerId),
    );

    const nowSeconds = await appNowSeconds(request, server.url);
    const periodEnd = nowSeconds + 7 * DAY_SECONDS;

    const withoutMetadata = subscriptionPayload({
      cancelAtPeriodEnd: false,
      eventId: "evt_e2e_m3_245_no_metadata",
      periodEnd,
      periodStart: nowSeconds,
      plan: "",
      priceId: PRICE_WEEK,
      status: "active",
      userId: "",
    });

    await deliverProcessing(request, server.url, withoutMetadata);

    const { subscriptions } = await stripeState(request, server.url);

    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]).toMatchObject({
      cancelAtPeriodEnd: false,
      currentPeriodEnd: periodEnd * 1000,
      currentPeriodStart: nowSeconds * 1000,
      plan: "week",
      status: "active",
      stripeSubscriptionId: SUBSCRIPTION_ID,
      userId: ownerId,
    });

    expect(await billingState(request, server.url)).toMatchObject({ plan: "week" });
  } finally {
    await server.stop();
    await stripe.stop();
  }
});
