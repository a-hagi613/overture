import { readFileSync } from "node:fs";
import { join } from "node:path";

import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext, Page } from "@playwright/test";

import type { AppServer } from "./app-server.ts";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";
import { seedApplication, seedBoard, seedCompany, seedPosting } from "./matching-harness.ts";

const test = appTest.extend<{ codePasteServer: AppServer }>({
  codePasteServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer, {
        INBOUND_HMAC_SECRET: "e2e-inbound-hmac-secret-0123456789",
        MAIL_DOMAIN: "tryoverture.com",
      });

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

const serverNow = Date.UTC(2026, 10, 20, 16, 15, 0);

const boardCode = "A1B2C3D4";

const BOARD_DIFF_LIMIT = 0.01;

function variantOf(width: 390 | 1280, theme: "light" | "dark") {
  return `${String(width)}-${theme}` as const;
}

const CARD_BOX = {
  1280: {
    dark: { height: 261, width: 940, x: 304, y: 117 },
    light: { height: 261, width: 940, x: 304, y: 117 },
  },
  390: {
    dark: { height: 343, width: 358, x: 16, y: 214 },
    light: { height: 343, width: 358, x: 16, y: 214 },
  },
} satisfies Record<
  390 | 1280,
  Record<"dark" | "light", { height: number; width: number; x: number; y: number }>
>;

const createdSchema = z.object({ id: z.string() });

const waitingSchema = z.object({ id: z.string() });

const authStateSchema = z.object({ users: z.array(z.object({ id: z.string() })) });

async function signInOwner(request: APIRequestContext, appServerUrl: string) {
  await requestMagicLink(appServerUrl, request, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, request, authTestIdentity.ownerEmail);

  await request.get(link);
  await request.post("/__test__/user/name", {
    data: { email: authTestIdentity.ownerEmail, name: authTestIdentity.ownerName },
  });

  return authStateSchema.parse(await (await request.get("/__test__/auth/state")).json());
}

async function moveClockToNow(request: APIRequestContext) {
  const clock = z
    .object({ now: z.number() })
    .parse(await (await request.get("/__test__/clock")).json());

  await request.post("/__test__/clock/offset", { data: { offsetMs: serverNow - clock.now } });
}

async function seedCodeWait(request: APIRequestContext, appServerUrl: string, userId: string) {
  await moveClockToNow(request);

  const companyId = await seedCompany(request, "Quillon Payments", "quillon.example");
  const boardId = await seedBoard(request, companyId, "greenhouse", "quillon");

  const postingId = await seedPosting(request, {
    atsJobId: "0419",
    boardId,
    companyId,
    tags: [{ dimension: "subrole", value: "Payments" }],
    title: "Senior Payments Engineer",
    url: "https://boards.example/jobs/0419",
  });

  const applicationId = await seedApplication(request, {
    postingId,
    status: "sending",
    userId,
  });

  const attempt = createdSchema.parse(
    await (
      await request.post("/__test__/attempts/seed", {
        data: { applicationId, provider: "local" },
      })
    ).json(),
  );

  const wait = waitingSchema.parse(
    await (
      await request.post("/__test__/mail/code-waits", {
        data: {
          attemptId: attempt.id,
          email: authTestIdentity.ownerEmail,
          expiresAt: serverNow + 9 * 60_000 + 42_000,
          startedAt: serverNow - 5 * 60_000,
        },
      })
    ).json(),
  );

  return { applicationId, waitId: wait.id };
}

async function seedScene(appServerUrl: string) {
  const request = await apiRequest.newContext({ baseURL: appServerUrl });

  const state = await signInOwner(request, appServerUrl);
  const userId = state.users.at(-1)?.id;

  if (userId === undefined) {
    throw new Error("No owner user.");
  }

  const storageState = await request.storageState();
  await seedCodeWait(request, appServerUrl, userId);
  await request.dispose();

  return storageState;
}

async function expectTouchTargets(page: Page, testId: string) {
  const sizes = await page
    .getByTestId(testId)
    .locator("button, a")
    .evaluateAll((nodes) =>
      nodes
        .map((node) => {
          const box = node.getBoundingClientRect();

          return {
            height: Math.round(box.height),
            label: (node.getAttribute("aria-label") ?? node.textContent).trim().slice(0, 24),
            width: Math.round(box.width),
          };
        })
        .filter((size) => size.width > 0 || size.height > 0),
    );

  expect(sizes.length).toBeGreaterThan(0);

  for (const size of sizes) {
    expect(size.height, size.label).toBeGreaterThanOrEqual(44);
    expect(size.width, size.label).toBeGreaterThanOrEqual(44);
  }
}

async function expectNoOverflow(page: Page) {
  const sizes = await page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));

  expect(sizes.html).toBeLessThanOrEqual(0);
  expect(sizes.body).toBeLessThanOrEqual(0);
}

async function compareRegion({
  actual,
  expected,
  region,
}: {
  actual: string;
  expected: string;
  region: { height: number; width: number; x: number; y: number };
}) {
  const { height, width } = region;

  const actualImage = new Image();

  actualImage.src = `data:image/png;base64,${actual}`;
  await actualImage.decode();

  const expectedImage = new Image();

  expectedImage.src = `data:image/png;base64,${expected}`;
  await expectedImage.decode();
  const canvas = document.createElement("canvas");

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");

  if (context === null) {
    throw new Error("no 2d canvas context");
  }

  function pixelsOf(draw: () => void) {
    if (context === null) {
      throw new Error("no 2d canvas context");
    }

    context.clearRect(0, 0, width, height);
    context.filter = "blur(2px)";
    draw();

    return context.getImageData(0, 0, width, height).data;
  }

  const first = pixelsOf(() => {
    context.drawImage(actualImage, 0, 0, width, height, 0, 0, width, height);
  });

  let best = 1;

  for (let dx = -3; dx <= 3; dx += 1) {
    for (let dy = -3; dy <= 3; dy += 1) {
      const second = pixelsOf(() => {
        context.drawImage(
          expectedImage,
          region.x + dx,
          region.y + dy,
          width,
          height,
          0,
          0,
          width,
          height,
        );
      });

      let differing = 0;

      for (let index = 0; index < first.length; index += 4) {
        const dr = (first[index] ?? 0) - (second[index] ?? 0);
        const dg = (first[index + 1] ?? 0) - (second[index + 1] ?? 0);
        const db = (first[index + 2] ?? 0) - (second[index + 2] ?? 0);

        if (Math.hypot(dr, dg, db) > 40) {
          differing += 1;
        }
      }

      best = Math.min(best, differing / (width * height));
    }
  }

  return best;
}

for (const width of [390, 1280] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`Home asks for the code on the drawn card at ${String(width)}px in ${theme}`, async ({
      browser,
      codePasteServer,
    }) => {
      const storageState = await seedScene(codePasteServer.url);
      const variant = variantOf(width, theme);
      const box = CARD_BOX[width][theme];

      const context = await browser.newContext({
        deviceScaleFactor: 1,
        storageState,
        viewport: { height: 1000, width },
      });

      const page = await context.newPage();

      if (theme === "dark") {
        await page.addInitScript(() => {
          globalThis.localStorage.setItem("overture.theme", "dark");
        });
      }

      await page.goto(`${codePasteServer.url}/`);

      await expect(
        page.getByRole("heading", { name: "Quillon Payments needs a code." }),
      ).toBeVisible();
      await expect(page.getByText(/^Expires in 9:4\d$/u)).toBeVisible();
      await expect(page.getByRole("button", { name: "Paste the code" })).toBeVisible();
      await expect(page.getByRole("button", { name: "No code yet" })).toBeVisible();
      await expect(
        page.getByText("Five minutes have passed with no forwarded mail."),
      ).toBeVisible();

      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      const card = page.getByTestId("home-code-wait");
      const actualBox = await card.boundingBox();

      if (actualBox === null) {
        throw new Error("The code-wait card has no box.");
      }

      expect(Math.round(actualBox.width)).toBe(box.width);
      expect(Math.abs(Math.round(actualBox.height) - box.height)).toBeLessThanOrEqual(3);

      const ratio = await page.evaluate(compareRegion, {
        actual: (await card.screenshot({ animations: "disabled", caret: "hide" })).toString(
          "base64",
        ),
        expected: readFileSync(
          join(process.cwd(), `design/reference/code-wait/${variant}.png`),
        ).toString("base64"),
        region: {
          height: Math.round(actualBox.height),
          width: Math.round(actualBox.width),
          x: box.x,
          y: box.y,
        },
      });

      expect(ratio).toBeLessThanOrEqual(BOARD_DIFF_LIMIT);

      await expectNoOverflow(page);

      if (width === 390) {
        await expectTouchTargets(page, "home-code-wait");
      }

      const { violations } = await new AxeBuilder({ page }).analyze();

      expect(violations, variant).toEqual([]);

      await context.close();
    });

    test(`the code-paste sheet shows the drawn states at ${String(width)}px in ${theme}`, async ({
      browser,
      codePasteServer,
    }) => {
      const storageState = await seedScene(codePasteServer.url);

      const context = await browser.newContext({
        deviceScaleFactor: 1,
        storageState,
        viewport: { height: 1000, width },
      });

      const page = await context.newPage();

      if (theme === "dark") {
        await page.addInitScript(() => {
          globalThis.localStorage.setItem("overture.theme", "dark");
        });
      }

      await page.goto(`${codePasteServer.url}/`);
      await page.getByRole("button", { name: "Paste the code" }).click();

      const sheet = page.getByTestId("code-paste-sheet");

      await expect(sheet.getByRole("heading", { name: "Paste the code." })).toBeVisible();
      await expect(sheet.getByText("Code paste")).toBeVisible();
      await expect(sheet.getByLabel("Verification code")).toBeVisible();
      await expect(sheet.getByPlaceholder("8 characters")).toBeVisible();
      await expect(sheet.getByText("Time left")).toBeVisible();
      await expect(sheet.getByRole("button", { name: "Submit code" })).toBeVisible();

      const box = await sheet.boundingBox();

      if (box === null) {
        throw new Error("The sheet has no box.");
      }

      expect(Math.round(box.width)).toBe(width === 1280 ? 468 : 358);

      const monogram = await sheet.locator("[aria-hidden=true]").first().boundingBox();

      expect(Math.round(monogram?.width ?? 0)).toBe(46);
      expect(Math.round(monogram?.height ?? 0)).toBe(46);

      const inputBox = await sheet.getByLabel("Verification code").boundingBox();

      expect(Math.round(inputBox?.height ?? 0)).toBe(50);

      await expectNoOverflow(page);
      await expect(sheet.getByText(/\bno\./u)).toHaveCount(0);

      if (width === 390) {
        await expectTouchTargets(page, "code-paste-sheet");
      }

      const { violations } = await new AxeBuilder({ page }).analyze();

      expect(violations, variantOf(width, theme)).toEqual([]);

      await sheet.getByRole("button", { name: "No code yet" }).click();

      await expect(sheet.getByRole("heading", { name: "Still waiting." })).toBeVisible();
      await expect(sheet.getByRole("link", { name: "Check the filter guide" })).toBeVisible();
      await expect(
        sheet.getByText("No code has arrived in your forwarded mail yet."),
      ).toBeVisible();

      await sheet.getByRole("button", { name: "Submit code" }).click();

      await expect(sheet.getByRole("alert")).toHaveText(
        "Enter the 8-character code from the email.",
      );

      await sheet.getByLabel("Verification code").fill(boardCode);

      await sheet.getByRole("button", { name: "Submit code" }).click();

      await expect(sheet.getByRole("heading", { name: "Submitted with your code." })).toBeVisible({
        timeout: 15_000,
      });
      await expect(sheet.getByText("Code accepted")).toBeVisible();
      await expect(sheet.getByText("Checking with the employer", { exact: true })).toBeVisible();
      await expect(sheet.getByRole("link", { name: "Open Board" })).toBeVisible();

      if (width === 390) {
        await expectTouchTargets(page, "code-paste-sheet");
      }

      await context.close();
    });
  }
}

for (const width of [768, 1920, 2560] as const) {
  test(`the sheet fits the viewport at ${String(width)}px`, async ({
    browser,
    codePasteServer,
  }) => {
    const storageState = await seedScene(codePasteServer.url);

    const context = await browser.newContext({
      deviceScaleFactor: 1,
      storageState,
      viewport: { height: 1000, width },
    });

    const page = await context.newPage();

    await page.goto(`${codePasteServer.url}/`);

    await expectNoOverflow(page);

    await page.getByRole("button", { name: "Paste the code" }).click();

    const sheet = page.getByTestId("code-paste-sheet");
    const box = await sheet.boundingBox();

    expect(Math.round(box?.width ?? 0)).toBe(width >= 1700 ? 520 : 468);

    await expectNoOverflow(page);

    const { violations } = await new AxeBuilder({ page }).analyze();

    expect(violations, String(width)).toEqual([]);

    await context.close();
  });
}

test("the sheet holds the keyboard inside and gives focus back when it closes", async ({
  browser,
  codePasteServer,
}) => {
  const storageState = await seedScene(codePasteServer.url);

  const context = await browser.newContext({
    deviceScaleFactor: 1,
    storageState,
    viewport: { height: 1000, width: 390 },
  });

  const page = await context.newPage();

  await page.goto(`${codePasteServer.url}/`);

  const opener = page.getByRole("button", { name: "Paste the code" });
  const sheet = page.getByTestId("code-paste-sheet");

  await opener.focus();
  await page.keyboard.press("Enter");

  await expect(sheet).toBeVisible();
  await expect(page.getByLabel("Verification code")).toBeFocused();

  await sheet.getByRole("button", { name: "No code yet" }).focus();
  await page.keyboard.press("Tab");

  const wrapped = await page.evaluate(() => {
    const active = document.activeElement;

    return {
      inside: active?.closest('[data-testid="code-paste-sheet"]') !== null,
      label: active?.getAttribute("aria-label") ?? "",
    };
  });

  expect(wrapped.inside).toBe(true);
  expect(wrapped.label).toBe("Close the code-paste sheet");

  await page.keyboard.press("Escape");

  await expect(sheet).toHaveCount(0);
  await expect(opener).toBeFocused();

  await context.close();
});
