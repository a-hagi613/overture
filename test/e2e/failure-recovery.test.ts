import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { AxeBuilder } from "@axe-core/playwright";
import { z } from "zod";

import type { APIRequestContext, Browser, Page } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import {
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

const test = appTest.extend<{ recoveryServer: AppServer }>({
  recoveryServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

const APPLY_URL = "https://apply.ferro.example/devops/apply";
const POSTING_URL = "https://jobs.ferro.example/devops";
const FALLBACK_POSTING_URL = "https://jobs.ferro.example/platform";

const LOGIN_WALL_REASON =
  "This employer requires creating an account to apply, so Overture skipped it.";

type SeedPostingInput = Parameters<typeof seedPosting>[1];

const POSTING_SEED: Omit<
  SeedPostingInput,
  "applyUrl" | "atsJobId" | "boardId" | "companyId" | "title" | "url"
> = {
  ats: "greenhouse",
  countryCode: "CA",
  employmentType: "full_time",
  language: "en",
  locationRaw: "Remote, Canada",
  salaryCurrency: "CAD",
  salaryMinMinor: 15_000_000,
  salaryPeriod: "year",
  tags: [
    { dimension: "subrole", value: "Backend" },
    { dimension: "seniority", value: "senior" },
  ],
  workplace: "remote",
};

const homeFailureSchema = z.object({
  activity: z.object({
    failed: z.array(
      z.object({
        applyUrl: z.string().nullable(),
        company: z.string(),
        id: z.string(),
        reason: z.string(),
        title: z.string(),
      }),
    ),
  }),
});

const detailSchema = z.object({
  posting: z.object({ applyUrl: z.string().nullable(), url: z.string() }),
});

interface Fixtures {
  boardId: string;
  companyId: string;
  owner: APIRequestContext;
  userId: string;
}

async function seedOwnerWithCatalog(appServerUrl: string) {
  const { owner, userId } = await ownerContextFor(appServerUrl);
  const companyId = await seedCompany(owner, "Ferro Cloud", "ferro.example");
  const boardId = await seedBoard(owner, companyId, "greenhouse", "ferro-cloud");

  return { boardId, companyId, owner, userId };
}

async function seedFailedApplication(
  request: APIRequestContext,
  fixtures: Fixtures,
  input: { applyUrl: string | null; createdAt: number; postingUrl: string; title: string },
) {
  const postingId = await seedPosting(request, {
    ...POSTING_SEED,
    applyUrl: input.applyUrl,
    atsJobId: `ferro-${input.title}`,
    boardId: fixtures.boardId,
    companyId: fixtures.companyId,
    title: input.title,
    url: input.postingUrl,
  });

  const applicationId = await seedApplication(request, {
    createdAt: input.createdAt,
    postingId,
    status: "failed",
    userId: fixtures.userId,
  });

  const status = await request.post("/__test__/applications/status", {
    data: { applicationId, status: "failed", statusReason: "unsupported_login_required" },
  });

  expect(status.ok()).toBe(true);

  const events = await request.post("/__test__/applications/events/seed", {
    data: {
      applicationId,
      events: [
        {
          at: input.createdAt + 1000,
          detail: null,
          fromValue: "sending",
          kind: "status",
          source: "system",
          toValue: "failed",
        },
      ],
    },
  });

  expect(events.ok()).toBe(true);

  return applicationId;
}

async function expectAxeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations, `axe at ${label}`).toEqual([]);
}

async function shoot(page: Page, name: string, fullPage = true) {
  const dir = process.env.WS16_SCREENSHOT_DIR;

  if (dir === undefined || dir === "") {
    return;
  }

  mkdirSync(dir, { recursive: true });
  await page.screenshot({ fullPage, path: join(dir, `${name}.png`) });
}

async function openSignedIn(
  browser: Browser,
  appServerUrl: string,
  width: number,
  theme: "light" | "dark",
  path: string,
) {
  const fixtures = await seedOwnerWithCatalog(appServerUrl);

  const applicationId = await seedFailedApplication(fixtures.owner, fixtures, {
    applyUrl: APPLY_URL,
    createdAt: Date.UTC(2026, 10, 17, 11, 0, 0),
    postingUrl: POSTING_URL,
    title: "DevOps Engineer",
  });

  const storageState = await fixtures.owner.storageState();

  const context = await browser.newContext({
    storageState,
    timezoneId: "America/Toronto",
    viewport: { height: width === 390 ? 844 : 900, width },
  });

  const page = await context.newPage();

  if (theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  await page.addInitScript(() => {
    globalThis.localStorage.setItem("overture.rail", "0");
  });

  await page.goto(`${appServerUrl}${path}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  return { applicationId, context, page };
}

test("failed applications carry a safe apply URL, falling back to the posting URL", async ({
  recoveryServer,
}) => {
  const fixtures = await seedOwnerWithCatalog(recoveryServer.url);

  const fallbackId = await seedFailedApplication(fixtures.owner, fixtures, {
    applyUrl: null,
    createdAt: Date.UTC(2026, 10, 17, 11, 0, 0),
    postingUrl: FALLBACK_POSTING_URL,
    title: "Platform Engineer",
  });

  const fallbackHome = homeFailureSchema.parse(
    await (await fixtures.owner.get("/api/home")).json(),
  );

  expect(fallbackHome.activity.failed.map((row) => row.applyUrl)).toEqual([FALLBACK_POSTING_URL]);

  const fallbackDetail = detailSchema.parse(
    await (await fixtures.owner.get(`/api/applications/${encodeURIComponent(fallbackId)}`)).json(),
  );

  expect(fallbackDetail.posting.applyUrl).toBe(FALLBACK_POSTING_URL);

  await fixtures.owner.post("/__test__/clock/offset", { data: { offsetMs: 60_000 } });

  const explicitId = await seedFailedApplication(fixtures.owner, fixtures, {
    applyUrl: APPLY_URL,
    createdAt: Date.UTC(2026, 10, 17, 11, 1, 0),
    postingUrl: POSTING_URL,
    title: "DevOps Engineer",
  });

  const home = homeFailureSchema.parse(await (await fixtures.owner.get("/api/home")).json());

  expect(home.activity.failed.map((row) => row.applyUrl)).toEqual([APPLY_URL]);
  expect(home.activity.failed[0]?.reason).toBe(LOGIN_WALL_REASON);

  const detail = detailSchema.parse(
    await (await fixtures.owner.get(`/api/applications/${encodeURIComponent(explicitId)}`)).json(),
  );

  expect(detail.posting.applyUrl).toBe(APPLY_URL);

  await fixtures.owner.dispose();
});

test("an unsafe apply URL is dropped and the posting URL is used instead", async ({
  recoveryServer,
}) => {
  const fixtures = await seedOwnerWithCatalog(recoveryServer.url);

  const applicationId = await seedFailedApplication(fixtures.owner, fixtures, {
    applyUrl: ["java", "script:alert(1)"].join(""),
    createdAt: Date.UTC(2026, 10, 17, 11, 0, 0),
    postingUrl: POSTING_URL,
    title: "DevOps Engineer",
  });

  const home = homeFailureSchema.parse(await (await fixtures.owner.get("/api/home")).json());

  expect(home.activity.failed[0]?.applyUrl).toBe(POSTING_URL);

  const detail = detailSchema.parse(
    await (
      await fixtures.owner.get(`/api/applications/${encodeURIComponent(applicationId)}`)
    ).json(),
  );

  expect(detail.posting.applyUrl).toBe(POSTING_URL);

  await fixtures.owner.dispose();
});

for (const [width, theme] of [
  [390, "light"],
  [390, "dark"],
  [1280, "light"],
  [1280, "dark"],
] as const) {
  test(`the failure recovery block links to the employer at ${String(width)}px ${theme}`, async ({
    browser,
    recoveryServer,
  }) => {
    const { applicationId, context, page } = await openSignedIn(
      browser,
      recoveryServer.url,
      width,
      theme,
      "/home",
    );

    const failures = page.getByTestId("home-failures");

    await expect(failures).toContainText("Couldn't apply");
    await expect(failures).toContainText("Ferro Cloud, DevOps Engineer");
    await expect(failures).toContainText(LOGIN_WALL_REASON);
    await expect(failures).toContainText("Nothing was sent · 0 applications charged");

    const homeLink = failures.getByRole("link", { name: "Apply on company site: Ferro Cloud" });

    await expect(homeLink).toBeVisible();
    await expect(homeLink).toHaveAttribute("href", APPLY_URL);
    await expect(homeLink).toHaveAttribute("target", "_blank");
    await expect(homeLink).toHaveAttribute("rel", "noopener noreferrer");

    const box = await homeLink.boundingBox();

    expect(box).not.toBeNull();

    if (box !== null && width === 390) {
      expect(box.height, "44px phone touch target").toBeGreaterThanOrEqual(44);
    }

    await expectAxeClean(page, `Home ${String(width)} ${theme}`);
    await shoot(page, `home-failure-${String(width)}-${theme}`);

    await page.goto(`${recoveryServer.url}/applications?card=${encodeURIComponent(applicationId)}`);

    const timeline = page.getByRole("tab", { name: "Timeline" });

    await timeline.click();

    const panel = page.getByRole("tabpanel");
    const failure = panel.getByText("Couldn't apply", { exact: true }).first();

    await expect(failure).toBeVisible();
    await expect(panel).toContainText(LOGIN_WALL_REASON);
    await expect(panel).toContainText("Nothing was sent · 0 applications charged");

    const timelineLink = panel.getByRole("link", { name: "Apply on company site: Ferro Cloud" });

    await expect(timelineLink).toBeVisible();
    await expect(timelineLink).toHaveAttribute("href", APPLY_URL);
    await expect(timelineLink).toHaveAttribute("target", "_blank");
    await expect(timelineLink).toHaveAttribute("rel", "noopener noreferrer");

    await expectAxeClean(page, `Timeline ${String(width)} ${theme}`);
    await shoot(page, `timeline-failure-${String(width)}-${theme}`);

    await context.close();
  });
}

const VIEWPORTS = [
  [390, "light"],
  [390, "dark"],
  [1280, "light"],
  [1280, "dark"],
] as const;

async function captureLanding(
  browser: Browser,
  appServerUrl: string,
  width: number,
  theme: "light" | "dark",
) {
  const context = await browser.newContext({
    timezoneId: "America/Toronto",
    viewport: { height: width === 390 ? 844 : 900, width },
  });

  const page = await context.newPage();

  if (theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  await page.goto(`${appServerUrl}/`);
  await expect(page.locator("body")).toContainText("saved answers");
  await expect(page.locator("body")).not.toContainText("Facts");
  await expect(page.locator("body")).not.toContainText("via Greenhouse");
  await expect(page.locator("body")).not.toContainText("Sent via ");

  await expectAxeClean(page, `Landing ${String(width)} ${theme}`);
  await shoot(page, `landing-copy-${String(width)}-${theme}`, false);

  await context.close();
}

async function captureProfile(
  browser: Browser,
  appServerUrl: string,
  storageState: Awaited<ReturnType<APIRequestContext["storageState"]>>,
  width: number,
  theme: "light" | "dark",
) {
  const context = await browser.newContext({
    storageState,
    timezoneId: "America/Toronto",
    viewport: { height: width === 390 ? 844 : 900, width },
  });

  const page = await context.newPage();

  if (theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  await page.goto(`${appServerUrl}/profile/details`);
  await expect(page.getByRole("heading", { level: 1, name: "Saved answers" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Personal Details");
  await expect(page.locator("body")).not.toContainText("Facts");

  await expectAxeClean(page, `Profile ${String(width)} ${theme}`);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(500);
  await shoot(page, `profile-copy-${String(width)}-${theme}`, width !== 390);

  await context.close();
}

test("the landing and signed-in copy say saved answers, never Facts", async ({
  browser,
  recoveryServer,
}) => {
  await Promise.all(
    VIEWPORTS.map(async ([width, theme]) =>
      captureLanding(browser, recoveryServer.url, width, theme),
    ),
  );

  const fixtures = await seedOwnerWithCatalog(recoveryServer.url);
  const storageState = await fixtures.owner.storageState();

  await Promise.all(
    VIEWPORTS.map(async ([width, theme]) =>
      captureProfile(browser, recoveryServer.url, storageState, width, theme),
    ),
  );

  await fixtures.owner.dispose();
});
