import { readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";
import { expect, test } from "@playwright/test";

import { startCatalogHarness } from "./catalog-harness.ts";

import type { Ats } from "../../src/server/catalog/board-feed.ts";
import type { CatalogHarness, PostingRow } from "./catalog-harness.ts";

const ASHBY_BOARD = "ramp";
const LEVER_BOARD = "swile";
const LEVER_EU_BOARD = "aavelabs";
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
  descriptionPlain: z.string().nullish(),
  description: z.string().nullish(),
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

const discoveredReportSchema = z.object({
  createdBoards: z.number(),
  existingBoards: z.number(),
});

function readBoardFixture(ats: Ats, token: string, region: "us" | "eu" = "us") {
  const root =
    ats === "lever" && region === "eu" ? "test/e2e/fixtures/lever-eu" : `test/e2e/fixtures/${ats}`;

  const raw: unknown = JSON.parse(
    readFileSync(join(process.cwd(), root, token, "board.json"), "utf8"),
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

test("an Ashby board slug is requested in lowercase", async () => {
  const harness = await startCatalogHarness([{ ats: "ashby", token: "Ramp" }]);

  try {
    const fixtureJobs = readBoardFixture("ashby", ASHBY_BOARD);

    await harness.runBackfillCycle();

    const { urls } = harness.fixture.stats();

    expect(urls).toContain("/posting-api/job-board/ramp?includeCompensation=true");
    expect(urls.some((url) => url.includes("/posting-api/job-board/Ramp"))).toBe(false);

    const postings = postingsOnBoard(await harness.postings(), harness.boardIds.Ramp);

    expect(postings).toHaveLength(fixtureJobs.length);
  } finally {
    await harness.close();
  }
});

test("a Lever EU board is polled on the EU instance and a US board stays on the US one", async () => {
  const harness = await startCatalogHarness([
    { ats: "lever", token: LEVER_EU_BOARD, region: "eu" },
    { ats: "lever", token: LEVER_BOARD, region: "us" },
  ]);

  try {
    const euFixtureJobs = readBoardFixture("lever", LEVER_EU_BOARD, "eu");
    const usFixtureJobs = readBoardFixture("lever", LEVER_BOARD);

    await harness.runBackfillCycle();

    const boards = await harness.boards();

    const euBoard = boards.find(
      (board) =>
        board.ats === "lever" && board.boardToken === LEVER_EU_BOARD && board.region === "eu",
    );

    const usBoard = boards.find(
      (board) => board.ats === "lever" && board.boardToken === LEVER_BOARD && board.region === "us",
    );

    expect(euBoard?.region).toBe("eu");
    expect(usBoard?.region).toBe("us");

    const { urls } = harness.fixture.stats();

    expect(urls.filter((url) => url.startsWith(`/eu/v0/postings/${LEVER_EU_BOARD}?`))).toHaveLength(
      1,
    );
    expect(urls.filter((url) => url.startsWith(`/v0/postings/${LEVER_EU_BOARD}?`))).toHaveLength(0);
    expect(urls.some((url) => url.startsWith(`/v0/postings/${LEVER_BOARD}?`))).toBe(true);
    expect(urls.some((url) => url.startsWith(`/eu/v0/postings/${LEVER_BOARD}?`))).toBe(false);

    const postings = await harness.postings();

    expect(postings.filter((row) => row.boardId === euBoard?.id)).toHaveLength(
      euFixtureJobs.length,
    );
    expect(postings.filter((row) => row.boardId === usBoard?.id)).toHaveLength(
      usFixtureJobs.length,
    );
  } finally {
    await harness.close();
  }
});

test("the same Lever slug on two regions makes two board rows and polls each separately", async () => {
  const harness = await startCatalogHarness([
    { ats: "lever", token: LEVER_EU_BOARD, region: "eu" },
    { ats: "lever", token: LEVER_EU_BOARD, region: "us" },
  ]);

  try {
    const euFixtureJobs = readBoardFixture("lever", LEVER_EU_BOARD, "eu");
    const boards = await harness.boards();

    const sameSlug = boards.filter(
      (board) => board.ats === "lever" && board.boardToken === LEVER_EU_BOARD,
    );

    expect(sameSlug).toHaveLength(2);
    expect(new Set(sameSlug.map((board) => board.region))).toEqual(new Set(["eu", "us"]));

    await harness.runBackfillCycle();

    const euBoard = sameSlug.find((board) => board.region === "eu");
    const usBoard = sameSlug.find((board) => board.region === "us");
    const postings = await harness.postings();

    expect(postings.filter((row) => row.boardId === euBoard?.id)).toHaveLength(
      euFixtureJobs.length,
    );
    expect(postings.filter((row) => row.boardId === usBoard?.id)).toHaveLength(0);

    const { urls } = harness.fixture.stats();

    expect(urls.some((url) => url.startsWith(`/eu/v0/postings/${LEVER_EU_BOARD}?`))).toBe(true);
    expect(urls.some((url) => url.startsWith(`/v0/postings/${LEVER_EU_BOARD}?`))).toBe(true);
  } finally {
    await harness.close();
  }
});

test("a Lever slug keeps its exact case in the request", async () => {
  const harness = await startCatalogHarness([{ ats: "lever", token: "Swile" }]);

  try {
    await harness.runBackfillCycle();

    const { urls } = harness.fixture.stats();

    expect(urls.some((url) => url.startsWith("/v0/postings/Swile?"))).toBe(true);
    expect(urls.some((url) => url.startsWith("/v0/postings/swile?"))).toBe(false);

    const board = (await harness.boards()).find((row) => row.boardToken === "Swile");

    expect(board?.status).toBe("empty");
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

    const htmlOnlyJob = fixtureJobs.find(
      (job) => (job.descriptionPlain ?? "").trim() === "" && (job.description ?? "") !== "",
    );

    if (htmlOnlyJob === undefined) {
      throw new Error("the Lever fixture has no HTML-only description");
    }

    const htmlOnlyPosting = postings.find((row) => row.atsJobId === htmlOnlyJob.id);

    expect((htmlOnlyPosting?.descriptionText ?? "").length).toBeGreaterThan(100);
    expect(htmlOnlyPosting?.descriptionText ?? "").not.toMatch(/<(?:p|div|li|ul|strong)\b/u);
    expect(htmlOnlyPosting?.descriptionText ?? "").not.toMatch(/&(?:amp|lt|gt|quot|nbsp);/u);
  } finally {
    await harness.close();
  }
});

test("a changed Greenhouse posting fetches its detail with pay transparency and stores the pay range", async () => {
  const harness = await startCatalogHarness([GREENHOUSE_BOARD]);

  try {
    const fixtureJobs = readBoardFixture("greenhouse", GREENHOUSE_BOARD);
    const paidJob = fixtureJobs.find((job) => (job.pay_input_ranges ?? []).length > 0);

    if (paidJob === undefined) {
      throw new Error("the Greenhouse fixture has no paid posting");
    }

    const [range] = paidJob.pay_input_ranges ?? [];

    await harness.runBackfillCycle();

    const afterBulk = postingsOnBoard(await harness.postings(), harness.boardIds[GREENHOUSE_BOARD]);

    expect(afterBulk).toHaveLength(fixtureJobs.length);
    expect(afterBulk.every((posting) => posting.salaryMinMinor === null)).toBe(true);

    const freshIso = new Date((await harness.clockNow()) - 60_000).toISOString();

    harness.fixture.mutateBoard("greenhouse", GREENHOUSE_BOARD, {
      updatedAtUpdates: { [paidJob.id]: freshIso },
    });

    await harness.runBackfillCycle();

    const afterDetail = postingsOnBoard(
      await harness.postings(),
      harness.boardIds[GREENHOUSE_BOARD],
    );

    const paidPosting = afterDetail.find((row) => row.atsJobId === paidJob.id);

    expect(paidPosting?.salaryMinMinor).toBe(range?.min_cents);
    expect(paidPosting?.salaryMaxMinor).toBe(range?.max_cents);
    expect(paidPosting?.salaryCurrency).toBe(range?.currency_type ?? null);
    expect(paidPosting?.salaryPeriod).toBe(range?.interval ?? null);

    const detailUrls = harness.fixture
      .stats()
      .urls.filter((url) => url.includes(`/v1/boards/${GREENHOUSE_BOARD}/jobs/`));

    expect(detailUrls.some((url) => url.includes(`/jobs/${paidJob.id}?`))).toBe(true);
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

test("the one-time re-tag rewrites open Lever and Ashby postings with the feed workplace and is idempotent", async () => {
  const harness = await startCatalogHarness([
    { ats: "lever", token: LEVER_BOARD },
    { ats: "ashby", token: ASHBY_BOARD },
  ]);

  try {
    const leverJobs = readBoardFixture("lever", LEVER_BOARD);
    const ashbyJobs = readBoardFixture("ashby", ASHBY_BOARD);
    const onsiteJob = leverJobs.find((job) => job.workplaceType === "onsite");
    const hybridJob = ashbyJobs.find((job) => job.workplaceType === "Hybrid");

    if (onsiteJob === undefined || hybridJob === undefined) {
      throw new Error("the fixtures have no Lever onsite or Ashby hybrid posting");
    }

    await harness.runBackfillCycle();

    const leverBeforeImport = postingsOnBoard(
      await harness.postings(),
      harness.boardIds[LEVER_BOARD],
    ).find((row) => row.atsJobId === onsiteJob.id);

    const ashbyBeforeImport = postingsOnBoard(
      await harness.postings(),
      harness.boardIds[ASHBY_BOARD],
    ).find((row) => row.atsJobId === hybridJob.id);

    expect(leverBeforeImport?.workplace).toBe("onsite");
    expect(ashbyBeforeImport?.workplace).toBe("hybrid");

    const imported = await importWorkplace(
      harness,
      [
        JSON.stringify({
          apply_url: leverBeforeImport?.applyUrl ?? onsiteJob.hostedUrl,
          title: onsiteJob.title,
          workplace: "unknown",
        }),
        JSON.stringify({
          apply_url: ashbyBeforeImport?.applyUrl ?? hybridJob.jobUrl,
          title: hybridJob.title,
          workplace: "unknown",
        }),
      ].join("\n"),
    );

    expect(imported.matched).toBe(2);

    const afterImport = await harness.postings();

    expect(
      postingsOnBoard(afterImport, harness.boardIds[LEVER_BOARD]).find(
        (row) => row.atsJobId === onsiteJob.id,
      )?.workplace,
    ).toBe("unknown");
    expect(
      postingsOnBoard(afterImport, harness.boardIds[ASHBY_BOARD]).find(
        (row) => row.atsJobId === hybridJob.id,
      )?.workplace,
    ).toBe("unknown");

    await harness.runBackfillCycle();

    const afterPlainPoll = await harness.postings();

    expect(
      postingsOnBoard(afterPlainPoll, harness.boardIds[LEVER_BOARD]).find(
        (row) => row.atsJobId === onsiteJob.id,
      )?.workplace,
    ).toBe("unknown");
    expect(
      postingsOnBoard(afterPlainPoll, harness.boardIds[ASHBY_BOARD]).find(
        (row) => row.atsJobId === hybridJob.id,
      )?.workplace,
    ).toBe("unknown");

    const firstReset = await resetFeedHashes(harness);

    expect(firstReset.boardsReset).toBe(2);
    expect(firstReset.postingsReset).toBe(leverJobs.length + ashbyJobs.length);

    await harness.runBackfillCycle();

    const afterRetag = await harness.postings();
    const leverAfterRetag = postingsOnBoard(afterRetag, harness.boardIds[LEVER_BOARD]);
    const ashbyAfterRetag = postingsOnBoard(afterRetag, harness.boardIds[ASHBY_BOARD]);

    expect(leverAfterRetag.find((row) => row.atsJobId === onsiteJob.id)?.workplace).toBe("onsite");
    expect(ashbyAfterRetag.find((row) => row.atsJobId === hybridJob.id)?.workplace).toBe("hybrid");
    expect(leverAfterRetag).toHaveLength(leverJobs.length);
    expect(ashbyAfterRetag).toHaveLength(ashbyJobs.length);

    await resetFeedHashes(harness);
    await harness.runBackfillCycle();

    const afterSecondRetag = await harness.postings();

    expect(
      postingsOnBoard(afterSecondRetag, harness.boardIds[LEVER_BOARD]).find(
        (row) => row.atsJobId === onsiteJob.id,
      )?.workplace,
    ).toBe("onsite");
    expect(
      postingsOnBoard(afterSecondRetag, harness.boardIds[ASHBY_BOARD]).find(
        (row) => row.atsJobId === hybridJob.id,
      )?.workplace,
    ).toBe("hybrid");
    expect(postingsOnBoard(afterSecondRetag, harness.boardIds[LEVER_BOARD])).toHaveLength(
      leverJobs.length,
    );
    expect(postingsOnBoard(afterSecondRetag, harness.boardIds[ASHBY_BOARD])).toHaveLength(
      ashbyJobs.length,
    );
  } finally {
    await harness.close();
  }
});

test("a Greenhouse seed row yields its token from every URL shape the dataset uses", async () => {
  const harness = await startCatalogHarness([]);

  try {
    const rows = [
      {
        ats: "greenhouse",
        name: "Boards Co",
        slug: "",
        url: "https://boards.greenhouse.io/boardsco",
      },
      {
        ats: "greenhouse",
        name: "Job Boards Co",
        slug: "",
        url: "https://job-boards.greenhouse.io/jobboardsco",
      },
      {
        ats: "greenhouse",
        name: "EU Co",
        slug: "",
        url: "https://job-boards.eu.greenhouse.io/euboardsco",
      },
      {
        ats: "greenhouse",
        name: "Job Path Co",
        slug: "",
        url: "https://job-boards.greenhouse.io/jobpathco/jobs/1234567",
      },
      {
        ats: "greenhouse",
        name: "Embed Co",
        slug: "",
        url: "https://boards.greenhouse.io/embed/job_board?for=embedco",
      },
    ];

    const response = await postJson(
      `${harness.app.url}/__test__/catalog/discovered-boards`,
      JSON.stringify({ rows }),
    );

    const report = discoveredReportSchema.parse(await response.json());

    expect(report.createdBoards).toBe(rows.length);

    const tokens = (await harness.boards()).map((board) => board.boardToken);

    expect(new Set(tokens)).toEqual(
      new Set(["boardsco", "jobboardsco", "euboardsco", "jobpathco", "embedco"]),
    );
  } finally {
    await harness.close();
  }
});

test("a Greenhouse job without internal_job_id parses and is kept while an explicit null is dropped", async () => {
  const harness = await startCatalogHarness(["vercel", GREENHOUSE_BOARD]);

  try {
    const vercelJobs = readBoardFixture("greenhouse", "vercel");
    const anthropicJobs = readBoardFixture("greenhouse", GREENHOUSE_BOARD);
    const [talentPoolJob] = anthropicJobs;

    if (talentPoolJob === undefined) {
      throw new Error("the Greenhouse fixture has no jobs");
    }

    harness.fixture.mutateBoard("greenhouse", GREENHOUSE_BOARD, {
      internalJobIdUpdates: { [talentPoolJob.id]: null },
    });

    await harness.runBackfillCycle();

    const postings = await harness.postings();
    const vercelPostings = postingsOnBoard(postings, harness.boardIds.vercel);
    const anthropicPostings = postingsOnBoard(postings, harness.boardIds[GREENHOUSE_BOARD]);

    expect(vercelPostings).toHaveLength(vercelJobs.length);
    expect(vercelPostings.every((posting) => posting.title !== "")).toBe(true);
    expect(anthropicPostings).toHaveLength(anthropicJobs.length - 1);
    expect(anthropicPostings.some((posting) => posting.atsJobId === talentPoolJob.id)).toBe(false);
  } finally {
    await harness.close();
  }
});
