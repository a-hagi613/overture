import { AxeBuilder } from "@axe-core/playwright";

import { expect, test } from "./app.fixture.ts";

test("the sidebar Profile submenu opens on hover and navigates to Account cleanly", async ({
  browser,
  appServerUrl,
  ownerStorageState,
}) => {
  const context = await browser.newContext({ storageState: ownerStorageState });
  const page = await context.newPage();

  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto(`${appServerUrl}/home`);
  await expect(
    page.getByRole("heading", { level: 1, name: /Good (?:morning|afternoon|evening),/u }),
  ).toBeVisible();

  const aside = page.locator("aside");
  const profileLink = aside.getByRole("link", { name: "Profile" });

  await expect(profileLink).toHaveAttribute("aria-expanded", "false");
  await profileLink.hover();
  await expect(profileLink).toHaveAttribute("aria-expanded", "true");

  await Promise.all(
    ["Resume & Cover Letter", "Personal Details", "Job Preferences", "Billing", "Account"].map(
      async (item) => {
        await expect(aside.getByRole("menuitem", { name: item })).toBeVisible();
      },
    ),
  );

  await aside.getByRole("menuitem", { name: "Account" }).click();
  await expect(page).toHaveURL(/\/profile\/account$/u);
  await expect(page.getByRole("heading", { level: 1, name: "Account Settings" })).toBeVisible();

  const results = await new AxeBuilder({ page }).include("aside").analyze();

  expect(results.violations).toEqual([]);

  await context.close();
});

for (const width of [390, 1280]) {
  test(`the Profile Account Settings screen causes no horizontal overflow at ${String(width)}px`, async ({
    browser,
    appServerUrl,
    ownerStorageState,
  }) => {
    const context = await browser.newContext({ storageState: ownerStorageState });
    const page = await context.newPage();

    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${appServerUrl}/profile/account`);
    await expect(page.getByRole("heading", { level: 1, name: "Account Settings" })).toBeVisible();

    if (width >= 1280) {
      await page.locator("aside").getByRole("link", { name: "Profile" }).hover();
    }

    const overflow = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));

    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);

    await context.close();
  });
}
