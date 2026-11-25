import { readFileSync } from "node:fs";

import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";

import type { APIRequestContext, Browser } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";

const test = appTest.extend<{ onboardingServer: AppServer }>({
  onboardingServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

async function signInOwner(request: APIRequestContext, appServerUrl: string) {
  await requestMagicLink(appServerUrl, request, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, request, authTestIdentity.ownerEmail);

  await request.get(link);
}

async function screenshotPage(
  browser: Browser,
  appServerUrl: string,
  path: string,
  width: number,
  theme: string,
) {
  const request = await apiRequest.newContext({ baseURL: appServerUrl });

  await signInOwner(request, appServerUrl);

  if (path === "/onboarding/resume") {
    const upload = await request.post("/api/profile/resume", {
      multipart: {
        file: {
          name: "resume.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from(readFileSync("test/e2e/fixtures/resume-board.pdf")),
        },
      },
    });

    expect(upload.status()).toBe(201);
  }

  const storageState = await request.storageState();

  await request.dispose();

  const context = await browser.newContext({
    deviceScaleFactor: 1,
    storageState,
    viewport: { height: width === 1280 ? 800 : 844, width },
  });

  const page = await context.newPage();

  if (theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  await page.goto(`${appServerUrl}${path}`);

  await expect(
    page.getByRole("heading", { level: 1, name: /Set up your workspace/u }),
  ).toBeVisible();

  if (path === "/onboarding/resume") {
    await expect(page.getByText("resume.pdf").first()).toBeVisible();
    await expect(page.getByText("PDF · 2 pages · 184 KB")).toBeVisible();
  } else {
    await expect(page.getByText("Overture finds jobs")).toBeVisible();
  }

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
    test(`the resume step matches the board at ${String(width)}px in ${theme}`, async ({
      browser,
      onboardingServer,
    }) => {
      await screenshotPage(browser, onboardingServer.url, "/onboarding/resume", width, theme);
    });
  }
}
