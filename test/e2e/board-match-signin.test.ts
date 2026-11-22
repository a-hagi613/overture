import { readFileSync } from "node:fs";

import type { Browser, Page } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, test as appTest } from "./app.fixture.ts";
import { setTurnstileScenario } from "./sign-in.ts";

const widths = [390, 1280];
const themes = ["light", "dark"];

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
