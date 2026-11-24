import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { request as apiRequest } from "@playwright/test";
import type {
  APIRequestContext,
  Browser,
  BrowserContextOptions,
  Locator,
  Page,
} from "@playwright/test";
import { z } from "zod";

import { openAdminAsOwner } from "./admin-sign-in.ts";
import { expect, test } from "./admin.fixture.ts";
import { seedOnboardingTargetsFlow } from "./onboarding-targets-harness.ts";

const shotDirectory = process.env.WS17B_SHOT_DIR;

const SIZES = [
  { height: 844, width: 390 },
  { height: 860, width: 1280 },
] as const;

const THEMES = ["light", "dark"] as const;

const createdSchema = z.object({ id: z.string() });

type StorageState = Awaited<ReturnType<APIRequestContext["storageState"]>>;

async function created(request: APIRequestContext, appUrl: string, path: string, body: string) {
  const payload: unknown = JSON.parse(body);
  const response = await request.post(`${appUrl}${path}`, { data: payload });

  if (!response.ok()) {
    throw new Error(`${path} failed: ${String(response.status())} ${await response.text()}`);
  }

  return createdSchema.parse(await response.json()).id;
}

async function seedLandingCatalog(request: APIRequestContext, appUrl: string) {
  const companyId = await created(
    request,
    appUrl,
    "/__test__/catalog/companies",
    JSON.stringify({ domain: "ws17b.example", name: "WS-17B Co" }),
  );

  const boardId = await created(
    request,
    appUrl,
    "/__test__/catalog/boards",
    JSON.stringify({ ats: "greenhouse", boardToken: "ws17b", companyId }),
  );

  const posting = (index: number, role: string, granularRole: string) => ({
    ats: "greenhouse",
    atsJobId: `ws17b-${String(index)}`,
    boardId,
    city: "Toronto",
    companyId,
    countryCode: "CA",
    employmentType: "full_time",
    language: "en",
    locationRaw: "Toronto, ON",
    tags: [
      { dimension: "role", value: role },
      { dimension: "granular_role", value: granularRole },
      { dimension: "seniority", value: "senior" },
    ],
    title: granularRole,
    url: `https://ws17b.example/${String(index)}`,
    workplace: index % 2 === 0 ? "remote" : "hybrid",
  });

  await request.post(`${appUrl}/__test__/catalog/postings/bulk`, {
    data: {
      postings: [
        posting(1, "Software Engineering", "Software Engineer"),
        posting(2, "Software Engineering", "Software Engineer"),
        posting(3, "Software Engineering", "Frontend Engineer"),
        posting(4, "Data & Analytics", "Data Scientist"),
        posting(5, "Administrative", "Executive Assistant"),
        posting(6, "Administrative", "Office Manager"),
      ],
    },
  });
}

async function shoot(page: Page, name: string, target?: Locator) {
  if (shotDirectory === undefined) {
    return;
  }

  const path = join(shotDirectory, `${name}.png`);

  if (target === undefined) {
    await page.screenshot({ fullPage: true, path });
  } else {
    await target.screenshot({ path });
  }
}

async function openPage(
  browser: Browser,
  url: string,
  width: number,
  height: number,
  theme: (typeof THEMES)[number],
  storageState?: StorageState,
) {
  const options: BrowserContextOptions = { baseURL: url, viewport: { height, width } };

  if (storageState !== undefined) {
    options.storageState = storageState;
  }

  const context = await browser.newContext(options);
  const page = await context.newPage();

  await page.addInitScript((mode) => {
    globalThis.localStorage.setItem("overture.theme", mode);
  }, theme);

  return { context, page };
}

async function eachViewport(
  shot: (width: number, height: number, theme: (typeof THEMES)[number]) => Promise<void>,
) {
  await Promise.all(
    SIZES.flatMap(({ width, height }) =>
      THEMES.map(async (theme) => {
        await shot(width, height, theme);
      }),
    ),
  );
}

test.describe("WS-17b review screenshots", () => {
  test.skip(shotDirectory === undefined, "only when WS17B_SHOT_DIR is set");

  test("landing supply filters", async ({ browser, isolatedAppServer }) => {
    mkdirSync(shotDirectory ?? "", { recursive: true });

    const request = await apiRequest.newContext({ baseURL: isolatedAppServer.url });

    await seedLandingCatalog(request, isolatedAppServer.url);

    await eachViewport(async (width, height, theme) => {
      const { context, page } = await openPage(
        browser,
        isolatedAppServer.url,
        width,
        height,
        theme,
      );

      await page.goto(`${isolatedAppServer.url}/#live-jobs`);
      await page.getByLabel("Category", { exact: true }).selectOption("Software Engineering");
      await page.getByLabel("Role", { exact: true }).fill("Software Engineer");
      await page.getByLabel("Role", { exact: true }).press("Enter");
      await expect(page.getByTestId("supply-count")).toHaveText("2");

      await shoot(page, `landing-supply-${String(width)}-${theme}`, page.locator("#live-jobs"));
      await context.close();
    });

    await request.dispose();
  });

  test("onboarding targets and profile targets", async ({ browser, isolatedAppServer }) => {
    mkdirSync(shotDirectory ?? "", { recursive: true });

    const request = await apiRequest.newContext({ baseURL: isolatedAppServer.url });

    await seedOnboardingTargetsFlow(request, isolatedAppServer.url);

    const storageState = await request.storageState();

    await eachViewport(async (width, height, theme) => {
      const { context, page } = await openPage(
        browser,
        isolatedAppServer.url,
        width,
        height,
        theme,
        storageState,
      );

      await page.goto(`${isolatedAppServer.url}/onboarding/targets`);
      await page.getByLabel("Category", { exact: true }).selectOption("Healthcare");
      await page.getByLabel("Add a specific role", { exact: true }).fill("Registered Nurse");
      await page.getByLabel("Add a specific role", { exact: true }).press("Enter");
      await expect(page.getByRole("button", { name: "Registered Nurse" })).toBeVisible();

      await shoot(
        page,
        `onboarding-targets-${String(width)}-${theme}`,
        page.locator('[aria-labelledby="ob-h"]'),
      );
      await context.close();
    });

    await eachViewport(async (width, height, theme) => {
      const { context, page } = await openPage(
        browser,
        isolatedAppServer.url,
        width,
        height,
        theme,
        storageState,
      );

      await page.goto(`${isolatedAppServer.url}/profile/preferences`);
      await page.getByLabel("Category", { exact: true }).selectOption("Healthcare");
      await page.getByLabel("Add a specific role", { exact: true }).fill("Registered Nurse");
      await page.getByLabel("Add a specific role", { exact: true }).press("Enter");
      await expect(page.getByRole("button", { name: "Registered Nurse" })).toBeVisible();

      await shoot(
        page,
        `profile-targets-${String(width)}-${theme}`,
        page.locator("#profile-targets"),
      );
      await context.close();
    });

    await request.dispose();
  });

  test("admin catalog classification", async ({
    page,
    adminIsolatedAppServer,
    adminIsolatedAppUrl,
    accessServer,
  }) => {
    mkdirSync(shotDirectory ?? "", { recursive: true });
    mkdirSync(join(adminIsolatedAppServer.objectsRoot, "catalog"), { recursive: true });
    writeFileSync(
      join(adminIsolatedAppServer.objectsRoot, "catalog", "latest.json"),
      JSON.stringify({
        version: "2026-11-24",
        tagging: {
          total_postings: 849_612,
          cross_board_dupes_removed: 41_002,
          unique_title_dept_pairs: 312_004,
          cache_hit: 210_100,
          tier1_esco_rules: 80_000,
          tier2_embeddings: 18_500,
          tier3_haiku_batch_sent: 412,
          tier3_haiku_resolved: 3402,
          still_untagged: 12_004,
          input_tokens: 5_200_000,
          output_tokens: 310_000,
          tier3_cost_usd: 6.71,
        },
      }),
    );

    await openAdminAsOwner(page, adminIsolatedAppUrl, accessServer.issueToken);

    async function shootAdmin(width: number, height: number, theme: string) {
      await page.setViewportSize({ width, height });
      await page.addInitScript((mode) => {
        globalThis.localStorage.setItem("overture.theme", mode);
      }, theme);
      await page.goto(`${adminIsolatedAppUrl}/admin/catalog`);
      await expect(page.getByRole("heading", { name: "Classification" })).toBeVisible();
      await shoot(
        page,
        `admin-catalog-${String(width)}-${theme}`,
        page.locator('section[aria-labelledby="admin-catalog-tagging"]'),
      );
    }

    await shootAdmin(390, 844, "light");
    await shootAdmin(390, 844, "dark");
    await shootAdmin(1280, 860, "light");
    await shootAdmin(1280, 860, "dark");
  });
});
