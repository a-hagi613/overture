import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext, Browser, Page } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

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

test.use({ trace: "off" });

const SHOT_DIR = process.env.HOME_SHOT_DIR ?? null;

const SERVER_NOW = Date.UTC(2026, 10, 17, 11, 15, 0);

const SECTION_IDS = [
  "home-needs-you",
  "home-ready-title",
  "home-in-progress",
  "home-replies",
  "home-matches",
] as const;

async function moveClockTo(request: APIRequestContext, target: number) {
  const current = z
    .object({ now: z.number() })
    .parse(await (await request.get("/__test__/clock")).json());

  await request.post("/__test__/clock/offset", { data: { offsetMs: target - current.now } });
}

async function seedAttention(request: APIRequestContext, appServerUrl: string) {
  await moveClockTo(request, SERVER_NOW);
  await requestMagicLink(appServerUrl, request, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, request, authTestIdentity.ownerEmail);

  await request.get(link);
  await request.post("/__test__/user/name", {
    data: { email: authTestIdentity.ownerEmail, name: authTestIdentity.ownerName },
  });

  const seeded = await request.post("/__test__/home/sample", {
    data: { email: authTestIdentity.ownerEmail, variant: "attention" },
  });

  expect(z.object({ ok: z.boolean() }).parse(await seeded.json())).toEqual({ ok: true });
}

async function openHome(
  browser: Browser,
  appServerUrl: string,
  width: number,
  theme: "light" | "dark" = "light",
) {
  const request = await apiRequest.newContext({ baseURL: appServerUrl });

  await seedAttention(request, appServerUrl);

  const storageState = await request.storageState();

  await request.dispose();

  const context = await browser.newContext({
    deviceScaleFactor: 1,
    storageState,
    viewport: { height: width >= 1024 ? 900 : 844, width },
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
    page.getByRole("heading", { level: 1, name: /Good (?:morning|afternoon|evening)/u }),
  ).toBeVisible();

  return { context, page };
}

async function sectionTops(page: Page) {
  const boxes = await Promise.all(
    SECTION_IDS.map(async (id) => page.locator(`#${id}`).boundingBox()),
  );

  return boxes.map((box, index) => {
    expect(box, `${SECTION_IDS[index] ?? "section"} is drawn`).not.toBeNull();

    return box?.y ?? 0;
  });
}

function expectAscending(tops: readonly number[], label: string) {
  for (const [index, top] of tops.entries()) {
    if (index === 0) {
      continue;
    }

    expect(top, `${label}: section ${String(index)} follows the one above`).toBeGreaterThan(
      tops[index - 1] ?? 0,
    );
  }
}

test("Home leads with what needs you first, then what is happening", async ({
  browser,
  homeServer,
}) => {
  const { context, page } = await openHome(browser, homeServer.url, 1280);

  try {
    const tops = await sectionTops(page);

    expectAscending(tops, "1280px");

    const control = await page.getByRole("heading", { name: "Application sending" }).boundingBox();

    expect(control).not.toBeNull();
    expect(tops[0] ?? 0).toBeGreaterThan(control?.y ?? 0);

    await expect(page.getByRole("heading", { name: "Needs your answer" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ready to send" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "In progress" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recruiter replies" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "New matches" })).toBeVisible();

    await expect(page.getByText("1 open", { exact: true })).toBeVisible();
    await expect(page.getByText("2 ready", { exact: true })).toBeVisible();
    await expect(page.getByText("Sending", { exact: true })).toBeVisible();
    await expect(page.getByText("Preparing", { exact: true })).toBeVisible();
    await expect(page.getByText("Queued · sends at 2:15 PM", { exact: true })).toBeVisible();
    await expect(page.getByText("Queued · next in line", { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("every section count and row opens the exact place it names", async ({
  browser,
  homeServer,
}) => {
  const { context, page } = await openHome(browser, homeServer.url, 1280);

  try {
    await expect(
      page.getByRole("link", { name: "Open Review: Needs your answer, 1 open" }),
    ).toHaveAttribute("href", "/review");
    await expect(
      page.getByRole("link", { name: "Open Ready: Ready to send, 2 ready" }),
    ).toHaveAttribute("href", "/ready");
    await expect(
      page.getByRole("link", { name: "Open Tracker: In progress, 4 moving" }),
    ).toHaveAttribute("href", "/tracker");
    await expect(
      page.getByRole("link", { name: "Open Inbox: Recruiter replies, 2 recent" }),
    ).toHaveAttribute("href", "/inbox");
    await expect(
      page.getByRole("link", { name: "Open Matches: New matches, 3 new" }),
    ).toHaveAttribute("href", "/matches");

    const needsSection = page.locator('section[aria-labelledby="home-needs-you"]');

    await expect(needsSection.locator('a[href^="/review?question="]')).toHaveCount(1);

    const readySection = page.locator('section[aria-labelledby="home-ready-title"]');

    await expect(readySection.locator('a[href="/ready"]')).toHaveCount(3);

    const progressSection = page.locator('section[aria-labelledby="home-in-progress"]');

    await expect(progressSection.locator('a[href^="/tracker?application="]')).toHaveCount(4);

    const repliesSection = page.locator('section[aria-labelledby="home-replies"]');

    await expect(repliesSection.locator('a[href^="/inbox/"]')).toHaveCount(2);
    await expect(repliesSection.locator('a[href^="/inbox/"]').first()).toHaveAttribute(
      "href",
      /^\/inbox\/[0-9a-f-]{36}$/u,
    );

    const matchesSection = page.locator('section[aria-labelledby="home-matches"]');

    await expect(matchesSection.locator('a[href="/matches"]')).toHaveCount(4);

    const progressRow = progressSection.locator('a[href^="/tracker?application="]').first();

    await progressRow.click();

    await expect(page).toHaveURL(/\/tracker\?.*application=/u);
    await expect(page.locator('dialog[aria-label="Application detail"]')).toBeVisible();
  } finally {
    await context.close();
  }
});

test("a section that fails to load keeps a Retry that recovers it", async ({
  browser,
  homeServer,
}) => {
  const request = await apiRequest.newContext({ baseURL: homeServer.url });

  await seedAttention(request, homeServer.url);

  const storageState = await request.storageState();

  await request.dispose();

  const context = await browser.newContext({
    storageState,
    viewport: { height: 900, width: 1280 },
  });

  const page = await context.newPage();

  try {
    await page.clock.setFixedTime(new Date(2026, 10, 17, 11, 0, 0));
    await page.route("**/api/home", async (route) => {
      await route.fulfill({ body: "{}", contentType: "application/json", status: 500 });
    });

    await page.goto(`${homeServer.url}/home`);

    const alert = page.getByRole("alert").filter({ hasText: "Home could not be loaded" });

    await expect(alert).toBeVisible();
    await expect(page.locator("#home-needs-you")).toHaveCount(0);

    await page.unroute("**/api/home");
    await page.getByRole("button", { name: "Retry" }).click();

    await expect(page.getByRole("heading", { name: "Needs your answer" })).toBeVisible();
    await expect(page.getByText("Queued · sends at 2:15 PM", { exact: true })).toBeVisible();

    await page.route("**/api/ready", async (route) => {
      await route.fulfill({ body: "{}", contentType: "application/json", status: 500 });
    });

    await page.reload();

    const readyFailed = page
      .locator('section[aria-labelledby="home-ready-title"]')
      .getByRole("alert");

    await expect(readyFailed).toContainText("This section could not be loaded.", {
      timeout: 15_000,
    });

    await page.unroute("**/api/ready");
    await readyFailed.getByRole("button", { name: "Retry" }).click();

    await expect(page.getByRole("heading", { name: "Ready to send" })).toBeVisible();
    await expect(page.getByText("2 ready", { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("New matches shows Scoring until a score exists and never the ranking points", async ({
  browser,
  homeServer,
}) => {
  const request = await apiRequest.newContext({ baseURL: homeServer.url });

  await seedAttention(request, homeServer.url);

  const body = await (await request.get("/api/matches")).text();

  expect(body).not.toContain("codeRank");
  expect(body).not.toContain("97.4");
  expect(body).not.toContain("93.8");

  const matches = z
    .object({
      items: z.array(
        z.object({ company: z.string(), score: z.number().nullable(), title: z.string() }),
      ),
      total: z.number(),
    })
    .parse(JSON.parse(body));

  expect(matches.total).toBe(3);
  expect(matches.items.map((row) => row.score)).toEqual([92, 81, null]);

  const storageState = await request.storageState();

  await request.dispose();

  const context = await browser.newContext({
    storageState,
    viewport: { height: 900, width: 1280 },
  });

  const page = await context.newPage();

  try {
    await page.goto(`${homeServer.url}/home`);

    const homeMatches = page.locator('section[aria-labelledby="home-matches"]');

    await expect(homeMatches.getByText("92% match")).toBeVisible();
    await expect(homeMatches.getByText("Scoring…")).toBeVisible();
    await expect(homeMatches.getByText("97.4")).toHaveCount(0);

    await page.goto(`${homeServer.url}/matches`);

    await expect(page.getByRole("heading", { level: 1, name: "Matches" })).toBeVisible();
    await expect(page.getByText("92% match").filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText("81% match").filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText("Scoring…").filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText("97.4")).toHaveCount(0);
    await expect(page.getByText("93.8")).toHaveCount(0);

    const results = await new AxeBuilder({ page }).analyze();

    expect(results.violations).toEqual([]);

    await page.route("**/api/matches*", async (route) => {
      await route.fulfill({ body: "{}", contentType: "application/json", status: 500 });
    });

    await page.reload();

    const failed = page.getByRole("alert").filter({ hasText: "Matches could not be loaded" });

    await expect(failed).toBeVisible({ timeout: 15_000 });

    await page.unroute("**/api/matches*");
    await page.getByRole("button", { name: "Retry" }).click();

    await expect(page.getByText("92% match").filter({ visible: true }).first()).toBeVisible();
  } finally {
    await context.close();
  }
});

test("the attention order, axe and width hold at 390 and 1280 in light and dark", async ({
  browser,
  homeServer,
}) => {
  test.slow();

  const request = await apiRequest.newContext({ baseURL: homeServer.url });

  await seedAttention(request, homeServer.url);

  const storageState = await request.storageState();

  await request.dispose();

  await Promise.all(
    ([390, 1280] as const).flatMap((width) =>
      (["light", "dark"] as const).map(async (theme) => {
        const context = await browser.newContext({
          deviceScaleFactor: 1,
          storageState,
          viewport: { height: width >= 1024 ? 900 : 844, width },
        });

        const page = await context.newPage();

        try {
          await page.clock.setFixedTime(new Date(2026, 10, 17, 11, 0, 0));

          if (theme === "dark") {
            await page.addInitScript(() => {
              globalThis.localStorage.setItem("overture.theme", "dark");
            });
          }

          await page.goto(`${homeServer.url}/home`);

          expectAscending(await sectionTops(page), `${String(width)}px ${theme}`);

          await expect(
            page.getByRole("link", { name: "Open Matches: New matches, 3 new" }),
          ).toBeVisible();

          await page.evaluate(async () => {
            await document.fonts.ready;
          });

          const results = await new AxeBuilder({ page }).analyze();

          expect(results.violations, `${String(width)}px ${theme}`).toEqual([]);

          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
          );

          expect(overflow, `${String(width)}px ${theme}`).toBe(false);

          await page.goto(`${homeServer.url}/matches`);

          await expect(page.getByText("Scoring…").filter({ visible: true }).first()).toBeVisible();

          const matchesResults = await new AxeBuilder({ page }).analyze();

          expect(matchesResults.violations, `${String(width)}px ${theme} matches`).toEqual([]);

          const matchesOverflow = await page.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
          );

          expect(matchesOverflow, `${String(width)}px ${theme} matches`).toBe(false);
        } finally {
          await context.close();
        }
      }),
    ),
  );
});

test("captures Home at 390 and 1280 in light and dark", async ({ browser, homeServer }) => {
  if (SHOT_DIR === null) {
    test.skip();

    return;
  }

  mkdirSync(SHOT_DIR, { recursive: true });

  const request = await apiRequest.newContext({ baseURL: homeServer.url });

  await seedAttention(request, homeServer.url);

  const storageState = await request.storageState();

  await request.dispose();

  await Promise.all(
    (["light", "dark"] as const).flatMap((theme) =>
      [390, 1280].map(async (width) => {
        const context = await browser.newContext({
          deviceScaleFactor: 1,
          storageState,
          viewport: { height: width >= 1024 ? 900 : 844, width },
        });

        const page = await context.newPage();

        try {
          await page.clock.setFixedTime(new Date(2026, 10, 17, 11, 0, 0));

          if (theme === "dark") {
            await page.addInitScript(() => {
              globalThis.localStorage.setItem("overture.theme", "dark");
            });
          }

          await page.goto(`${homeServer.url}/home`);
          await expect(page.getByRole("heading", { name: "Needs your answer" })).toBeVisible();

          await page.evaluate(async () => {
            await document.fonts.ready;
          });

          await page.screenshot({
            animations: "disabled",
            caret: "hide",
            fullPage: true,
            path: join(SHOT_DIR, `${String(width)}-${theme}.png`),
          });

          await page.goto(`${homeServer.url}/matches`);

          await expect(page.getByRole("heading", { level: 1, name: "Matches" })).toBeVisible();

          await page.screenshot({
            animations: "disabled",
            caret: "hide",
            fullPage: true,
            path: join(SHOT_DIR, `matches-${String(width)}-${theme}.png`),
          });
        } finally {
          await context.close();
        }
      }),
    ),
  );
});
