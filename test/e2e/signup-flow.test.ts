import type { Page } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, test } from "./app.fixture.ts";
import {
  clearSinkMail,
  latestMailLink,
  setTurnstileScenario,
  sinkMailCount,
  verifyAuthState,
} from "./sign-in.ts";

const PASSWORD = "overture-pass-813";

async function waitForTurnstile(page: Page, widget: string) {
  await expect
    .poll(
      async () =>
        await page
          .locator(`[data-turnstile="${widget}"] input[name="cf-turnstile-response"]`)
          .inputValue(),
    )
    .not.toBe("");
}

test("a new user signs up on the form, verifies by mail and signs in to the app", async ({
  page,
  request,
  isolatedAppServer,
  browser,
}) => {
  const { url } = isolatedAppServer;

  await clearSinkMail(url, request);
  await setTurnstileScenario(page.request, url, { action: "signup" });

  await page.goto(`${url}/signin`);
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email").fill(authTestIdentity.ownerEmail);
  await page.getByLabel("Create a password").fill(PASSWORD);
  await waitForTurnstile(page, "password");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  expect(await sinkMailCount(url, request)).toBe(1);

  const link = await latestMailLink(url, request, authTestIdentity.ownerEmail);

  await page.goto(link);
  await expect(page.getByRole("heading", { name: "The day so far" })).toBeVisible();

  const authState = await verifyAuthState(url, request);
  const owner = authState.users.find((user) => user.email === authTestIdentity.ownerEmail);

  expect(owner?.emailVerified).toBe(true);
  expect(authState.accounts.some((account) => account.providerId === "credential")).toBe(true);
  expect(authState.sessions.filter((session) => session.userId === owner?.id)).toHaveLength(1);

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();

  await secondPage.goto(`${url}/signin`);
  await setTurnstileScenario(secondPage.request, url, { action: "signin" });
  await secondPage.getByLabel("Email").fill(authTestIdentity.ownerEmail);
  await secondPage.getByLabel("Password").fill(PASSWORD);
  await waitForTurnstile(secondPage, "password");
  await secondPage.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(secondPage.getByRole("heading", { name: "The day so far" })).toBeVisible();

  await secondContext.close();
});
