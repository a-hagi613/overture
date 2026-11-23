import type { APIRequestContext } from "@playwright/test";
import { z } from "zod";

import { expect, test } from "./app.fixture.ts";

const searchResponseSchema = z.object({
  hits: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      company: z.string(),
      location: z.string().nullable(),
      department: z.string().nullable(),
      ats: z.string(),
    }),
  ),
  durationMs: z.number(),
});

const SEARCH_BUDGET_MS = 50;

const QUERIES = {
  title: "Senior Backend Engineer",
  company: "Northwind",
  location: "Toronto",
  department: "Infrastructure",
};

async function searchBy(request: APIRequestContext, appUrl: string, query: string) {
  const response = await request.get(
    `${appUrl}/__test__/search?q=${encodeURIComponent(query)}&limit=50`,
  );

  if (response.status() !== 200) {
    throw new Error(`search for ${query} failed with ${String(response.status())}`);
  }

  return searchResponseSchema.parse(await response.json());
}

test("search by title, company, location and department stays under 50 ms on the template catalog", async ({
  request,
  appServerUrl,
}) => {
  const titleSearch = await searchBy(request, appServerUrl, QUERIES.title);

  expect(titleSearch.hits.length).toBeGreaterThan(0);
  expect(titleSearch.durationMs).toBeLessThan(SEARCH_BUDGET_MS);

  const companySearch = await searchBy(request, appServerUrl, QUERIES.company);

  expect(companySearch.hits.length).toBeGreaterThan(0);
  expect(companySearch.hits.some((hit) => hit.company === "Northwind Systems")).toBe(true);
  expect(companySearch.durationMs).toBeLessThan(SEARCH_BUDGET_MS);

  const locationSearch = await searchBy(request, appServerUrl, QUERIES.location);

  expect(locationSearch.hits.length).toBeGreaterThan(0);
  expect(locationSearch.hits.some((hit) => hit.location?.includes("Toronto"))).toBe(true);
  expect(locationSearch.durationMs).toBeLessThan(SEARCH_BUDGET_MS);

  const departmentSearch = await searchBy(request, appServerUrl, QUERIES.department);

  expect(departmentSearch.hits.length).toBeGreaterThan(0);
  expect(departmentSearch.hits.some((hit) => hit.department === "Infrastructure")).toBe(true);
  expect(departmentSearch.durationMs).toBeLessThan(SEARCH_BUDGET_MS);

  expect(
    titleSearch.hits.some(
      (hit) => hit.title === QUERIES.title && hit.company === "Northwind Systems",
    ),
  ).toBe(true);
});

test("the search page lists postings for a query", async ({ ownerPage, appServerUrl }) => {
  await ownerPage.goto(`${appServerUrl}/search?q=${encodeURIComponent(QUERIES.title)}`);

  await expect(ownerPage.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();

  await expect(ownerPage.getByText(QUERIES.title).first()).toBeVisible();

  await expect(ownerPage.getByText("Northwind Systems").first()).toBeVisible();
});
