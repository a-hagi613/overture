import { request as apiRequest } from "@playwright/test";

import type { AppServer } from "./app-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { seedReady } from "./ready-harness.ts";

const test = appTest.extend<{ readyServer: AppServer }>({
  readyServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer, {
        INBOUND_HMAC_SECRET: "e2e-post-approval-hmac-0123456789",
      });

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

test("the first approval explains the apply address and shows the iOS Home Screen card once", async ({
  browser,
  readyServer,
}) => {
  const request = await apiRequest.newContext({ baseURL: readyServer.url });

  await seedReady(request, readyServer.url);

  const storageState = await request.storageState();

  await request.dispose();

  const context = await browser.newContext({
    storageState,
    timezoneId: "America/Toronto",
    userAgent: IPHONE_SAFARI,
    viewport: { height: 844, width: 390 },
  });

  const page = await context.newPage();

  await page.goto(`${readyServer.url}/ready`);
  await page.getByRole("button", { name: "Approve & Next" }).first().click();
  await page.getByRole("button", { name: "Yes, send application" }).click();

  await expect(
    page.getByRole("heading", {
      level: 2,
      name: /Your applications send from your Overture address/u,
    }),
  ).toBeVisible();
  await expect(page.getByText(/@/u).first()).toBeVisible();
  await expect(page.getByText("Add Overture to your Home Screen")).toBeVisible();
  await expect(page.getByText("Tap the Share button in Safari.")).toBeVisible();
  await expect(page.getByText("Choose Add to Home Screen, then Add.")).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );

  expect(overflow).toBeLessThanOrEqual(0);

  await page.getByRole("button", { name: /Dismiss the address and Home Screen card/u }).click();
  await expect(page.getByText("Add Overture to your Home Screen")).toHaveCount(0);

  await page.reload();
  await expect(page.getByText("Add Overture to your Home Screen")).toHaveCount(0);

  await context.close();
});
