import { AxeBuilder } from "@axe-core/playwright";

import { expect, test } from "./app.fixture.ts";

test("the shell page and the health route are reachable, and the page is axe clean", async ({
  page,
  appServerUrl,
}) => {
  const health = await page.request.get(`${appServerUrl}/api/health`);

  expect(health.ok()).toBe(true);
  await expect(health.json()).resolves.toEqual({ status: "ok", database: "ok" });

  await page.goto(appServerUrl);
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations).toEqual([]);
});
