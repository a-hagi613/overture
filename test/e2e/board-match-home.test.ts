import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext, Browser } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { AxeBuilder } from "@axe-core/playwright";
import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";

const test = appTest.extend<{ homeServer: AppServer }>({
  homeServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

const serverNow = Date.UTC(2026, 10, 17, 11, 15, 0);

const okSchema = z.object({ ok: z.boolean() });

async function moveClockTo(request: APIRequestContext, target: number) {
  const current = z
    .object({ now: z.number() })
    .parse(await (await request.get("/__test__/clock")).json());

  const moved = await request.post("/__test__/clock/offset", {
    data: { offsetMs: target - current.now },
  });

  expect(moved.ok()).toBe(true);
}

async function seedHomeBoard(request: APIRequestContext, appServerUrl: string) {
  await moveClockTo(request, serverNow);

  await requestMagicLink(appServerUrl, request, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, request, authTestIdentity.ownerEmail);

  await request.get(link);
  await request.post("/__test__/user/name", {
    data: { email: authTestIdentity.ownerEmail, name: authTestIdentity.ownerName },
  });

  const response = await request.post("/__test__/home/sample", {
    data: { email: authTestIdentity.ownerEmail },
  });

  okSchema.parse(await response.json());
}

async function expectHomeMatchesBoard(
  browser: Browser,
  appServerUrl: string,
  width: number,
  theme: string,
) {
  const request = await apiRequest.newContext({ baseURL: appServerUrl });

  await seedHomeBoard(request, appServerUrl);

  const storageState = await request.storageState();

  await request.dispose();

  const context = await browser.newContext({
    deviceScaleFactor: 1,
    storageState,
    viewport: { height: width === 1280 ? 1197 : 2039, width },
  });

  const page = await context.newPage();

  await page.clock.setFixedTime(new Date(2026, 10, 17, 11, 0, 0));

  if (theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  await page.goto(`${appServerUrl}/home`);

  await expect(
    page.getByRole("heading", { level: 1, name: /Good (?:morning|afternoon|evening),/u }),
  ).toBeVisible();
  await expect(page.getByText("Next one sends about 11:40")).toBeVisible();
  await expect(page.getByText("4 open")).toBeVisible();
  await expect(page.getByRole("link", { name: "Answer questions" })).toBeVisible();
  await expect(page.getByText("09:12")).toBeVisible();
  await expect(page.getByText("Moved from Screening to Interviewing")).toBeVisible();

  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations, `${String(width)}px ${theme}`).toEqual([]);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );

  expect(overflow, `${String(width)}px ${theme}`).toBe(false);

  await context.close();
}

for (const width of [1280, 390]) {
  for (const theme of ["light", "dark"]) {
    test(`the Home page matches the board at ${String(width)}px in ${theme}`, async ({
      browser,
      homeServer,
    }) => {
      await expectHomeMatchesBoard(browser, homeServer.url, width, theme);
    });
  }
}
