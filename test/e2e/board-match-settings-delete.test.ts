import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";

import type { APIRequestContext, Browser, Locator, Page } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
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
  await request.post(`${appServerUrl}/__test__/user/name`, {
    data: { email: authTestIdentity.ownerEmail, name: authTestIdentity.ownerName },
  });
}

async function expectNoHorizontalScroll(page: Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));

  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
}

const REAUTH_WINDOW_MS = 15 * 60 * 1000;

async function setClockOffset(appServerUrl: string, offsetMs: number) {
  await fetch(`${appServerUrl}/__test__/clock/offset`, {
    body: JSON.stringify({ offsetMs }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function expectButtonInteractive(page: Page, button: Locator) {
  expect(await button.evaluate((element) => getComputedStyle(element).cursor)).toBe("pointer");

  await page.mouse.move(0, 0);
  const rest = await button.evaluate((element) => getComputedStyle(element).backgroundColor);

  await button.hover();
  await expect
    .poll(async () => button.evaluate((element) => getComputedStyle(element).backgroundColor), {
      timeout: 1500,
    })
    .not.toBe(rest);

  await button.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");

  const outline = await button.evaluate((element) => {
    const style = getComputedStyle(element);

    return { style: style.outlineStyle, width: style.outlineWidth };
  });

  expect(outline.style).not.toBe("none");
  expect(outline.width).not.toBe("0px");
}

async function expectButtonsAreInteractive(page: Page) {
  await expectButtonInteractive(page, page.getByRole("button", { name: "Delete account" }));

  await page.getByRole("button", { name: "Delete account" }).click();
  await expect(page.getByRole("heading", { name: "This erases everything" })).toBeVisible();

  await expectButtonInteractive(
    page,
    page.getByRole("button", { name: "Email me a sign-in link", exact: true }),
  );
  await expectButtonInteractive(page, page.getByRole("button", { name: "Cancel", exact: true }));

  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
}

async function expectDeleteBoard(
  browser: Browser,
  appServerUrl: string,
  width: number,
  theme: string,
) {
  const request = await apiRequest.newContext({ baseURL: appServerUrl });

  await seedOwner(request, appServerUrl);

  const storage = await request.storageState();

  await request.dispose();

  const context = await browser.newContext({
    deviceScaleFactor: 1,
    storageState: storage,
    viewport: { height: 900, width },
  });

  const page = await context.newPage();

  if (theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  await setClockOffset(appServerUrl, REAUTH_WINDOW_MS + 1);

  await page.goto(`${appServerUrl}/settings/delete`);
  await expect(page).toHaveURL(/\/profile\/account/u);
  await expect(page.getByRole("heading", { level: 1, name: "Account Settings" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Danger zone" })).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const { violations } = await new AxeBuilder({ page }).analyze();

  expect(violations).toEqual([]);

  await expectNoHorizontalScroll(page);
  await expectButtonsAreInteractive(page);

  await expect(
    page.getByText("Deleting needs a fresh sign-in. We email you a link that works once."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await setClockOffset(appServerUrl, 0);
  await page.reload();
  await page.getByRole("button", { name: "Delete account" }).click();

  const confirmButton = page.getByRole("button", { name: "Permanently delete account" });

  await expect(confirmButton).toBeDisabled();
  await page.getByLabel("I understand my data is erased").check();
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();
  await expect(page.getByText("Erasing your account")).toBeVisible();

  await context.close();
}

test("the delete page has no horizontal overflow at every breakpoint", async ({
  boardServer,
  browser,
}) => {
  const request = await apiRequest.newContext({ baseURL: boardServer.url });

  await seedOwner(request, boardServer.url);

  const storage = await request.storageState();

  await request.dispose();

  await Promise.all(
    [390, 768, 1280, 1920, 2560].map(async (width) => {
      const context = await browser.newContext({
        deviceScaleFactor: 1,
        storageState: storage,
        viewport: { height: 900, width },
      });

      const page = await context.newPage();

      await page.goto(`${boardServer.url}/settings/delete`);
      await expect(page).toHaveURL(/\/profile\/account/u);
      await expect(page.getByRole("heading", { level: 2, name: "Danger zone" })).toBeVisible();
      await expectNoHorizontalScroll(page);

      await context.close();
    }),
  );
});

for (const width of [390, 1280] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`the delete account states match the ${String(width)} ${theme} board`, async ({
      boardServer,
      browser,
    }) => {
      await expectDeleteBoard(browser, boardServer.url, width, theme);
    });
  }
}
