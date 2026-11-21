import { readFileSync } from "node:fs";

import type { Browser, Page } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, test as appTest } from "./app.fixture.ts";
import { latestMailLink, setTurnstileScenario } from "./sign-in.ts";

const widths = [390, 1280];
const themes = ["light", "dark"];

const statelessStates = ["sign-in", "sign-up", "forgot-password", "suspended"] as const;

const statefulStates = ["magic-sent", "verify-sent", "reset-password", "refused"] as const;

type State = (typeof statelessStates)[number] | (typeof statefulStates)[number];

const referenceDir = new URL("../../design/reference/signin/", import.meta.url);

function readPngSize(name: string) {
  const png = readFileSync(new URL(`${name}.png`, referenceDir));
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);

  return { height: view.getUint32(20), width: view.getUint32(16) };
}

async function waitForTurnstile(page: Page, widget: string) {
  await expect
    .poll(
      async () =>
        await page
          .locator(`[data-turnstile="${widget}"] input[name="cf-turnstile-response"]`)
          .inputValue(),
    )
    .not.toBe("");
}

async function open(page: Page, serverUrl: string, theme: string, state: State) {
  if (theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  if (state === "forgot-password") {
    await page.goto(`${serverUrl}/forgot-password`);
    await page.getByLabel("Email").fill(authTestIdentity.ownerEmail);

    return;
  }

  if (state === "reset-password") {
    await page.goto(`${serverUrl}/signin`);
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await page.getByRole("button", { name: "Create an account" }).click();
    await page.getByLabel("Email").fill(authTestIdentity.ownerEmail);
    await setTurnstileScenario(page.request, serverUrl, { action: "signup" });
    await waitForTurnstile(page, "password");
    await page.getByLabel("Create a password").fill("e2e-password-813");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

    await setTurnstileScenario(page.request, serverUrl, { action: "reset" });

    const reset = await page.request.post(`${serverUrl}/api/auth/request-password-reset`, {
      data: {
        email: authTestIdentity.ownerEmail,
        redirectTo: `${serverUrl}/reset-password`,
      },
      headers: {
        "x-captcha-response": authTestIdentity.turnstilePassToken,
        "x-turnstile-action": "reset",
        origin: serverUrl,
      },
    });

    expect(reset.ok()).toBe(true);

    const link = await latestMailLink(serverUrl, page.request, authTestIdentity.ownerEmail);

    await page.goto(link);
    await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();

    return;
  }

  await page.goto(`${serverUrl}/signin`);
  await expect
    .poll(
      async () =>
        await page
          .locator('[data-turnstile="magic"] input[name="cf-turnstile-response"]')
          .inputValue(),
    )
    .not.toBe("");

  if (state !== "suspended") {
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  }

  if (state === "suspended") {
    await page.goto(`${serverUrl}/signin?error=account_suspended`);

    return;
  }

  if (state === "sign-in") {
    await setTurnstileScenario(page.request, serverUrl, { action: "signin" });
    await waitForTurnstile(page, "password");
    await page.getByLabel("Email").fill(authTestIdentity.ownerEmail);

    return;
  }

  if (state === "refused") {
    await setTurnstileScenario(page.request, serverUrl, { action: "magiclink" });
    await page.getByLabel("Email").fill("sam.reyes@example.com");
    await waitForTurnstile(page, "magic");
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByText("This email isn't invited yet.")).toBeVisible();

    return;
  }

  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email").fill(authTestIdentity.ownerEmail);

  if (state === "sign-up") {
    await setTurnstileScenario(page.request, serverUrl, { action: "signup" });
    await waitForTurnstile(page, "password");

    return;
  }

  if (state === "verify-sent") {
    await setTurnstileScenario(page.request, serverUrl, { action: "signup" });
    await waitForTurnstile(page, "password");
    await page.getByLabel("Create a password").fill("e2e-password-813");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

    return;
  }

  await page.getByRole("button", { name: "Sign in" }).click();
  await setTurnstileScenario(page.request, serverUrl, { action: "magiclink" });
  await waitForTurnstile(page, "magic");
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
