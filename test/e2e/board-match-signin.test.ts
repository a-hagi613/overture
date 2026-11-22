import { readFileSync } from "node:fs";

import { AxeBuilder } from "@axe-core/playwright";

import type { Browser, Page } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, test as appTest } from "./app.fixture.ts";
import { setTurnstileScenario } from "./sign-in.ts";

const widths = [390, 1280];
const themes = ["light", "dark"];
const sweepWidths = [390, 768, 1280, 1440, 1920, 2560] as const;

const statelessStates = ["sign-in", "suspended"] as const;

const statefulStates = ["magic-sent", "refused"] as const;

type State = (typeof statelessStates)[number] | (typeof statefulStates)[number];

const referenceDir = new URL("../../design/reference/signin/", import.meta.url);

function readPngSize(name: string) {
  const png = readFileSync(new URL(`${name}.png`, referenceDir));
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);

  return { height: view.getUint32(20), width: view.getUint32(16) };
}

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
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByText("This email isn't invited yet.")).toBeVisible();

    return;
  }

  await page.getByLabel("Email").fill(authTestIdentity.ownerEmail);
  await setTurnstileScenario(page.request, serverUrl, { action: "magiclink" });
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
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
  const { height } = readPngSize(name);

  const context = await browser.newContext({
    deviceScaleFactor: 1,
    viewport: { width, height },
  });

  const page = await context.newPage();

  await open(page, serverUrl, theme, state);
  await page.evaluate(async () => document.fonts.ready.then(() => true));
  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    const active = document.activeElement;

    if (active instanceof HTMLElement) {
      active.blur();
    }
  });

  if (width === 390) {
    await expect(page).toHaveScreenshot(`${name}.png`, {
      animations: "disabled",
      caret: "hide",
      clip: { x: 0, y: 0, width, height },
      maxDiffPixelRatio: 0.01,
    });
  } else {
    await expect(page).toHaveScreenshot(`${name}.png`, {
      animations: "disabled",
      caret: "hide",
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  }

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

async function assertFits(page: Page, width: number, theme: string) {
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  expect(overflow.scrollWidth, `${String(width)}px ${theme}`).toBeLessThanOrEqual(
    overflow.clientWidth,
  );

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations, `${String(width)}px ${theme}`).toEqual([]);
}

appTest.describe("the sign-in screen at every width", () => {
  for (const width of sweepWidths) {
    for (const theme of themes) {
      appTest(
        `${String(width)} ${theme} has no horizontal overflow and is axe clean`,
        async ({ page, appServerUrl }) => {
          await page.setViewportSize({ width, height: 900 });
          await open(page, appServerUrl, theme, "sign-in");
          await assertFits(page, width, theme);
        },
      );
    }
  }
});

appTest.describe("the sign-in states at 390 and 1280", () => {
  for (const state of ["magic-sent", "refused", "suspended"] as const) {
    for (const theme of themes) {
      appTest(
        `${state} in ${theme} stays inside the viewport and is axe clean at 390 and 1280`,
        async ({ browser, isolatedAppServer }) => {
          await Promise.all(
            widths.map(async (width) => {
              const context = await browser.newContext({
                deviceScaleFactor: 1,
                viewport: { width, height: 900 },
              });

              const page = await context.newPage();

              await open(page, isolatedAppServer.url, theme, state);
              await assertFits(page, width, theme);
              await context.close();
            }),
          );
        },
      );
    }
  }
});

appTest(
  "the sign-in screen ships product copy, not canvas annotations",
  async ({ page, appServerUrl }) => {
    await page.goto(`${appServerUrl}/signin`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Sign in to Overture" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeVisible();
    await expect(page.getByText("Invitation only for now.")).toBeVisible();
    await expect(page.getByText("Google, LinkedIn or an emailed link")).toBeVisible();

    const text = await page.locator("body").textContent();

    expect(text).not.toMatch(/\bfig(?:ure)?\.?\s*\d|\bfolio\b|§|artboard|sample data/iu);
    expect(text).not.toMatch(/password/iu);
    expect(text).not.toMatch(/create an account|sign up/iu);
  },
);
