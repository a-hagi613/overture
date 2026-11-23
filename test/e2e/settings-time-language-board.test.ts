import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";

import type { APIRequestContext, Browser, Page } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { seedUnreadNotifications } from "./notification-seed.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";

const test = appTest.extend<{ boardServer: AppServer }>({
  boardServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

async function seedOwner(request: APIRequestContext, appServerUrl: string) {
  await requestMagicLink(appServerUrl, request, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, request, authTestIdentity.ownerEmail);

  await request.get(link);

  await seedUnreadNotifications(request, appServerUrl);

  const seeded = await request.put("/api/profile/settings", {
    data: { languages: ["en"], timezone: "America/Toronto" },
  });

  if (!seeded.ok()) {
    throw new Error(`settings seed failed: ${String(seeded.status())}`);
  }
}

async function openSettings(page: Page, appServerUrl: string, theme: string) {
  if (theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  await page.goto(`${appServerUrl}/profile/account`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("settings-time-language")).toBeVisible();
  await page.evaluate(async () => document.fonts.ready);
}

async function expectCardMatchesBoard(
  browser: Browser,
  appServerUrl: string,
  width: number,
  theme: string,
) {
  const request = await apiRequest.newContext({ baseURL: appServerUrl });

  await seedOwner(request, appServerUrl);

  const storageState = await request.storageState();

  await request.dispose();

  const context = await browser.newContext({ deviceScaleFactor: 1, storageState });
  const page = await context.newPage();

  await page.setViewportSize({ width, height: width === 1280 ? 1800 : 1200 });
  await openSettings(page, appServerUrl, theme);

  const card = page.getByTestId("settings-time-language");

  const cardStyles = await card.evaluate((element) => {
    const style = getComputedStyle(element);

    return {
      borderRadius: style.borderTopLeftRadius,
      borderTopWidth: style.borderTopWidth,
      paddingBottom: style.paddingBottom,
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight,
      paddingTop: style.paddingTop,
    };
  });

  expect(cardStyles.borderRadius).toBe("12px");
  expect(cardStyles.borderTopWidth).toBe("1px");

  if (width === 1280) {
    expect(cardStyles.paddingTop).toBe("24px");
    expect(cardStyles.paddingRight).toBe("24px");
    expect(cardStyles.paddingBottom).toBe("24px");
    expect(cardStyles.paddingLeft).toBe("24px");
  } else {
    expect(cardStyles.paddingTop).toBe("20px");
    expect(cardStyles.paddingRight).toBe("20px");
    expect(cardStyles.paddingBottom).toBe("20px");
    expect(cardStyles.paddingLeft).toBe("20px");
  }

  const heading = card.getByRole("heading", { level: 2 });

  await expect(heading).toHaveText("Time and language");

  const headingStyles = await heading.evaluate((element) => {
    const style = getComputedStyle(element);

    return {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
    };
  });

  expect(headingStyles.fontFamily).toContain("Instrument Serif");

  await expect(page.getByTestId("settings-time-zone-row")).toBeVisible();
  await expect(page.getByTestId("settings-posting-languages-row")).toBeVisible();

  const select = card.getByLabel("Time zone");

  expect(await select.inputValue()).toBe("America/Toronto");

  const english = card.getByRole("button", { name: "English" });
  const french = card.getByRole("button", { name: "French" });
  const englishRect = await english.boundingBox();

  if (englishRect === null) {
    throw new Error("the English chip has no box");
  }

  if (width < 768) {
    expect(Math.round(englishRect.height)).toBeGreaterThanOrEqual(44);
  }

  expect(await english.getAttribute("aria-pressed")).toBe("true");
  expect(await french.getAttribute("aria-pressed")).toBe("false");

  const { violations } = await new AxeBuilder({ page })
    .include('[data-testid="settings-time-language"]')
    .analyze();

  expect(violations).toEqual([]);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );

  expect(overflow).toBe(false);

  await context.close();
}

for (const width of [390, 1280] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`the Time and language card matches the ${String(width)} ${theme} board`, async ({
      boardServer,
      browser,
    }) => {
      await expectCardMatchesBoard(browser, boardServer.url, width, theme);
    });
  }
}
