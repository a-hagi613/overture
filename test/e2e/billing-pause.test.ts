import { readFileSync } from "node:fs";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test } from "./app.fixture.ts";
import {
  appNowSeconds,
  BILLING_APP_ORIGIN,
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
import { seedBoard, seedCompany, seedPosting } from "./matching-harness.ts";
import { subscriptionKeys, vapidKeyPair } from "./push.fixture.ts";
import { startStripeMock } from "./stripe-mock.fixture.ts";

const vapid = vapidKeyPair();

const paidTemplate = readFileSync("test/e2e/fixtures/stripe/invoice-paid.json", "utf8");

const failedTemplate = readFileSync("test/e2e/fixtures/stripe/invoice-payment-failed.json", "utf8");

const DAY_SECONDS = 86_400;

const homeSchema = z.object({
  applicationsLeft: z.number(),
  pauseReason: z
    .enum([
      "user",
      "onboarding",
      "no_resume",
      "plan_ended",
      "payment_failed",
      "suspended",
      "no_mailbox",
    ])
    .nullable(),
  running: z.boolean(),
});

const notificationSchema = z.object({
  body: z.string(),
  createdAt: z.number(),
  emailedAt: z.number().nullable(),
  id: z.string(),
  kind: z.string(),
  pushedAt: z.number().nullable(),
  title: z.string(),
  url: z.string(),
});

const notificationsSchema = z.object({ notifications: z.array(notificationSchema) });

const mailSchema = z.object({
  messages: z.array(z.object({ body: z.string(), subject: z.string(), to: z.string() })),
});

const pushRequestsSchema = z.object({
  requests: z.array(z.object({ url: z.string() })),
});

const ledgerRowSchema = z.object({
  amount: z.number(),
  applicationId: z.string().nullable(),
  creditAccount: z.string(),
  debitAccount: z.string(),
  grantId: z.string(),
  idempotencyKey: z.string(),
  kind: z.string(),
});

const billingStateSchema = z.object({
  applicationsLeft: z.number(),
  grants: z.array(z.object({ id: z.string() })),
  ledger: z.array(ledgerRowSchema),
});

const webhookResultSchema = z.object({ result: z.enum(["processed", "duplicate"]) });

const runDueSchema = z.object({ ran: z.number() });

const reservationSchema = z.object({ applicationsLeft: z.number(), released: z.boolean() });

interface InvoiceInput {
  eventId: string;
  invoiceId: string;
  periodEnd: number;
  periodStart: number;
  plan?: string;
  userId: string;
}

function invoicePayload(template: string, input: InvoiceInput) {
  return template
    .replaceAll("__EVENT_ID__", input.eventId)
    .replaceAll("__INVOICE_ID__", input.invoiceId)
    .replaceAll("__USER_ID__", input.userId)
    .replaceAll("__PLAN__", input.plan ?? "month")
    .replaceAll("__PRICE_ID__", BILLING_PRICE_MONTH)
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

async function homeState(request: APIRequestContext, appUrl: string) {
  return homeSchema.parse(await (await request.get(`${appUrl}/api/home`)).json());
}

async function pausedNotices(request: APIRequestContext, appUrl: string, userId: string) {
  const state = notificationsSchema.parse(
    await (
      await request.get(`${appUrl}/__test__/notifications?userId=${encodeURIComponent(userId)}`)
    ).json(),
  );

  return state.notifications.filter((row) => row.kind === "paused");
}

async function waitForPauseNoticeDelivery(
  request: APIRequestContext,
  appUrl: string,
  userId: string,
) {
  await expect
    .poll(
      async () => {
        const [notice] = await pausedNotices(request, appUrl, userId);

        return notice !== undefined && notice.pushedAt !== null && notice.emailedAt !== null;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}

async function mailTo(request: APIRequestContext, appUrl: string, to: string) {
  const mail = mailSchema.parse(await (await request.get(`${appUrl}/__test__/mail`)).json());

  return mail.messages.filter((message) => message.to === to);
}

async function runDue(request: APIRequestContext, appUrl: string) {
  return runDueSchema.parse(await (await request.post(`${appUrl}/__test__/jobs/run-due`)).json());
}

async function billingState(request: APIRequestContext, appUrl: string, userId: string) {
  return billingStateSchema.parse(
    await (
      await request.get(`${appUrl}/__test__/billing-state?userId=${encodeURIComponent(userId)}`)
    ).json(),
  );
}

async function subscribePush(
  request: APIRequestContext,
  appUrl: string,
  userId: string,
  endpoint: string,
) {
  const keys = subscriptionKeys();

  const response = await request.post(`${appUrl}/__test__/push/subscriptions`, {
    data: { endpoint, keys: { auth: keys.auth, p256dh: keys.p256dh }, userId },
  });

  expect(response.ok()).toBe(true);
}

async function setRunning(request: APIRequestContext, appUrl: string, userId: string) {
  const response = await request.post(`${appUrl}/__test__/profile/running`, {
    data: { running: true, userId },
  });

  expect(response.ok()).toBe(true);
}

async function seedApplication(
  catalog: APIRequestContext,
  appUrl: string,
  userId: string,
  email: string,
  suffix: string,
  status: "approved" | "confirming" | "sending",
  reserve = true,
) {
  const companyId = await seedCompany(catalog, `Acme ${suffix}`, `acme-${suffix}.example`);
  const boardId = await seedBoard(catalog, companyId, "greenhouse", `acme-${suffix}`);

  const postingId = await seedPosting(catalog, {
    atsJobId: `job-${suffix}`,
    boardId,
    companyId,
    title: "Platform Engineer",
    url: `https://acme-${suffix}.example/jobs/${suffix}`,
  });

  const seeded = await catalog.post(`${appUrl}/__test__/applications/seed`, {
    data: { origin: "auto", postingId, status, userId },
  });

  const applicationId = z.object({ id: z.string() }).parse(await seeded.json()).id;

  if (!reserve) {
    return applicationId;
  }

  const reserved = await catalog.post(`${appUrl}/__test__/ledger/application`, {
    data: { applicationId, commit: false, email },
  });

  expect(z.object({ reserved: z.boolean() }).parse(await reserved.json()).reserved).toBe(true);

  return applicationId;
}

test("a failed payment pauses with its own copy, a push and an email, and a paid invoice resumes", async ({
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
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_PUBLIC_KEY: vapid.publicKey,
  });

  try {
    const ownerId = await signInOwner(request, server.url);
    const { ownerEmail } = authTestIdentity;

    await setRunning(request, server.url, ownerId);
    await subscribePush(request, server.url, ownerId, "https://push.example.test/send/billing");
    await request.post(`${server.url}/__test__/mail/clear`);
    await request.post(`${server.url}/__test__/push/clear`);

    const checkout = await request.post(`${server.url}/api/billing/checkout`, {
      data: { plan: "month" },
    });

    expect(checkout.status()).toBe(200);
    expect(stripe.requests).toHaveLength(1);

    const nowSeconds = await appNowSeconds(request, server.url);

    const paid = invoicePayload(paidTemplate, {
      eventId: "evt_pause_paid_1",
      invoiceId: "in_pause_month_1",
      periodEnd: nowSeconds + 30 * DAY_SECONDS,
      periodStart: nowSeconds,
      userId: ownerId,
    });

    const firstPaid = await deliver(request, server.url, paid);

    expect(webhookResultSchema.parse(await firstPaid.json())).toStrictEqual({
      result: "processed",
    });
    expect(await homeState(request, server.url)).toMatchObject({
      applicationsLeft: 250,
      pauseReason: null,
      running: true,
    });

    const failed = invoicePayload(failedTemplate, {
      eventId: "evt_pause_failed_1",
      invoiceId: "in_pause_month_1",
      periodEnd: nowSeconds + 30 * DAY_SECONDS,
      periodStart: nowSeconds,
      userId: ownerId,
    });

    const firstFailed = await deliver(request, server.url, failed);

    expect(webhookResultSchema.parse(await firstFailed.json())).toStrictEqual({
      result: "processed",
    });
    expect(await homeState(request, server.url)).toMatchObject({
      pauseReason: "payment_failed",
      running: false,
    });

    let notices = await pausedNotices(request, server.url, ownerId);

    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      body: "Sending stays paused until the card is updated.",
      title: "Payment didn't go through.",
      url: "/",
    });

    await runDue(request, server.url);

    await waitForPauseNoticeDelivery(request, server.url, ownerId);

    notices = await pausedNotices(request, server.url, ownerId);

    expect(notices[0]?.pushedAt).not.toBeNull();
    expect(notices[0]?.emailedAt).not.toBeNull();

    const emails = await mailTo(request, server.url, ownerEmail);

    expect(emails).toHaveLength(1);
    expect(emails[0]?.subject).toBe("Your Overture payment didn't go through");
    expect(emails[0]?.body).toContain("Sending stays paused until the card is updated.");
    expect(emails[0]?.body).toContain("Update payment");
    expect(emails[0]?.body).toContain(`${BILLING_APP_ORIGIN}/settings`);
    expect(emails[0]?.body).not.toContain("failed");

    const pushes = pushRequestsSchema.parse(
      await (await request.get(`${server.url}/__test__/push/requests`)).json(),
    );

    expect(pushes.requests.map((entry) => entry.url)).toContain(
      "https://push.example.test/send/billing",
    );

    const replay = await deliver(request, server.url, failed);

    expect(webhookResultSchema.parse(await replay.json())).toStrictEqual({ result: "duplicate" });

    const repeatedFailure = await deliver(
      request,
      server.url,
      invoicePayload(failedTemplate, {
        eventId: "evt_pause_failed_2",
        invoiceId: "in_pause_month_2",
        periodEnd: nowSeconds + 60 * DAY_SECONDS,
        periodStart: nowSeconds + 30 * DAY_SECONDS,
        userId: ownerId,
      }),
    );

    expect(repeatedFailure.status()).toBe(200);
    expect(await pausedNotices(request, server.url, ownerId)).toHaveLength(1);
    expect(await mailTo(request, server.url, ownerEmail)).toHaveLength(1);

    const renewal = await deliver(
      request,
      server.url,
      invoicePayload(paidTemplate, {
        eventId: "evt_pause_paid_2",
        invoiceId: "in_pause_month_3",
        periodEnd: nowSeconds + 60 * DAY_SECONDS,
        periodStart: nowSeconds + 30 * DAY_SECONDS,
        userId: ownerId,
      }),
    );

    expect(webhookResultSchema.parse(await renewal.json())).toStrictEqual({ result: "processed" });
    expect(await homeState(request, server.url)).toMatchObject({
      pauseReason: null,
      running: true,
    });

    const pausedAgain = await deliver(
      request,
      server.url,
      invoicePayload(failedTemplate, {
        eventId: "evt_pause_failed_3",
        invoiceId: "in_pause_month_4",
        periodEnd: nowSeconds + 90 * DAY_SECONDS,
        periodStart: nowSeconds + 60 * DAY_SECONDS,
        userId: ownerId,
      }),
    );

    expect(pausedAgain.status()).toBe(200);
    expect(await homeState(request, server.url)).toMatchObject({
      pauseReason: "payment_failed",
      running: false,
    });
    expect(await pausedNotices(request, server.url, ownerId)).toHaveLength(2);
  } finally {
    await server.stop();
    await stripe.stop();
  }
});

test("the end of a plan pauses and lets an in-flight send finish, charged only if it sent", async ({
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
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_PUBLIC_KEY: vapid.publicKey,
  });

  const catalog = await apiRequest.newContext({ baseURL: server.url });

  try {
    const ownerId = await signInOwner(request, server.url);
    const { ownerEmail } = authTestIdentity;

    await setRunning(request, server.url, ownerId);
    await subscribePush(request, server.url, ownerId, "https://push.example.test/send/plan");
    await request.post(`${server.url}/__test__/mail/clear`);
    await request.post(`${server.url}/__test__/push/clear`);

    const nowSeconds = await appNowSeconds(request, server.url);
    const periodEnd = nowSeconds + 3600;

    const paid = await deliver(
      request,
      server.url,
      invoicePayload(paidTemplate, {
        eventId: "evt_plan_paid_1",
        invoiceId: "in_plan_month_1",
        periodEnd,
        periodStart: nowSeconds,
        userId: ownerId,
      }),
    );

    expect(webhookResultSchema.parse(await paid.json())).toStrictEqual({ result: "processed" });

    const sentApp = await seedApplication(
      catalog,
      server.url,
      ownerId,
      ownerEmail,
      "sent",
      "sending",
    );

    const failedApp = await seedApplication(
      catalog,
      server.url,
      ownerId,
      ownerEmail,
      "failed",
      "confirming",
    );

    expect(await homeState(request, server.url)).toMatchObject({ applicationsLeft: 248 });

    const clock = z
      .object({ now: z.number() })
      .parse(await (await request.get(`${server.url}/__test__/clock`)).json());

    await request.post(`${server.url}/__test__/clock/offset`, {
      data: { offsetMs: periodEnd * 1000 + 3600 * 1000 - clock.now },
    });

    await runDue(request, server.url);

    expect(await homeState(request, server.url)).toMatchObject({
      applicationsLeft: 0,
      pauseReason: "plan_ended",
      running: false,
    });

    let notices = await pausedNotices(request, server.url, ownerId);

    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      body: "Sending stopped when it ran out. Your queue and history are kept.",
      title: "Your plan has ended.",
      url: "/",
    });

    const heldApp = await seedApplication(
      catalog,
      server.url,
      ownerId,
      ownerEmail,
      "held",
      "approved",
      false,
    );

    await catalog.post(`${server.url}/__test__/jobs/run-now`, {
      data: { kind: "planner.day", payload: JSON.stringify({ userId: ownerId }) },
    });

    const applications = z
      .object({
        applications: z.array(z.object({ id: z.string(), scheduledFor: z.number().nullable() })),
      })
      .parse(
        await (
          await catalog.get(
            `${server.url}/__test__/applications?userId=${encodeURIComponent(ownerId)}`,
          )
        ).json(),
      );

    expect(applications.applications.find((row) => row.id === heldApp)?.scheduledFor).toBeNull();

    await runDue(request, server.url);

    await waitForPauseNoticeDelivery(request, server.url, ownerId);

    notices = await pausedNotices(request, server.url, ownerId);

    expect(notices[0]?.pushedAt).not.toBeNull();
    expect(notices[0]?.emailedAt).not.toBeNull();

    const emails = await mailTo(request, server.url, ownerEmail);

    expect(emails).toHaveLength(1);
    expect(emails[0]?.subject).toBe("Your Overture plan has ended");
    expect(emails[0]?.body).toContain("Your plan has ended.");
    expect(emails[0]?.body).toContain("Choose a plan");
    expect(emails[0]?.body).toContain(`${BILLING_APP_ORIGIN}/settings`);

    const afterExpiry = await billingState(request, server.url, ownerId);

    expect(afterExpiry.ledger.filter((row) => row.kind === "release")).toHaveLength(0);
    expect(afterExpiry.ledger.find((row) => row.kind === "expire")?.amount).toBe(248);

    await catalog.post(`${server.url}/__test__/applications/status`, {
      data: { applicationId: sentApp, status: "sent" },
    });
    await catalog.post(`${server.url}/__test__/ledger/application`, {
      data: { applicationId: sentApp, commit: true, email: ownerEmail },
    });

    const charged = await billingState(request, server.url, ownerId);

    expect(
      charged.ledger.filter((row) => row.kind === "commit" && row.applicationId === sentApp),
    ).toHaveLength(1);
    expect(charged.ledger.filter((row) => row.kind === "commit")).toHaveLength(1);

    const released = await catalog.post(`${server.url}/__test__/ledger/release`, {
      data: { applicationId: failedApp, email: ownerEmail },
    });

    expect(reservationSchema.parse(await released.json()).released).toBe(true);

    const afterRelease = await billingState(request, server.url, ownerId);

    expect(
      afterRelease.ledger.filter((row) => row.kind === "commit" && row.applicationId === failedApp),
    ).toHaveLength(0);
    expect(afterRelease.ledger.filter((row) => row.kind === "commit")).toHaveLength(1);

    const beforeSweep = z
      .object({ now: z.number(), offsetMs: z.number() })
      .parse(await (await request.get(`${server.url}/__test__/clock`)).json());

    await request.post(`${server.url}/__test__/clock/offset`, {
      data: { offsetMs: beforeSweep.offsetMs + 3600 * 1000 },
    });
    await runDue(request, server.url);

    const settled = await billingState(request, server.url, ownerId);
    const expireRows = settled.ledger.filter((row) => row.kind === "expire");

    expect(expireRows.reduce((sum, row) => sum + row.amount, 0)).toBe(249);
    expect(settled.applicationsLeft).toBe(0);

    const resume = await deliver(
      request,
      server.url,
      invoicePayload(paidTemplate, {
        eventId: "evt_plan_paid_2",
        invoiceId: "in_plan_month_2",
        periodEnd: periodEnd + 30 * DAY_SECONDS,
        periodStart: periodEnd,
        userId: ownerId,
      }),
    );

    expect(webhookResultSchema.parse(await resume.json())).toStrictEqual({ result: "processed" });
    expect(await homeState(request, server.url)).toMatchObject({
      applicationsLeft: 250,
      pauseReason: null,
      running: true,
    });
  } finally {
    await catalog.dispose();
    await server.stop();
    await stripe.stop();
  }
});

test("the demo account never pauses, notifies or calls Stripe on a failed payment", async ({
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
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_PUBLIC_KEY: vapid.publicKey,
  });

  const demo = await apiRequest.newContext({ baseURL: server.url });

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
    const before = await homeState(demo, server.url);

    await demo.post(`${server.url}/__test__/mail/clear`);
    await demo.post(`${server.url}/__test__/push/clear`);

    const nowSeconds = await appNowSeconds(demo, server.url);

    const failed = await deliver(
      demo,
      server.url,
      invoicePayload(failedTemplate, {
        eventId: "evt_demo_payment_failed",
        invoiceId: "in_demo_failed",
        periodEnd: nowSeconds + 30 * DAY_SECONDS,
        periodStart: nowSeconds,
        userId: demoId,
      }),
    );

    expect(failed.status()).toBe(200);

    expect(await homeState(demo, server.url)).toMatchObject({
      pauseReason: before.pauseReason,
      running: before.running,
    });
    expect(await pausedNotices(demo, server.url, demoId)).toHaveLength(0);

    const mail = mailSchema.parse(await (await demo.get(`${server.url}/__test__/mail`)).json());

    expect(mail.messages).toHaveLength(0);

    const pushes = pushRequestsSchema.parse(
      await (await demo.get(`${server.url}/__test__/push/requests`)).json(),
    );

    expect(pushes.requests).toHaveLength(0);

    const checkout = await demo.post(`${server.url}/api/billing/checkout`, {
      data: { plan: "month" },
    });

    expect(checkout.status()).toBe(403);
    expect(await checkout.json()).toMatchObject({ error: "demo_locked" });
    expect(stripe.requests).toHaveLength(0);
  } finally {
    await demo.dispose();
    await server.stop();
    await stripe.stop();
  }
});
