import { AxeBuilder } from "@axe-core/playwright";

import { expect, test } from "./app.fixture.ts";

test("the sidebar Settings submenu opens by mouse and keyboard, and Escape returns focus", async ({
  browser,
  appServerUrl,
  ownerStorageState,
}) => {
  const context = await browser.newContext({ storageState: ownerStorageState });
  const page = await context.newPage();

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${appServerUrl}/`);
  await expect(page.getByRole("heading", { name: "The day so far" })).toBeVisible();

  const aside = page.locator("aside");
  const toggle = aside.getByRole("button", { name: "Show settings pages" });

  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(aside.getByRole("link", { name: "Export" })).toBeHidden();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(aside.getByRole("link", { name: "Export" })).toBeVisible();

  await page.keyboard.press("ArrowDown");
  await expect(aside.getByRole("link", { name: "Profile data" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(aside.getByRole("link", { name: "Terms and privacy" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  await toggle.click();
  await aside.getByRole("link", { name: "Export" }).click();
  await expect(page).toHaveURL(/\/settings\/export/u);
  await expect(aside.getByRole("link", { name: "Export" })).toHaveAttribute("aria-current", "page");

  const results = await new AxeBuilder({ page }).include("aside").analyze();

  expect(results.violations).toEqual([]);

  await context.close();
});

test("the Settings row opens the account page, and /settings/terms lands on the terms page", async ({
  browser,
  appServerUrl,
  ownerStorageState,
}) => {
  const context = await browser.newContext({ storageState: ownerStorageState });
  const page = await context.newPage();

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${appServerUrl}/`);
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Settings" })
    .click();
  await expect(page).toHaveURL(/\/settings$/u);

  await page.goto(`${appServerUrl}/settings/terms`);
  await expect(page).toHaveURL(/\/terms$/u);

  await context.close();
});
