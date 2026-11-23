import { AxeBuilder } from "@axe-core/playwright";
import { join } from "node:path";

import type { Browser, BrowserContext, Page } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, test } from "./app.fixture.ts";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

const desktopDestinations = ["Home", "Tracker", "Ready", "Review", "Inbox", "Calendar", "Profile"];

async function expectDesktopDestinations(locator: ReturnType<Page["getByRole"]>) {
  await Promise.all(
    desktopDestinations.map(async (destination) => {
      await expect(locator.getByRole("link", { name: destination }).first()).toBeVisible();
    }),
  );
}

async function openShell(page: Page, appServerUrl: string, theme: string) {
  if (theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  await page.goto(`${appServerUrl}/home`);
  await expect(
    page.getByRole("heading", { level: 1, name: /Good (?:morning|afternoon|evening),/u }),
  ).toBeVisible();
}

async function expectShellAxeClean(
  browser: Browser,
  storageState: StorageState,
  appServerUrl: string,
  width: number,
  theme: string,
) {
  const context = await browser.newContext({ storageState });
  const shellPage = await context.newPage();

  await shellPage.setViewportSize({ width, height: 844 });
  await openShell(shellPage, appServerUrl, theme);

  const results = await new AxeBuilder({ page: shellPage }).analyze();

  expect(results.violations, `${String(width)}px ${theme}`).toEqual([]);
  await shellPage.screenshot({
    fullPage: true,
    path: join(process.cwd(), `test/e2e/.tmp/shell-${String(width)}-${theme}.png`),
  });

  await context.close();
}

test("the shell lists workspace destinations on desktop and navigates to Account, Inbox, and 404", async ({
  browser,
  appServerUrl,
  ownerStorageState,
}) => {
  const desktop = await browser.newContext({ storageState: ownerStorageState });
  const shellPage = await desktop.newPage();

  await shellPage.setViewportSize({ width: 1280, height: 900 });
  await openShell(shellPage, appServerUrl, "light");

  const sideNav = shellPage.getByRole("navigation", { name: "Main" });

  await expect(sideNav).toBeVisible();
  await expectDesktopDestinations(sideNav);
  await expect(
    shellPage.getByRole("navigation", { name: "Quick sections" }).getByRole("link", {
      name: "Home",
    }),
  ).toBeHidden();

  await sideNav.getByRole("link", { name: "Profile" }).hover();
  await sideNav.getByRole("menuitem", { name: "Account" }).click();
  await expect(shellPage).toHaveURL(/\/profile\/account$/u);
  await expect(shellPage.getByRole("heading", { name: "Account and sign-in" })).toBeVisible();
  await expect(shellPage.getByText(authTestIdentity.ownerEmail).first()).toBeVisible();
  await expect(shellPage.getByRole("button", { name: "Sign out everywhere" })).toBeVisible();

  await shellPage.goto(`${appServerUrl}/inbox`);
  await expect(shellPage.getByRole("heading", { level: 1, name: "Employer Inbox" })).toBeVisible();

  await shellPage.goto(`${appServerUrl}/missing-route`);
  await expect(shellPage.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();

  await desktop.close();
});

test("the shell shows the phone tab bar at 390 and the desktop rail at 1280", async ({
  page,
  appServerUrl,
  ownerStorageState,
}) => {
  const context = await page.context().browser()?.newContext({ storageState: ownerStorageState });

  if (context === undefined) {
    throw new Error("A shell context could not be opened.");
  }

  const shellPage = await context.newPage();

  await shellPage.setViewportSize({ width: 390, height: 844 });
  await openShell(shellPage, appServerUrl, "light");

  const sideNav = shellPage.getByRole("navigation", { name: "Main" });
  const tabBar = shellPage.getByRole("navigation", { name: "Quick sections" });

  await expect(tabBar).toBeVisible();
  await expect(tabBar.getByRole("link", { name: "Home" })).toBeVisible();
  await expect(tabBar.getByRole("button", { name: "Tracker" })).toBeVisible();
  await expect(tabBar.getByRole("button", { name: "Profile" })).toBeVisible();
  await expect(tabBar.getByRole("button", { name: "More" })).toBeVisible();
  await expect(sideNav).toBeHidden();

  await shellPage.setViewportSize({ width: 1280, height: 900 });
  await expect(sideNav).toBeVisible();
  await expect(tabBar).toBeHidden();

  await context.close();
});

test("the shell is axe clean at 390 and 1280 in light and dark", async ({
  browser,
  appServerUrl,
  ownerStorageState,
}) => {
  await expectShellAxeClean(browser, ownerStorageState, appServerUrl, 390, "light");
  await expectShellAxeClean(browser, ownerStorageState, appServerUrl, 390, "dark");
  await expectShellAxeClean(browser, ownerStorageState, appServerUrl, 1280, "light");
  await expectShellAxeClean(browser, ownerStorageState, appServerUrl, 1280, "dark");
});

test("a keyboard user can skip the shell to the main content", async ({
  browser,
  appServerUrl,
  ownerStorageState,
}) => {
  const context = await browser.newContext({ storageState: ownerStorageState });
  const shellPage = await context.newPage();

  await shellPage.setViewportSize({ width: 1280, height: 900 });
  await openShell(shellPage, appServerUrl, "light");

  const skipLink = shellPage.getByRole("link", { name: "Skip to content" });

  await expect(skipLink).toHaveCount(1);

  await shellPage.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeInViewport();

  await shellPage.keyboard.press("Enter");
  await expect(shellPage.locator("main#main-content")).toBeFocused();

  await context.close();
});
