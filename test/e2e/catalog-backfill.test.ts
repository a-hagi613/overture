import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { catalogBoards, catalogPostings, postBackfillAndRun, startCatalogHarness } from "./catalog-harness.ts";

const FIXTURE_BOARD = "vercel";
const TOKEN_WITH_404 = "stripe";

function fixtureJobIds(token: string) {
  const boardPath = join(process.cwd(), "test/e2e/fixtures/greenhouse", token, "board.json");
  const board = JSON.parse(readFileSync(boardPath, "utf8")) as { jobs: { id: number }[] };

  return board.jobs.map((job) => String(job.id));
}

test("a backfill fills the catalog and later reads add, change and close Postings", async () => {
  const harness = await startCatalogHarness([FIXTURE_BOARD]);

  try {
    await postBackfillAndRun(harness);

    const afterBackfill = await catalogPostings(harness.app.url);
    const boardPostings = afterBackfill.filter((posting) => posting.boardId === harness.boardIds[FIXTURE_BOARD]);

    expect(boardPostings.length).toBe(4);
    expect(boardPostings.every((posting) => posting.closedAt === null)).toBe(true);

    const detailCountsAfterBackfill = (await harness.fixture.stats()).detailCounts;
    const detailCountEntries = Object.values(detailCountsAfterBackfill);

    expect(detailCountEntries.length).toBe(4);
    expect(detailCountEntries.every((count) => count === 1)).toBe(true);

    const jobsOnBoard = fixtureJobIds(FIXTURE_BOARD);
    const changedJobId = jobsOnBoard[0] ?? "";
    const removedJobId = jobsOnBoard[1] ?? "";
    const untouchedJobId = jobsOnBoard[2] ?? "";

    await harness.fixture.mutateBoard(FIXTURE_BOARD, {
      titleUpdates: { [changedJobId]: "Principal Platform Engineer" },
      updatedAtUpdates: { [changedJobId]: "2026-11-19T18:30:00Z" },
      removeJobIds: [removedJobId],
      addJobs: [
        {
          id: "9999001",
          title: "Senior Backend Engineer",
          updatedAt: "2026-11-19T19:00:00Z",
          firstPublished: "2026-11-19T09:00:00Z",
          absoluteUrl: "https://job-boards.greenhouse.io/vercel/jobs/9999001",
          locationName: "Remote — Canada",
        },
      ],
    });

    await postBackfillAndRun(harness);

    const afterSecondRead = await catalogPostings(harness.app.url);

    const boardAfterSecondRead = afterSecondRead.filter(
      (posting) => posting.boardId === harness.boardIds[FIXTURE_BOARD],
    );

    expect(boardAfterSecondRead.length).toBe(5);

    const removed = boardAfterSecondRead.find((posting) => posting.atsJobId === removedJobId);

    expect(removed?.closedAt).toBeNull();
    expect(removed?.missingPolls).toBe(1);

    const changed = boardAfterSecondRead.find((posting) => posting.atsJobId === changedJobId);

    expect(changed?.title).toBe("Principal Platform Engineer");

    const added = boardAfterSecondRead.find((posting) => posting.atsJobId === "9999001");

    expect(added?.closedAt).toBeNull();

    const detailCountsAfterSecondRead = (await harness.fixture.stats()).detailCounts;
    const detailsForChanged = detailCountsAfterSecondRead[`${FIXTURE_BOARD}/${changedJobId}`] ?? 0;
    const detailsForUntouched = detailCountsAfterSecondRead[`${FIXTURE_BOARD}/${untouchedJobId}`] ?? 0;

    expect(detailsForChanged).toBe(2);
    expect(detailsForUntouched).toBe(1);

    await postBackfillAndRun(harness);

    const afterThirdRead = await catalogPostings(harness.app.url);

    const boardAfterThirdRead = afterThirdRead.filter(
      (posting) => posting.boardId === harness.boardIds[FIXTURE_BOARD],
    );

    const closedAfterThirdRead = boardAfterThirdRead.find((posting) => posting.atsJobId === removedJobId);

    expect(closedAfterThirdRead?.closedAt).not.toBeNull();

    const detailCountsAfterThirdRead = (await harness.fixture.stats()).detailCounts;

    expect(detailCountsAfterThirdRead).toEqual(detailCountsAfterSecondRead);
  } finally {
    await harness.close();
  }
});

test("activity-based scheduling gives a changed board a next plan inside the quiet band", async () => {
  const harness = await startCatalogHarness([FIXTURE_BOARD]);

  try {
    await postBackfillAndRun(harness);

    const boards = await catalogBoards(harness.app.url);
    const board = boards.find((candidate) => candidate.boardToken === FIXTURE_BOARD);

    expect(board?.status).toBe("active");
    expect(board?.etag).not.toBeNull();
    expect(board?.lastPolledAt).not.toBeNull();
    expect(board?.nextPollAt).not.toBeNull();

    const intervalMs = (board?.nextPollAt ?? 0) - (board?.lastPolledAt ?? 0);

    expect(intervalMs).toBeGreaterThanOrEqual(30 * 60_000);
    expect(intervalMs).toBeLessThanOrEqual(12 * 3_600_000 + 60_000);
  } finally {
    await harness.close();
  }
});

test("a board that 404s twice is marked gone and stops being polled", async () => {
  const harness = await startCatalogHarness([TOKEN_WITH_404]);

  try {
    await harness.fixture.setNotFound([TOKEN_WITH_404]);

    await postBackfillAndRun(harness);

    const boardsAfterFirst = await catalogBoards(harness.app.url);
    const boardAfterFirst = boardsAfterFirst.find((candidate) => candidate.boardToken === TOKEN_WITH_404);

    expect(boardAfterFirst?.status).toBe("active");
    expect(boardAfterFirst?.notFoundPolls).toBe(1);

    await postBackfillAndRun(harness);

    const boardsAfterSecond = await catalogBoards(harness.app.url);
    const boardAfterSecond = boardsAfterSecond.find((candidate) => candidate.boardToken === TOKEN_WITH_404);

    expect(boardAfterSecond?.status).toBe("gone");
    expect(boardAfterSecond?.nextPollAt).toBeNull();
  } finally {
    await harness.close();
  }
});
