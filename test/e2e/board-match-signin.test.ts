import { AxeBuilder } from "@axe-core/playwright";

import type { Browser, Page } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, test as appTest } from "./app.fixture.ts";
import { setTurnstileScenario } from "./sign-in.ts";

const widths = [390, 1280];
const themes = ["light", "dark"];

const statelessStates = ["sign-in", "suspended"] as const;

const statefulStates = ["magic-sent", "refused"] as const;

type State = (typeof statelessStates)[number] | (typeof statefulStates)[number];

async function open(page: Page, serverUrl: string, theme: string, state: State) {
  if (theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  await page.goto(`${serverUrl}/signin`);

  if (state !== "suspended") {
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  }

  if (state === "suspended") {
    await page.goto(`${serverUrl}/signin?error=account_suspended`);

    return;
  }

  if (state === "sign-in") {
    await setTurnstileScenario(page.request, serverUrl, { action: "signin" });
    await page.getByLabel("Email").fill(authTestIdentity.ownerEmail);

    return;
  }

  if (state === "refused") {
    await setTurnstileScenario(page.request, serverUrl, { action: "magiclink" });
    await page.getByLabel("Email").fill("sam.reyes@example.com");
    await page.getByRole("button", { name: "Send sign-in link" }).click();
    await expect(page.getByText("This email isn't invited yet.")).toBeVisible();

    return;
  }

  await page.getByLabel("Email").fill(authTestIdentity.ownerEmail);
  await setTurnstileScenario(page.request, serverUrl, { action: "magiclink" });
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByText("Link sent to")).toBeVisible();
}

async function assertMatchesBoard(
  browser: Browser,
  serverUrl: string,
  width: number,
  theme: string,
  state: State,
) {
  const name = `${String(width)}-${theme}-${state}`;

  const context = await browser.newContext({
    deviceScaleFactor: 1,
    viewport: { height: width === 1280 ? 900 : 844, width },
  });

  const page = await context.newPage();

  await open(page, serverUrl, theme, state);
  await page.evaluate(async () => document.fonts.ready.then(() => true));

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations, name).toEqual([]);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );

  expect(overflow, name).toBe(false);

  await context.close();
}

for (const width of widths) {
  for (const theme of themes) {
    for (const state of statelessStates) {
      appTest(
        `the ${String(width)} ${theme} sign-in screen matches the board in ${state} mode`,
        async ({ appServer, browser }) => {
          await assertMatchesBoard(browser, appServer.url, width, theme, state);
        },
      );
    }

    for (const state of statefulStates) {
      appTest(
        `the ${String(width)} ${theme} sign-in screen matches the board in ${state} mode`,
        async ({ isolatedAppServer, browser }) => {
          await assertMatchesBoard(browser, isolatedAppServer.url, width, theme, state);
        },
      );
    }
  }
}
