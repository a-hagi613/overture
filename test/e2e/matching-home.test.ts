import { AxeBuilder } from "@axe-core/playwright";

import type { Browser } from "@playwright/test";
import type { AnthropicFixtureServer } from "./anthropic-fixture-server.ts";
import type { AppServer } from "./app-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { startAnthropicFixtureServer } from "./anthropic-fixture-server.ts";
import {
  clearCatalog,
  configureMatching,
  grantApplications,
  ownerContextFor,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

const test = appTest.extend<{ matching: { anthropic: AnthropicFixtureServer; server: AppServer } }>(
  {
    matching: [
      async ({ identityServer }, provide) => {
        const anthropic = await startAnthropicFixtureServer();

        const server = await startFreshAppServer(identityServer, {
          ANTHROPIC_API_KEY: "test-anthropic-key",
          ANTHROPIC_BASE_URL: anthropic.url,
        });

        await provide({ anthropic, server });
        await server.stop();
        anthropic.stop();
      },
      { scope: "test" },
    ],
  },
);

async function seedUpNext(server: AppServer) {
  const { owner } = await ownerContextFor(server.url);

  await clearCatalog(owner);
  await grantApplications(owner, 70);
  await configureMatching(owner);

  const seeds = [
    { company: "Northwind Labs", title: "Senior Backend Engineer" },
    { company: "Ferro Cloud", title: "Data Backend Engineer" },
    { company: "Halden Systems", title: "Backend Engineer" },
  ];

  const ids = await Promise.all(
    seeds.map(async (seed) => {
      const slug = seed.company.toLowerCase().replaceAll(" ", "-");
      const companyId = await seedCompany(owner, seed.company, `${slug}.example`);
      const boardId = await seedBoard(owner, companyId, "greenhouse", slug);

      return seedPosting(owner, {
        atsJobId: slug,
        boardId,
        companyId,
        title: seed.title,
        url: `https://${slug}.example/1`,
      });
    }),
  );

  const storage = await owner.storageState();

  await owner.dispose();

  return { ids, storage };
}

async function openHome(browser: Browser, server: AppServer, width: number, theme: string) {
  const { storage } = await seedUpNext(server);
  const context = await browser.newContext({ deviceScaleFactor: 1, storageState: storage });
  const page = await context.newPage();

  if (theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${server.url}/`);
  await expect(page.getByRole("heading", { name: "Up next" })).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  return { context, page };
}

test("Up next scores on open, and Apply, Save and Hide act on the card", async ({
  browser,
  matching,
}) => {
  const { context, page } = await openHome(browser, matching.server, 1280, "light");
  const list = page.getByTestId("up-next-list").getByRole("listitem");

  await expect(list).toHaveCount(3);
  await expect(page.getByText("Open to score · Open it to see why it fits.").first()).toBeVisible();

  const strong = list.filter({
    has: page.getByRole("button", { exact: true, name: "Apply to Senior Backend Engineer" }),
  });

  await strong.getByRole("button", { exact: true, name: "Senior Backend Engineer" }).click();
  await expect(strong.getByText("Match score, 92 out of 100")).toBeVisible();
  await expect(strong.getByText("Strong match")).toBeVisible();
  await expect(strong.getByText(/Go and Postgres/u)).toBeVisible();
  expect(matching.anthropic.requests()).toHaveLength(1);

  await strong.getByRole("button", { name: "Save Senior Backend Engineer" }).click();
  await expect(
    strong.getByRole("button", { name: "Remove Senior Backend Engineer from saved" }),
  ).toBeVisible();
  await expect(strong.getByText("Saved")).toBeVisible();

  const weak = list.filter({
    has: page.getByRole("button", { exact: true, name: "Hide Backend Engineer" }),
  });

  await weak.getByRole("button", { name: "Hide Backend Engineer" }).click();
  await expect(list).toHaveCount(2);
  await expect(weak).toHaveCount(0);

  await strong.getByRole("button", { name: "Apply to Senior Backend Engineer" }).click();
  await expect(list).toHaveCount(1);
  await expect(strong).toHaveCount(0);

  await context.close();
});

for (const width of [390, 1280] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`Up next is axe clean at ${String(width)}px in ${theme}`, async ({
      browser,
      matching,
    }) => {
      const { context, page } = await openHome(browser, matching.server, width, theme);
      const results = await new AxeBuilder({ page }).analyze();

      expect(results.violations, `${String(width)}px ${theme}`).toEqual([]);

      await context.close();
    });
  }
}
