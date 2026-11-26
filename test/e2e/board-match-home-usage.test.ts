import { AxeBuilder } from "@axe-core/playwright";

import { expect, test } from "./app.fixture.ts";

for (const theme of ["light", "dark"] as const) {
  test(`the 1280 ${theme} Applications-left element matches the home board`, async ({
    appServerUrl,
    browser,
    chromeOwnerStorage,
  }) => {
    const context = await browser.newContext({
      deviceScaleFactor: 1,
      storageState: chromeOwnerStorage,
      viewport: { height: 1000, width: 1280 },
    });

    const page = await context.newPage();

    await page.clock.setFixedTime(new Date(2026, 10, 17, 3, 0, 0));

    await page.request.post(`${appServerUrl}/api/running`, { data: { running: true } });

    if (theme === "dark") {
      await page.addInitScript(() => {
        globalThis.localStorage.setItem("overture.theme", "dark");
      });
    }

    await page.goto(`${appServerUrl}/home`);
    await expect(
      page.getByRole("heading", { level: 1, name: /Good (?:morning|afternoon|evening),/u }),
    ).toBeVisible();
    const balanceCard = page.getByTestId("sidebar-balance");

    await expect(balanceCard.getByText("Balance", { exact: true })).toBeVisible();
    await expect(balanceCard.getByText(/applications left · \d+ of 10 today/u)).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
    });

    const results = await new AxeBuilder({ page }).analyze();

    expect(results.violations).toEqual([]);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );

    expect(overflow, theme).toBe(false);

    await context.close();
  });
}
