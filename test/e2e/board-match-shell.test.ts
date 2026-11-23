import { AxeBuilder } from "@axe-core/playwright";

import { expect, test } from "./app.fixture.ts";

for (const width of [390, 1280] as const) {
  for (const theme of ["light", "dark"]) {
    test(`the ${String(width)} ${theme} shell matches the home board chrome`, async ({
      appServerUrl,
      browser,
      chromeOwnerStorage,
    }) => {
      const context = await browser.newContext({
        deviceScaleFactor: 1,
        storageState: chromeOwnerStorage,
        viewport: { height: 900, width },
      });

      const page = await context.newPage();

      await page.clock.setFixedTime(new Date(2026, 10, 17, 3, 0, 0));

      if (theme === "dark") {
        await page.addInitScript(() => {
          globalThis.localStorage.setItem("overture.theme", "dark");
        });
      }

      await page.request.post(`${appServerUrl}/api/running`, { data: { running: true } });

      await page.goto(`${appServerUrl}/home`);
      await expect(
        page.getByRole("heading", { level: 1, name: /Good (?:morning|afternoon|evening),/u }),
      ).toBeVisible();

      if (width === 1280) {
        await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
        await expect(page.getByText("of 70 on your plan")).toHaveCount(1);
      } else {
        await expect(page.getByRole("navigation", { name: "Quick sections" })).toBeVisible();
        await expect(page.getByText("Sending active").first()).toBeVisible();
      }

      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      const results = await new AxeBuilder({ page }).analyze();

      expect(results.violations, `${String(width)}px ${theme}`).toEqual([]);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );

      expect(overflow, `${String(width)}px ${theme}`).toBe(false);

      await context.close();
    });
  }
}
