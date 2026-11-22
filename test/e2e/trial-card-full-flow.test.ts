import { createHmac } from "node:crypto";

import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test } from "./app.fixture.ts";
import { startStripeMock } from "./stripe-mock.fixture.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";

const fixtureToken = (...parts: string[]) => parts.join("_");
const WEBHOOK_SECRET = fixtureToken("whsec", "trial");
const SECRET_KEY = fixtureToken("sk", "test", "trial");
const CARD_SECRET = "e2e-card-fingerprint-secret-0123456789";
const demoLoginEmail = "test@email.com";

const sessionSchema = z.object({ user: z.object({ id: z.string() }) });
const homeSchema = z.object({ applicationsLeft: z.number() });
const trialSchema = z.object({ result: z.literal("granted"), applications: z.literal(3) });
const webhookResultSchema = z.object({ result: z.enum(["processed", "duplicate"]) });
const setupSchema = z.object({ url: z.url() });
const clockSchema = z.object({ now: z.number() });

async function signedHeader(request: APIRequestContext, appUrl: string, payload: string) {
  const timestamp = Math.trunc(
    clockSchema.parse(await (await request.get(`${appUrl}/__test__/clock`)).json()).now / 1000,
  );

  const signature = createHmac("sha256", WEBHOOK_SECRET)
    .update(`${String(timestamp)}.${payload}`)
    .digest("hex");

  return `t=${String(timestamp)},v1=${signature}`;
}

function setupEventPayload(eventId: string, sessionId: string, userId: string) {
  return JSON.stringify({
    id: eventId,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        client_reference_id: userId,
        customer: null,
        metadata: { user_id: userId },
        mode: "setup",
        status: "complete",
      },
    },
  });
}

async function signIn(request: APIRequestContext, appUrl: string, email: string) {
  const requested = await requestMagicLink(appUrl, request, email);

  if (!requested.ok()) {
    throw new Error(`The magic link request failed: ${await requested.text()}`);
  }

  await request.get(await latestMailLink(appUrl, request, email));

  const session = sessionSchema.parse(
    await (await request.get(`${appUrl}/api/auth/get-session`)).json(),
  );

  return session.user.id;
}

async function applicationsLeft(request: APIRequestContext, appUrl: string) {
  return homeSchema.parse(await (await request.get(`${appUrl}/api/home`)).json()).applicationsLeft;
}

test("a fresh account has no Applications until a verified trial card is recorded", async ({
  identityServer,
  request,
}) => {
  const stripe = await startStripeMock();

  const server = await startFreshAppServer(identityServer, {
    CARD_FINGERPRINT_SECRET: CARD_SECRET,
    STRIPE_API_BASE_URL: stripe.url,
    STRIPE_SECRET_KEY: SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  });

  try {
    await signIn(request, server.url, authTestIdentity.ownerEmail);

    expect(await applicationsLeft(request, server.url)).toBe(0);

    const setup = await request.post(`${server.url}/api/billing/trial/setup`);

    expect(setup.status()).toBe(200);
    expect(setupSchema.parse(await setup.json()).url.startsWith("https://")).toBe(true);
    expect(stripe.requests.some((r) => r.path === "/v1/checkout/sessions")).toBe(true);
  } finally {
    await server.stop();
    await stripe.stop();
  }
});

test("a signed setup-mode webhook grants the trial and enables preparation, once", async ({
  identityServer,
  request,
}) => {
  const stripe = await startStripeMock();

  const server = await startFreshAppServer(identityServer, {
    CARD_FINGERPRINT_SECRET: CARD_SECRET,
    STRIPE_API_BASE_URL: stripe.url,
    STRIPE_SECRET_KEY: SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  });

  try {
    const userId = await signIn(request, server.url, authTestIdentity.ownerEmail);

    stripe.stubVerifiedSetupSession({
      fingerprint: "fp_trial_e2e_card_a",
      id: "cs_setup_e2e_hook",
      userId,
    });

    const payload = setupEventPayload("evt_setup_e2e_hook", "cs_setup_e2e_hook", userId);

    const headers = {
      "content-type": "application/json",
      "stripe-signature": await signedHeader(request, server.url, payload),
    };

    const first = await request.post(`${server.url}/webhooks/stripe`, { data: payload, headers });

    expect(first.status()).toBe(200);
    expect(webhookResultSchema.parse(await first.json()).result).toBe("processed");
    expect(await applicationsLeft(request, server.url)).toBe(3);

    const replay = await request.post(`${server.url}/webhooks/stripe`, { data: payload, headers });

    expect(webhookResultSchema.parse(await replay.json()).result).toBe("duplicate");
    expect(await applicationsLeft(request, server.url)).toBe(3);

    const forged = await request.post(`${server.url}/webhooks/stripe`, {
      data: payload,
      headers: { ...headers, "stripe-signature": "t=1,v1=00" },
    });

    expect(forged.status()).toBe(400);
  } finally {
    await server.stop();
    await stripe.stop();
  }
});

test("the card check grants once and the demo account is locked before any Stripe call", async ({
  identityServer,
  request,
}) => {
  const stripe = await startStripeMock();

  const server = await startFreshAppServer(identityServer, {
    CARD_FINGERPRINT_SECRET: CARD_SECRET,
    DEMO_LOGIN_ENABLED: "true",
    STRIPE_API_BASE_URL: stripe.url,
    STRIPE_SECRET_KEY: SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  });

  try {
    const ownerId = await signIn(request, server.url, authTestIdentity.ownerEmail);

    stripe.stubVerifiedSetupSession({
      fingerprint: "fp_trial_e2e_card_b",
      id: "cs_setup_e2e_owner",
      userId: ownerId,
    });

    const granted = await request.post(`${server.url}/api/billing/trial/verify`, {
      data: { sessionId: "cs_setup_e2e_owner" },
    });

    expect(granted.status()).toBe(200);
    expect(trialSchema.parse(await granted.json())).toEqual({ applications: 3, result: "granted" });

    stripe.clear();

    const demo = await apiRequest.newContext();

    try {
      const demoSignIn = await demo.post(`${server.url}/api/auth/demo/sign-in`, {
        data: { email: demoLoginEmail },
        headers: {
          "x-captcha-response": authTestIdentity.turnstilePassToken,
          "x-turnstile-action": "magiclink",
          origin: server.url,
        },
      });

      expect(demoSignIn.ok()).toBe(true);

      const demoSetup = await demo.post(`${server.url}/api/billing/trial/setup`);

      const demoVerify = await demo.post(`${server.url}/api/billing/trial/verify`, {
        data: { sessionId: "cs_setup_e2e_demo" },
      });

      expect(demoSetup.status()).toBe(403);
      expect(demoVerify.status()).toBe(403);
      expect(await demoSetup.json()).toMatchObject({ error: "demo_locked" });
      expect(await demoVerify.json()).toMatchObject({ error: "demo_locked" });
      expect(stripe.requests).toHaveLength(0);
    } finally {
      await demo.dispose();
    }
  } finally {
    await server.stop();
    await stripe.stop();
  }
});
