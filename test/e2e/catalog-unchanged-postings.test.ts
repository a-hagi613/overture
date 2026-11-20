import { expect, test } from "@playwright/test";

import { startCatalogHarness } from "./catalog-harness.ts";

import type { CatalogHarness, PostingRow } from "./catalog-harness.ts";

import type { Ats } from "../../src/server/catalog/board-feed.ts";

const LEVER_BOARD = "spotify";
const ASHBY_BOARD = "linear";
const CYCLE_STEP_MS = 60_000;

const BOARDS: readonly { ats: Ats; token: string }[] = [
  { ats: "lever", token: LEVER_BOARD },
  { ats: "ashby", token: ASHBY_BOARD },
];

async function moveClockTo(harness: CatalogHarness, offsetMs: number) {
  const response = await fetch(`${harness.app.url}/__test__/clock/offset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ offsetMs }),
  });

  if (!response.ok) {
    throw new Error(`moving the clock failed: ${String(response.status)}`);
  }
}

async function postingsOn(harness: CatalogHarness, token: string) {
  const boardId = harness.boardIds[token] ?? "";

  return (await harness.postings()).filter((row) => row.boardId === boardId);
}

function rewrittenBetween(before: PostingRow[], after: PostingRow[]) {
  const taggedBefore = new Map(before.map((row) => [row.atsJobId, row.taggedAt] as const));

  return after
    .flatMap((row) => (taggedBefore.get(row.atsJobId) === row.taggedAt ? [] : [row.atsJobId]))
    .toSorted();
}

function byAtsJobId(rows: PostingRow[], atsJobId: string) {
  return rows.find((row) => row.atsJobId === atsJobId);
}

test.describe("Lever and Ashby postings are rewritten only when their feed content changes", () => {
  for (const { ats, token } of BOARDS) {
    test(`an unchanged ${ats} board polled twice rewrites no Posting rows`, async () => {
      const harness = await startCatalogHarness([{ ats, token }]);

      try {
        await moveClockTo(harness, 0);
        await harness.runBackfillCycle();

        const afterFirstPoll = await postingsOn(harness, token);

        await moveClockTo(harness, CYCLE_STEP_MS);
        await harness.runBackfillCycle();

        const afterSecondPoll = await postingsOn(harness, token);

        expect(harness.fixture.stats().perAts[ats].requestCount).toBe(2);
        expect(afterFirstPoll.length).toBeGreaterThan(0);
        expect(afterSecondPoll.length).toBe(afterFirstPoll.length);
        expect(rewrittenBetween(afterFirstPoll, afterSecondPoll)).toEqual([]);
      } finally {
        await harness.close();
      }
    });

    test(`a changed ${ats} title rewrites and re-tags only that Posting on the next poll`, async () => {
      const harness = await startCatalogHarness([{ ats, token }]);

      try {
        const [changedJob] = harness.fixture.jobs(ats, token);

        if (changedJob === undefined) {
          throw new Error(`the ${ats} fixture board has no jobs`);
        }

        await moveClockTo(harness, 0);
        await harness.runBackfillCycle();

        const afterFirstPoll = await postingsOn(harness, token);

        harness.fixture.mutateBoard(ats, token, {
          titleUpdates: { [changedJob.atsJobId]: "Principal Platform Engineer" },
        });

        await moveClockTo(harness, CYCLE_STEP_MS);
        await harness.runBackfillCycle();

        const afterSecondPoll = await postingsOn(harness, token);

        expect(rewrittenBetween(afterFirstPoll, afterSecondPoll)).toEqual([changedJob.atsJobId]);
        expect(byAtsJobId(afterSecondPoll, changedJob.atsJobId)?.title).toBe(
          "Principal Platform Engineer",
        );
      } finally {
        await harness.close();
      }
    });

    test(`a changed ${ats} description rewrites and re-tags only that Posting on the next poll`, async () => {
      const harness = await startCatalogHarness([{ ats, token }]);

      try {
        const [changedJob] = harness.fixture.jobs(ats, token);

        if (changedJob === undefined) {
          throw new Error(`the ${ats} fixture board has no jobs`);
        }

        await moveClockTo(harness, 0);
        await harness.runBackfillCycle();

        const afterFirstPoll = await postingsOn(harness, token);

        harness.fixture.mutateBoard(ats, token, {
          descriptionUpdates: {
            [changedJob.atsJobId]: "We are hiring a platform engineer to run our job pipeline.",
          },
        });

        await moveClockTo(harness, CYCLE_STEP_MS);
        await harness.runBackfillCycle();

        const afterSecondPoll = await postingsOn(harness, token);

        expect(rewrittenBetween(afterFirstPoll, afterSecondPoll)).toEqual([changedJob.atsJobId]);
      } finally {
        await harness.close();
      }
    });
  }
});
