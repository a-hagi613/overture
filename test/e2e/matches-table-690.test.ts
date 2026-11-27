import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { AxeBuilder } from "@axe-core/playwright";

import type { Browser, Page } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import {
  configureMatching,
  grantApplications,
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

const test = appTest.extend<{ matchesServer: AppServer }>({
  matchesServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

test.use({ trace: "off" });

const SHOT_DIR = join(process.cwd(), "docs/screenshots/690");

const DAY = 86_400_000;
const POSTED = Date.UTC(2026, 10, 16, 9, 0, 0);

const THREE_REASONS = "Same backend stack. Toronto role. Pay above target.";

interface SeededJob {
  atsJobId: string;
  picked?: boolean;
  reason?: string;
  score: number | null;
  title: string;
}

const JOBS: SeededJob[] = [
  { atsJobId: "job-1", reason: THREE_REASONS, score: 96, title: "Staff Platform Engineer" },
  {
    atsJobId: "job-2",
    reason: '["Same backend stack","Toronto role"]',
    score: 92,
    title: "Senior Backend Engineer",
  },
  { atsJobId: "job-3", reason: "Backend role in Toronto.", score: 88, title: "Backend Engineer" },
  { atsJobId: "job-4", reason: "Platform work you know.", score: 84, title: "Platform Engineer" },
  { atsJobId: "job-5", reason: "Reliability focus.", score: 80, title: "Senior SRE" },
  { atsJobId: "job-6", reason: "Data pipelines.", score: 76, title: "Data Engineer" },
  { atsJobId: "job-7", reason: "Close role fit.", score: 72, title: "Infrastructure Engineer" },
  { atsJobId: "job-8", picked: true, reason: "DevOps role.", score: 68, title: "DevOps Engineer" },
  { atsJobId: "job-9", reason: "Cloud platforms.", score: 64, title: "Cloud Engineer" },
  { atsJobId: "job-10", reason: "Backend services.", score: 60, title: "Backend Engineer II" },
  { atsJobId: "job-11", reason: "Systems work.", score: 56, title: "Systems Engineer" },
  { atsJobId: "job-12", score: null, title: "Scoring Engineer" },
];

async function seedMatches(appServerUrl: string) {
  const { owner, userId } = await ownerContextFor(appServerUrl);

  await configureMatching(owner);
  await grantApplications(owner, 20);

  const companies = [
    { domain: "northwind.example", name: "Northwind Labs", token: "northwind" },
    { domain: "halden.example", name: "Halden Systems", token: "halden" },
    { domain: "ferro.example", name: "Ferro Cloud", token: "ferro" },
  ];

  const boards = await Promise.all(
    companies.map(async (company) => {
      const companyId = await seedCompany(owner, company.name, company.domain);

      return {
        boardId: await seedBoard(owner, companyId, "greenhouse", company.token),
        companyId,
      };
    }),
  );

  await Promise.all(
    JOBS.map(async (job, index) => {
      const board = boards.at(index % boards.length);

      if (board === undefined) {
        throw new Error("every seeded job needs a board");
      }

      const postingId = await seedPosting(owner, {
        atsJobId: job.atsJobId,
        boardId: board.boardId,
        companyId: board.companyId,
        locationRaw: "Toronto, ON",
        postedAt: POSTED - index * DAY,
        title: job.title,
        url: `https://northwind.example/${job.atsJobId}`,
      });

      await owner.post("/__test__/matches/seed", {
        data: {
          codeRank: 100 - index,
          postingId,
          reason: job.reason ?? null,
          score: job.score,
          userId,
        },
      });

      if (job.picked === true) {
        await seedApplication(owner, { postingId, status: "preparing", userId });
      }
    }),
  );

  const closedBoard = boards.at(0);

  if (closedBoard === undefined) {
    throw new Error("the closed job needs a board");
  }

  const closedId = await seedPosting(owner, {
    atsJobId: "job-closed",
    boardId: closedBoard.boardId,
    companyId: closedBoard.companyId,
    locationRaw: "Toronto, ON",
    postedAt: POSTED,
    title: "Closed Engineer",
    url: "https://northwind.example/job-closed",
  });

  await owner.post("/__test__/matches/seed", {
    data: { codeRank: 200, postingId: closedId, reason: "Closed role.", score: 99, userId },
  });

  await owner.post("/__test__/catalog/postings/close", { data: { id: closedId } });

  return owner;
}

async function storageFor(appServerUrl: string) {
  const owner = await seedMatches(appServerUrl);

  const storageState = await owner.storageState();

  await owner.dispose();

  return storageState;
}

async function openMatches(
  browser: Browser,
  appServerUrl: string,
  options: { from: "home" | "sidebar" | "url"; theme?: "dark" | "light"; width: number },
) {
  const storageState = await storageFor(appServerUrl);

  const context = await browser.newContext({
    deviceScaleFactor: 1,
    storageState,
    viewport: { height: options.width >= 1024 ? 900 : 844, width: options.width },
  });

  const page = await context.newPage();

  await page.clock.setFixedTime(new Date(2026, 10, 17, 11, 0, 0));

  if (options.theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  if (options.from === "url") {
    await page.goto(`${appServerUrl}/matches`);
  } else {
    await page.goto(`${appServerUrl}/home`);

    if (options.from === "sidebar") {
      await page
        .getByRole("navigation", { name: "Main" })
        .getByRole("link", { name: "Matches", exact: true })
        .click();
    } else {
      await page.getByRole("link", { name: /Open Matches/u }).click();
    }
  }

  await expect(page.getByRole("heading", { level: 1, name: "Matches" })).toBeVisible();
  await expect(page.getByText("96% match").filter({ visible: true })).toBeVisible();

  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  return { context, page };
}

async function rowTitles(page: Page) {
  const cells = page.locator("table tbody tr td:first-child");

  return cells.allInnerTexts();
}

async function expectNoOverflowAndAxe(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );

  expect(overflow, `horizontal overflow at ${label}`).toBeLessThanOrEqual(0);

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations, `axe at ${label}`).toEqual([]);
}

async function shoot(page: Page, name: string) {
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ fullPage: true, path: join(SHOT_DIR, `${name}.png`) });
}

test.describe("the Matches table", () => {
  test.setTimeout(240_000);

  test("opens from the sidebar, pages without repeating, expands reasons and applies from a row", async ({
    browser,
    matchesServer,
  }) => {
    const { context, page } = await openMatches(browser, matchesServer.url, {
      from: "sidebar",
      width: 1280,
    });

    try {
      expect(await rowTitles(page)).toHaveLength(10);
      expect(await rowTitles(page)).not.toContain("Closed Engineer");

      const apiPage = await page.request.get(`${matchesServer.url}/api/matches?page=1&pageSize=10`);
      const apiBody = await apiPage.text();

      expect(apiPage.status()).toBe(200);
      expect(apiBody).not.toContain("codeRank");
      expect(JSON.parse(apiBody)).toMatchObject({
        page: 1,
        pageSize: 10,
        total: 12,
        totalPages: 2,
      });

      const badPage = await page.request.get(`${matchesServer.url}/api/matches?page=zero`);

      expect(badPage.status()).toBe(400);

      await expect(page.getByRole("columnheader", { name: "Match score" })).toHaveAttribute(
        "aria-sort",
        "descending",
      );
      await expect(page.getByRole("row").nth(1)).toContainText("96% match");
      await expect(page.getByText("Scoring…")).toHaveCount(0);

      const firstPage = await rowTitles(page);

      await page.getByRole("button", { name: "Next page" }).click();

      await expect(page).toHaveURL(/page=2/u);
      await expect(page.getByText("Page 2 of 2")).toBeVisible();
      await expect(page.getByText("Scoring…").filter({ visible: true }).first()).toBeVisible();

      const secondPage = await rowTitles(page);

      expect(secondPage).toHaveLength(2);
      expect([...new Set([...firstPage, ...secondPage])]).toHaveLength(12);

      await page.getByRole("button", { name: "Previous page" }).click();

      await expect(page).toHaveURL(/\/matches$/u);
      await expect(page.getByText("Page 1 of 2")).toBeVisible();
      await expect(page.getByRole("row").nth(1)).toContainText("Staff Platform Engineer");
      expect(await rowTitles(page)).toEqual(firstPage);

      const reasonsButton = page.getByRole("button", {
        name: "Show 3 reasons for Staff Platform Engineer",
      });

      await reasonsButton.click();

      const hideButton = page.getByRole("button", {
        name: "Hide reasons for Staff Platform Engineer",
      });

      await expect(hideButton).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByText("Pay above target.").filter({ visible: true })).toBeVisible();
      await hideButton.click();
      await expect(page.getByText("Pay above target.").filter({ visible: true })).toHaveCount(0);

      const pickedRow = page.getByRole("row").filter({ hasText: "DevOps Engineer" });

      await expect(
        pickedRow.getByRole("link", { name: "View application for DevOps Engineer" }),
      ).toBeVisible();

      const applyRow = page.getByRole("row").filter({ hasText: "Backend Engineer II" });

      await applyRow.getByRole("button", { name: "Apply" }).click();

      await expect(page).toHaveURL(/\/tracker\?application=/u);
      await expect(
        page.getByRole("heading", { level: 1, name: "Application Tracker" }),
      ).toBeVisible();

      await page.goto(`${matchesServer.url}/matches`);

      await expect(
        page
          .getByRole("row")
          .filter({ hasText: "Backend Engineer II" })
          .getByRole("link", { name: "View application for Backend Engineer II" }),
      ).toBeVisible();

      await expectNoOverflowAndAxe(page, "1280 light");
    } finally {
      await context.close();
    }
  });

  test("sorts by a header without losing the sticky header", async ({ browser, matchesServer }) => {
    const { context, page } = await openMatches(browser, matchesServer.url, {
      from: "sidebar",
      width: 1280,
    });

    try {
      await page.getByRole("button", { name: "Job" }).click();

      await expect(page.getByRole("columnheader", { name: "Job" })).toHaveAttribute(
        "aria-sort",
        "ascending",
      );
      await expect(page.getByRole("row").nth(1)).toContainText("Backend Engineer");
      await expect(page.locator("thead").first()).toHaveClass(/sticky/u);
    } finally {
      await context.close();
    }
  });

  for (const width of [1280, 390]) {
    for (const theme of ["light", "dark"] as const) {
      test(`matches the design at ${String(width)}px in ${theme}`, async ({
        browser,
        matchesServer,
      }) => {
        const { context, page } = await openMatches(browser, matchesServer.url, {
          from: width === 390 ? "home" : "sidebar",
          theme,
          width,
        });

        try {
          await assertTableFits(page, width);
          await expectNoOverflowAndAxe(page, `${String(width)}px ${theme}`);
          await shoot(page, `matches-${String(width)}-${theme}`);
        } finally {
          await context.close();
        }
      });
    }
  }
});

async function assertTableFits(page: Page, width: number) {
  if (width === 390) {
    await expect(page.locator("table").first()).toBeHidden();
    await expect(page.getByRole("article").first()).toBeVisible();
  } else {
    await expect(page.locator("table").first()).toBeVisible();
    await expect(page.getByRole("article").first()).toBeHidden();
  }
}
