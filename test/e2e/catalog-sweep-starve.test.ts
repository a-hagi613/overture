import { expect, test } from "@playwright/test";

import { startCatalogHarness } from "./catalog-harness.ts";

import type { BoardSpec } from "./catalog-harness.ts";

const HEALTH_BUDGET_MS = 1000;
const MIN_SAMPLES = 40;
const GREENHOUSE_JOBS = 900;
const ASHBY_JOBS = 900;
const HEAVY_GREENHOUSE_JOBS = 900;

const GREENHOUSE_BOARDS = [
  "bulk-greenhouse-one",
  "bulk-greenhouse-two",
  "bulk-greenhouse-three",
  "bulk-greenhouse-four",
];

const HEAVY_GREENHOUSE_BOARD = "bulk-greenhouse-heavy";

const ASHBY_BOARDS = ["bulk-ashby-one", "bulk-ashby-two", "bulk-ashby-three"];

const BOARDS: BoardSpec[] = [
  ...GREENHOUSE_BOARDS.map((token) => ({
    ats: "greenhouse" as const,
    token,
    bulk: { jobCount: GREENHOUSE_JOBS, descriptionKb: 6 },
  })),
  {
    ats: "greenhouse" as const,
    token: HEAVY_GREENHOUSE_BOARD,
    bulk: { jobCount: HEAVY_GREENHOUSE_JOBS, sourceToken: "stripe" },
  },
  ...ASHBY_BOARDS.map((token) => ({
    ats: "ashby" as const,
    token,
    bulk: { jobCount: ASHBY_JOBS, descriptionKb: 4 },
  })),
];

async function sampleHealthWhile(url: string, untilSettled: () => boolean) {
  const samples: number[] = [];

  async function step() {
    if (untilSettled()) {
      return samples;
    }

    const start = performance.now();
    const response = await fetch(`${url}/api/health`);

    await response.json();
    samples.push(performance.now() - start);

    return step();
  }

  return step();
}

test("the health route keeps answering while the sweep reads multi-megabyte feeds over a filled catalog", async () => {
  const harness = await startCatalogHarness(BOARDS);

  try {
    await harness.seedPostings([...GREENHOUSE_BOARDS, ...ASHBY_BOARDS]);

    const seeded = await harness.postings();

    expect(seeded.length).toBe(
      GREENHOUSE_JOBS * GREENHOUSE_BOARDS.length + ASHBY_JOBS * ASHBY_BOARDS.length,
    );

    for (const [index, token] of GREENHOUSE_BOARDS.entries()) {
      const jobId = `gh-${token}-${String(index)}`;

      harness.fixture.mutateBoard("greenhouse", token, {
        titleUpdates: { [jobId]: "Principal Platform Engineer" },
        updatedAtUpdates: { [jobId]: "2026-11-20T09:00:00Z" },
      });
    }

    let settled = false;

    const sweep = (async () => {
      await harness.runBackfillCycle();
      settled = true;
    })();

    const samples = await sampleHealthWhile(harness.app.url, () => settled);

    await sweep;

    const slow = samples.filter((sample) => sample >= HEALTH_BUDGET_MS);

    expect(samples.length).toBeGreaterThanOrEqual(MIN_SAMPLES);
    expect(slow.map((sample) => Math.round(sample))).toEqual([]);

    const details = harness.fixture.stats().detailCounts;

    expect(Object.keys(details).length).toBe(GREENHOUSE_BOARDS.length);

    const after = await harness.postings();
    const ashbyBoardIds = new Set(ASHBY_BOARDS.map((token) => harness.boardIds[token] ?? ""));
    const ashbyPostings = after.filter((posting) => ashbyBoardIds.has(posting.boardId));
    const heavyBoardId = harness.boardIds[HEAVY_GREENHOUSE_BOARD] ?? "";
    const heavyPostings = after.filter((posting) => posting.boardId === heavyBoardId);

    expect(after.length).toBe(seeded.length + HEAVY_GREENHOUSE_JOBS);
    expect(after.filter((posting) => posting.closedAt !== null).length).toBe(0);
    expect(heavyPostings.length).toBe(HEAVY_GREENHOUSE_JOBS);
    expect(heavyPostings.every((posting) => posting.descriptionHash !== null)).toBe(true);
    expect(ashbyPostings.length).toBe(ASHBY_JOBS * ASHBY_BOARDS.length);
    expect(ashbyPostings.every((posting) => posting.tagSource === "rules")).toBe(true);
  } finally {
    await harness.close();
  }
});
