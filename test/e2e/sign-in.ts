import { z } from "zod";

import type { APIRequestContext, Page } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";

const mailListSchema = z.object({
  messages: z.array(
    z.object({
      body: z.string(),
      to: z.string(),
    }),
  ),
});

const authStateSchema = z.object({
  users: z.array(
    z.object({
      email: z.string(),
      emailVerified: z.boolean(),
      id: z.string(),
      role: z.string(),
    }),
  ),
  accounts: z.array(z.object({ providerId: z.string(), userId: z.string() })),
  sessions: z.array(z.object({ id: z.string(), userId: z.string() })),
});

const sentMailListSchema = z.object({ messages: z.array(z.unknown()) });

export async function clearSinkMail(appServerUrl: string, request: APIRequestContext) {
  await request.post(`${appServerUrl}/__test__/mail/clear`);
}

export async function requestMagicLink(
  appServerUrl: string,
  request: APIRequestContext,
  email: string,
) {
  return request.post(`${appServerUrl}/api/auth/sign-in/magic-link`, {
    data: { email, callbackURL: "/signin" },
    headers: {
      "x-captcha-response": authTestIdentity.turnstilePassToken,
      "x-turnstile-action": "magiclink",
      origin: appServerUrl,
    },
  });
}

export interface TurnstileScenario {
  action: "signin" | "signup" | "magiclink";
  hostname?: string;
  outcome?: "pass" | "replay" | "error";
}

export async function setTurnstileScenario(
  request: APIRequestContext,
  appServerUrl: string,
  scenario: TurnstileScenario,
) {
  const response = await request.post(`${appServerUrl}/__test__/turnstile`, { data: scenario });

  if (!response.ok()) {
    throw new Error(`Setting the Turnstile scenario failed with ${String(response.status())}.`);
  }
}

export async function latestMailLink(appServerUrl: string, request: APIRequestContext, to: string) {
  const response = await request.get(`${appServerUrl}/__test__/mail`);
  const { messages } = mailListSchema.parse(await response.json());
  const message = messages.findLast((sent) => sent.to === to);

  if (message === undefined) {
    throw new Error(`No sink mail addressed to ${to}.`);
  }

  const linkPattern = /https?:\/\/[^\s]+|\/api\/auth\/[^\s]+/u;
  const link = linkPattern.exec(message.body)?.[0];

  if (link === undefined) {
    throw new Error(`No sign-in link found in the mail to ${to}.`);
  }

  return link.startsWith("/") ? `${appServerUrl}${link}` : link;
}

export async function sinkMailCount(appServerUrl: string, request: APIRequestContext) {
  const response = await request.get(`${appServerUrl}/__test__/mail`);

  return sentMailListSchema.parse(await response.json()).messages.length;
}

export async function verifyAuthState(appServerUrl: string, request: APIRequestContext) {
  const response = await request.get(`${appServerUrl}/__test__/auth/state`);

  return authStateSchema.parse(await response.json());
}

export async function signInByMagicLink(
  page: Page,
  appServerUrl: string,
  request: APIRequestContext,
  email: string,
) {
  await clearSinkMail(appServerUrl, request);
  await requestMagicLink(appServerUrl, request, email);

  const link = await latestMailLink(appServerUrl, request, email);

  await page.goto(link);
}
