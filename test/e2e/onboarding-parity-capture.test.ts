import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";

import type { AppServer } from "./app-server.ts";
import type { Page } from "@playwright/test";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { seedOnboardingTargetsFlow } from "./onboarding-targets-harness.ts";
import { walkOnboardingSteps1To4 } from "./onboarding-walk.ts";

const test = appTest.extend<{ onboardingServer: AppServer }>({
  onboardingServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer, {
        INBOUND_HMAC_SECRET: "e2e-onboarding-hmac-secret-0123456789",
      });

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

const outDir = join("parity-captures", "onboarding");

const variants = [
  { theme: "light", width: 1280 },
  { theme: "dark", width: 1280 },
  { theme: "light", width: 390 },
  { theme: "dark", width: 390 },
] as const;

async function captureInTurn<Item>(items: readonly Item[], act: (item: Item) => Promise<void>) {
  const first = items.at(0);

  if (first === undefined) {
    return;
  }

  await act(first);
  await captureInTurn(items.slice(1), act);
}

async function setTheme(page: Page, theme: string) {
  await page.evaluate((value) => {
    globalThis.localStorage.setItem("overture.theme", value);
  }, theme);
}

async function captureStep(page: Page, name: string, theme: string, width: number) {
  await page.setViewportSize({ height: width === 390 ? 844 : 900, width });
  await setTheme(page, theme);
  await page.reload();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations, `${name} ${String(width)} ${theme} axe`).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
    `${name} ${String(width)} ${theme} overflow`,
  ).toBe(0);

  mkdirSync(outDir, { recursive: true });
  await page.screenshot({
    fullPage: true,
    path: join(outDir, `${name}-${String(width)}-${theme}.png`),
  });
}

test("a fresh user's forward and trial steps match the boards at 390 and 1280, light and dark", async ({
  browser,
  onboardingServer,
}) => {
  const request = await apiRequest.newContext({ baseURL: onboardingServer.url });

  await seedOnboardingTargetsFlow(request, onboardingServer.url);

  const context = await browser.newContext({
    storageState: await request.storageState(),
    viewport: { height: 900, width: 1280 },
  });

  const page = await context.newPage();

  await walkOnboardingSteps1To4(page, onboardingServer.url);

  await captureInTurn(variants, async (variant) =>
    captureStep(page, "forward", variant.theme, variant.width),
  );

  await page.goto(`${onboardingServer.url}/onboarding/trial`);

  await captureInTurn(variants, async (variant) =>
    captureStep(page, "trial", variant.theme, variant.width),
  );

  await context.close();
  await request.dispose();
});
