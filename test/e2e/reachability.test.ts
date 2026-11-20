import { AxeBuilder } from "@axe-core/playwright";

import { expect, test } from "./app.fixture.ts";

test("the sign-in screen and the health route are reachable, and the screen is axe clean", async ({
  page,
  appServerUrl,
}) => {
  const health = await page.request.get(`${appServerUrl}/api/health`);

  expect(health.ok()).toBe(true);
  await expect(health.json()).resolves.toEqual({ status: "ok", database: "ok" });

  await page.goto(appServerUrl);
  await expect(page).toHaveURL(/\/signin/u);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in to Overture" })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations).toEqual([]);
});
