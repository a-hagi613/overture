import { readFileSync } from "node:fs";

import type { AppServer } from "./app-server.ts";

import type { Page } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, test as appTest, startFreshAppServer } from "./app.fixture.ts";
import { latestMailLink, setTurnstileScenario } from "./sign-in.ts";

const boardTest = appTest.extend<{ boardServer: AppServer }>({
  boardServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

const widths = [390, 1280];
const themes = ["light", "dark"];

const states = [
  "sign-in",
  "sign-up",
  "magic-sent",
  "verify-sent",
  "forgot-password",
  "reset-password",
  "suspended",
  "refused",
] as const;

type State = (typeof states)[number];

const referenceDir = new URL("../../design/reference/signin/", import.meta.url);

function readPngSize(name: string) {
  const png = readFileSync(new URL(`${name}.png`, referenceDir));
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);

  return { height: view.getUint32(20), width: view.getUint32(16) };
}

async function compareArtboard({
  actual,
  expected,
  width,
  height,
}: {
  actual: string;
  expected: string;
  width: number;
  height: number;
}) {
  const decode = async (base64: string) => {
    const image = new Image();

    image.src = `data:image/png;base64,${base64}`;
    await image.decode();

    const canvas = document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");

    if (context === null) {
      throw new Error("no 2d canvas context");
    }

    context.drawImage(image, 0, 0, width, height, 0, 0, width, height);

    return context.getImageData(0, 0, width, height).data;
  };

  const colorDelta = (
    first: Uint8ClampedArray,
    x1: number,
    y1: number,
    second: Uint8ClampedArray,
    x2: number,
    y2: number,
  ) => {
    const [r1 = 0, g1 = 0, b1 = 0] = first.subarray(
      (y1 * width + x1) * 4,
      (y1 * width + x1) * 4 + 3,
    );

    const [r2 = 0, g2 = 0, b2 = 0] = second.subarray(
      (y2 * width + x2) * 4,
      (y2 * width + x2) * 4 + 3,
    );

    const dr = r1 - r2;
    const dg = g1 - g2;
    const db = b1 - b2;
    const dy = dr * 0.299 + dg * 0.587 + db * 0.114;
    const di = dr * 0.596 - dg * 0.274 - db * 0.322;
    const dq = dr * 0.211 - dg * 0.523 + db * 0.312;
    const delta = 0.5053 * dy * dy + 0.299 * di * di + 0.1957 * dq * dq;

    return dy > 0 ? -delta : delta;
  };

  const bounds = (x: number, y: number) => ({
    x0: Math.max(x - 1, 0),
    y0: Math.max(y - 1, 0),
    x2: Math.min(x + 1, width - 1),
    y2: Math.min(y + 1, height - 1),
  });

  const hasManySiblings = (data: Uint8ClampedArray, x: number, y: number) => {
    const { x0, y0, x2, y2 } = bounds(x, y);
    let zeroes = x === x0 || x === x2 || y === y0 || y === y2 ? 1 : 0;

    for (let nx = x0; nx <= x2; nx += 1) {
      for (let ny = y0; ny <= y2; ny += 1) {
        if ((nx !== x || ny !== y) && colorDelta(data, x, y, data, nx, ny) === 0) {
          zeroes += 1;

          if (zeroes > 1) {
            return true;
          }
        }
      }
    }

    return false;
  };

  const isAntialiased = (data: Uint8ClampedArray, x: number, y: number) => {
    const { x0, y0, x2, y2 } = bounds(x, y);
    let zeroes = x === x0 || x === x2 || y === y0 || y === y2 ? 1 : 0;
    let min = 0;
    let max = 0;
    let minPoint = { x, y };
    let maxPoint = { x, y };

    for (let nx = x0; nx <= x2; nx += 1) {
      for (let ny = y0; ny <= y2; ny += 1) {
        if (nx === x && ny === y) {
          continue;
        }

        const delta = colorDelta(data, x, y, data, nx, ny);

        if (delta === 0) {
          zeroes += 1;

          if (zeroes > 2) {
            return false;
          }
        } else if (delta < min) {
          min = delta;
          minPoint = { x: nx, y: ny };
        } else if (delta > max) {
          max = delta;
          maxPoint = { x: nx, y: ny };
        }
      }
    }

    if (min === 0 || max === 0) {
      return false;
    }

    return (
      hasManySiblings(data, minPoint.x, minPoint.y) && hasManySiblings(data, maxPoint.x, maxPoint.y)
    );
  };

  const maxDelta = 35_215 * 0.2 * 0.2;
  const actualData = await decode(actual);
  const expectedData = await decode(expected);
  let different = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const delta = colorDelta(actualData, x, y, expectedData, x, y);

      if (
        Math.abs(delta) > maxDelta &&
        !isAntialiased(actualData, x, y) &&
        !isAntialiased(expectedData, x, y)
      ) {
        different += 1;
      }
    }
  }

  return different / (width * height);
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

async function expectArtboardToMatchBoard(page: Page, name: string, width: number, height: number) {
  const actual = await page.screenshot({
    animations: "disabled",
    caret: "hide",
    clip: { x: 0, y: 0, width, height },
  });

  const expected = readFileSync(new URL(`${name}.png`, referenceDir));

  const ratio = await page.evaluate(compareArtboard, {
    actual: actual.toString("base64"),
    expected: expected.toString("base64"),
    width,
    height,
  });

  expect(ratio).toBeLessThanOrEqual(0.01);
}

for (const width of widths) {
  for (const theme of themes) {
    for (const state of states) {
      boardTest(
        `the ${String(width)} ${theme} sign-in screen matches the board in ${state} mode`,
        async ({ boardServer, browser }) => {
          const name = `${String(width)}-${theme}-${state}`;
          const { height } = readPngSize(name);

          const context = await browser.newContext({
            deviceScaleFactor: 1,
            viewport: { width, height },
          });

          const page = await context.newPage();

          await open(page, boardServer.url, theme, state);
          await page.evaluate(async () => document.fonts.ready.then(() => true));
          await page.evaluate(() => {
            const active = document.activeElement;

            if (active instanceof HTMLElement) {
              active.blur();
            }
          });

          if (width === 390) {
            await expectArtboardToMatchBoard(page, name, width, height);
          } else {
            await expect(page).toHaveScreenshot(`${name}.png`, {
              animations: "disabled",
              caret: "hide",
              fullPage: true,
              maxDiffPixelRatio: 0.01,
            });
          }

          await context.close();
        },
      );
    }
  }
}
