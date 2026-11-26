import { AxeBuilder } from "@axe-core/playwright";
import { join } from "node:path";

import type { Browser, BrowserContext, Page } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, test } from "./app.fixture.ts";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

const desktopDestinations = [
  "Home",
  "Tracker",
  "Ready",
  "Review",
  "Resume & Cover Letter",
  "Job Preferences",
  "Application Answers",
  "Inbox",
  "Calendar",
  "Notifications",
  "Support",
];

const phoneDestinations = ["Home", "Tracker", "Ready", "Review", "Inbox"];

async function expectDestinations(
  locator: ReturnType<Page["getByRole"]>,
  destinations: readonly string[],
) {
  await Promise.all(
    destinations.map(async (destination) => {
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
  await expectDestinations(sideNav, desktopDestinations);
  await expect(
    shellPage.getByRole("navigation", { name: "Primary" }).getByRole("link", {
      name: "Home",
    }),
  ).toBeHidden();

  await shellPage
    .locator("[data-shell-sidebar]")
    .getByRole("button", { name: /Account menu/u })
    .click();
  await shellPage.getByRole("menuitem", { name: "Account settings" }).click();
  await expect(shellPage).toHaveURL(/\/profile\/account$/u);
  await expect(shellPage.getByRole("heading", { name: "Account and sign-in" })).toBeVisible();
  await expect(shellPage.getByText(authTestIdentity.ownerEmail).first()).toBeVisible();
  await expect(shellPage.getByRole("button", { name: "Sign out everywhere" })).toBeVisible();

  await shellPage.goto(`${appServerUrl}/inbox`);
  await expect(shellPage.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();

  await shellPage.goto(`${appServerUrl}/missing-route`);
  await expect(shellPage.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();

  await desktop.close();
});

test("the phone shows a slim header and five direct tab destinations, with no popup menus", async ({
  browser,
  appServerUrl,
  ownerStorageState,
}) => {
  const context = await browser.newContext({ storageState: ownerStorageState });
  const shellPage = await context.newPage();

  await shellPage.setViewportSize({ width: 390, height: 844 });
  await openShell(shellPage, appServerUrl, "light");

  const sideNav = shellPage.getByRole("navigation", { name: "Main" });
  const tabBar = shellPage.getByRole("navigation", { name: "Primary" });
  const header = shellPage.locator("[data-mobile-header]");

  await expect(tabBar).toBeVisible();
  await expectDestinations(tabBar, phoneDestinations);
  await expect(tabBar.getByRole("button")).toHaveCount(0);
  await expect(header).toBeVisible();
  await expect(header.getByText("Home", { exact: true })).toBeVisible();
  await expect(header.getByRole("button", { name: "Search" })).toHaveCSS("width", "44px");
  await expect(header.getByRole("link", { name: "Notifications" })).toHaveAttribute(
    "href",
    "/notifications",
  );
  await expect(header.getByRole("link", { name: "Profile" })).toHaveAttribute("href", "/profile");
  await expect(sideNav).toBeHidden();

  await shellPage.setViewportSize({ width: 1280, height: 900 });
  await expect(sideNav).toBeVisible();
  await expect(tabBar).toBeHidden();
  await expect(header).toBeHidden();

  await context.close();
});

test("the phone header and tab bar reach search, notifications, the profile hub and every destination in one tap", async ({
  browser,
  appServerUrl,
  ownerStorageState,
}) => {
  const context = await browser.newContext({ storageState: ownerStorageState });
  const shellPage = await context.newPage();

  await shellPage.setViewportSize({ width: 390, height: 844 });
  await openShell(shellPage, appServerUrl, "light");

  const header = shellPage.locator("[data-mobile-header]");
  const tabBar = shellPage.getByRole("navigation", { name: "Primary" });

  await header.getByRole("button", { name: "Search" }).click();
  await expect(shellPage.getByPlaceholder("Search applications, reviews, emails")).toBeVisible();
  await shellPage.keyboard.press("Escape");

  await header.getByRole("link", { name: "Profile" }).click();
  await expect(shellPage).toHaveURL(/\/profile$/u);
  await expect(shellPage.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible();
  await expect(header.getByText("Profile", { exact: true })).toBeVisible();

  const hub = shellPage.getByRole("navigation", { name: "Profile sections" });

  await Promise.all(
    [
      "Resume & Cover Letter",
      "Job Preferences",
      "Application Answers",
      "Billing",
      "Account settings",
      "Support",
    ].map(async (label) => {
      await expect(hub.getByRole("link", { name: label })).toBeVisible();
    }),
  );

  await expect(hub.getByRole("switch", { name: "Switch to dark mode" })).toBeVisible();
  await expect(hub.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(shellPage.getByText("Applications left", { exact: true })).toBeVisible();
  await shellPage.getByRole("link", { name: "Job Preferences" }).click();
  await expect(shellPage).toHaveURL(/\/profile\/preferences$/u);

  await tabBar.getByRole("link", { name: "Tracker" }).click();
  await expect(shellPage).toHaveURL(/\/tracker$/u);
  await expect(
    shellPage.getByRole("heading", { level: 1, name: "Application Tracker" }),
  ).toBeVisible();
  await expect(header.getByText("Tracker", { exact: true })).toBeVisible();

  await shellPage.goto(`${appServerUrl}/applications?from=legacy`);
  await expect(shellPage).toHaveURL(/\/tracker\?from=legacy$/u);

  await shellPage.goto(`${appServerUrl}/board?card=abc`);
  await expect(shellPage).toHaveURL(/\/tracker\?application=abc$/u);

  await shellPage.goto(`${appServerUrl}/calendar?month=2026-11`);
  await expect(shellPage).toHaveURL(/\/calendar\?month=2026-11$/u);
  await expect(shellPage.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
  await expect(header.getByText("Calendar", { exact: true })).toBeVisible();

  await shellPage.goto(`${appServerUrl}/search?q=platform`);
  await expect(shellPage).toHaveURL(/\/tracker\?q=platform$/u);

  await shellPage.setViewportSize({ width: 1280, height: 900 });
  await shellPage.goto(`${appServerUrl}/profile`);
  await expect(shellPage).toHaveURL(/\/profile\/resume$/u);

  await context.close();
});

test("the navigation, phone header, profile hub and Applications page render at 390 and 1280", async ({
  browser,
  appServerUrl,
  ownerStorageState,
}) => {
  const sizes = [
    { theme: "light", width: 390 },
    { theme: "dark", width: 390 },
    { theme: "light", width: 1280 },
    { theme: "dark", width: 1280 },
  ] as const;

  await Promise.all(
    sizes.map(async ({ theme, width }) => {
      const context = await browser.newContext({
        storageState: ownerStorageState,
        viewport: { height: 844, width },
      });

      if (theme === "dark") {
        await context.addInitScript(() => {
          globalThis.localStorage.setItem("overture.theme", "dark");
        });
      }

      const page = await context.newPage();

      await page.goto(`${appServerUrl}/home`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await page.screenshot({
        path: join(process.cwd(), `test/e2e/.tmp/nav-home-${String(width)}-${theme}.png`),
      });

      await page.goto(`${appServerUrl}/tracker`);
      await expect(
        page.getByRole("heading", { level: 1, name: "Application Tracker" }),
      ).toBeVisible();
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await page.screenshot({
        path: join(process.cwd(), `test/e2e/.tmp/nav-applications-${String(width)}-${theme}.png`),
      });

      if (width === 390) {
        await page.goto(`${appServerUrl}/profile`);
        await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible();
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        await page.screenshot({
          path: join(process.cwd(), `test/e2e/.tmp/nav-profile-hub-${String(width)}-${theme}.png`),
        });
      }

      await context.close();
    }),
  );
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
