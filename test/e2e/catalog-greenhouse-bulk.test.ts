import { expect, test } from "@playwright/test";
import { z } from "zod";

import { startCatalogHarness } from "./catalog-harness.ts";

import type { CatalogHarness, PostingRow } from "./catalog-harness.ts";

const BOARD = "vercel";
const BOARD_PATH = `/v1/boards/${BOARD}/jobs`;
const CONTENT_PATH = `${BOARD_PATH}?content=true`;
const SWEEP_CLAIM_MS = 15 * 60_000;
const SWEEP_MAX_BOARDS = 5;
const MAX_DETAILS = 5;
const GREENHOUSE_MIN_INTERVAL_MS = 500;
const FAR_FUTURE_MS = 7 * 86_400_000;
const CLOCK_STEP_MS = 86_400_000;

function rewrittenBetween(before: PostingRow[], after: PostingRow[]) {
  const taggedBefore = new Map(before.map((row) => [row.atsJobId, row.taggedAt] as const));

  return after
    .flatMap((row) => (taggedBefore.get(row.atsJobId) === row.taggedAt ? [] : [row.atsJobId]))
    .toSorted();
}

async function sweepBatches(harness: CatalogHarness) {
  const response = await fetch(`${harness.app.url}/__test__/catalog/sweep-batches`);

  return z
    .object({
      batches: z.object({
        greenhouse: z.number(),
        lever: z.number(),
        ashby: z.number(),
      }),
    })
    .parse(await response.json()).batches;
}

test("a first Greenhouse poll makes one content request and stores every description", async () => {
  const harness = await startCatalogHarness([BOARD]);

  try {
    await harness.runBackfillCycle();

    const stats = harness.fixture.stats();

    expect(stats.paths).toEqual([CONTENT_PATH]);
    expect(stats.perAts.greenhouse.requestCount).toBe(1);
    expect(stats.detailCounts).toEqual({});

    const rows = await harness.postings();
    const jobs = harness.fixture.jobs("greenhouse", BOARD);

    expect(rows.length).toBe(jobs.length);
    expect(rows.every((row) => row.descriptionHash !== null)).toBe(true);
  } finally {
    await harness.close();
  }
});

test("one to five changed Greenhouse postings fetch only those details", async () => {
  const harness = await startCatalogHarness([BOARD]);

  try {
    await harness.runBackfillCycle();

    const jobs = harness.fixture.jobs("greenhouse", BOARD);
    const updatedAt = "2026-11-20T10:00:00Z";

    harness.fixture.mutateBoard("greenhouse", BOARD, {
      titleUpdates: Object.fromEntries(
        jobs.map((job) => [job.atsJobId, `Steady State ${job.atsJobId}`] as const),
      ),
      updatedAtUpdates: Object.fromEntries(jobs.map((job) => [job.atsJobId, updatedAt] as const)),
    });

    const before = harness.fixture.stats();

    await harness.runBackfillCycle();

    const after = harness.fixture.stats();
    const paths = after.paths.slice(before.paths.length);

    expect(paths).toHaveLength(1 + jobs.length);
    expect(paths.filter((path) => path === BOARD_PATH)).toHaveLength(1);
    expect(paths.filter((path) => path.startsWith(`${BOARD_PATH}/`))).toHaveLength(jobs.length);

    const details = after.detailCounts;

    expect(Object.values(details).reduce((total, count) => total + count, 0)).toBe(jobs.length);

    const rows = await harness.postings();

    for (const job of jobs) {
      const row = rows.find((candidate) => candidate.atsJobId === job.atsJobId);

      expect(row?.title).toBe(`Steady State ${job.atsJobId}`);
    }
  } finally {
    await harness.close();
  }
});

test("more than five changed Greenhouse postings switch to one content request", async () => {
  const token = "bulk-switch";
  const listPath = `/v1/boards/${token}/jobs`;

  const harness = await startCatalogHarness([
    { ats: "greenhouse", token, bulk: { jobCount: 10, descriptionKb: 1 } },
  ]);

  try {
    await harness.runBackfillCycle();

    const jobs = harness.fixture.jobs("greenhouse", token).slice(0, MAX_DETAILS + 1);
    const updatedAt = "2026-11-20T11:00:00Z";

    harness.fixture.mutateBoard("greenhouse", token, {
      titleUpdates: Object.fromEntries(
        jobs.map((job) => [job.atsJobId, `Bulk Refresh ${job.atsJobId}`] as const),
      ),
      updatedAtUpdates: Object.fromEntries(jobs.map((job) => [job.atsJobId, updatedAt] as const)),
    });

    const before = harness.fixture.stats();

    await harness.runBackfillCycle();

    const after = harness.fixture.stats();
    const paths = after.paths.slice(before.paths.length);

    expect(paths).toEqual([listPath, `${listPath}?content=true`]);
    expect(after.detailCounts).toEqual(before.detailCounts);

    const rows = await harness.postings();

    for (const job of jobs) {
      const row = rows.find((candidate) => candidate.atsJobId === job.atsJobId);

      expect(row?.title).toBe(`Bulk Refresh ${job.atsJobId}`);
      expect(row?.descriptionHash).not.toBeNull();
    }
  } finally {
    await harness.close();
  }
});

test("an unchanged Greenhouse board makes one request and rewrites nothing", async () => {
  const harness = await startCatalogHarness([BOARD]);

  try {
    await harness.runBackfillCycle();
    await harness.runBackfillCycle();

    const afterSecondPoll = await harness.postings();
    const before = harness.fixture.stats();

    await harness.runBackfillCycle();

    const after = harness.fixture.stats();
    const afterThirdPoll = await harness.postings();

    expect(after.paths.slice(before.paths.length)).toEqual([BOARD_PATH]);
    expect(after.requestCount - before.requestCount).toBe(1);
    expect(rewrittenBetween(afterSecondPoll, afterThirdPoll)).toEqual([]);
  } finally {
    await harness.close();
  }
});

test("a sweep claims at most the configured number of Greenhouse boards and fits the claim", async () => {
  const tokens = Array.from({ length: 25 }, (_unused, index) => `cap-greenhouse-${String(index)}`);

  const boards = tokens.map((token) => ({
    ats: "greenhouse" as const,
    token,
    bulk: { jobCount: 1, descriptionKb: 1 },
  }));

  const harness = await startCatalogHarness(boards);

  try {
    await harness.putSetting("catalog.sweep_interval_ms", String(FAR_FUTURE_MS));
    await harness.putSetting("catalog.sweep_max_boards", String(SWEEP_MAX_BOARDS));
    await harness.putSetting("jobs.poll_interval_ms", "1000");

    const plan = await sweepBatches(harness);

    expect(plan.greenhouse).toBe(SWEEP_MAX_BOARDS);
    expect(plan.greenhouse * (1 + MAX_DETAILS) * GREENHOUSE_MIN_INTERVAL_MS).toBeLessThanOrEqual(
      SWEEP_CLAIM_MS,
    );

    await harness.runBackfillCycle();

    const afterBackfill = await harness.boards();

    expect(afterBackfill.filter((board) => board.lastPolledAt !== null)).toHaveLength(
      SWEEP_MAX_BOARDS,
    );

    await harness.moveClock(CLOCK_STEP_MS);

    await harness.runOneJob("catalog.sweep");

    const afterSweep = await harness.boards();

    expect(afterSweep.filter((board) => board.lastPolledAt !== null)).toHaveLength(
      SWEEP_MAX_BOARDS * 2,
    );
  } finally {
    await harness.close();
  }
});
