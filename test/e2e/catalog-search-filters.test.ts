import type { Page } from "@playwright/test";
import { z } from "zod";

import { expect, test } from "./app.fixture.ts";
import { startCatalogHarness } from "./catalog-harness.ts";

const postingsTagRowSchema = z.object({
  postingId: z.string(),
  dimension: z.string(),
  value: z.string(),
  source: z.string(),
});

const postingTagsResponseSchema = z.object({
  postingTags: z.array(postingsTagRowSchema),
});

const searchResponseSchema = z.object({
  hits: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      company: z.string(),
      location: z.string().nullable(),
    }),
  ),
  durationMs: z.number(),
});

function results(ownerPage: Page) {
  return ownerPage.getByRole("region", { name: "Postings" }).getByRole("listitem");
}

function resultLinks(ownerPage: Page) {
  return results(ownerPage).getByRole("link");
}

async function searchHits(url: string) {
  const response = await fetch(url);

  if (response.status !== 200) {
    throw new Error(`search failed with ${String(response.status)}`);
  }

  return searchResponseSchema.parse(await response.json());
}

test("the role filter narrows search results to the tagged role", async ({
  ownerPage,
  appServerUrl,
}) => {
  await ownerPage.goto(`${appServerUrl}/search?q=${encodeURIComponent("Manager")}`);

  await expect(resultLinks(ownerPage).filter({ hasText: "Engineering Manager" })).toHaveCount(20);
  await expect(resultLinks(ownerPage).filter({ hasText: "Product Manager" })).toHaveCount(20);

  await ownerPage.getByLabel("Role").selectOption("Product Management");

  await expect(resultLinks(ownerPage).filter({ hasText: "Engineering Manager" })).toHaveCount(0);
  await expect(resultLinks(ownerPage).filter({ hasText: "Product Manager" })).toHaveCount(20);
});

test("the seniority filter narrows search results to the tagged seniority", async ({
  ownerPage,
  appServerUrl,
}) => {
  await ownerPage.goto(`${appServerUrl}/search?q=${encodeURIComponent("Backend")}`);

  await expect(
    resultLinks(ownerPage).filter({ hasText: /^Senior Backend Engineer$/u }),
  ).toHaveCount(20);
  await expect(resultLinks(ownerPage).filter({ hasText: /^Backend Engineer$/u })).toHaveCount(20);

  await ownerPage.getByLabel("Seniority").selectOption("senior");

  await expect(resultLinks(ownerPage).filter({ hasText: /^Backend Engineer$/u })).toHaveCount(0);
  await expect(
    resultLinks(ownerPage).filter({ hasText: /^Senior Backend Engineer$/u }),
  ).toHaveCount(20);
});

test("the workplace filter narrows search results to the tagged workplace", async ({
  ownerPage,
  appServerUrl,
}) => {
  await ownerPage.goto(`${appServerUrl}/search?q=${encodeURIComponent("Engineer")}`);

  await ownerPage.getByLabel("Workplace").selectOption("remote");

  await expect(results(ownerPage).filter({ hasText: "Remote" })).toHaveCount(50);

  await ownerPage.getByLabel("Workplace").selectOption("hybrid");

  await expect(results(ownerPage).first()).toBeVisible();
  await expect(results(ownerPage).filter({ hasText: "Remote" })).toHaveCount(0);
});

test("the city filter narrows search results to postings resolved to that city", async ({
  ownerPage,
  appServerUrl,
}) => {
  await ownerPage.goto(`${appServerUrl}/search?q=${encodeURIComponent("Engineer")}`);

  await ownerPage.getByLabel("City").fill("Toronto");
  await ownerPage.getByLabel("City").press("Enter");

  await expect(results(ownerPage).filter({ hasText: "Toronto" }).first()).toBeVisible();
  await expect(results(ownerPage).filter({ hasNotText: "Toronto" })).toHaveCount(0);
});

test("the employment type filter narrows search results to the tagged type", async ({
  ownerPage,
  appServerUrl,
}) => {
  await ownerPage.goto(`${appServerUrl}/search?q=${encodeURIComponent("Engineer")}`);

  await ownerPage.getByLabel("Employment type").selectOption("contract");

  await expect(resultLinks(ownerPage).filter({ hasText: "Senior Backend Engineer" })).toHaveCount(
    0,
  );
  await expect(results(ownerPage).filter({ hasText: "Frontend Engineer" }).first()).toBeVisible();

  const contractTitles = new Set([
    "Frontend Engineer",
    "Machine Learning Engineer",
    "Security Engineer",
    "DevOps Engineer",
  ]);

  const titles = await resultLinks(ownerPage).allTextContents();

  expect(titles.every((title) => contractTitles.has(title))).toBe(true);

  await ownerPage.getByLabel("Employment type").selectOption("internship");

  await expect(results(ownerPage)).toHaveCount(0);
  await expect(ownerPage.getByText("No postings match that search.")).toBeVisible();
});

test("postings poll records tags from the rules and the filters search them", async () => {
  const harness = await startCatalogHarness(["vercel"]);

  try {
    await harness.runBackfillCycle();

    const rows = await harness.postings();

    expect(rows.length).toBe(4);

    for (const row of rows) {
      expect(row.tagSource).toBe("rules");
      expect(row.taggedAt).not.toBeNull();
    }

    const remoteRows = rows.filter((row) => row.workplace === "remote");

    expect(remoteRows.length).toBe(1);
    expect(remoteRows[0]?.title).toBe("Account Executive, Commercial");
    expect(rows.filter((row) => row.workplace === "hybrid").length).toBe(3);

    const tagsResponse = await fetch(`${harness.app.url}/__test__/catalog/posting-tags`);

    expect(tagsResponse.status).toBe(200);

    const tagsBody = postingTagsResponseSchema.parse(await tagsResponse.json());
    const roleRows = tagsBody.postingTags.filter((row) => row.dimension === "role");

    expect(roleRows.length).toBe(4);
    expect(roleRows.every((row) => row.value === "Sales" && row.source === "rules")).toBe(true);

    const remoteSearch = await searchHits(
      `${harness.app.url}/api/search?q=${encodeURIComponent("Account Executive")}&workplace=remote&limit=10`,
    );

    expect(remoteSearch.hits.length).toBe(1);
    expect(remoteSearch.hits[0]?.title).toBe("Account Executive, Commercial");

    const hybridSearch = await searchHits(
      `${harness.app.url}/api/search?q=${encodeURIComponent("Account Executive")}&workplace=hybrid&limit=10`,
    );

    expect(hybridSearch.hits.length).toBe(3);
  } finally {
    await harness.close();
  }
});
