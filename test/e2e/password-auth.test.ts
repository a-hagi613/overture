import type { APIRequestContext } from "@playwright/test";

import { z } from "zod";

import { authTestIdentity, personas } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test } from "./app.fixture.ts";
import {
  askPasswordReset,
  clearSinkMail,
  latestMailLink,
  setTurnstileScenario,
  signInWithPassword,
  signUpWithPassword,
  sinkMailCount,
  verifyAuthState,
} from "./sign-in.ts";

const errorSchema = z.object({ code: z.string() });

async function repeat(times: number, attempt: () => Promise<void>) {
  if (times === 0) {
    return;
  }

  await attempt();
  await repeat(times - 1, attempt);
}

async function verifyByMail(url: string, request: APIRequestContext) {
  const link = await latestMailLink(url, request, authTestIdentity.ownerEmail);

  await request.get(link);
}

test("an unverified password account cannot sign in or start a run until it verifies", async ({
  page,
  request,
  isolatedAppServer,
}) => {
  const { url } = isolatedAppServer;
  const password = "overture-pass-813";

  await setTurnstileScenario(request, url, { action: "signup" });

  const created = await signUpWithPassword(url, request, {
    email: authTestIdentity.ownerEmail,
    password,
  });

  expect(created.ok()).toBe(true);

  const state = await verifyAuthState(url, request);
  const owner = state.users.find((user) => user.email === authTestIdentity.ownerEmail);

  expect(owner?.emailVerified).toBe(false);
  expect(state.sessions.filter((session) => session.userId === owner?.id)).toEqual([]);
  expect((await request.post(`${url}/api/running`, { data: { running: true } })).status()).toBe(
    401,
  );

  await setTurnstileScenario(request, url, { action: "signin" });

  const refused = await signInWithPassword(url, request, {
    email: authTestIdentity.ownerEmail,
    password,
  });

  expect(refused.status()).toBe(403);
  expect((await verifyAuthState(url, request)).sessions).toEqual([]);

  await verifyByMail(url, request);

  const signedIn = await signInWithPassword(url, page.request, {
    email: authTestIdentity.ownerEmail,
    password,
  });

  expect(signedIn.ok()).toBe(true);

  const running = await page.request.post(`${url}/api/running`, { data: { running: true } });

  expect(running.ok()).toBe(true);

  await page.goto(`${url}/`);
  await expect(page.getByRole("heading", { name: "The day so far" })).toBeVisible();
});

test("the verify screen sends the verification email again", async ({
  page,
  request,
  isolatedAppServer,
}) => {
  const { url } = isolatedAppServer;

  await clearSinkMail(url, request);
  await setTurnstileScenario(page.request, url, { action: "signup" });
  await page.goto(`${url}/signin`);
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email").fill(authTestIdentity.ownerEmail);
  await page.getByLabel("Create a password").fill("overture-pass-813");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  expect(await sinkMailCount(url, request)).toBe(1);

  await setTurnstileScenario(page.request, url, { action: "signup" });
  await page.getByRole("button", { name: "Send the email again" }).click();
  await expect.poll(async () => await sinkMailCount(url, request)).toBe(2);
});

test("forgot and reset set a new password and sign in with it", async ({
  page,
  request,
  isolatedAppServer,
}) => {
  const { url } = isolatedAppServer;
  const oldPassword = "overture-pass-813";
  const newPassword = "overture-pass-814";

  await setTurnstileScenario(request, url, { action: "signup" });
  await signUpWithPassword(url, request, {
    email: authTestIdentity.ownerEmail,
    password: oldPassword,
  });
  await verifyByMail(url, request);
  await clearSinkMail(url, request);

  await page.goto(`${url}/forgot-password`);
  await page.getByLabel("Email").fill(authTestIdentity.ownerEmail);
  await setTurnstileScenario(page.request, url, { action: "reset" });
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(
    page.getByText("If an account exists for this email, the link is on its way."),
  ).toBeVisible();

  const link = await latestMailLink(url, page.request, authTestIdentity.ownerEmail);

  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  await expect(page.getByText(authTestIdentity.ownerEmail)).toBeVisible();

  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByLabel("Confirm new password").fill(newPassword);
  await setTurnstileScenario(page.request, url, { action: "reset" });
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByText("Password saved. Sign in with your new password.")).toBeVisible();

  await setTurnstileScenario(page.request, url, { action: "signin" });
  await page.getByLabel("Email").fill(authTestIdentity.ownerEmail);
  await page.getByLabel("Password").fill(newPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "The day so far" })).toBeVisible();

  const oldAttempt = await signInWithPassword(url, page.request, {
    email: authTestIdentity.ownerEmail,
    password: oldPassword,
  });

  expect(oldAttempt.status()).toBe(401);
});

test("password rules refuse a short or breached password", async ({
  request,
  isolatedAppServer,
}) => {
  const { url } = isolatedAppServer;

  await setTurnstileScenario(request, url, { action: "signup" });

  const short = await signUpWithPassword(url, request, {
    email: authTestIdentity.ownerEmail,
    password: "short1234",
  });

  expect(short.status()).toBe(400);
  expect(errorSchema.parse(await short.json()).code).toBe("PASSWORD_TOO_SHORT");

  const breached = await signUpWithPassword(url, request, {
    email: authTestIdentity.ownerEmail,
    password: "password123",
  });

  expect(breached.status()).toBe(400);
  expect(errorSchema.parse(await breached.json()).code).toBe("PASSWORD_COMPROMISED");
  expect((await verifyAuthState(url, request)).users).toEqual([]);
});

test("sign-up, sign-in and reset ask limits hold", async ({ request, isolatedAppServer }) => {
  const { url } = isolatedAppServer;

  await setTurnstileScenario(request, url, { action: "signup" });

  await repeat(5, async () => {
    const response = await signUpWithPassword(url, request, {
      email: authTestIdentity.ownerEmail,
      password: "overture-pass-813",
    });

    expect(response.ok()).toBe(true);
  });

  const overSignUp = await signUpWithPassword(url, request, {
    email: authTestIdentity.ownerEmail,
    password: "overture-pass-813",
  });

  expect(overSignUp.status()).toBe(429);

  await setTurnstileScenario(request, url, { action: "signin" });

  await repeat(10, async () => {
    const response = await signInWithPassword(url, request, {
      email: "limited.signin@example.com",
      password: "overture-pass-813",
    });

    expect(response.status()).toBe(403);
  });

  const overSignIn = await signInWithPassword(url, request, {
    email: "limited.signin@example.com",
    password: "overture-pass-813",
  });

  expect(overSignIn.status()).toBe(429);

  await setTurnstileScenario(request, url, { action: "reset" });

  await repeat(3, async () => {
    expect((await askPasswordReset(url, request, "limited.reset@example.com")).ok()).toBe(true);
  });

  expect((await askPasswordReset(url, request, "limited.reset@example.com")).status()).toBe(429);

  const state = await verifyAuthState(url, request);

  expect(state.users.map((user) => user.email)).toEqual([authTestIdentity.ownerEmail]);
  expect(state.users[0]?.emailVerified).toBe(false);
});

test("a provider never links to an unverified password email; it replaces the unproven registration", async ({
  page,
  request,
  identityServer,
}) => {
  const appServer = await startFreshAppServer(identityServer);
  const { url } = appServer;

  try {
    await setTurnstileScenario(request, url, { action: "signup" });
    await signUpWithPassword(url, request, {
      email: authTestIdentity.ownerEmail,
      password: "attacker-password-1",
    });
    await setTurnstileScenario(request, url, { action: "signin" });
    await identityServer.setPersona(personas.owner("google-unverified-link"));
    await page.goto(`${url}/signin`);
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page.getByRole("heading", { name: "The day so far" })).toBeVisible();

    const state = await verifyAuthState(url, request);
    const owner = state.users.filter((user) => user.email === authTestIdentity.ownerEmail);

    expect(owner).toHaveLength(1);
    expect(owner[0]?.emailVerified).toBe(true);
    expect(
      state.accounts
        .filter((account) => account.userId === owner[0]?.id)
        .map((account) => account.providerId),
    ).toEqual(["google"]);
    expect(state.sessions.filter((session) => session.userId === owner[0]?.id)).toHaveLength(1);

    await setTurnstileScenario(request, url, { action: "signin" });

    const attacker = await signInWithPassword(url, request, {
      email: authTestIdentity.ownerEmail,
      password: "attacker-password-1",
    });

    expect(attacker.ok()).toBe(false);
  } finally {
    await appServer.stop();
  }
});
