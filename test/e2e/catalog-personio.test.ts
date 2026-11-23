import { z } from "zod";
import { expect, test } from "@playwright/test";

import { startCatalogHarness } from "./catalog-harness.ts";

import type { CatalogHarness } from "./catalog-harness.ts";

const PERSONIO_BOARD = "personio";
const OTTONOVA_BOARD = "ottonova";
const CLARK_BOARD = "clark";

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

const batchesResponseSchema = z.object({
  batches: z.object({
    greenhouse: z.number(),
    lever: z.number(),
    ashby: z.number(),
    personio: z.number(),
  }),
});

async function search(harness: CatalogHarness, query: string) {
  const response = await fetch(
    `${harness.app.url}/__test__/search?q=${encodeURIComponent(query)}&limit=50`,
  );

  return searchResponseSchema.parse(await response.json());
}

function postingsOnBoard(rows: Awaited<ReturnType<CatalogHarness["postings"]>>, boardId: string) {
  return rows.filter((row) => row.boardId === boardId);
}

async function sweepBatches(harness: CatalogHarness) {
  const response = await fetch(`${harness.app.url}/__test__/catalog/sweep-batches`);

  return batchesResponseSchema.parse(await response.json()).batches;
}

test("recorded Personio feeds ingest into searchable, tagged Postings with the German fallback", async () => {
  const harness = await startCatalogHarness([
    { ats: "personio", token: PERSONIO_BOARD },
    { ats: "personio", token: OTTONOVA_BOARD },
    { ats: "personio", token: CLARK_BOARD },
  ]);

  try {
    await harness.setKillSwitch("ats", "personio", false);
    await harness.runBackfillCycle();

    const postings = await harness.postings();
    const personioPostings = postingsOnBoard(postings, harness.boardIds[PERSONIO_BOARD] ?? "");
    const ottonovaPostings = postingsOnBoard(postings, harness.boardIds[OTTONOVA_BOARD] ?? "");
    const clarkPostings = postingsOnBoard(postings, harness.boardIds[CLARK_BOARD] ?? "");

    expect(personioPostings).toHaveLength(2);
    expect(ottonovaPostings).toHaveLength(4);
    expect(clarkPostings).toHaveLength(4);

    const businessDevelopment = personioPostings.find((row) => row.atsJobId === "2885178");

    expect(businessDevelopment?.title).toBe("Business Development Representative (d/f/m)");
    expect(businessDevelopment?.url).toContain(`/personio/${PERSONIO_BOARD}/job/2885178`);
    expect(businessDevelopment?.applyUrl).toContain(`/job/2885178/apply?language=en`);
    expect(businessDevelopment?.locationRaw).toBe("Berlin");
    expect(businessDevelopment?.countryCode).toBe("DE");
    expect(businessDevelopment?.employmentType).toBe("full_time");
    expect(businessDevelopment?.language).toBe("en");
    expect(businessDevelopment?.descriptionText).toContain("Personio");

    const supportAgent = ottonovaPostings.find((row) => row.atsJobId === "2888695");

    expect(supportAgent?.language).toBe("de");
    expect(supportAgent?.descriptionText ?? "").not.toBe("");
    expect(supportAgent?.locationRaw).toBe("München; Köln");
    expect(supportAgent?.employmentType).toBe("full_time");

    const englishClarkPosting = clarkPostings.find((row) => row.atsJobId === "2894252");
    const germanClarkPosting = clarkPostings.find((row) => row.atsJobId === "2377588");

    expect(englishClarkPosting?.language).toBe("en");
    expect(englishClarkPosting?.descriptionText ?? "").not.toBe("");
    expect(germanClarkPosting?.language).toBe("de");
    expect(germanClarkPosting?.descriptionText ?? "").not.toBe("");

    const tags = await harness.postingTags();
    const taggedIds = new Set(tags.map((tag) => tag.postingId));

    expect(taggedIds.has(personioPostings[0]?.id ?? "")).toBe(true);
    expect(taggedIds.has(ottonovaPostings[0]?.id ?? "")).toBe(true);

    const found = await search(harness, "Business Development Representative");

    expect(found.hits.some((hit) => hit.ats === "personio")).toBe(true);
    expect(
      found.hits.some((hit) => hit.title === "Business Development Representative (d/f/m)"),
    ).toBe(true);

    const germanSearch = await search(harness, "Krankenversicherung");

    expect(germanSearch.hits.some((hit) => hit.ats === "personio")).toBe(true);
  } finally {
    await harness.close();
  }
});

test("the Personio kill switch stops polling and is released for its probe", async () => {
  const harness = await startCatalogHarness([{ ats: "personio", token: PERSONIO_BOARD }]);

  try {
    expect((await sweepBatches(harness)).personio).toBe(0);

    await harness.runBackfillCycle();

    expect(harness.fixture.stats().perAts.personio.requestCount).toBe(0);
    expect(await harness.postings()).toHaveLength(0);

    const boardBefore = (await harness.boards()).find((row) => row.boardToken === PERSONIO_BOARD);

    expect(boardBefore?.lastPolledAt).toBeNull();

    await harness.setKillSwitch("ats", "personio", false);

    expect((await sweepBatches(harness)).personio).toBeGreaterThan(0);

    await harness.runBackfillCycle();

    expect(harness.fixture.stats().perAts.personio.requestCount).toBe(1);
    expect(await harness.postings()).toHaveLength(2);

    const boardAfter = (await harness.boards()).find((row) => row.boardToken === PERSONIO_BOARD);

    expect(boardAfter?.lastPolledAt).not.toBeNull();

    await harness.setKillSwitch("ats", "personio", true);
    await harness.runBackfillCycle();

    expect(harness.fixture.stats().perAts.personio.requestCount).toBe(1);
    expect(await harness.postings()).toHaveLength(2);
  } finally {
    await harness.close();
  }
});

test("a Personio board that answers 404 or a redirect twice is marked gone and stops polling", async () => {
  const missingBoard = "missing-board";
  const redirectedBoard = "redirected-board";

  const harness = await startCatalogHarness([
    { ats: "personio", token: missingBoard },
    { ats: "personio", token: redirectedBoard },
  ]);

  try {
    await harness.setKillSwitch("ats", "personio", false);
    harness.fixture.setRedirect("personio", [redirectedBoard]);

    await harness.runBackfillCycle();

    const afterFirst = await harness.boards();

    for (const token of [missingBoard, redirectedBoard]) {
      const board = afterFirst.find((candidate) => candidate.boardToken === token);

      expect(board?.status).toBe("active");
      expect(board?.notFoundPolls).toBe(1);
    }

    await harness.runBackfillCycle();

    const afterSecond = await harness.boards();

    for (const token of [missingBoard, redirectedBoard]) {
      const board = afterSecond.find((candidate) => candidate.boardToken === token);

      expect(board?.status).toBe("gone");
      expect(board?.nextPollAt).toBeNull();
    }

    expect(await harness.postings()).toHaveLength(0);
  } finally {
    await harness.close();
  }
});
