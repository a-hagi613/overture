import { readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";
import { expect, test } from "@playwright/test";

import { startCatalogHarness } from "./catalog-harness.ts";
import { readSseEventUntil } from "./sse.ts";

import type { SseEvent } from "./sse.ts";
import type { CatalogHarness } from "./catalog-harness.ts";

const jobDoneSchema = z.object({ id: z.string() });
const enqueueResponseSchema = z.object({ id: z.string() });

const batchesResponseSchema = z.object({
  batches: z.object({
    greenhouse: z.number(),
    lever: z.number(),
    ashby: z.number(),
  }),
});

const jobsResponseSchema = z.object({
  jobs: z.array(
    z.object({ id: z.string(), kind: z.string(), status: z.string(), runAt: z.number() }),
  ),
});

const fixtureBoardSchema = z.object({
  jobs: z.array(z.object({ id: z.union([z.number(), z.string()]).transform(String) })),
});

const SWEEP_CLAIM_MS = 15 * 60_000;
const BOARD_PASS_BATCH = 20;
const DUE_OFFSET_MS = 12 * 3_600_000 + 5 * 60_000;
const PARKED_CHAIN_INTERVAL_MS = 86_400_000;
const ACTIVITY_BANDS_MS = [30 * 60_000, 2 * 3_600_000, 12 * 3_600_000];

function listPathFor(token: string) {
  return `/v1/boards/${token}/jobs`;
}

function readFixtureBoard(token: string) {
  const boardFile = join(process.cwd(), "test/e2e/fixtures/greenhouse", token, "board.json");
  const board = fixtureBoardSchema.parse(JSON.parse(readFileSync(boardFile, "utf8")));

  return board.jobs.map((job) => job.id);
}

async function putSetting(harness: CatalogHarness, key: string, value: string) {
  const response = await fetch(`${harness.app.url}/__test__/settings/${key}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value }),
  });

  expect(response.ok).toBe(true);
}

async function moveClock(harness: CatalogHarness, offsetMs: number) {
  const response = await fetch(`${harness.app.url}/__test__/clock/offset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ offsetMs }),
  });

  expect(response.ok).toBe(true);
}

async function sweepBatches(harness: CatalogHarness) {
  const response = await fetch(`${harness.app.url}/__test__/catalog/sweep-batches`);

  return batchesResponseSchema.parse(await response.json()).batches;
}

async function enqueueSweep(harness: CatalogHarness) {
  const response = await fetch(`${harness.app.url}/__test__/jobs/enqueue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "catalog.sweep",
      payload: "{}",
      runAt: await harness.clockNow(),
      priority: 1,
    }),
  });

  expect(response.ok).toBe(true);

  return enqueueResponseSchema.parse(await response.json()).id;
}

function doneFor(event: SseEvent) {
  return event.event === "job.done" ? jobDoneSchema.parse(JSON.parse(event.data)).id : null;
}

function sweepEventLabel(event: SseEvent, sweepIds: string[]) {
  if (event.event !== "job.started" && event.event !== "job.done") {
    return null;
  }

  const { id } = jobDoneSchema.parse(JSON.parse(event.data));

  return sweepIds.includes(id) ? `${event.event}:${id}` : null;
}

async function waitForSweepsDone(harness: CatalogHarness, sweepIds: string[]) {
  const settled = new Set<string>();

  await readSseEventUntil(`${harness.app.url}/api/events`, null, (event) => {
    const id = doneFor(event);

    if (id !== null && sweepIds.includes(id)) {
      settled.add(id);
    }

    return sweepIds.every((sweepId) => settled.has(sweepId));
  });
}

async function sweepTimeline(harness: CatalogHarness, sweepIds: string[]) {
  const timeline: string[] = [];

  await readSseEventUntil(`${harness.app.url}/api/events`, "", (event) => {
    const label = sweepEventLabel(event, sweepIds);

    if (label !== null && !timeline.includes(label)) {
      timeline.push(label);
    }

    return timeline.length === sweepIds.length * 2;
  });

  return timeline;
}

function boardFor(rows: Awaited<ReturnType<CatalogHarness["boards"]>>, boardToken: string) {
  const board = rows.find((candidate) => candidate.boardToken === boardToken);

  if (board === undefined) {
    throw new Error(`the ${boardToken} board is missing from the catalog`);
  }

  return board;
}

function polledCount(rows: Awaited<ReturnType<CatalogHarness["boards"]>>, ats: string) {
  return rows.filter((row) => row.ats === ats && row.lastPolledAt !== null).length;
}

test("a queued sweep waits for the running one, which claims its boards and leaves the finished poll's band", async () => {
  const harness = await startCatalogHarness(["vercel", "stripe"]);

  try {
    await putSetting(harness, "catalog.sweep_interval_ms", String(PARKED_CHAIN_INTERVAL_MS));
    await putSetting(harness, "jobs.poll_interval_ms", "1000");

    await harness.runBackfillCycle();

    harness.fixture.setDelayMs(1200);

    await moveClock(harness, DUE_OFFSET_MS);

    const fixtureJobIds = readFixtureBoard("vercel");
    const changedJobId = fixtureJobIds[0] ?? "";

    harness.fixture.mutateBoard("greenhouse", "vercel", {
      updatedAtUpdates: {
        [changedJobId]: new Date((await harness.clockNow()) - 60_000).toISOString(),
      },
    });

    const firstSweepId = await enqueueSweep(harness);
    const secondSweepId = await enqueueSweep(harness);

    await waitForSweepsDone(harness, [firstSweepId, secondSweepId]);

    const timeline = await sweepTimeline(harness, [firstSweepId, secondSweepId]);

    expect(timeline).toEqual([
      `job.started:${firstSweepId}`,
      `job.done:${firstSweepId}`,
      `job.started:${secondSweepId}`,
      `job.done:${secondSweepId}`,
    ]);

    const stats = harness.fixture.stats();

    for (const token of ["vercel", "stripe"]) {
      expect(stats.paths.filter((path) => path === listPathFor(token)).length).toBe(1);
    }

    expect(stats.perAts.greenhouse.requestCount).toBe(5);

    const boards = await harness.boards();

    for (const token of ["vercel", "stripe"]) {
      const board = boardFor(boards, token);

      expect(board.lastPolledAt).not.toBeNull();

      const interval = (board.nextPollAt ?? 0) - (board.lastPolledAt ?? 0);

      expect(ACTIVITY_BANDS_MS).toContain(interval);
    }
  } finally {
    await harness.close();
  }
});

test("one sweep's batch is spread across the ATSes in proportion to their limits", async () => {
  const harness = await startCatalogHarness([
    "vercel",
    "stripe",
    "cloudflare",
    { ats: "lever", token: "olo" },
    { ats: "lever", token: "spotify" },
    { ats: "ashby", token: "linear" },
    { ats: "ashby", token: "ramp" },
  ]);

  try {
    expect(await sweepBatches(harness)).toEqual({
      greenhouse: BOARD_PASS_BATCH,
      lever: BOARD_PASS_BATCH,
      ashby: BOARD_PASS_BATCH,
    });

    await putSetting(harness, "catalog.sweep_interval_ms", "1000");

    expect(await sweepBatches(harness)).toEqual({ greenhouse: 2, lever: 2, ashby: 2 });

    await putSetting(harness, "catalog.sweep_interval_ms", "60000");
    await putSetting(harness, "catalog.sweep_max_boards", "1");

    expect(await sweepBatches(harness)).toEqual({ greenhouse: 1, lever: 1, ashby: 1 });

    await putSetting(harness, "catalog.sweep_max_boards", "20");
    await putSetting(harness, "catalog.sweep_batch", "6");

    expect(await sweepBatches(harness)).toEqual({ greenhouse: 2, lever: 2, ashby: 2 });

    await putSetting(harness, "catalog.sweep_batch", "3");
    await putSetting(harness, "catalog.sweep_interval_ms", "60000");

    await harness.runBackfillCycle();

    let boards = await harness.boards();

    expect(polledCount(boards, "greenhouse")).toBe(1);
    expect(polledCount(boards, "lever")).toBe(1);
    expect(polledCount(boards, "ashby")).toBe(1);

    await harness.runOneJob("catalog.sweep");

    boards = await harness.boards();

    expect(polledCount(boards, "greenhouse")).toBe(2);
    expect(polledCount(boards, "lever")).toBe(2);
    expect(polledCount(boards, "ashby")).toBe(2);

    await harness.runOneJob("catalog.sweep");

    boards = await harness.boards();

    expect(polledCount(boards, "greenhouse")).toBe(3);
    expect(polledCount(boards, "lever")).toBe(2);
    expect(polledCount(boards, "ashby")).toBe(2);

    await harness.runOneJob("catalog.sweep");

    boards = await harness.boards();

    expect(polledCount(boards, "greenhouse")).toBe(3);
    expect(polledCount(boards, "lever")).toBe(2);
    expect(polledCount(boards, "ashby")).toBe(2);
  } finally {
    await harness.close();
  }
});

test("a crashed poll's board is held by its claim and polled again once the claim lapses", async () => {
  const harness = await startCatalogHarness(["vercel"]);

  try {
    await putSetting(harness, "catalog.sweep_interval_ms", String(PARKED_CHAIN_INTERVAL_MS));
    await putSetting(harness, "jobs.poll_interval_ms", "1000");

    await harness.runBackfillCycle();

    const bandedBoard = boardFor(await harness.boards(), "vercel");
    const bandedLastPolledAt = bandedBoard.lastPolledAt;

    harness.fixture.setDelayMs(6000);

    await moveClock(harness, DUE_OFFSET_MS);

    const inFlightRequestPath = harness.fixture.nextRequest();
    const crashedSweepId = await enqueueSweep(harness);

    await readSseEventUntil(`${harness.app.url}/api/events`, null, (event) =>
      event.event === "job.started"
        ? jobDoneSchema.parse(JSON.parse(event.data)).id === crashedSweepId
        : false,
    );

    expect(await inFlightRequestPath).toBe(listPathFor("vercel"));

    const claimedNow = await harness.clockNow();
    const claimedBoard = boardFor(await harness.boards(), "vercel");

    expect(claimedBoard.lastPolledAt).toBe(bandedLastPolledAt);
    expect(claimedBoard.nextPollAt).toBeGreaterThan(claimedNow);
    expect((claimedBoard.nextPollAt ?? 0) - claimedNow).toBeLessThanOrEqual(SWEEP_CLAIM_MS);

    await harness.app.crash();

    harness.fixture.setDelayMs(0);

    await harness.app.restart();

    await harness.runOneJob("catalog.sweep");

    expect(harness.fixture.stats().perAts.greenhouse.requestCount).toBe(2);
    expect(await harness.postings()).toHaveLength(4);

    const heldBoard = boardFor(await harness.boards(), "vercel");

    expect(heldBoard.lastPolledAt).toBe(bandedLastPolledAt);
    expect(heldBoard.nextPollAt).toBeGreaterThan(await harness.clockNow());

    await moveClock(harness, (heldBoard.nextPollAt ?? 0) - (await harness.clockNow()) + 60_000);

    const jobsResponse = await fetch(`${harness.app.url}/__test__/jobs`);
    const { jobs } = jobsResponseSchema.parse(await jobsResponse.json());
    const dueNow = await harness.clockNow();

    const pendingSweeps = jobs
      .filter(
        (job) =>
          job.kind === "catalog.sweep" &&
          job.status === "queued" &&
          job.runAt <= dueNow &&
          job.id !== crashedSweepId,
      )
      .map((job) => job.id);

    const finalSweepId = await enqueueSweep(harness);

    await waitForSweepsDone(harness, [...pendingSweeps, finalSweepId]);

    expect(harness.fixture.stats().perAts.greenhouse.requestCount).toBe(3);
    expect(await harness.postings()).toHaveLength(4);

    const recoveredBoard = boardFor(await harness.boards(), "vercel");

    expect(recoveredBoard.lastPolledAt ?? 0).toBeGreaterThan(bandedLastPolledAt ?? 0);

    const recoveredInterval = (recoveredBoard.nextPollAt ?? 0) - (recoveredBoard.lastPolledAt ?? 0);

    expect(ACTIVITY_BANDS_MS).toContain(recoveredInterval);
  } finally {
    await harness.close();
  }
});
