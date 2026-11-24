import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { AxeBuilder } from "@axe-core/playwright";
import { expect, request as apiRequest } from "@playwright/test";

import type { Browser } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";
import { startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";

const SCREENSHOT_DIR = "/tmp/m3-244-screenshots";
const CARD_SECRET = "e2e-card-fingerprint-secret-0123456789";

const test = appTest.extend<{ trialServer: { url: string } }>({
  trialServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer, {
        CARD_FINGERPRINT_SECRET: CARD_SECRET,
        STRIPE_API_BASE_URL: "http://127.0.0.1:1",
        STRIPE_PRICE_MONTH: "price_e2e_month",
        STRIPE_PRICE_WEEK: "price_e2e_week",
        STRIPE_SECRET_KEY: ["sk", "test", "ui"].join("_"),
        STRIPE_WEBHOOK_SECRET: ["whsec", "ui"].join("_"),
      });

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

async function ownerStorageState(appUrl: string) {
  const api = await apiRequest.newContext({ baseURL: appUrl });

  const requested = await requestMagicLink(appUrl, api, authTestIdentity.ownerEmail);

  expect(requested.ok()).toBe(true);
  await api.get(await latestMailLink(appUrl, api, authTestIdentity.ownerEmail));

  const storageState = await api.storageState();

  await api.dispose();

  return storageState;
}

async function openTrialPage(
  browser: Browser,
  storageState: Awaited<ReturnType<typeof ownerStorageState>>,
  width: number,
  theme: "light" | "dark",
) {
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    storageState,
    viewport: { height: width === 1280 ? 900 : 844, width },
  });

  const page = await context.newPage();

  await page.addInitScript((value: string) => {
    globalThis.localStorage.setItem("overture.theme", value);
  }, theme);

  return { context, page };
}

for (const width of [390, 1280, 2560]) {
  for (const theme of ["light", "dark"] as const) {
    test(`the trial page at ${String(width)}px ${theme} has no overflow and passes axe`, async ({
      browser,
      trialServer,
    }) => {
      const storageState = await ownerStorageState(trialServer.url);
      const { context, page } = await openTrialPage(browser, storageState, width, theme);

      await page.goto(`${trialServer.url}/onboarding/trial`);

      await expect(
        page.getByRole("heading", {
          level: 1,
          name: /Verify a card for your three free Applications/u,
        }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Verify card" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Verify card" })).toBeDisabled();
      await expect(page.getByRole("checkbox")).not.toBeChecked();

      await page.evaluate(async () => document.fonts.ready);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );

      expect(overflow, `horizontal overflow at ${String(width)}px ${theme}`).toBeLessThanOrEqual(0);

      const results = await new AxeBuilder({ page }).analyze();

      expect(results.violations, `axe at ${String(width)}px ${theme}`).toEqual([]);

      await context.close();
    });
  }
}

for (const width of [390, 1280]) {
  for (const theme of ["light", "dark"] as const) {
    for (const state of ["verify", "declined", "used"] as const) {
      test(`the ${state} card at ${String(width)}px ${theme} is captured and accessible`, async ({
        browser,
        trialServer,
      }) => {
        mkdirSync(SCREENSHOT_DIR, { recursive: true });

        const storageState = await ownerStorageState(trialServer.url);
        const { context, page } = await openTrialPage(browser, storageState, width, theme);

        const status = state === "declined" ? 402 : 409;

        const body =
          state === "declined" ? { error: "card_not_verified" } : { error: "already_used" };

        if (state !== "verify") {
          await page.route("**/api/billing/trial/verify", async (route) =>
            route.fulfill({ body: JSON.stringify(body), contentType: "application/json", status }),
          );
        }

        await page.goto(`${trialServer.url}/onboarding/trial?card=verified&session=cs_setup_ui`);

        if (state !== "verify") {
          await page.getByRole("button", { name: "Verify card" }).click();
        }

        const heading = {
          verify: /Verify a card$/u,
          declined: /Card declined/u,
          used: /Card already used/u,
        }[state];

        await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible();

        await page.evaluate(async () => document.fonts.ready);

        const results = await new AxeBuilder({ page }).analyze();

        expect(results.violations, `axe ${state} ${String(width)}px ${theme}`).toEqual([]);

        const contentHeight = await page.evaluate(() => document.documentElement.scrollHeight);

        await page.setViewportSize({ width, height: contentHeight });

        await page.screenshot({
          animations: "disabled",
          caret: "hide",
          fullPage: true,
          path: join(SCREENSHOT_DIR, `trial-${state}-${String(width)}-${theme}.png`),
        });

        await context.close();
      });
    }
  }
}
