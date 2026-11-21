import { readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";
import { expect, test } from "@playwright/test";

import { startCatalogHarness } from "./catalog-harness.ts";

import type { CatalogHarness } from "./catalog-harness.ts";

const FIXTURE_BOARD = "vercel";
const MISSING_BOARD = "stripe";

const fixtureBoardSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.union([z.number(), z.string()]).transform(String),
      title: z.string().default(""),
    }),
  ),
});

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

function readFixtureBoard(token: string) {
  const boardFile = join(process.cwd(), "test/e2e/fixtures/greenhouse", token, "board.json");
  const board = fixtureBoardSchema.parse(JSON.parse(readFileSync(boardFile, "utf8")));

  return board.jobs.map((job) => ({ id: job.id, title: job.title }));
}

async function clockNow(harness: CatalogHarness) {
  const response = await fetch(`${harness.app.url}/__test__/clock`);
  const clockResponse = z.object({ now: z.number() }).parse(await response.json());

  return clockResponse.now;
}

async function search(harness: CatalogHarness, query: string) {
  const response = await fetch(
    `${harness.app.url}/api/search?q=${encodeURIComponent(query)}&limit=50`,
  );

  return searchResponseSchema.parse(await response.json());
}

test("a backfill fills the catalog and later reads add, change and close Postings", async () => {
  const harness = await startCatalogHarness([FIXTURE_BOARD]);

  try {
    const jobsOnBoard = readFixtureBoard(FIXTURE_BOARD);

    expect(jobsOnBoard.length).toBe(4);

    const changedJob = jobsOnBoard[0] ?? { id: "", title: "" };
    const removedJob = jobsOnBoard[1] ?? { id: "", title: "" };
    const untouchedJob = jobsOnBoard[2] ?? { id: "", title: "" };

    await harness.runBackfillCycle();

    const afterBackfill = await harness.postings();

    expect(postingsOnBoard(afterBackfill, harness.boardIds[FIXTURE_BOARD] ?? "").length).toBe(4);
    expect(
      postingsOnBoard(afterBackfill, harness.boardIds[FIXTURE_BOARD] ?? "").every(
        (posting) => posting.closedAt === null,
      ),
    ).toBe(true);

    const detailsAfterBackfill = harness.fixture.stats().detailCounts;

    expect(Object.values(detailsAfterBackfill).reduce((total, count) => total + count, 0)).toBe(0);
    expect(harness.fixture.stats().perAts.greenhouse.requestCount).toBe(1);
    expect(harness.fixture.stats().paths).toEqual([
      `/v1/boards/${FIXTURE_BOARD}/jobs?content=true`,
    ]);

    const recentIso = new Date((await clockNow(harness)) - 60_000).toISOString();

    harness.fixture.mutateBoard("greenhouse", FIXTURE_BOARD, {
      titleUpdates: { [changedJob.id]: "Principal Platform Engineer" },
      updatedAtUpdates: { [changedJob.id]: recentIso },
      removeJobIds: [removedJob.id],
      addJobs: [
        {
          id: "9999001",
          title: "Senior Backend Engineer",
          updatedAt: recentIso,
          firstPublished: recentIso,
          absoluteUrl: "https://job-boards.greenhouse.io/vercel/jobs/9999001",
          locationName: "Remote — Canada",
        },
      ],
    });

    await harness.runBackfillCycle();

    const afterSecondRead = await harness.postings();
    const secondReadBoard = postingsOnBoard(afterSecondRead, harness.boardIds[FIXTURE_BOARD] ?? "");

    expect(secondReadBoard.length).toBe(5);

    const removed = findJob(secondReadBoard, removedJob.id);

    expect(removed?.closedAt).toBeNull();
    expect(removed?.missingPolls).toBe(1);

    const changed = findJob(secondReadBoard, changedJob.id);

    expect(changed?.title).toBe("Principal Platform Engineer");

    const added = findJob(secondReadBoard, "9999001");

    expect(added?.closedAt).toBeNull();

    const detailsAfterSecondRead = harness.fixture.stats().detailCounts;

    expect(detailsAfterSecondRead[`${FIXTURE_BOARD}/${changedJob.id}`] ?? 0).toBe(1);
    expect(detailsAfterSecondRead[`vercel/9999001`] ?? 0).toBe(1);
    expect(detailsAfterSecondRead[`${FIXTURE_BOARD}/${untouchedJob.id}`] ?? 0).toBe(0);
    expect(Object.values(detailsAfterSecondRead).reduce((total, count) => total + count, 0)).toBe(
      2,
    );

    await harness.runBackfillCycle();

    const afterThirdRead = await harness.postings();
    const thirdReadBoard = postingsOnBoard(afterThirdRead, harness.boardIds[FIXTURE_BOARD] ?? "");

    const closed = findJob(thirdReadBoard, removedJob.id);

    expect(closed?.closedAt).not.toBeNull();

    expect(harness.fixture.stats().detailCounts).toEqual(detailsAfterSecondRead);
  } finally {
    await harness.close();
  }
});

test("closing a board's missing Postings crosses chunk boundaries", async () => {
  const harness = await startCatalogHarness([FIXTURE_BOARD]);

  try {
    await harness.runBackfillCycle();

    const boardId = harness.boardIds[FIXTURE_BOARD] ?? "";
    const seededCount = 600;

    const onBoard = readFixtureBoard(FIXTURE_BOARD);
    const ids = Array.from({ length: seededCount }, (_, index) => `missing-${String(index)}`);

    const response = await fetch(`${harness.app.url}/__test__/catalog/postings/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        postings: ids.map((atsJobId) => ({
          ats: "greenhouse",
          atsJobId,
          boardId,
          companyId: harness.companyId,
          title: "Senior Backend Engineer",
          url: `https://job-boards.greenhouse.io/${FIXTURE_BOARD}/jobs/${atsJobId}`,
        })),
      }),
    });

    expect(response.ok).toBe(true);

    const changedJob = onBoard[0] ?? { id: "", title: "" };

    harness.fixture.mutateBoard("greenhouse", FIXTURE_BOARD, {
      titleUpdates: { [changedJob.id]: "Principal Platform Engineer" },
      updatedAtUpdates: {
        [changedJob.id]: new Date((await clockNow(harness)) - 60_000).toISOString(),
      },
    });

    await harness.runBackfillCycle();
    await harness.runBackfillCycle();

    const rows = postingsOnBoard(await harness.postings(), boardId);
    const seeded = rows.filter((row) => ids.includes(row.atsJobId));

    expect(seeded.length).toBe(seededCount);
    expect(seeded.filter((row) => row.closedAt === null)).toEqual([]);
    expect(rows.filter((row) => !ids.includes(row.atsJobId) && row.closedAt === null).length).toBe(
      onBoard.length,
    );
  } finally {
    await harness.close();
  }
});

function boardFor(boards: Awaited<ReturnType<CatalogHarness["boards"]>>, boardToken: string) {
  const board = boards.find((candidate) => candidate.boardToken === boardToken);

  if (board === undefined) {
    throw new Error(`the ${boardToken} board is missing from the catalog`);
  }

  return board;
}

function postingsOnBoard<T extends { boardId: string }>(rows: T[], boardId: string) {
  return rows.filter((row) => row.boardId === boardId);
}

function findJob<T extends { atsJobId: string }>(rows: T[], atsJobId: string) {
  return rows.find((row) => row.atsJobId === atsJobId);
}

test("search reflects a Posting title change and a close once the poll lands", async () => {
  const harness = await startCatalogHarness([FIXTURE_BOARD]);

  try {
    const jobsOnBoard = readFixtureBoard(FIXTURE_BOARD);
    const changedJob = jobsOnBoard[0] ?? { id: "", title: "" };
    const removedJob = jobsOnBoard[1] ?? { id: "", title: "" };

    await harness.runBackfillCycle();

    const before = await search(harness, "Principal Platform Engineer");

    expect(before.hits.length).toBe(0);

    const recentIso = new Date((await clockNow(harness)) - 60_000).toISOString();

    harness.fixture.mutateBoard("greenhouse", FIXTURE_BOARD, {
      titleUpdates: { [changedJob.id]: "Principal Platform Engineer" },
      updatedAtUpdates: { [changedJob.id]: recentIso },
      removeJobIds: [removedJob.id],
    });

    await harness.runBackfillCycle();
    await harness.runBackfillCycle();

    const after = await search(harness, "Principal Platform Engineer");

    expect(after.hits.length).toBe(1);
    expect(after.hits[0]?.title).toBe("Principal Platform Engineer");

    const removedSearch = await search(harness, removedJob.title);

    expect(
      removedSearch.hits.some((hit) => hit.title === removedJob.title && hit.ats === "greenhouse"),
    ).toBe(false);
  } finally {
    await harness.close();
  }
});

test("activity-based scheduling puts a freshly changed board on the 30 minute band and the trickle reads the change", async () => {
  const harness = await startCatalogHarness([FIXTURE_BOARD]);

  try {
    const jobsOnBoard = readFixtureBoard(FIXTURE_BOARD);
    const changedJob = jobsOnBoard[0] ?? { id: "", title: "" };

    harness.fixture.mutateBoard("greenhouse", FIXTURE_BOARD, {
      updatedAtUpdates: {
        [changedJob.id]: new Date((await clockNow(harness)) - 60_000).toISOString(),
      },
    });

    await harness.runBackfillCycle();

    const boards = await harness.boards();
    const board = boardFor(boards, FIXTURE_BOARD);

    expect(board.status).toBe("active");
    expect(board.contentHash).not.toBeNull();
    expect(board.nextPollAt).not.toBeNull();

    const intervalMs = (board.nextPollAt ?? 0) - (board.lastPolledAt ?? 0);

    expect(intervalMs).toBe(30 * 60_000);

    const freshIso = new Date((await clockNow(harness)) - 60_000).toISOString();

    harness.fixture.mutateBoard("greenhouse", FIXTURE_BOARD, {
      titleUpdates: { [changedJob.id]: "Distinguished Platform Engineer" },
      updatedAtUpdates: { [changedJob.id]: freshIso },
    });

    await harness.pollThroughScheduledSweep(31 * 60_000);

    const boardsAfterTrickle = await harness.boards();
    const boardAfterTrickle = boardFor(boardsAfterTrickle, FIXTURE_BOARD);

    expect(boardAfterTrickle.lastPolledAt ?? 0).toBeGreaterThan(board.lastPolledAt ?? 0);

    const intervalAfterTrickle =
      (boardAfterTrickle.nextPollAt ?? 0) - (boardAfterTrickle.lastPolledAt ?? 0);

    expect(intervalAfterTrickle).toBe(30 * 60_000);

    const postings = await harness.postings();
    const changed = findJob(postings, changedJob.id);

    expect(changed?.title).toBe("Distinguished Platform Engineer");
  } finally {
    await harness.close();
  }
});

test("a board that 404s twice is marked gone and stops being polled", async () => {
  const harness = await startCatalogHarness([MISSING_BOARD]);

  try {
    harness.fixture.setNotFound("greenhouse", [MISSING_BOARD]);

    await harness.runBackfillCycle();

    const boardsAfterFirst = await harness.boards();

    const boardAfterFirst = boardsAfterFirst.find(
      (candidate) => candidate.boardToken === MISSING_BOARD,
    );

    expect(boardAfterFirst?.status).toBe("active");
    expect(boardAfterFirst?.notFoundPolls).toBe(1);

    await harness.runBackfillCycle();

    const boardsAfterSecond = await harness.boards();

    const boardAfterSecond = boardsAfterSecond.find(
      (candidate) => candidate.boardToken === MISSING_BOARD,
    );

    expect(boardAfterSecond?.status).toBe("gone");
    expect(boardAfterSecond?.nextPollAt).toBeNull();
    const postings = await harness.postings();

    expect(postings).toHaveLength(0);
  } finally {
    await harness.close();
  }
});
