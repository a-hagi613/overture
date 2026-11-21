import { createHmac } from "node:crypto";
import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";

const fixtureToken = (...parts: string[]) => parts.join("_");

export const BILLING_WEBHOOK_SECRET = fixtureToken("whsec", "fixture");

export const BILLING_SECRET_KEY = fixtureToken("sk", "test", "fixture");

export const BILLING_PRICE_WEEK = "price_e2e_week";

export const BILLING_PRICE_MONTH = "price_e2e_month";

export const BILLING_APP_ORIGIN = "http://localhost:3000";

export const BILLING_CUSTOMER_ID = "cus_e2e_owner";

export const DEMO_LOGIN_EMAIL = "test@email.com";

const clockSchema = z.object({ now: z.number() });

const authStateSchema = z.object({
  users: z.array(z.object({ email: z.string(), id: z.string(), role: z.string() })),
});

export async function appNowSeconds(request: APIRequestContext, appUrl: string) {
  const { now } = clockSchema.parse(await (await request.get(`${appUrl}/__test__/clock`)).json());

  return Math.trunc(now / 1000);
}

export function signPayload(payload: string, timestamp: number) {
  const signature = createHmac("sha256", BILLING_WEBHOOK_SECRET)
    .update(`${String(timestamp)}.${payload}`)
    .digest("hex");

  return `t=${String(timestamp)},v1=${signature}`;
}

export async function postWebhook(
  request: APIRequestContext,
  appUrl: string,
  payload: string,
  signature: string,
) {
  return request.post(`${appUrl}/webhooks/stripe`, {
    data: payload,
    headers: { "content-type": "application/json", "stripe-signature": signature },
  });
}

export async function signInOwner(request: APIRequestContext, appUrl: string) {
  const requested = await requestMagicLink(appUrl, request, authTestIdentity.ownerEmail);

  if (!requested.ok()) {
    throw new Error(`The magic link request failed: ${await requested.text()}`);
  }

  const link = await latestMailLink(appUrl, request, authTestIdentity.ownerEmail);

  await request.get(link);

  const state = authStateSchema.parse(
    await (await request.get(`${appUrl}/__test__/auth/state`)).json(),
  );

  const owner = state.users.find((user) => user.email === authTestIdentity.ownerEmail);

  if (owner === undefined) {
    throw new Error(`The owner did not sign in: ${JSON.stringify(state.users)}`);
  }

  return owner.id;
}

export async function signedInUserId(request: APIRequestContext, appUrl: string, email: string) {
  const state = authStateSchema.parse(
    await (await request.get(`${appUrl}/__test__/auth/state`)).json(),
  );

  const user = state.users.find((candidate) => candidate.email === email);

  if (user === undefined) {
    throw new Error(`${email} did not sign in: ${JSON.stringify(state.users)}`);
  }

  return user.id;
}
