import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";

import { startFreshAppServer, expect, test } from "./app.fixture.ts";
import {
  appNowSeconds,
  BILLING_APP_ORIGIN as APP_ORIGIN,
  BILLING_CUSTOMER_ID as CUSTOMER_ID,
  BILLING_PRICE_MONTH as STRIPE_MOCK_PRICE_MONTH,
  BILLING_PRICE_WEEK as STRIPE_MOCK_PRICE_WEEK,
  BILLING_SECRET_KEY as SECRET_KEY,
  BILLING_WEBHOOK_SECRET as WEBHOOK_SECRET,
  DEMO_LOGIN_EMAIL as demoLoginEmail,
  postWebhook,
  signInOwner,
  signPayload,
} from "./billing-harness.ts";
import { serverEnvironment } from "./app-server.ts";
import { startStripeMock } from "./stripe-mock.fixture.ts";
import { authTestIdentity } from "./auth.fixture.ts";

const fixturePayload = readFileSync(
  "test/e2e/fixtures/stripe/checkout-session-completed.json",
  "utf8",
);

const billingStatusSchema = z.object({ customer: z.boolean(), enabled: z.boolean() });

const billingUrlSchema = z.object({ url: z.url() });

const webhookResultSchema = z.object({ result: z.enum(["processed", "duplicate"]) });

const stripeStateSchema = z.object({
  customers: z.array(z.object({ stripeCustomerId: z.string(), userId: z.string() })),
  events: z.array(
    z.object({
      id: z.string(),
      processedAt: z.number().nullable(),
      receivedAt: z.number(),
      type: z.string(),
    }),
  ),
});

function payloadFor(userId: string) {
  return fixturePayload.replaceAll("__USER_ID__", userId);
}

async function stripeState(request: APIRequestContext, appUrl: string) {
  return stripeStateSchema.parse(
    await (await request.get(`${appUrl}/__test__/stripe-state`)).json(),
  );
}

test("a signed event is processed once, a replay and bad signatures change nothing, and checkout and portal use Stripe", async ({
  identityServer,
  request,
}) => {
  const stripe = await startStripeMock();

  const server = await startFreshAppServer(identityServer, {
    DEMO_LOGIN_ENABLED: "true",
    STRIPE_API_BASE_URL: stripe.url,
    STRIPE_PRICE_MONTH: STRIPE_MOCK_PRICE_MONTH,
    STRIPE_PRICE_WEEK: STRIPE_MOCK_PRICE_WEEK,
    STRIPE_SECRET_KEY: SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  });

  try {
    const ownerId = await signInOwner(request, server.url);

    const before = await request.get(`${server.url}/api/billing`);

    expect(before.status()).toBe(200);
    expect(billingStatusSchema.parse(await before.json())).toStrictEqual({
      customer: false,
      enabled: true,
    });

    const checkout = await request.post(`${server.url}/api/billing/checkout`, {
      data: { plan: "month" },
    });

    expect(checkout.status()).toBe(200);

    const { url: checkoutUrl } = billingUrlSchema.parse(await checkout.json());

    expect(checkoutUrl.startsWith("https://checkout.stripe.com/")).toBe(true);
    expect(stripe.requests).toHaveLength(1);

    const [checkoutRequest] = stripe.requests;

    if (checkoutRequest === undefined) {
      throw new Error("Stripe saw no checkout request.");
    }

    expect(checkoutRequest.method).toBe("POST");
    expect(checkoutRequest.path).toBe("/v1/checkout/sessions");

    const checkoutParams = new URLSearchParams(checkoutRequest.body);

    expect(checkoutParams.get("mode")).toBe("subscription");
    expect(checkoutParams.get("line_items[0][price]")).toBe(STRIPE_MOCK_PRICE_MONTH);
    expect(checkoutParams.get("client_reference_id")).toBe(ownerId);
    expect(checkoutParams.get("metadata[user_id]")).toBe(ownerId);
    expect(checkoutParams.get("customer_email")).toBe(authTestIdentity.ownerEmail);
    expect(checkoutParams.get("success_url")).toBe(`${APP_ORIGIN}/profile/billing?billing=success`);
    expect(checkoutParams.get("cancel_url")).toBe(
      `${APP_ORIGIN}/profile/billing?billing=cancelled`,
    );

    stripe.clear();

    const earlyPortal = await request.post(`${server.url}/api/billing/portal`);

    expect(earlyPortal.status()).toBe(409);
    expect(stripe.requests).toHaveLength(0);

    const payload = payloadFor(ownerId);
    const timestamp = await appNowSeconds(request, server.url);
    const first = await postWebhook(request, server.url, payload, signPayload(payload, timestamp));

    expect(first.status()).toBe(200);
    expect(webhookResultSchema.parse(await first.json())).toStrictEqual({ result: "processed" });

    const afterFirst = await stripeState(request, server.url);

    expect(afterFirst.events).toHaveLength(1);
    expect(afterFirst.events[0]?.id).toBe("evt_e2e_checkout_completed");
    expect(afterFirst.events[0]?.type).toBe("checkout.session.completed");
    expect(afterFirst.events[0]?.processedAt).not.toBeNull();
    expect(afterFirst.customers).toStrictEqual([
      { stripeCustomerId: CUSTOMER_ID, userId: ownerId },
    ]);

    const processedAt = afterFirst.events[0]?.processedAt;

    const replay = await postWebhook(
      request,
      server.url,
      payload,
      signPayload(payload, await appNowSeconds(request, server.url)),
    );

    expect(replay.status()).toBe(200);
    expect(webhookResultSchema.parse(await replay.json())).toStrictEqual({ result: "duplicate" });

    const afterReplay = await stripeState(request, server.url);

    expect(afterReplay.events).toHaveLength(1);
    expect(afterReplay.events[0]?.processedAt).toBe(processedAt);
    expect(afterReplay.customers).toHaveLength(1);

    const tampered = payload.replace('"status": "complete"', '"status": "expired"');

    const tamperedResponse = await postWebhook(
      request,
      server.url,
      tampered,
      signPayload(payload, await appNowSeconds(request, server.url)),
    );

    expect(tamperedResponse.status()).toBe(400);
    expect(await tamperedResponse.json()).toStrictEqual({ error: "invalid_signature" });

    const stale = payload.replace("evt_e2e_checkout_completed", "evt_e2e_checkout_stale");

    const staleResponse = await postWebhook(
      request,
      server.url,
      stale,
      signPayload(stale, (await appNowSeconds(request, server.url)) - 3600),
    );

    expect(staleResponse.status()).toBe(400);

    const unsigned = await request.post(`${server.url}/webhooks/stripe`, {
      data: payload,
      headers: { "content-type": "application/json" },
    });

    expect(unsigned.status()).toBe(400);

    const oversized = await request.post(`${server.url}/webhooks/stripe`, {
      data: "x".repeat(1_000_001),
      headers: { "content-type": "application/json" },
    });

    expect(oversized.status()).toBe(413);

    const afterBad = await stripeState(request, server.url);

    expect(afterBad.events).toHaveLength(1);
    expect(afterBad.events[0]?.processedAt).toBe(processedAt);
    expect(afterBad.customers).toStrictEqual([{ stripeCustomerId: CUSTOMER_ID, userId: ownerId }]);

    const status = await request.get(`${server.url}/api/billing`);

    expect(billingStatusSchema.parse(await status.json())).toStrictEqual({
      customer: true,
      enabled: true,
    });

    stripe.clear();

    const portal = await request.post(`${server.url}/api/billing/portal`);

    expect(portal.status()).toBe(200);
    expect(billingUrlSchema.parse(await portal.json()).url.length).toBeGreaterThan(0);
    expect(stripe.requests).toHaveLength(1);

    const [portalRequest] = stripe.requests;

    if (portalRequest === undefined) {
      throw new Error("Stripe saw no portal request.");
    }

    expect(portalRequest.path).toBe("/v1/billing_portal/sessions");

    const portalParams = new URLSearchParams(portalRequest.body);

    expect(portalParams.get("customer")).toBe(CUSTOMER_ID);
    expect(portalParams.get("return_url")).toBe(`${APP_ORIGIN}/profile/billing`);

    stripe.clear();

    const demo = await apiRequest.newContext();

    const demoSignIn = await demo.post(`${server.url}/api/auth/demo/sign-in`, {
      data: { email: demoLoginEmail },
      headers: {
        "x-captcha-response": authTestIdentity.turnstilePassToken,
        "x-turnstile-action": "magiclink",
        origin: server.url,
      },
    });

    expect(demoSignIn.ok()).toBe(true);

    try {
      const demoStatus = await demo.get(`${server.url}/api/billing`);

      const demoCheckout = await demo.post(`${server.url}/api/billing/checkout`, {
        data: { plan: "week" },
      });

      const demoPortal = await demo.post(`${server.url}/api/billing/portal`);

      expect(demoStatus.status()).toBe(403);
      expect(demoCheckout.status()).toBe(403);
      expect(demoPortal.status()).toBe(403);
      expect(await demoStatus.json()).toMatchObject({ error: "demo_locked" });
      expect(await demoCheckout.json()).toMatchObject({ error: "demo_locked" });
      expect(await demoPortal.json()).toMatchObject({ error: "demo_locked" });
      expect(stripe.requests).toHaveLength(0);
    } finally {
      await demo.dispose();
    }
  } finally {
    await server.stop();
    await stripe.stop();
  }
});

test("without the Stripe pair billing is off and the app runs as in M2", async ({
  identityServer,
  request,
}) => {
  const server = await startFreshAppServer(identityServer, {
    STRIPE_API_BASE_URL: "http://127.0.0.1:1",
    STRIPE_SECRET_KEY: "",
    STRIPE_WEBHOOK_SECRET: "",
  });

  try {
    await signInOwner(request, server.url);

    const status = await request.get(`${server.url}/api/billing`);

    expect(status.status()).toBe(200);
    expect(billingStatusSchema.parse(await status.json())).toStrictEqual({
      customer: false,
      enabled: false,
    });

    const checkout = await request.post(`${server.url}/api/billing/checkout`, {
      data: { plan: "week" },
    });

    const webhook = await postWebhook(request, server.url, "{}", "t=1,v1=00");

    expect(checkout.status()).toBe(503);
    expect(await checkout.json()).toMatchObject({ error: "billing_disabled" });
    expect(webhook.status()).toBe(503);
  } finally {
    await server.stop();
  }
});

test("a half-set Stripe pair stops the server at boot and names the missing one", async () => {
  const directory = mkdtempSync(join(tmpdir(), "overture-e2e-stripe-boot-"));

  const child = spawn("bun", ["run", "src/server/main.ts"], {
    env: {
      ...serverEnvironment({ STRIPE_SECRET_KEY: SECRET_KEY, STRIPE_WEBHOOK_SECRET: "" }),
      DATABASE_URL: join(directory, "overture.db"),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });

  const outcome = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
    let stderr = "";

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("exit", (code) => {
      resolve({ code, stderr });
    });
  });

  expect(outcome.code).not.toBe(0);
  expect(outcome.stderr).toContain(
    "STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are set together or not at all",
  );
});
