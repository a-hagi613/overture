import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext, Browser, Page } from "@playwright/test";
import type { AppServer } from "./app-server.ts";
import type { IdentityServer } from "./identity-server-test.fixture.ts";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { seedBoard, seedBoardOwner } from "./board-harness.ts";
import { seedOnboardingBoard } from "./onboarding-harness.ts";
import {
  seedOnboardingTargetsBoard,
  seedOnboardingTargetsFlow,
} from "./onboarding-targets-harness.ts";
import { walkOnboardingSteps1To4 } from "./onboarding-walk.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";

const SCREENSHOT_DIR = process.env.CANVAS_SCREENSHOT_DIR;

const VARIANTS = [
  { theme: "light", width: 1280 },
  { theme: "dark", width: 1280 },
  { theme: "light", width: 390 },
  { theme: "dark", width: 390 },
] as const;

const SERVER_NOW = Date.UTC(2026, 10, 17, 11, 15, 0);

const homeSchema = z.object({
  applicationsLeft: z.number(),
  planApplications: z.number(),
});

const test = appTest;

async function each<Item>(items: readonly Item[], act: (item: Item) => Promise<void>) {
  const [first, ...rest] = items;

  if (first === undefined) {
    return;
  }

  await act(first);
  await each(rest, act);
}

async function shoot(page: Page, name: string) {
  if (SCREENSHOT_DIR === undefined || SCREENSHOT_DIR === "") {
    return;
  }

  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    path: join(SCREENSHOT_DIR, `${name}.png`),
  });
}

async function signIn(request: APIRequestContext, appUrl: string) {
  const requested = await requestMagicLink(appUrl, request, authTestIdentity.ownerEmail);

  expect(requested.ok()).toBe(true);

  const link = await latestMailLink(appUrl, request, authTestIdentity.ownerEmail);

  await request.get(link);
}

async function openPage(
  browser: Browser,
  appUrl: string,
  storageState: Awaited<ReturnType<APIRequestContext["storageState"]>>,
  width: number,
  theme: string,
  options: { clock?: Date | undefined; rail?: boolean | undefined } = {},
) {
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    storageState,
    timezoneId: "America/Toronto",
    viewport: { height: width === 1280 ? 900 : 844, width },
  });

  const page = await context.newPage();

  await page.addInitScript((value: string) => {
    globalThis.localStorage.setItem("overture.theme", value);
  }, theme);

  if (options.rail === true) {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.rail", "1");
    });
  }

  if (options.clock !== undefined) {
    await page.clock.setFixedTime(options.clock);
  }

  return { context, page };
}

async function captureVariants(options: {
  appUrl: string;
  browser: Browser;
  name: string;
  path: string;
  ready: (page: Page, width: number) => Promise<void>;
  storageState: Awaited<ReturnType<APIRequestContext["storageState"]>>;
  clock?: Date;
  rail?: boolean;
}) {
  await each(VARIANTS, async ({ theme, width }) => {
    const { context, page } = await openPage(
      options.browser,
      options.appUrl,
      options.storageState,
      width,
      theme,
      { clock: options.clock, rail: options.rail },
    );

    try {
      await page.goto(`${options.appUrl}${options.path}`);
      await options.ready(page, width);
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      const overflow = await page.evaluate(() => ({
        body: document.body.scrollWidth - document.body.clientWidth,
        html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }));

      expect(
        overflow,
        `${options.name} ${String(width)} ${theme} horizontal overflow`,
      ).toStrictEqual({ body: 0, html: 0 });

      const results = await new AxeBuilder({ page }).analyze();

      expect(results.violations, `${options.name} ${String(width)} ${theme} axe`).toEqual([]);

      await shoot(page, `${options.name}-${String(width)}-${theme}`);
    } finally {
      await context.close();
    }
  });
}

async function expectNoOverflowAcrossDesktop(page: Page, label: string) {
  await each([768, 1440, 1920, 2560], async (width) => {
    await page.setViewportSize({ height: 900, width });

    const overflow = await page.evaluate(() => ({
      body: document.body.scrollWidth - document.body.clientWidth,
      html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));

    expect(overflow, `${label} at ${String(width)}px`).toStrictEqual({ body: 0, html: 0 });
  });
}

async function withServer(
  identityServer: IdentityServer,
  run: (server: AppServer) => Promise<void>,
  extraEnvironment: Record<string, string> = {},
) {
  const server = await startFreshAppServer(identityServer, extraEnvironment);

  try {
    await run(server);
  } finally {
    await server.stop();
  }
}

test.describe("Canvas parity: onboarding, states and 404", () => {
  test.setTimeout(300_000);

  test("the onboarding steps match the canvas at 390 and 1280, light and dark", async ({
    browser,
    identityServer,
  }) => {
    await withServer(
      identityServer,
      async (server) => {
        const request = await apiRequest.newContext({ baseURL: server.url });

        try {
          await signIn(request, server.url);

          const storageState = await request.storageState();

          await captureVariants({
            appUrl: server.url,
            browser,
            name: "onboarding-welcome",
            path: "/onboarding",
            ready: async (page) => {
              await expect(
                page.getByRole("heading", { level: 2, name: /Welcome to Overture/u }),
              ).toBeVisible();
            },
            storageState,
          });

          const upload = await request.post("/api/profile/resume", {
            multipart: {
              file: {
                buffer: Buffer.from(readFileSync("test/e2e/fixtures/resume-board.pdf")),
                mimeType: "application/pdf",
                name: "resume.pdf",
              },
            },
          });

          expect(upload.status()).toBe(201);

          await captureVariants({
            appUrl: server.url,
            browser,
            name: "onboarding-resume",
            path: "/onboarding/resume",
            ready: async (page) => {
              await expect(page.getByText("resume.pdf")).toBeVisible();
            },
            storageState,
          });

          await seedOnboardingBoard(request, server.url);

          await captureVariants({
            appUrl: server.url,
            browser,
            name: "onboarding-facts",
            path: "/onboarding/facts",
            ready: async (page) => {
              await expect(page.getByText("Unlocks 14 queued jobs").first()).toBeVisible();
            },
            storageState,
          });

          await seedOnboardingTargetsBoard(request, server.url);

          await captureVariants({
            appUrl: server.url,
            browser,
            name: "onboarding-targets",
            path: "/onboarding/targets",
            ready: async (page) => {
              await expect(page.getByLabel("Salary floor")).toBeVisible();
            },
            storageState,
          });

          await each([1, 2, 3, 4], async (step) => {
            const finished = await request.post(`/api/onboarding/${String(step)}`);

            expect(finished.ok()).toBe(true);
          });

          await captureVariants({
            appUrl: server.url,
            browser,
            name: "onboarding-forward",
            path: "/onboarding/forward",
            ready: async (page, width) => {
              await expect(
                page.getByRole("heading", { level: 2, name: /Forward your job mail/u }),
              ).toBeVisible();
              const address = page.getByLabel("Your forwarding address");

              await expect(address).toHaveValue(/^in-.+@.+/u);
              await expect(page.getByText("workablemail.com", { exact: false })).toBeVisible();
              await expect(page.getByText("personio.com", { exact: false })).toBeVisible();
              await expect(page.getByText(/smartrecruiters\.com/u)).toHaveCount(0);
              await expect(page.getByText(/recruitee\.com/u)).toHaveCount(0);

              const fits = await address.evaluate((element) => ({
                client: element.clientWidth,
                scroll: element.scrollWidth,
              }));

              expect(
                fits.scroll,
                `the forwarding address clips at ${String(width)}px`,
              ).toBeLessThanOrEqual(fits.client);
            },
            storageState,
          });

          const { context, page } = await openPage(
            browser,
            server.url,
            storageState,
            1280,
            "light",
          );

          try {
            await page.goto(`${server.url}/onboarding/forward`);
            await expect(page.getByLabel("Your forwarding address")).toBeVisible();
            await expectNoOverflowAcrossDesktop(page, "onboarding forward");
          } finally {
            await context.close();
          }
        } finally {
          await request.dispose();
        }
      },
      { INBOUND_HMAC_SECRET: "e2e-onboarding-hmac-secret-0123456789" },
    );
  });

  test("a fresh user finishes onboarding with a mock PDF and lands in the app", async ({
    browser,
    identityServer,
  }) => {
    await withServer(
      identityServer,
      async (server) => {
        const request = await apiRequest.newContext({ baseURL: server.url });

        try {
          const { userId } = await seedOnboardingTargetsFlow(request, server.url);

          expect(userId).toBeTruthy();

          const context = await browser.newContext({
            storageState: await request.storageState(),
            viewport: { height: 1400, width: 1280 },
          });

          try {
            const page = await context.newPage();

            await walkOnboardingSteps1To4(page, server.url);

            await expect(
              page.getByRole("heading", { level: 2, name: /Forward your job mail/u }),
            ).toBeVisible();
            await page.getByLabel(/I agree to the /u).check();
            await page.getByRole("button", { name: "Start" }).click();
            await expect(page).toHaveURL(/\/notifications$/u);

            await page.goto(`${server.url}/a-page-that-does-not-exist`);
            await expect(
              page.getByRole("heading", { level: 1, name: "Page not found." }),
            ).toBeVisible();
            await expect(page.getByRole("link", { name: "Go to Home" })).toBeVisible();
            await expect(page.getByRole("link", { name: "Browse the Board" })).toBeVisible();
          } finally {
            await context.close();
          }
        } finally {
          await request.dispose();
        }
      },
      { INBOUND_HMAC_SECRET: "e2e-onboarding-hmac-secret-0123456789" },
    );
  });

  test("the paused Home matches the canvas", async ({ browser, identityServer }) => {
    await withServer(identityServer, async (server) => {
      const request = await apiRequest.newContext({ baseURL: server.url });

      try {
        const current = z
          .object({ now: z.number() })
          .parse(await (await request.get("/__test__/clock")).json());

        await request.post("/__test__/clock/offset", {
          data: { offsetMs: SERVER_NOW - current.now },
        });

        await signIn(request, server.url);
        await request.post("/__test__/user/name", {
          data: { email: authTestIdentity.ownerEmail, name: authTestIdentity.ownerName },
        });
        await request.post("/__test__/home/sample", {
          data: { email: authTestIdentity.ownerEmail, variant: "paused" },
        });

        const pausedStorage = await request.storageState();

        await captureVariants({
          appUrl: server.url,
          browser,
          clock: new Date(2026, 10, 17, 11, 0, 0),
          name: "states-paused",
          path: "/",
          ready: async (page) => {
            await expect(page.getByText("Paused by you.")).toBeVisible();
            await expect(page.getByText("Auto-apply paused")).toBeVisible();
            await expect(page.getByText("Held while sending is paused")).toBeVisible();
          },
          storageState: pausedStorage,
        });

        await request.post("/__test__/home/pause", {
          data: { email: authTestIdentity.ownerEmail, pauseReason: "payment_failed" },
        });

        await captureVariants({
          appUrl: server.url,
          browser,
          clock: new Date(2026, 10, 17, 11, 0, 0),
          name: "states-payment-failed",
          path: "/",
          ready: async (page) => {
            await expect(page.getByText("Payment didn't go through.")).toBeVisible();
            await expect(page.getByRole("link", { name: "Update payment" })).toBeVisible();
          },
          storageState: pausedStorage,
        });
      } finally {
        await request.dispose();
      }
    });
  });

  test("the out-of-applications Home matches the canvas", async ({ browser, identityServer }) => {
    await withServer(identityServer, async (server) => {
      const request = await apiRequest.newContext({ baseURL: server.url });

      try {
        await signIn(request, server.url);
        await request.post("/__test__/user/name", {
          data: { email: authTestIdentity.ownerEmail, name: authTestIdentity.ownerName },
        });

        const running = await request.post("/api/running", { data: { running: true } });

        expect(running.ok()).toBe(true);

        await request.post("/__test__/ledger/grant", {
          data: {
            email: authTestIdentity.ownerEmail,
            expiresAt: null,
            idempotencyKey: "canvas-out-of-applications",
            quantity: 2,
            source: "period",
          },
        });

        await each([1, 2], async (index) => {
          const reserved = await request.post("/__test__/ledger/application", {
            data: {
              applicationId: `canvas-out-of-applications-${String(index)}`,
              commit: true,
              email: authTestIdentity.ownerEmail,
            },
          });

          expect(reserved.ok()).toBe(true);
        });

        const home = homeSchema.parse(await (await request.get("/api/home")).json());

        expect(home).toMatchObject({ applicationsLeft: 0, planApplications: 2 });

        await captureVariants({
          appUrl: server.url,
          browser,
          name: "states-out-of-applications",
          path: "/",
          ready: async (page) => {
            await expect(page.getByText("Out of Applications.")).toBeVisible();
            await expect(page.getByRole("link", { name: "See the Board" })).toBeVisible();
          },
          storageState: await request.storageState(),
        });
      } finally {
        await request.dispose();
      }
    });
  });

  test("the Board shows the confirming application on the canvas cards", async ({
    browser,
    identityServer,
  }) => {
    await withServer(identityServer, async (server) => {
      const request = await apiRequest.newContext({ baseURL: server.url });

      try {
        const userId = await seedBoardOwner(request, server.url);

        await seedBoard(request, userId);

        const board = z
          .object({
            columns: z.array(
              z.object({
                cards: z.array(
                  z.object({ company: z.string(), id: z.string(), status: z.string() }),
                ),
              }),
            ),
          })
          .parse(await (await request.get("/api/board")).json());

        const confirming = board.columns
          .flatMap((column) => column.cards)
          .find((card) => card.status === "confirming");

        expect(confirming).toBeDefined();

        if (confirming !== undefined) {
          await request.post("/__test__/applications/events/seed", {
            data: {
              applicationId: confirming.id,
              events: [
                {
                  at: SERVER_NOW,
                  detail: "The form was submitted. Waiting for the employer's confirmation.",
                  fromValue: "sending",
                  kind: "status",
                  source: "system",
                  toValue: "confirming",
                },
              ],
            },
          });
        }

        const storageState = await request.storageState();

        await captureVariants({
          appUrl: server.url,
          browser,
          name: "states-confirming",
          path: "/board",
          rail: true,
          ready: async (page, width) => {
            if (width === 390) {
              await page.getByRole("tab", { name: /^Queued/u }).click();
            }

            if (confirming !== undefined) {
              await page
                .locator(`button[data-card="${confirming.id}"]`)
                .filter({ visible: true })
                .click();
            }

            await expect(
              page.getByText("Checking with the employer").filter({ visible: true }).first(),
            ).toBeVisible();
          },
          storageState,
        });
      } finally {
        await request.dispose();
      }
    });
  });

  test("the 404 page matches the canvas at 390 and 1280, light and dark", async ({
    browser,
    identityServer,
  }) => {
    await withServer(identityServer, async (server) => {
      const request = await apiRequest.newContext({ baseURL: server.url });

      try {
        const storageState = await request.storageState();

        await captureVariants({
          appUrl: server.url,
          browser,
          name: "not-found",
          path: "/a-page-that-does-not-exist",
          ready: async (page) => {
            await expect(
              page.getByRole("heading", { level: 1, name: "Page not found." }),
            ).toBeVisible();
            await expect(page.getByText("This page has moved on, or never existed.")).toBeVisible();
            await expect(page.getByRole("link", { name: "Go to Home" })).toBeVisible();
            await expect(page.getByRole("link", { name: "Browse the Board" })).toBeVisible();
            await expect(page.getByRole("navigation", { name: "Footer" })).toBeVisible();
          },
          storageState,
        });

        const { context, page } = await openPage(browser, server.url, storageState, 1440, "light");

        try {
          await page.goto(`${server.url}/a-page-that-does-not-exist`);
          await expect.poll(async () => page.locator("h1").first().isVisible()).toBe(true);
          await expectNoOverflowAcrossDesktop(page, "404");
        } finally {
          await context.close();
        }
      } finally {
        await request.dispose();
      }
    });
  });
});
