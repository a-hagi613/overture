import { AxeBuilder } from "@axe-core/playwright";

import { expect, test } from "./app.fixture.ts";

test("the health route is reachable, and a visitor at / sees the public landing, not the app", async ({
  page,
  appServerUrl,
}) => {
  const health = await page.request.get(`${appServerUrl}/api/health`);

  expect(health.ok()).toBe(true);
  await expect(health.json()).resolves.toEqual({ status: "ok", database: "ok" });

  await page.goto(appServerUrl);
  await expect(page).toHaveURL(`${appServerUrl}/`);
  await expect(
    page.getByRole("heading", { level: 1, name: /Overture prepares every application/u }),
  ).toBeVisible();

  await page.goto(`${appServerUrl}/signin`);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in to Overture" })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations).toEqual([]);
});

test("the forgot and reset screens are reachable and axe clean", async ({ page, appServerUrl }) => {
  await page.goto(`${appServerUrl}/forgot-password`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Forgot your password?" }),
  ).toBeVisible();

  const forgot = await new AxeBuilder({ page }).analyze();

  expect(forgot.violations).toEqual([]);

  await page.goto(`${appServerUrl}/reset-password?token=not-a-token`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Choose a new password" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("That reset link is used or expired.");

  const reset = await new AxeBuilder({ page }).analyze();

  expect(reset.violations).toEqual([]);
});
