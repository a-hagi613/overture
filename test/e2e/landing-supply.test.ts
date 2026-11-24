import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import { z } from "zod";

import type { AppServer } from "./app-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";

const test = appTest.extend<{ supplyServer: AppServer }>({
  supplyServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);
      const request = await apiRequest.newContext({ baseURL: server.url });

      await seedSupplyCatalog(request);
      await request.dispose();
      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

const createdSchema = z.object({ id: z.string() });

const ATS_VALUES = ["greenhouse", "lever"] as const;

interface PostingSeed {
  ats: (typeof ATS_VALUES)[number];
  atsJobId: string;
  city: string;
  countryCode: string;
  locationRaw: string;
  role: "Operations" | "Software Engineering";
  granularRole: string;
  extraTags?: readonly { dimension: "role" | "granular_role"; value: string }[];
  title: string;
  url: string;
  workplace: "hybrid" | "remote";
}

interface SeedRequest {
  [field: string]: string | number | null | SeedRequest | (string | number | SeedRequest)[];
}

const OPEN_SEEDS: readonly PostingSeed[] = [
  {
    ats: "greenhouse",
    atsJobId: "supply-gh-swe-remote",
    city: "Austin",
    countryCode: "US",
    locationRaw: "Austin, TX",
    role: "Software Engineering",
    granularRole: "Software Engineer",
    title: "Backend Engineer",
    url: "https://supply.example/gh-swe-remote",
    workplace: "remote",
  },
  {
    ats: "greenhouse",
    atsJobId: "supply-gh-swe-onsite",
    city: "Toronto",
    countryCode: "CA",
    locationRaw: "Toronto, ON",
    role: "Software Engineering",
    granularRole: "Software Engineer",
    title: "Platform Engineer",
    url: "https://supply.example/gh-swe-onsite",
    workplace: "hybrid",
  },
  {
    ats: "lever",
    atsJobId: "supply-lever-ops-remote",
    city: "London",
    countryCode: "GB",
    locationRaw: "London, United Kingdom",
    role: "Operations",
    granularRole: "Operations Manager",
    title: "Revenue Operations Lead",
    url: "https://supply.example/lever-ops-remote",
    workplace: "remote",
  },
  {
    ats: "lever",
    atsJobId: "supply-lever-ops-hybrid",
    city: "London",
    countryCode: "GB",
    locationRaw: "London, United Kingdom",
    role: "Operations",
    granularRole: "Operations Manager",
    title: "Business Operations Manager",
    url: "https://supply.example/lever-ops-hybrid",
    workplace: "hybrid",
  },
  {
    ats: "greenhouse",
    atsJobId: "supply-gh-swe-data-hybrid-label",
    city: "Austin",
    countryCode: "US",
    extraTags: [
      { dimension: "role", value: "Data & Analytics" },
      { dimension: "granular_role", value: "Data Scientist" },
    ],
    locationRaw: "Austin, TX",
    role: "Software Engineering",
    granularRole: "Software Engineer",
    title: "Machine Learning Engineer",
    url: "https://supply.example/gh-swe-data",
    workplace: "remote",
  },
];

const CLOSED_SEED: PostingSeed = {
  ats: "greenhouse",
  atsJobId: "supply-gh-swe-closed",
  city: "Austin",
  countryCode: "US",
  locationRaw: "Austin, TX",
  role: "Software Engineering",
  granularRole: "Software Engineer",
  title: "Closed Backend Engineer",
  url: "https://supply.example/gh-swe-closed",
  workplace: "remote",
};

async function created(request: APIRequestContext, path: string, data: SeedRequest) {
  const response = await request.post(path, { data });

  if (!response.ok()) {
    throw new Error(`${path} failed: ${String(response.status())} ${await response.text()}`);
  }

  return createdSchema.parse(await response.json()).id;
}

async function seedSupplyCatalog(request: APIRequestContext) {
  const cleared = await request.post("/__test__/catalog/postings/close-all");

  if (!cleared.ok()) {
    throw new Error(`closing the template catalog failed: ${String(cleared.status())}`);
  }

  const companyId = await created(request, "/__test__/catalog/companies", {
    domain: "supply.example",
    name: "Supply Preview Co",
  });

  const boards = new Map<string, string>();

  const boardEntries = await Promise.all(
    ATS_VALUES.map(async (ats) => ({
      ats,
      id: await created(request, "/__test__/catalog/boards", {
        ats,
        boardToken: `supply-${ats}`,
        companyId,
      }),
    })),
  );

  for (const entry of boardEntries) {
    boards.set(entry.ats, entry.id);
  }

  const postingFor = (seed: PostingSeed) =>
    ({
      ats: seed.ats,
      atsJobId: seed.atsJobId,
      boardId: boards.get(seed.ats) ?? "",
      city: seed.city,
      companyId,
      countryCode: seed.countryCode,
      employmentType: "full_time",
      language: "en",
      locationRaw: seed.locationRaw,
      tags: [
        { dimension: "role", value: seed.role },
        { dimension: "granular_role", value: seed.granularRole },
        ...(seed.extraTags ?? []),
      ],
      title: seed.title,
      url: seed.url,
      workplace: seed.workplace,
    }) satisfies SeedRequest;

  const closedId = await created(request, "/__test__/catalog/postings", postingFor(CLOSED_SEED));

  await request.post("/__test__/catalog/postings/close", { data: { id: closedId } });

  const bulk = await request.post("/__test__/catalog/postings/bulk", {
    data: { postings: OPEN_SEEDS.map((seed) => postingFor(seed)) },
  });

  if (!bulk.ok()) {
    throw new Error(`postings bulk failed: ${String(bulk.status())} ${await bulk.text()}`);
  }
}

function isSupplyRequest(url: string) {
  if (url === "") {
    return false;
  }

  try {
    return new URL(url).pathname === "/api/supply";
  } catch {
    return false;
  }
}

function isExpectedConsoleError(entry: { text: string; url: string }) {
  return (
    entry.text.includes("status of 503") ||
    entry.text.includes("Content Security Policy") ||
    isSupplyRequest(entry.url)
  );
}

async function layoutOf(page: Page) {
  return page.evaluate(() => {
    const section = document.querySelector("#live-jobs")?.getBoundingClientRect();
    const next = document.querySelector("#pricing")?.getBoundingClientRect();

    return {
      nextTop: (next?.top ?? 0) + globalThis.scrollY,
      sectionHeight: section?.height ?? 0,
    };
  });
}

test.describe("the landing live supply preview", () => {
  test("the count follows the category, granular role, location and remote filters without a layout shift or an axe violation", async ({
    page,
    supplyServer,
  }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto(`${supplyServer.url}/`);

    const count = page.getByTestId("supply-count");
    const caption = page.getByTestId("supply-caption");
    const category = page.getByLabel("Category", { exact: true });
    const role = page.getByLabel("Role", { exact: true });
    const location = page.getByRole("button", { name: /^Location:/u });
    const remote = page.getByRole("switch", { name: "Remote only" });

    await expect(count).toHaveText("5");
    await expect(caption).toContainText("open jobs ready to apply");

    const layoutBefore = await layoutOf(page);

    await category.selectOption("Software Engineering");
    await expect(count).toHaveText("3");

    await role.fill("Software Engineer");
    await role.press("Enter");
    await expect(count).toHaveText("3");

    await category.selectOption("Data & Analytics");
    await expect(count).toHaveText("1");

    await role.fill("Data Scientist");
    await role.press("Enter");
    await expect(count).toHaveText("1");

    await category.selectOption("");
    await expect(count).toHaveText("1");

    await role.fill("");
    await role.press("Enter");
    await expect(count).toHaveText("5");

    await remote.click();
    await expect(count).toHaveText("3");

    await category.selectOption("Software Engineering");
    await expect(count).toHaveText("2");

    await category.selectOption("");
    await location.click();
    await page.getByPlaceholder("Type a city, country, or continent…").fill("London");
    await page
      .getByRole("option", { name: /London/u })
      .first()
      .click();
    await expect(count).toHaveText("1");

    await remote.click();
    await expect(count).toHaveText("2");

    await page.getByRole("button", { name: "Clear location filter" }).click();
    await expect(count).toHaveText("5");

    await expect(caption).toContainText("open jobs ready to apply");
    await expect(page.getByTestId("supply-status")).toContainText("Last updated");
    expect(await layoutOf(page)).toEqual(layoutBefore);

    const results = await new AxeBuilder({ page }).analyze();

    expect(results.violations).toEqual([]);
  });

  test("the API failing leaves a readable fallback, no console error and a working retry", async ({
    page,
    supplyServer,
  }) => {
    const consoleErrors: { text: string; url: string }[] = [];
    const pageErrors: string[] = [];

    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push({ text: message.text(), url: message.location().url });
      }
    });
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });

    await page.route("**/api/supply**", async (route) => {
      await route.fulfill({ body: "unavailable", status: 503 });
    });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`${supplyServer.url}/`);

    await expect(page.getByTestId("supply-count")).toHaveText("—");
    await expect(page.getByTestId("supply-caption")).toContainText("unavailable right now");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();

    const overflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));

    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

    const landing = await new AxeBuilder({ page }).analyze();

    expect(landing.violations).toEqual([]);

    await page.unroute("**/api/supply**");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("supply-count")).toHaveText("5");

    expect(consoleErrors.filter((entry) => !isExpectedConsoleError(entry))).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("the prerendered page explains the count with JavaScript off, and the card is axe clean at 390 and 1280 in both themes", async ({
    browser,
    supplyServer,
  }) => {
    const noScript = await browser.newContext({ javaScriptEnabled: false });

    try {
      const page = await noScript.newPage();

      await page.goto(`${supplyServer.url}/`);

      const text = await page.locator("body").textContent();

      expect(text).toContain("Live counts load with the page.");
      expect(await page.getByTestId("supply-count").textContent()).toBe("—");
    } finally {
      await noScript.close();
    }

    await Promise.all(
      [390, 1280].flatMap((width) =>
        ["light", "dark"].map(async (theme) => {
          const context = await browser.newContext();

          try {
            const page = await context.newPage();

            await page.addInitScript((mode) => {
              globalThis.localStorage.setItem("overture.theme", mode);
            }, theme);
            await page.setViewportSize({ width, height: 1000 });
            await page.goto(`${supplyServer.url}/`);
            await expect(page.getByTestId("supply-count")).toHaveText("5");

            const results = await new AxeBuilder({ page }).include("#live-jobs").analyze();

            expect(results.violations).toEqual([]);
          } finally {
            await context.close();
          }
        }),
      ),
    );
  });
});
