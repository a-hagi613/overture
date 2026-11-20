import { expect, test } from "@playwright/test";
import { z } from "zod";

import { startCatalogHarness } from "./catalog-harness.ts";

const FIXTURE_PARQUET_PATH = "test/e2e/fixtures/ats-scrapers/companies.parquet";

const discoverableBoards = [
  { ats: "greenhouse", boardToken: "vercel" },
  { ats: "greenhouse", boardToken: "cloudflare" },
  { ats: "lever", boardToken: "aavelabs" },
  { ats: "lever", boardToken: "32Co" },
  { ats: "ashby", boardToken: "anagram" },
  { ats: "ashby", boardToken: "goanagram" },
  { ats: "lever", boardToken: "anagramsecurity" },
  { ats: "ashby", boardToken: "0g" },
];

const loadReportSchema = z.object({
  considered: z.number(),
  unsupportedAts: z.number(),
  withoutBoardToken: z.number(),
  duplicateBoardToken: z.number(),
  createdBoards: z.number(),
  existingBoards: z.number(),
  createdCompanies: z.number(),
  reusedCompanies: z.number(),
});

const createdCompanySchema = z.object({ id: z.string() });
const createdBoardSchema = z.object({ id: z.string() });

async function postJson(url: string, body: Record<string, string>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`POST ${url} failed: ${String(response.status)}`);
  }

  return response;
}

async function createCompany(appUrl: string, name: string) {
  const response = await postJson(`${appUrl}/__test__/catalog/companies`, { name });
  const company = createdCompanySchema.parse(await response.json());

  return company;
}

async function createV1Board(appUrl: string, companyId: string, boardToken: string) {
  const response = await postJson(`${appUrl}/__test__/catalog/boards`, {
    companyId,
    ats: "greenhouse",
    boardToken,
    source: "v1_seed",
  });

  const board = createdBoardSchema.parse(await response.json());

  return board;
}

async function loadDiscovered(appUrl: string, path: string) {
  const response = await postJson(`${appUrl}/__test__/catalog/discovered-boards`, { path });

  return loadReportSchema.parse(await response.json());
}

test("discovered boards load from the recorded parquet fixture once, leave v1 rows alone, and feed the backfill", async () => {
  const harness = await startCatalogHarness([]);

  try {
    const stripe = await createCompany(harness.app.url, "Stripe");
    const anagram = await createCompany(harness.app.url, "Anagram");

    const stripeBoard = await createV1Board(harness.app.url, stripe.id, "stripe");

    const first = await loadDiscovered(harness.app.url, FIXTURE_PARQUET_PATH);

    expect(first).toEqual({
      considered: 11,
      unsupportedAts: 2,
      withoutBoardToken: 0,
      duplicateBoardToken: 0,
      createdBoards: 8,
      existingBoards: 1,
      createdCompanies: 5,
      reusedCompanies: 3,
    });

    const boardsAfterFirst = await harness.boards();

    expect(boardsAfterFirst.length).toBe(9);

    const stripeAfterFirst = boardsAfterFirst.find((board) => board.boardToken === "stripe");

    expect(stripeAfterFirst?.id).toBe(stripeBoard.id);
    expect(stripeAfterFirst?.source).toBe("v1_seed");
    expect(stripeAfterFirst?.companyId).toBe(stripe.id);

    for (const expected of discoverableBoards) {
      const board = boardsAfterFirst.find(
        (candidate) =>
          candidate.ats === expected.ats && candidate.boardToken === expected.boardToken,
      );

      expect(board?.source).toBe("discovered");
      expect(board?.status).toBe("active");
    }

    const anagramBoards = boardsAfterFirst.filter(
      (board) =>
        board.boardToken === "anagram" ||
        board.boardToken === "goanagram" ||
        board.boardToken === "anagramsecurity",
    );

    expect(anagramBoards.length).toBe(3);

    for (const board of anagramBoards) {
      expect(board.companyId).toBe(anagram.id);
    }

    const distinctCompanyIds = new Set(boardsAfterFirst.map((board) => board.companyId));

    expect(distinctCompanyIds.size).toBe(7);

    const second = await loadDiscovered(harness.app.url, FIXTURE_PARQUET_PATH);

    expect(second).toEqual({
      considered: 11,
      unsupportedAts: 2,
      withoutBoardToken: 0,
      duplicateBoardToken: 0,
      createdBoards: 0,
      existingBoards: 9,
      createdCompanies: 0,
      reusedCompanies: 0,
    });

    const boardsAfterSecond = await harness.boards();

    expect(boardsAfterSecond.length).toBe(9);

    const stripeAfterSecond = boardsAfterSecond.find((board) => board.boardToken === "stripe");

    expect(stripeAfterSecond?.source).toBe("v1_seed");
    expect(stripeAfterSecond?.companyId).toBe(stripe.id);

    for (const expected of discoverableBoards) {
      const board = boardsAfterSecond.find(
        (candidate) =>
          candidate.ats === expected.ats && candidate.boardToken === expected.boardToken,
      );

      expect(board?.source).toBe("discovered");
    }

    await harness.runBackfillCycle();

    const boardsAfterBackfill = await harness.boards();

    for (const token of ["vercel", "stripe", "cloudflare"]) {
      const board = boardsAfterBackfill.find((candidate) => candidate.boardToken === token);

      expect(board?.status).toBe("active");
    }

    const leverBoard = boardsAfterBackfill.find((candidate) => candidate.boardToken === "32Co");

    expect(leverBoard?.status).toBe("empty");

    const postings = await harness.postings();
    const vercelBoard = boardsAfterBackfill.find((candidate) => candidate.boardToken === "vercel");

    expect(vercelBoard?.id).toBeDefined();

    const vercelPostings = postings.filter((row) => row.boardId === vercelBoard?.id);

    expect(vercelPostings.length).toBe(4);
    expect(vercelPostings.every((row) => row.closedAt === null)).toBe(true);

    const stripePostings = postings.filter((row) => row.boardId === stripeBoard.id);

    expect(stripePostings.length).toBe(4);
  } finally {
    await harness.close();
  }
});
