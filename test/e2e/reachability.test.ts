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
    page.getByRole("heading", { level: 1, name: /The job hunt,\s*handled\./u }),
  ).toBeVisible();

  await page.goto(`${appServerUrl}/signin`);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in to Overture" })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations).toEqual([]);
});
