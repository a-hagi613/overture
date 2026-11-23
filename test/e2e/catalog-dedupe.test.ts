import { readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";
import { expect, test } from "@playwright/test";

import { startCatalogHarness } from "./catalog-harness.ts";

const MAIN_BOARD = "vercel";
const DUPLICATE_BOARD = "stripe";

const fixtureBoardSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.union([z.number(), z.string()]).transform(String),
      title: z.string().default(""),
      location: z.object({ name: z.string().nullish() }).nullish(),
    }),
  ),
});

const searchResponseSchema = z.object({
  hits: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      company: z.string(),
    }),
  ),
  durationMs: z.number(),
});

function readFirstJob(token: string) {
  const boardFile = join(process.cwd(), "test/e2e/fixtures/greenhouse", token, "board.json");
  const board = fixtureBoardSchema.parse(JSON.parse(readFileSync(boardFile, "utf8")));

  const [job] = board.jobs;

  if (job === undefined) {
    throw new Error(`the ${token} fixture board has no jobs`);
  }

  return job;
}

test("duplicate roles across one company's boards share a dedupe key and show once", async () => {
  const harness = await startCatalogHarness([MAIN_BOARD, DUPLICATE_BOARD]);

  try {
    const mainJob = readFirstJob(MAIN_BOARD);
    const duplicateJob = readFirstJob(DUPLICATE_BOARD);

    harness.fixture.mutateBoard("greenhouse", DUPLICATE_BOARD, {
      titleUpdates: { [duplicateJob.id]: mainJob.title },
      locationUpdates: { [duplicateJob.id]: mainJob.location?.name ?? "" },
    });

    await harness.runBackfillCycle();

    const postings = await harness.postings();

    const mainRow = postings.find(
      (posting) =>
        posting.boardId === (harness.boardIds[MAIN_BOARD] ?? "") && posting.atsJobId === mainJob.id,
    );

    const duplicateRow = postings.find(
      (posting) =>
        posting.boardId === (harness.boardIds[DUPLICATE_BOARD] ?? "") &&
        posting.atsJobId === duplicateJob.id,
    );

    expect(duplicateRow?.title).toBe(mainJob.title);
    expect(duplicateRow?.dedupeKey).toBe(mainRow?.dedupeKey);

    const sharingKey = postings.filter(
      (posting) => posting.dedupeKey === (mainRow?.dedupeKey ?? ""),
    );

    expect(sharingKey.length).toBe(2);

    const response = await fetch(
      `${harness.app.url}/__test__/search?q=${encodeURIComponent(mainJob.title)}&limit=50`,
    );

    const searchResult = searchResponseSchema.parse(await response.json());

    expect(searchResult.hits.length).toBe(1);
    expect(searchResult.hits[0]?.title).toBe(mainJob.title);
  } finally {
    await harness.close();
  }
});
