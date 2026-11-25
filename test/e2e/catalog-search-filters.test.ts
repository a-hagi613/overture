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

async function searchHits(url: string) {
  const response = await fetch(url);

  if (response.status !== 200) {
    throw new Error(`search failed with ${String(response.status)}`);
  }

  return searchResponseSchema.parse(await response.json());
}

async function apiSearchHits(ownerPage: Page, url: string) {
  const response = await ownerPage.request.get(url);

  if (response.status() !== 200) {
    throw new Error(`search failed with ${String(response.status())}`);
  }

  return searchResponseSchema.parse(await response.json());
}

test("the role filter narrows search results to the tagged role and /search redirects to /applications", async ({
  ownerPage,
  appServerUrl,
}) => {
  await ownerPage.goto(`${appServerUrl}/search?q=${encodeURIComponent("Manager")}`);
  await expect(ownerPage).toHaveURL(/\/tracker\?q=Manager/u);

  const unfiltered = await apiSearchHits(
    ownerPage,
    `${appServerUrl}/api/search?q=${encodeURIComponent("Manager")}&limit=100`,
  );

  expect(unfiltered.hits.filter((hit) => hit.title.includes("Engineering Manager"))).toHaveLength(
    20,
  );
  expect(unfiltered.hits.filter((hit) => hit.title.includes("Product Manager"))).toHaveLength(20);

  const filtered = await apiSearchHits(
    ownerPage,
    `${appServerUrl}/api/search?q=${encodeURIComponent("Manager")}&role=${encodeURIComponent("Product Management")}&limit=100`,
  );

  expect(filtered.hits.filter((hit) => hit.title.includes("Engineering Manager"))).toHaveLength(0);
  expect(filtered.hits.filter((hit) => hit.title.includes("Product Manager"))).toHaveLength(20);
});

test("the seniority filter narrows search results to the tagged seniority", async ({
  ownerPage,
  appServerUrl,
}) => {
  const unfiltered = await apiSearchHits(
    ownerPage,
    `${appServerUrl}/api/search?q=${encodeURIComponent("Backend")}&limit=100`,
  );

  expect(unfiltered.hits.filter((hit) => hit.title === "Senior Backend Engineer")).toHaveLength(20);
  expect(unfiltered.hits.filter((hit) => hit.title === "Backend Engineer")).toHaveLength(20);

  const filtered = await apiSearchHits(
    ownerPage,
    `${appServerUrl}/api/search?q=${encodeURIComponent("Backend")}&seniority=senior&limit=100`,
  );

  expect(filtered.hits.filter((hit) => hit.title === "Backend Engineer")).toHaveLength(0);
  expect(filtered.hits.filter((hit) => hit.title === "Senior Backend Engineer")).toHaveLength(20);
});

test("the workplace filter narrows search results to the tagged workplace", async ({
  ownerPage,
  appServerUrl,
}) => {
  const remote = await apiSearchHits(
    ownerPage,
    `${appServerUrl}/api/search?q=${encodeURIComponent("Engineer")}&workplace=remote&limit=50`,
  );

  expect(remote.hits).toHaveLength(50);
  expect(remote.hits.every((hit) => (hit.location ?? "").includes("Remote"))).toBe(true);

  const hybrid = await apiSearchHits(
    ownerPage,
    `${appServerUrl}/api/search?q=${encodeURIComponent("Engineer")}&workplace=hybrid&limit=50`,
  );

  expect(hybrid.hits.length).toBeGreaterThan(0);
  expect(hybrid.hits.some((hit) => (hit.location ?? "").includes("Remote"))).toBe(false);
});

test("the city filter narrows search results to postings resolved to that city", async ({
  ownerPage,
  appServerUrl,
}) => {
  const toronto = await apiSearchHits(
    ownerPage,
    `${appServerUrl}/api/search?q=${encodeURIComponent("Engineer")}&location=${encodeURIComponent("Toronto")}&limit=50`,
  );

  expect(toronto.hits.length).toBeGreaterThan(0);
  expect(toronto.hits.every((hit) => (hit.location ?? "").includes("Toronto"))).toBe(true);
});

test("the employment type filter narrows search results to the tagged type", async ({
  ownerPage,
  appServerUrl,
}) => {
  const contract = await apiSearchHits(
    ownerPage,
    `${appServerUrl}/api/search?q=${encodeURIComponent("Engineer")}&employmentType=contract&limit=100`,
  );

  expect(contract.hits.some((hit) => hit.title.includes("Senior Backend Engineer"))).toBe(false);
  expect(contract.hits.some((hit) => hit.title.includes("Frontend Engineer"))).toBe(true);

  const contractTitles = new Set([
    "Frontend Engineer",
    "Machine Learning Engineer",
    "Security Engineer",
    "DevOps Engineer",
  ]);

  expect(contract.hits.every((hit) => contractTitles.has(hit.title))).toBe(true);

  const internship = await apiSearchHits(
    ownerPage,
    `${appServerUrl}/api/search?q=${encodeURIComponent("Engineer")}&employmentType=internship&limit=100`,
  );

  expect(internship.hits).toHaveLength(0);
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
    expect(roleRows.every((row) => row.value === "sales" && row.source === "rules")).toBe(true);

    const remoteSearch = await searchHits(
      `${harness.app.url}/__test__/search?q=${encodeURIComponent("Account Executive")}&workplace=remote&limit=10`,
    );

    expect(remoteSearch.hits.length).toBe(1);
    expect(remoteSearch.hits[0]?.title).toBe("Account Executive, Commercial");

    const hybridSearch = await searchHits(
      `${harness.app.url}/__test__/search?q=${encodeURIComponent("Account Executive")}&workplace=hybrid&limit=10`,
    );

    expect(hybridSearch.hits.length).toBe(3);
  } finally {
    await harness.close();
  }
});
