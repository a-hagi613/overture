import { z } from "zod";
import { expect, test } from "@playwright/test";

import { startCatalogHarness } from "./catalog-harness.ts";
import { readSseEventUntil } from "./sse.ts";

import type { CatalogHarness } from "./catalog-harness.ts";

const SWEEP_JOB_KIND = "catalog.sweep";
const PARKED_SWEEP_INTERVAL_MS = 86_400_000;
const DUE_OFFSET_MS = 12 * 3_600_000 + 5 * 60_000;
const SWEEP_CLAIM_MS = 15 * 60_000;
const HEALTH_P99_MS = 300;
const MIN_HEALTH_SAMPLES = 200;
const JOBS_PER_BOARD = 1500;
const DESCRIPTION_KB = 3;

const HEAVY_BOARD_TOKENS = [
  "worker-heavy-greenhouse-one",
  "worker-heavy-greenhouse-two",
  "worker-heavy-greenhouse-three",
];

const CRASH_JOBS_PER_BOARD = 100;
const CRASH_BOARD_TOKENS = ["worker-crash-greenhouse-one", "worker-crash-greenhouse-two"];

const alertEventSchema = z.object({ kind: z.string() });

const jobSchema = z.object({
  id: z.string(),
  status: z.string(),
  lastError: z.string().nullable(),
});

function alertKindFor(event: { event: string; data: string }) {
  if (event.event !== "alert.raised") {
    return null;
  }

  const parsed = alertEventSchema.safeParse(JSON.parse(event.data));

  return parsed.success ? parsed.data.kind : null;
}

async function sampleHealthDuringSweep(harness: CatalogHarness, jobId: string) {
  const samples: number[] = [];

  async function step() {
    const started = performance.now();
    const response = await fetch(`${harness.app.url}/api/health`);

    await response.json();
    samples.push(performance.now() - started);

    const job = await readJob(harness, jobId);

    if (job.status !== "queued" && job.status !== "running") {
      return samples;
    }

    return step();
  }

  return step();
}

function percentile(values: number[], ratio: number) {
  const sorted = values.toSorted((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));

  return sorted[index] ?? 0;
}

async function readJob(harness: CatalogHarness, jobId: string) {
  const response = await fetch(`${harness.app.url}/__test__/jobs/${jobId}`);

  return jobSchema.parse(await response.json());
}

async function waitForJobStatus(
  harness: CatalogHarness,
  jobId: string,
  status: string,
  attempts = 2000,
) {
  const job = await readJob(harness, jobId);

  if (job.status === status || attempts <= 0) {
    return job;
  }

  return waitForJobStatus(harness, jobId, status, attempts - 1);
}

test.describe.configure({ mode: "serial", timeout: 120_000 });

test("a sweep of thousands of postings keeps /api/health under 300 ms at the 99th percentile", async () => {
  const boards = HEAVY_BOARD_TOKENS.map((token) => ({
    ats: "greenhouse" as const,
    token,
    bulk: { jobCount: JOBS_PER_BOARD, descriptionKb: DESCRIPTION_KB },
  }));

  const harness = await startCatalogHarness(boards);

  try {
    await harness.putSetting("catalog.sweep_interval_ms", String(PARKED_SWEEP_INTERVAL_MS));
    await harness.putSetting("jobs.poll_interval_ms", "1000");

    await harness.runBackfillCycle();

    const seeded = await harness.postings();

    expect(seeded).toHaveLength(HEAVY_BOARD_TOKENS.length * JOBS_PER_BOARD);

    for (const token of HEAVY_BOARD_TOKENS) {
      const updatedAtUpdates: Record<string, string> = {};

      for (const job of harness.fixture.jobs("greenhouse", token)) {
        updatedAtUpdates[job.atsJobId] = "2026-11-21T09:00:00Z";
      }

      harness.fixture.mutateBoard("greenhouse", token, { updatedAtUpdates });
    }

    await harness.moveClock(DUE_OFFSET_MS);

    const sweepStartedAt = await harness.clockNow();
    const sweepId = await harness.enqueueJob(SWEEP_JOB_KIND);
    const samples = await sampleHealthDuringSweep(harness, sweepId);

    expect(samples.length).toBeGreaterThanOrEqual(MIN_HEALTH_SAMPLES);
    expect(percentile(samples, 0.99)).toBeLessThan(HEALTH_P99_MS);

    expect((await readJob(harness, sweepId)).status).toBe("done");

    const after = await harness.postings();

    expect(after).toHaveLength(seeded.length);
    expect(after.every((posting) => posting.closedAt === null)).toBe(true);
    expect(after.every((posting) => posting.lastSeenAt >= sweepStartedAt)).toBe(true);
  } finally {
    await harness.close();
  }
});

test("a worker crash mid-sweep restarts it, keeps the server up and retries the claimed board", async () => {
  const boards = CRASH_BOARD_TOKENS.map((token) => ({
    ats: "greenhouse" as const,
    token,
    bulk: { jobCount: CRASH_JOBS_PER_BOARD, descriptionKb: 1 },
  }));

  const harness = await startCatalogHarness(boards);

  try {
    await harness.putSetting("catalog.sweep_interval_ms", String(PARKED_SWEEP_INTERVAL_MS));
    await harness.putSetting("jobs.poll_interval_ms", "1000");

    await harness.runBackfillCycle();

    const before = await harness.boards();
    const beforePolled = new Map(before.map((board) => [board.id, board.lastPolledAt ?? 0]));

    harness.fixture.setDelayMs(4000);

    await harness.moveClock(DUE_OFFSET_MS);

    const inFlight = harness.fixture.nextRequest();
    const crashedSweepId = await harness.enqueueJob(SWEEP_JOB_KIND);

    const alert = readSseEventUntil(
      `${harness.app.url}/__test__/events`,
      null,
      (event) => alertKindFor(event) === "catalog.worker",
    );

    await inFlight;

    expect(await harness.crashSweepWorker()).toBe(true);

    const health = await fetch(`${harness.app.url}/api/health`);
    const healthBody: unknown = await health.json();

    expect(health.ok).toBe(true);
    expect(healthBody).toMatchObject({ status: "ok", database: "ok" });

    const crashed = await waitForJobStatus(harness, crashedSweepId, "queued");

    expect(crashed.status).toBe("queued");
    expect(crashed.lastError).toContain("crashed");

    const alertEvent = await alert;

    expect(alertEvent).not.toBeNull();
    expect(alertKindFor(z.object({ event: z.string(), data: z.string() }).parse(alertEvent))).toBe(
      "catalog.worker",
    );

    harness.fixture.setDelayMs(0);

    await harness.moveClock(DUE_OFFSET_MS + SWEEP_CLAIM_MS + 60_000);

    const retryStartedAt = await harness.clockNow();

    await harness.waitForJob(crashedSweepId);

    const retried = await readJob(harness, crashedSweepId);

    expect(retried.status).toBe("done");

    const status = await harness.sweepWorkerStatus();

    expect(status.restarts).toBeGreaterThanOrEqual(1);
    expect(status.running).toBe(true);

    const after = await harness.boards();

    expect(after).toHaveLength(boards.length);
    expect(after.every((board) => (board.lastPolledAt ?? 0) >= retryStartedAt)).toBe(true);

    const retriedPolls = new Map(after.map((board) => [board.id, board.lastPolledAt ?? 0]));

    for (const [boardId, polledAt] of beforePolled) {
      expect(retriedPolls.get(boardId) ?? 0).toBeGreaterThan(polledAt);
    }

    expect(await harness.postings()).toHaveLength(boards.length * CRASH_JOBS_PER_BOARD);
  } finally {
    await harness.close();
  }
});
