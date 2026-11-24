import { join } from "node:path";

import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext, Browser } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";

const INBOUND_SECRET = "apply-alias-forwarding-test-secret";
const ALIAS_PATTERN = /^[a-z0-9][a-z0-9.]*@tryoverture\.com$/u;
const TOGGLE_LABEL = "Use my personal email instead";

const applyEmailSchema = z.object({
  applyAddress: z.string().nullable(),
  personalEmail: z.string(),
  usePersonalEmail: z.boolean(),
});

const test = appTest.extend<{ aliasServer: AppServer }>({
  aliasServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer, {
        INBOUND_HMAC_SECRET: INBOUND_SECRET,
      });

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

async function ownerRequest(appServerUrl: string) {
  const request = await apiRequest.newContext({ baseURL: appServerUrl });

  await requestMagicLink(appServerUrl, request, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, request, authTestIdentity.ownerEmail);

  await request.get(link);

  return request;
}

async function readApplyEmail(request: APIRequestContext) {
  const response = await request.get("/api/profile/apply-email");

  expect(response.status()).toBe(200);

  return applyEmailSchema.parse(await response.json());
}

async function captureCards(
  browser: Browser,
  appServerUrl: string,
  storageState: Awaited<ReturnType<APIRequestContext["storageState"]>>,
) {
  const directory = process.env.APPLY_EMAIL_CAPTURE_DIR;

  if (directory === undefined) {
    return;
  }

  const variants = [
    [390, "light"],
    [1280, "light"],
    [390, "dark"],
    [1280, "dark"],
  ] as const;

  await Promise.all(
    variants.map(async ([width, scheme]) => {
      const context = await browser.newContext({ deviceScaleFactor: 1, storageState });
      const page = await context.newPage();

      await page.setViewportSize({ width, height: width === 1280 ? 1400 : 1200 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.addInitScript((theme) => {
        globalThis.localStorage.setItem("overture.theme", theme);
      }, scheme);
      await page.goto(`${appServerUrl}/profile/account`);
      await expect(page.getByTestId("settings-apply-email")).toBeVisible();
      await page.evaluate(async () => document.fonts.ready);
      await page.getByTestId("settings-apply-email").screenshot({
        animations: "disabled",
        path: join(directory, `apply-email-${String(width)}-${scheme}.png`),
      });

      await context.close();
    }),
  );
}

test("switching to the personal email is saved and shown on Profile → Account", async ({
  aliasServer,
  browser,
}) => {
  test.setTimeout(180_000);

  const appUrl = aliasServer.url;
  const request = await ownerRequest(appUrl);

  try {
    const initial = await readApplyEmail(request);

    expect(initial.usePersonalEmail).toBe(false);
    expect(initial.personalEmail).toBe(authTestIdentity.ownerEmail);
    expect(initial.applyAddress).not.toBeNull();
    expect(initial.applyAddress ?? "").toMatch(ALIAS_PATTERN);

    const storageState = await request.storageState();
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();

    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto(`${appUrl}/profile/account`);

    const card = page.getByTestId("settings-apply-email");

    await expect(card).toBeVisible();
    await expect(card).toContainText(initial.applyAddress ?? "");

    const toggle = card.getByRole("switch", { name: TOGGLE_LABEL });

    await expect(toggle).not.toBeChecked();

    await toggle.focus();
    await page.keyboard.press("Space");

    await expect(toggle).toBeChecked();
    await expect(card).toContainText(authTestIdentity.ownerEmail);
    await expect(card).toContainText(
      `New applications put ${initial.personalEmail} on the form, and you paste each verification code.`,
    );

    expect(await readApplyEmail(request)).toMatchObject({ usePersonalEmail: true });

    await page.reload();
    await expect(
      page.getByTestId("settings-apply-email").getByRole("switch", {
        name: TOGGLE_LABEL,
      }),
    ).toBeChecked();

    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await page.setViewportSize({ width: 390, height: 844 });

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);

    await expect(card).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).include('[data-testid="settings-apply-email"]').analyze())
        .violations,
    ).toEqual([]);

    await context.close();
  } finally {
    await request.dispose();
  }
});

test("the apply-email card is readable in light and dark at 390 and 1280", async ({
  aliasServer,
  browser,
}) => {
  test.setTimeout(180_000);

  const request = await ownerRequest(aliasServer.url);

  await captureCards(browser, aliasServer.url, await request.storageState());
  await request.dispose();
});
