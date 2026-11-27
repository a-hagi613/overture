import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";

const test = appTest.extend<{ supplyServer: AppServer }>({
  supplyServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);
      const request = await apiRequest.newContext({ baseURL: server.url });

      await seedSupplyJobs(request);
      await request.dispose();
      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

interface JobSeed {
  category: string;
  cities: string[];
  countries: string[];
  public_slug: string;
  title: string;
  work_mode: "hybrid" | "remote";
}

const OPEN_SEEDS: readonly JobSeed[] = [
  {
    category: "software_engineering",
    cities: ["Austin"],
    countries: ["us"],
    public_slug: "supply-gh-swe-remote",
    title: "Backend Engineer",
    work_mode: "remote",
  },
  {
    category: "software_engineering",
    cities: ["Toronto"],
    countries: ["ca"],
    public_slug: "supply-gh-swe-onsite",
    title: "Platform Engineer",
    work_mode: "hybrid",
  },
  {
    category: "operations",
    cities: ["London"],
    countries: ["gb"],
    public_slug: "supply-lever-ops-remote",
    title: "Revenue Operations Lead",
    work_mode: "remote",
  },
  {
    category: "operations",
    cities: ["London"],
    countries: ["gb"],
    public_slug: "supply-lever-ops-hybrid",
    title: "Business Operations Manager",
    work_mode: "hybrid",
  },
  {
    category: "data_science",
    cities: ["Austin"],
    countries: ["us"],
    public_slug: "supply-gh-swe-data",
    title: "Machine Learning Engineer",
    work_mode: "remote",
  },
];

async function seedSupplyJobs(request: APIRequestContext) {
  const response = await request.post("/__test__/jobs/seed", {
    data: { jobs: OPEN_SEEDS },
  });

  if (!response.ok()) {
    throw new Error(
      `seeding freehire jobs failed: ${String(response.status())} ${await response.text()}`,
    );
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
    const role = page.getByRole("button", { name: /^Role:/u });
    const location = page.getByRole("button", { name: /^Location:/u });
    const remote = page.getByRole("switch", { name: "Remote only" });

    await expect(count).toHaveText("5");
    await expect(caption).toContainText("open jobs ready to apply");

    const layoutBefore = await layoutOf(page);

    await category.selectOption({ label: "Software & IT" });
    await expect(count).toHaveText("2");

    await role.click();
    await page.getByPlaceholder("Search roles…").fill("Software Engineer");
    await page
      .getByRole("listbox")
      .getByRole("option", { name: /^Software Engineer \(general\)/u })
      .first()
      .click();
    await expect(count).toHaveText("2");

    await category.selectOption({ label: "Data & AI" });
    await expect(count).toHaveText("1");

    await role.click();
    await page.getByPlaceholder("Search roles…").fill("Data Scientist");
    await page
      .getByRole("listbox")
      .getByRole("option", { name: /^Data Scientist/u })
      .first()
      .click();
    await expect(count).toHaveText("1");

    await category.selectOption("");
    await expect(count).toHaveText("1");

    await page.getByRole("button", { name: "Clear role" }).click();
    await expect(count).toHaveText("5");

    await remote.click();
    await expect(count).toHaveText("3");

    await category.selectOption({ label: "Software & IT" });
    await expect(count).toHaveText("1");

    await category.selectOption("");
    await location.click();
    await page.getByPlaceholder("Type a city, country, or continent…").fill("London");
    await page
      .getByRole("listbox")
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

    const results = await new AxeBuilder({ page }).include("#live-jobs").analyze();

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
