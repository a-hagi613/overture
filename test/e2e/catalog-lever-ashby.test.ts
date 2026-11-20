import { readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";
import { expect, test } from "@playwright/test";

import { startCatalogHarness } from "./catalog-harness.ts";

import type { Ats } from "../../src/server/catalog/board-feed.ts";
import type { CatalogHarness } from "./catalog-harness.ts";

const LEVER_BOARD = "spotify";
const LEVER_OTHER_BOARD = "olo";
const ASHBY_BOARD = "linear";
const ASHBY_OTHER_BOARD = "ramp";
const GREENHOUSE_BOARD = "vercel";

const PER_ATS_MIN_REQUEST_INTERVAL_MS = 480;
const PER_ATS_CONCURRENCY = 4;

const leverFixtureSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.string(),
      text: z.string().default(""),
      categories: z
        .object({
          department: z.string().nullish(),
        })
        .nullish(),
    }),
  ),
});

const ashbyFixtureSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.string(),
      title: z.string().default(""),
      department: z.string().nullish(),
    }),
  ),
});

const greenhouseFixtureSchema = z.object({
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

function readFixture(ats: Ats, token: string) {
  const boardFile = join(process.cwd(), `test/e2e/fixtures/${ats}`, token, "board.json");
  const raw: unknown = JSON.parse(readFileSync(boardFile, "utf8"));

  if (ats === "lever") {
    const parsed = leverFixtureSchema.parse(raw);

    return {
      jobs: parsed.jobs.map((job) => ({
        id: job.id,
        title: job.text,
        department: job.categories?.department ?? null,
      })),
    };
  }

  if (ats === "ashby") {
    const parsed = ashbyFixtureSchema.parse(raw);

    return {
      jobs: parsed.jobs.map((job) => ({
        id: job.id,
        title: job.title,
        department: job.department ?? null,
      })),
    };
  }

  const parsed = greenhouseFixtureSchema.parse(raw);

  return { jobs: parsed.jobs.map((job) => ({ id: job.id, title: job.title, department: null })) };
}

async function search(harness: CatalogHarness, query: string) {
  const response = await fetch(
    `${harness.app.url}/api/search?q=${encodeURIComponent(query)}&limit=50`,
  );

  return searchResponseSchema.parse(await response.json());
}

function postingsOnBoard(rows: Awaited<ReturnType<CatalogHarness["postings"]>>, boardId: string) {
  return rows.filter((row) => row.boardId === boardId);
}

async function recentIso(harness: CatalogHarness) {
  return new Date((await harness.clockNow()) - 60_000).toISOString();
}

async function verifyBackfillUpdateClose(ats: Ats, token: string) {
  const harness = await startCatalogHarness([{ ats, token }]);

  try {
    const jobsOnBoard = readFixture(ats, token).jobs;

    expect(jobsOnBoard.length).toBe(4);

    const changedJob = jobsOnBoard[0] ?? { id: "", title: "", department: null };
    const removedJob = jobsOnBoard[1] ?? { id: "", title: "", department: null };

    await harness.runBackfillCycle();

    const afterBackfill = postingsOnBoard(await harness.postings(), harness.boardIds[token] ?? "");

    expect(afterBackfill.length).toBe(4);
    expect(afterBackfill.every((posting) => posting.closedAt === null)).toBe(true);
    expect(afterBackfill[0]?.title).toBe(changedJob.title);
    expect(afterBackfill[0]?.department).toBe(changedJob.department);
    expect(harness.fixture.stats().perAts[ats].requestCount).toBe(1);

    const freshIso = await recentIso(harness);

    harness.fixture.mutateBoard(ats, token, {
      titleUpdates: { [changedJob.id]: "Principal Platform Engineer" },
      removeJobIds: [removedJob.id],
      addJobs: [
        {
          id: "9999001",
          title: "Senior Backend Engineer",
          updatedAt: freshIso,
          firstPublished: freshIso,
          absoluteUrl: `https://jobs.example.test/${token}/9999001`,
          locationName: "Remote — Canada",
        },
      ],
    });

    await harness.runBackfillCycle();

    const afterSecondRead = postingsOnBoard(
      await harness.postings(),
      harness.boardIds[token] ?? "",
    );

    expect(afterSecondRead.length).toBe(5);
    expect(afterSecondRead.find((row) => row.atsJobId === changedJob.id)?.title).toBe(
      "Principal Platform Engineer",
    );
    expect(afterSecondRead.find((row) => row.atsJobId === removedJob.id)?.missingPolls).toBe(1);
    expect(
      afterSecondRead.find((row) => row.atsJobId === removedJob.id)?.closedAt ?? null,
    ).toBeNull();
    expect(afterSecondRead.find((row) => row.atsJobId === "9999001")?.closedAt ?? null).toBeNull();
    expect(harness.fixture.stats().perAts[ats].requestCount).toBe(2);

    await harness.runBackfillCycle();

    const afterThirdRead = postingsOnBoard(await harness.postings(), harness.boardIds[token] ?? "");

    expect(afterThirdRead.find((row) => row.atsJobId === removedJob.id)?.closedAt).not.toBeNull();
    expect(harness.fixture.stats().perAts[ats].requestCount).toBe(3);
  } finally {
    await harness.close();
  }
}

test("a Lever backfill fills the catalog and later reads add, change and close Postings", async () => {
  await verifyBackfillUpdateClose("lever", LEVER_BOARD);
});

test("an Ashby backfill fills the catalog and later reads add, change and close Postings", async () => {
  await verifyBackfillUpdateClose("ashby", ASHBY_BOARD);
});

test("search finds Lever and Ashby Postings alongside Greenhouse Postings", async () => {
  const harness = await startCatalogHarness([
    GREENHOUSE_BOARD,
    { ats: "lever", token: LEVER_BOARD },
    { ats: "ashby", token: ASHBY_BOARD },
  ]);

  try {
    const greenhouseFixture = readFixture("greenhouse", GREENHOUSE_BOARD);
    const leverFixture = readFixture("lever", LEVER_BOARD);
    const ashbyFixture = readFixture("ashby", ASHBY_BOARD);

    await harness.runBackfillCycle();

    const sharedQuery = await search(harness, "Account Executive");

    const atsInHits = new Set(sharedQuery.hits.map((hit) => hit.ats));

    expect(sharedQuery.hits.some((hit) => hit.title === greenhouseFixture.jobs[0]?.title)).toBe(
      true,
    );
    expect(atsInHits.has("lever")).toBe(true);
    expect(atsInHits.has("greenhouse")).toBe(true);

    const leverOnly = await search(harness, "Spotify Technology");

    expect(leverOnly.hits.length).toBeGreaterThan(0);
    expect(leverOnly.hits.some((hit) => hit.ats === "lever")).toBe(true);
    expect(leverOnly.hits.some((hit) => hit.title === leverFixture.jobs[0]?.title)).toBe(true);

    const ashbyOnly = await search(harness, "Fullstack");

    expect(ashbyOnly.hits.length).toBeGreaterThan(0);
    expect(ashbyOnly.hits.some((hit) => hit.ats === "ashby")).toBe(true);
    expect(ashbyOnly.hits.some((hit) => hit.title === ashbyFixture.jobs[0]?.title)).toBe(true);
  } finally {
    await harness.close();
  }
});

test("duplicate roles across ATS boards share a dedupe key and show once", async () => {
  const harness = await startCatalogHarness([
    GREENHOUSE_BOARD,
    { ats: "ashby", token: ASHBY_BOARD },
  ]);

  try {
    const greenhouseFixture = readFixture("greenhouse", GREENHOUSE_BOARD);
    const ashbyFixture = readFixture("ashby", ASHBY_BOARD);

    const [greenhouseJob] = greenhouseFixture.jobs;
    const [ashbyJob] = ashbyFixture.jobs;

    if (greenhouseJob === undefined || ashbyJob === undefined) {
      throw new Error("a fixture board has no jobs");
    }

    harness.fixture.mutateBoard("ashby", ASHBY_BOARD, {
      titleUpdates: { [ashbyJob.id]: greenhouseJob.title },
    });

    await harness.runBackfillCycle();

    const postings = await harness.postings();

    const greenhouseRow = postings.find(
      (row) =>
        row.boardId === (harness.boardIds[GREENHOUSE_BOARD] ?? "") &&
        row.atsJobId === greenhouseJob.id,
    );

    const ashbyRow = postings.find(
      (row) =>
        row.boardId === (harness.boardIds[ASHBY_BOARD] ?? "") && row.atsJobId === ashbyJob.id,
    );

    expect(ashbyRow?.title).toBe(greenhouseJob.title);
    expect(ashbyRow?.dedupeKey).toBe(greenhouseRow?.dedupeKey);

    const results = await search(harness, greenhouseJob.title);

    expect(results.hits.length).toBe(1);
    expect(results.hits[0]?.title).toBe(greenhouseJob.title);
  } finally {
    await harness.close();
  }
});

test("a mixed backfill respects each ATS's concurrency cap and request pacing", async () => {
  const harness = await startCatalogHarness([
    "vercel",
    "stripe",
    "cloudflare",
    { ats: "lever", token: LEVER_BOARD },
    { ats: "lever", token: LEVER_OTHER_BOARD },
    { ats: "ashby", token: ASHBY_BOARD },
    { ats: "ashby", token: ASHBY_OTHER_BOARD },
  ]);

  try {
    harness.fixture.setDelayMs(700);

    await harness.runBackfillCycle();

    const stats = harness.fixture.stats();

    expect(stats.paths.filter((path) => path.startsWith("/v0/postings/")).length).toBe(2);
    expect(stats.paths.filter((path) => path.startsWith("/posting-api/job-board/")).length).toBe(2);

    for (const [ats, expectedRequests] of [
      ["greenhouse", 15],
      ["lever", 2],
      ["ashby", 2],
    ] as const) {
      const atsStats = stats.perAts[ats];

      expect(atsStats.requestCount).toBe(expectedRequests);
      expect(atsStats.maxInFlight).toBeLessThanOrEqual(PER_ATS_CONCURRENCY);
      expect(atsStats.arrivalGapsMs.length).toBe(expectedRequests - 1);

      for (const gap of atsStats.arrivalGapsMs) {
        expect(gap).toBeGreaterThanOrEqual(PER_ATS_MIN_REQUEST_INTERVAL_MS);
      }
    }

    expect(stats.maxInFlight).toBeGreaterThanOrEqual(2);
  } finally {
    await harness.close();
  }
});

test("Lever and Ashby boards that 404 twice are marked gone and stop being polled", async () => {
  const harness = await startCatalogHarness([
    { ats: "lever", token: LEVER_BOARD },
    { ats: "ashby", token: ASHBY_BOARD },
  ]);

  try {
    harness.fixture.setNotFound("lever", [LEVER_BOARD]);
    harness.fixture.setNotFound("ashby", [ASHBY_BOARD]);

    await harness.runBackfillCycle();

    const boardsAfterFirst = await harness.boards();

    for (const token of [LEVER_BOARD, ASHBY_BOARD]) {
      const board = boardsAfterFirst.find((row) => row.boardToken === token);

      expect(board?.status).toBe("active");
      expect(board?.notFoundPolls).toBe(1);
    }

    await harness.runBackfillCycle();

    const boardsAfterSecond = await harness.boards();

    for (const token of [LEVER_BOARD, ASHBY_BOARD]) {
      const board = boardsAfterSecond.find((row) => row.boardToken === token);

      expect(board?.status).toBe("gone");
      expect(board?.nextPollAt).toBeNull();
    }

    const postings = await harness.postings();

    expect(postings).toHaveLength(0);
  } finally {
    await harness.close();
  }
});
