import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import { z } from "zod";

import { startCatalogHarness } from "./catalog-harness.ts";

import type { CatalogHarness, PostingRow, PostingTagRow } from "./catalog-harness.ts";

const GREENHOUSE_BOARD_DIR = "test/e2e/fixtures/greenhouse";
const LEVER_BOARD_DIR = "test/e2e/fixtures/lever";
const ASHBY_BOARD_DIR = "test/e2e/fixtures/ashby";

const GREENHOUSE_BOARDS = ["vercel", "stripe"];
const LEVER_BOARDS = ["olo"];
const EMPTY_LEVER_BOARD = "poolside";
const ASHBY_BOARDS = ["linear"];
const GONE_ASHBY_BOARD = "ramp";

const greenhouseBoardSchema = z.object({
  jobs: z.array(z.object({ id: z.union([z.number(), z.string()]).transform(String) })),
});

const leverBoardSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      categories: z.object({ department: z.string().nullish() }).nullish(),
    }),
  ),
});

const ashbyBoardSchema = z.object({
  jobs: z.array(z.object({ id: z.string(), title: z.string(), department: z.string().nullish() })),
});

function readJson<T>(path: string, schema: z.ZodType<T>) {
  return schema.parse(JSON.parse(readFileSync(path, "utf8")));
}

function fixturePostings() {
  const rows: { ats: string; board: string; atsJobId: string; title: string }[] = [];

  for (const board of GREENHOUSE_BOARDS) {
    const parsed = readJson(join(GREENHOUSE_BOARD_DIR, board, "board.json"), greenhouseBoardSchema);

    for (const job of parsed.jobs) {
      rows.push({ ats: "greenhouse", board, atsJobId: job.id, title: jobTitle(board, job.id) });
    }
  }

  for (const board of LEVER_BOARDS) {
    const parsed = readJson(join(LEVER_BOARD_DIR, board, "board.json"), leverBoardSchema);

    for (const job of parsed.jobs) {
      rows.push({ ats: "lever", board, atsJobId: job.id, title: job.text });
    }
  }

  for (const board of ASHBY_BOARDS) {
    const parsed = readJson(join(ASHBY_BOARD_DIR, board, "board.json"), ashbyBoardSchema);

    for (const job of parsed.jobs) {
      rows.push({ ats: "ashby", board, atsJobId: job.id, title: job.title });
    }
  }

  return rows;
}

function jobTitle(board: string, jobId: string) {
  const detailPath = join(GREENHOUSE_BOARD_DIR, board, "jobs", `${jobId}.json`);

  return z.object({ title: z.string() }).parse(JSON.parse(readFileSync(detailPath, "utf8"))).title;
}

function postingIdsOf(rows: PostingTagRow[]) {
  return new Set(rows.flatMap((tag) => [tag.postingId]));
}

function countRows(values: { key: string; open: number }[]) {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value.key, (counts.get(value.key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([key, open]) => ({ key, open }))
    .toSorted((left, right) => right.open - left.open || left.key.localeCompare(right.key));
}

function percent(share: number) {
  return `${share.toFixed(1)} %`;
}

function tableRows(markdown: string, headingPrefix: string) {
  const lines = markdown.split("\n");
  const headingIndex = lines.findIndex((line) => line.startsWith(`## ${headingPrefix}`));

  if (headingIndex === -1) {
    throw new Error(`the census report has no section starting with: ${headingPrefix}`);
  }

  const rows: string[][] = [];

  for (const line of lines.slice(headingIndex + 1)) {
    if (line.startsWith("## ")) {
      break;
    }

    if (!line.startsWith("|")) {
      continue;
    }

    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());

    const isSeparatorRow = cells.every((cell) => /^-+$/u.test(cell));

    if (isSeparatorRow) {
      rows.pop();

      continue;
    }

    rows.push(cells);
  }

  return rows;
}

function runCensusScript(harness: CatalogHarness, outputPath: string) {
  const result = spawnSync(
    "bun",
    ["run", "scripts/census.ts", "--db", harness.databasePath, "--out", outputPath],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  if (result.status !== 0 || result.error !== undefined) {
    throw new Error(`scripts/census.ts failed: ${result.stderr}`);
  }
}

function coverageExpected(postings: PostingRow[], tags: PostingTagRow[], dimension: string) {
  const open = postings.filter((posting) => posting.closedAt === null).length;
  const dimensionTags = tags.filter((tag) => tag.dimension === dimension);

  const classified = postingIdsOf(dimensionTags).size;
  const rulesClassified = postingIdsOf(dimensionTags.filter((tag) => tag.source === "rules")).size;

  return {
    dimension,
    classified,
    rulesClassified,
    unclassified: open - classified,
    shareClassified: open === 0 ? 0 : (classified / open) * 100,
    shareRulesClassified: open === 0 ? 0 : (rulesClassified / open) * 100,
  };
}

test("the census over a recorded catalog prints the fixture aggregates and nothing personal", async () => {
  const harness = await startCatalogHarness([
    ...GREENHOUSE_BOARDS.map((token) => ({ ats: "greenhouse" as const, token })),
    ...LEVER_BOARDS.map((token) => ({ ats: "lever" as const, token })),
    { ats: "lever", token: EMPTY_LEVER_BOARD },
    ...ASHBY_BOARDS.map((token) => ({ ats: "ashby" as const, token })),
    { ats: "ashby" as const, token: GONE_ASHBY_BOARD },
  ]);

  try {
    harness.fixture.setNotFound("ashby", [GONE_ASHBY_BOARD]);

    await harness.runBackfillCycle();
    await harness.runBackfillCycle();

    const postings = await harness.postings();
    const tags = await harness.postingTags();
    const fixtureRows = fixturePostings();

    expect(postings.length).toBe(fixtureRows.length);

    for (const row of fixtureRows) {
      expect(postings.some((posting) => posting.title === row.title)).toBe(true);
    }

    const directory = mkdtempSync(join(tmpdir(), "overture-census-"));
    const outputPath = join(directory, "census.md");

    runCensusScript(harness, outputPath);

    const markdown = readFileSync(outputPath, "utf8");
    const open = postings.filter((posting) => posting.closedAt === null);

    expect(tableRows(markdown, "Boards by ATS and status")).toEqual([
      ["ashby", "active", String(ASHBY_BOARDS.length)],
      ["ashby", "gone", "1"],
      ["greenhouse", "active", String(GREENHOUSE_BOARDS.length)],
      ["lever", "active", String(LEVER_BOARDS.length)],
      ["lever", "empty", "1"],
    ]);

    const byAts = countRows(fixtureRows.map((row) => ({ key: row.ats, open: 1 })));

    expect(tableRows(markdown, "Postings by ATS")).toEqual(
      byAts.map((row) => [row.key, String(row.open), "0"]),
    );

    const byCountry = countRows(
      open.map((posting) => ({ key: posting.countryCode ?? "unknown", open: 1 })),
    );

    expect(tableRows(markdown, "Postings by country")).toEqual(
      byCountry.map((row) => [row.key, String(row.open)]),
    );

    const byWorkplace = countRows(open.map((posting) => ({ key: posting.workplace, open: 1 })));

    expect(tableRows(markdown, "Postings by workplace")).toEqual(
      byWorkplace.map((row) => [row.key, String(row.open)]),
    );

    const byTitle = countRows(open.map((posting) => ({ key: posting.titleNorm, open: 1 })));

    expect(tableRows(markdown, "Top titles")).toEqual(
      byTitle.map((row) => [row.key, String(row.open)]),
    );

    const byDepartment = countRows(
      open.map((posting) => ({ key: posting.department ?? "unknown", open: 1 })),
    );

    expect(tableRows(markdown, "Department frequency")).toEqual(
      byDepartment.map((row) => [row.key, String(row.open)]),
    );

    const coverage = ["role", "subrole", "seniority"].map((dimension) =>
      coverageExpected(postings, tags, dimension),
    );

    expect(tableRows(markdown, "Rule coverage by tag dimension")).toEqual(
      coverage.map((row) => [
        row.dimension,
        String(row.classified),
        String(row.rulesClassified),
        String(row.unclassified),
        percent(row.shareClassified),
        percent(row.shareRulesClassified),
      ]),
    );

    expect(tableRows(markdown, "Top companies by open Postings")).toEqual([
      ["Fixture Dynamics", String(open.length)],
    ]);

    expect(markdown).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u);
    expect(markdown).not.toMatch(/https?:\/\//u);
    expect(markdown).not.toMatch(/\bwww\./u);
    expect(markdown).not.toContain("job-boards.greenhouse.io");
    expect(markdown).not.toContain("jobs.lever.co");
    expect(markdown).not.toContain("jobs.ashbyhq.com");
  } finally {
    await harness.close();
  }
});
