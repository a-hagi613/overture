import { readFileSync } from "node:fs";

import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext, Browser, Page } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { seedUnreadNotifications } from "./notification-seed.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";

const test = appTest.extend<{ boardServer: AppServer }>({
  boardServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

const boardTargets = {
  roles: [
    "Platform Engineer",
    "Senior Backend Engineer",
    "DevOps Engineer",
    "Infrastructure Engineer",
    "Site Reliability Engineer",
  ],
  seniorities: ["senior", "staff"],
  workplaces: ["remote", "hybrid"],
  locations: ["Toronto, ON", "Vancouver, BC", "Austin, TX"],
  employmentTypes: ["full_time"],
  salaryFloorMinor: 14_000_000,
  salaryCurrency: "CAD",
  salaryPeriod: "year",
};

const createdSchema = z.object({ id: z.string() });

async function seedOwner(request: APIRequestContext, appServerUrl: string) {
  await requestMagicLink(appServerUrl, request, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, request, authTestIdentity.ownerEmail);

  await request.get(link);

  await request.post(`${appServerUrl}/__test__/user/name`, {
    data: { email: authTestIdentity.ownerEmail, name: authTestIdentity.ownerName },
  });
  await seedUnreadNotifications(request, appServerUrl);
  await request.post("/api/running", { data: { running: true } });

  await request.put("/api/profile/languages", { data: { languages: ["en"] } });

  await request.post("/api/profile/resume", {
    multipart: {
      file: {
        name: "resume.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(readFileSync("test/e2e/fixtures/resume-text.pdf")),
      },
    },
  });

  await request.put("/api/profile/skip-companies", {
    data: {
      companies: [
        { name: "Quillon Payments", domain: null },
        { name: "Fenwick & Marsh", domain: null },
      ],
    },
  });

  await request.put("/api/profile/targets", { data: boardTargets });
}

async function seedMatchingPostings(request: APIRequestContext) {
  const companyResponse = await request.post("/__test__/catalog/companies", {
    data: { name: "Board Seed Co", domain: "board-seed.example" },
  });

  if (!companyResponse.ok()) {
    throw new Error(`company seed failed: ${String(companyResponse.status())}`);
  }

  const company = createdSchema.parse(await companyResponse.json());

  const boardResponse = await request.post("/__test__/catalog/boards", {
    data: { companyId: company.id, ats: "greenhouse", boardToken: "board-seed" },
  });

  const board = createdSchema.parse(await boardResponse.json());

  const postings = Array.from({ length: 206 }, (_, index) => ({
    boardId: board.id,
    companyId: company.id,
    ats: "greenhouse",
    atsJobId: `board-seed-${String(index)}`,
    url: `https://board-seed.example/${String(index)}`,
    title: "Senior Backend Engineer",
    workplace: "remote",
    employmentType: "full_time",
    language: "en",
    locationRaw: "Toronto, Ontario, Canada",
    countryCode: "CA",
    region: "Ontario",
    city: "Toronto",
    tags: [
      { dimension: "subrole", value: "Backend" },
      { dimension: "seniority", value: "senior" },
    ],
  }));

  const seeded = await request.post("/__test__/catalog/postings/bulk", {
    data: { postings },
  });

  if (!seeded.ok()) {
    throw new Error(`posting seed failed: ${String(seeded.status())}`);
  }
}

async function openProfile(page: Page, appServerUrl: string, theme: string) {
  if (theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  await page.goto(`${appServerUrl}/profile`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("targets-matched-count")).toHaveText("213");
  await expect(page.getByText("Platform Engineer")).toBeVisible();
  await expect(page.getByText("Brightwave Analytics").first()).toBeVisible();
  await page.evaluate(async () => document.fonts.ready);
}

async function expectProfileMatchesBoard(
  browser: Browser,
  appServerUrl: string,
  width: number,
  theme: string,
) {
  const request = await apiRequest.newContext({ baseURL: appServerUrl });

  await seedOwner(request, appServerUrl);
  await seedMatchingPostings(request);

  const storageState = await request.storageState();

  await request.dispose();

  const context = await browser.newContext({ storageState });
  const profilePage = await context.newPage();

  await profilePage.setViewportSize({ width, height: width === 1280 ? 800 : 844 });
  await openProfile(profilePage, appServerUrl, theme);

  const results = await new AxeBuilder({ page: profilePage }).analyze();

  expect(results.violations, `${String(width)}px ${theme}`).toEqual([]);

  const contentHeight = await profilePage.evaluate(() => document.documentElement.scrollHeight);

  await profilePage.setViewportSize({ width, height: contentHeight });
  await expect(profilePage).toHaveScreenshot(`${String(width)}-${theme}.png`, {
    maxDiffPixelRatio: 0.01,
  });
  await context.close();
}

test("the Profile page matches the board at 1280px in light", async ({ browser, boardServer }) => {
  await expectProfileMatchesBoard(browser, boardServer.url, 1280, "light");
});

test("the Profile page matches the board at 1280px in dark", async ({ browser, boardServer }) => {
  await expectProfileMatchesBoard(browser, boardServer.url, 1280, "dark");
});

test("the Profile page matches the board at 390px in light", async ({ browser, boardServer }) => {
  await expectProfileMatchesBoard(browser, boardServer.url, 390, "light");
});

test("the Profile page matches the board at 390px in dark", async ({ browser, boardServer }) => {
  await expectProfileMatchesBoard(browser, boardServer.url, 390, "dark");
});
