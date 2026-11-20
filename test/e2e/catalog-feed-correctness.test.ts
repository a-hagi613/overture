import { readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";
import { expect, test } from "@playwright/test";

import { startCatalogHarness } from "./catalog-harness.ts";

import type { Ats } from "../../src/server/catalog/board-feed.ts";
import type { CatalogHarness, PostingRow } from "./catalog-harness.ts";

const ASHBY_BOARD = "ramp";
const LEVER_BOARD = "swile";
const PAGINATED_LEVER_BOARD = "pigment";
const GREENHOUSE_BOARD = "anthropic";

const fixtureJobSchema = z.object({
  id: z.union([z.number(), z.string()]).transform(String),
  title: z.string().default(""),
  text: z.string().default(""),
  workplaceType: z.string().nullish(),
  isRemote: z.boolean().nullish(),
  jobUrl: z.string().default(""),
  hostedUrl: z.string().default(""),
  applyUrl: z.string().nullish(),
  pay_input_ranges: z
    .array(
      z.object({
        min_cents: z.number().nullish(),
        max_cents: z.number().nullish(),
        currency_type: z.string().nullish(),
        interval: z.string().nullish(),
      }),
    )
    .nullish(),
  content: z.string().nullish(),
});

const boardFixtureSchema = z.object({ jobs: z.array(fixtureJobSchema) });

const importReportSchema = z.object({
  matched: z.number(),
  unmatched: z.number(),
});

const retagReportSchema = z.object({
  boardsReset: z.number(),
  postingsReset: z.number(),
});

function readBoardFixture(ats: Ats, token: string) {
  const raw: unknown = JSON.parse(
    readFileSync(join(process.cwd(), `test/e2e/fixtures/${ats}`, token, "board.json"), "utf8"),
  );

  const parsed = boardFixtureSchema.parse(raw);
  const jobs: (typeof parsed.jobs)[number][] = [];

  for (const job of parsed.jobs) {
    jobs.push({ ...job, title: job.title === "" ? job.text : job.title });
  }

  return jobs;
}

function postingsOnBoard(rows: PostingRow[], boardId: string | undefined) {
  return rows.filter((row) => row.boardId === boardId);
}

async function postJson(url: string, body: string) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

  if (!response.ok) {
    throw new Error(`POST ${url} failed with ${String(response.status)}`);
  }

  return response;
}

async function importWorkplace(harness: CatalogHarness, row: string) {
  const response = await postJson(
    `${harness.app.url}/__test__/tag-imports`,
    JSON.stringify({ content: `${row}\n` }),
  );

  return importReportSchema.parse(await response.json());
}

async function resetFeedHashes(harness: CatalogHarness) {
  const response = await postJson(`${harness.app.url}/__test__/catalog/retag-open-postings`, "{}");

  return retagReportSchema.parse(await response.json());
}

test("an Ashby hybrid posting that is also isRemote true is tagged hybrid and uses its applyUrl", async () => {
  const harness = await startCatalogHarness([{ ats: "ashby", token: ASHBY_BOARD }]);

  try {
    const fixtureJobs = readBoardFixture("ashby", ASHBY_BOARD);

    expect(fixtureJobs.length).toBeGreaterThan(0);
    expect(fixtureJobs.every((job) => job.workplaceType === "Hybrid")).toBe(true);
    expect(fixtureJobs.every((job) => job.isRemote === true)).toBe(true);

    await harness.runBackfillCycle();

    const postings = postingsOnBoard(await harness.postings(), harness.boardIds[ASHBY_BOARD]);

    expect(postings).toHaveLength(fixtureJobs.length);

    for (const posting of postings) {
      const fixtureJob = fixtureJobs.find((job) => job.id === posting.atsJobId);

      expect(posting.workplace).toBe("hybrid");
      expect(posting.applyUrl).toBe(fixtureJob?.applyUrl ?? null);
      expect(posting.url).toBe(fixtureJob?.jobUrl ?? "");
    }
  } finally {
    await harness.close();
  }
});

test("a Lever onsite posting is tagged onsite and keeps hostedUrl and applyUrl apart", async () => {
  const harness = await startCatalogHarness([{ ats: "lever", token: LEVER_BOARD }]);

  try {
    const fixtureJobs = readBoardFixture("lever", LEVER_BOARD);
    const onsiteJobs = fixtureJobs.filter((job) => job.workplaceType === "onsite");

    expect(onsiteJobs.length).toBeGreaterThan(0);

    await harness.runBackfillCycle();

    const postings = postingsOnBoard(await harness.postings(), harness.boardIds[LEVER_BOARD]);

    expect(postings).toHaveLength(fixtureJobs.length);

    for (const posting of postings) {
      const fixtureJob = fixtureJobs.find((job) => job.id === posting.atsJobId);

      const expectedWorkplace = {
        onsite: "onsite",
        hybrid: "hybrid",
        remote: "remote",
      }[fixtureJob?.workplaceType ?? ""];

      expect(posting.workplace).toBe(expectedWorkplace);
      expect(posting.url).toBe(fixtureJob?.hostedUrl ?? "");
      expect(posting.applyUrl).toBe(fixtureJob?.applyUrl ?? null);
    }
  } finally {
    await harness.close();
  }
});

test("a Lever board over one hundred postings is read page by page", async () => {
  const harness = await startCatalogHarness([{ ats: "lever", token: PAGINATED_LEVER_BOARD }]);

  try {
    const fixtureJobs = readBoardFixture("lever", PAGINATED_LEVER_BOARD);

    expect(fixtureJobs.length).toBeGreaterThan(100);

    await harness.runBackfillCycle();

    const postings = postingsOnBoard(
      await harness.postings(),
      harness.boardIds[PAGINATED_LEVER_BOARD],
    );

    expect(postings).toHaveLength(fixtureJobs.length);

    const pageUrls = harness.fixture
      .stats()
      .urls.filter((url) => url.startsWith(`/v0/postings/${PAGINATED_LEVER_BOARD}?`));

    expect(pageUrls).toHaveLength(2);
    expect(pageUrls[0]).toContain("limit=100&skip=0");
    expect(pageUrls[1]).toContain("limit=100&skip=100");
    expect(pageUrls.some((url) => url.includes("skip=200"))).toBe(false);
  } finally {
    await harness.close();
  }
});

test("a Greenhouse detail fetch asks for pay transparency and stores the pay range", async () => {
  const harness = await startCatalogHarness([GREENHOUSE_BOARD]);

  try {
    const fixtureJobs = readBoardFixture("greenhouse", GREENHOUSE_BOARD);
    const paidJobs = fixtureJobs.filter((job) => (job.pay_input_ranges ?? []).length > 0);

    expect(paidJobs.length).toBeGreaterThan(0);

    await harness.runBackfillCycle();

    const postings = postingsOnBoard(await harness.postings(), harness.boardIds[GREENHOUSE_BOARD]);

    expect(postings).toHaveLength(fixtureJobs.length);

    for (const fixtureJob of paidJobs) {
      const [range] = fixtureJob.pay_input_ranges ?? [];
      const posting = postings.find((row) => row.atsJobId === fixtureJob.id);

      expect(posting?.salaryMinMinor).toBe(range?.min_cents);
      expect(posting?.salaryMaxMinor).toBe(range?.max_cents);
      expect(posting?.salaryCurrency).toBe(range?.currency_type ?? null);
      expect(posting?.salaryPeriod).toBe(range?.interval ?? null);
    }

    const detailUrls = harness.fixture
      .stats()
      .urls.filter((url) => url.includes(`/v1/boards/${GREENHOUSE_BOARD}/jobs/`));

    expect(detailUrls.length).toBe(fixtureJobs.length);
    expect(detailUrls.every((url) => url.includes("pay_transparency=true"))).toBe(true);
  } finally {
    await harness.close();
  }
});

test("a double-encoded Greenhouse posting is decoded before its description reaches the catalog", async () => {
  const harness = await startCatalogHarness([GREENHOUSE_BOARD]);

  try {
    const fixtureJobs = readBoardFixture("greenhouse", GREENHOUSE_BOARD);
    const encodedJob = fixtureJobs.find((job) => (job.content ?? "").includes("&lt;p&gt;"));

    expect(encodedJob).toBeDefined();

    await harness.runBackfillCycle();

    const postings = postingsOnBoard(await harness.postings(), harness.boardIds[GREENHOUSE_BOARD]);

    for (const posting of postings) {
      expect(posting.descriptionText).not.toBeNull();
      expect(posting.descriptionText ?? "").not.toMatch(/&(?:amp|lt|gt|quot|apos|nbsp);/u);
      expect(posting.descriptionText ?? "").not.toMatch(/<(?:p|div|li|ul|h[1-6]|strong|em)\b/u);
    }
  } finally {
    await harness.close();
  }
});

test("the one-time re-tag rewrites open Lever postings with the feed workplace and is idempotent", async () => {
  const harness = await startCatalogHarness([{ ats: "lever", token: LEVER_BOARD }]);

  try {
    const fixtureJobs = readBoardFixture("lever", LEVER_BOARD);
    const onsiteJob = fixtureJobs.find((job) => job.workplaceType === "onsite");

    if (onsiteJob === undefined) {
      throw new Error("the Lever fixture has no onsite posting");
    }

    await harness.runBackfillCycle();

    const beforeImport = postingsOnBoard(
      await harness.postings(),
      harness.boardIds[LEVER_BOARD],
    ).find((row) => row.atsJobId === onsiteJob.id);

    expect(beforeImport?.workplace).toBe("onsite");

    const imported = await importWorkplace(
      harness,
      JSON.stringify({
        apply_url: beforeImport?.applyUrl ?? onsiteJob.hostedUrl,
        title: onsiteJob.title,
        workplace: "unknown",
      }),
    );

    expect(imported.matched).toBe(1);

    const afterImport = postingsOnBoard(
      await harness.postings(),
      harness.boardIds[LEVER_BOARD],
    ).find((row) => row.atsJobId === onsiteJob.id);

    expect(afterImport?.workplace).toBe("unknown");

    await harness.runBackfillCycle();

    const afterPlainPoll = postingsOnBoard(
      await harness.postings(),
      harness.boardIds[LEVER_BOARD],
    ).find((row) => row.atsJobId === onsiteJob.id);

    expect(afterPlainPoll?.workplace).toBe("unknown");

    const firstReset = await resetFeedHashes(harness);

    expect(firstReset.boardsReset).toBe(1);
    expect(firstReset.postingsReset).toBe(fixtureJobs.length);

    await harness.runBackfillCycle();

    const afterRetag = postingsOnBoard(await harness.postings(), harness.boardIds[LEVER_BOARD]);

    expect(afterRetag.find((row) => row.atsJobId === onsiteJob.id)?.workplace).toBe("onsite");
    expect(afterRetag).toHaveLength(fixtureJobs.length);

    await resetFeedHashes(harness);
    await harness.runBackfillCycle();

    const afterSecondRetag = postingsOnBoard(
      await harness.postings(),
      harness.boardIds[LEVER_BOARD],
    );

    expect(afterSecondRetag.find((row) => row.atsJobId === onsiteJob.id)?.workplace).toBe("onsite");
    expect(afterSecondRetag).toHaveLength(fixtureJobs.length);
  } finally {
    await harness.close();
  }
});
