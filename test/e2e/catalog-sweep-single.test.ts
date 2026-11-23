import { expect, test } from "@playwright/test";

import { startCatalogHarness } from "./catalog-harness.ts";

import type { BoardSpec, CatalogHarness, JobRow } from "./catalog-harness.ts";

const SWEEP_JOB_KIND = "catalog.sweep";

const SWEEP_INTERVAL_MS = 1000;
const FEED_DELAY_MS = 2500;
const HEALTH_BUDGET_MS = 1000;
const OBSERVATION_MS = 12 * SWEEP_INTERVAL_MS;
const JOB_LEASE_MS = 5 * 60_000;
const SETTLE_WINDOW_MS = 10_000;

const BOARD_TOKENS = [
  "chained-greenhouse-one",
  "chained-greenhouse-two",
  "chained-greenhouse-three",
  "chained-greenhouse-four",
  "chained-greenhouse-five",
  "chained-greenhouse-six",
];

const BOARDS: BoardSpec[] = BOARD_TOKENS.map((token) => ({
  ats: "greenhouse" as const,
  token,
  bulk: { jobCount: 40, descriptionKb: 2 },
}));

const CRASH_BOARD_TOKENS = [
  "crashed-greenhouse-one",
  "crashed-greenhouse-two",
  "crashed-greenhouse-three",
  "crashed-greenhouse-four",
];

const CRASH_BOARDS: BoardSpec[] = CRASH_BOARD_TOKENS.map((token) => ({
  ats: "greenhouse" as const,
  token,
  bulk: { jobCount: 40, descriptionKb: 2 },
}));

interface SweepSample {
  queued: number;
  running: number;
  runningIds: string[];
  done: number;
  healthMs: number;
}

function sweepRows(jobs: JobRow[]) {
  return jobs.filter((job) => job.kind === SWEEP_JOB_KIND);
}

async function sampleSweeps(harness: CatalogHarness) {
  const rows = sweepRows(await harness.jobs());
  const queued = rows.filter((job) => job.status === "queued");
  const active = rows.filter((job) => job.status === "running");
  const done = rows.filter((job) => job.status === "done");

  const started = performance.now();
  const response = await fetch(`${harness.app.url}/api/health`);

  await response.json();

  return {
    queued: queued.length,
    running: active.length,
    runningIds: active.map((job) => job.id),
    done: done.length,
    healthMs: performance.now() - started,
  } satisfies SweepSample;
}

async function sampleUntil(harness: CatalogHarness, done: (sample: SweepSample) => boolean) {
  const samples: SweepSample[] = [];

  async function step() {
    samples.push(await sampleSweeps(harness));

    const last = samples.at(-1);

    if (last !== undefined && done(last)) {
      return samples;
    }

    return step();
  }

  return step();
}

test("a sweep slower than its interval never overlaps the next one, and health keeps answering", async () => {
  const harness = await startCatalogHarness(BOARDS);

  try {
    await harness.putSetting("catalog.sweep_interval_ms", String(SWEEP_INTERVAL_MS));
    await harness.putSetting("jobs.poll_interval_ms", String(SWEEP_INTERVAL_MS));

    await harness.seedPostings(BOARD_TOKENS);
    await harness.runBackfillCycle();

    harness.fixture.setDelayMs(FEED_DELAY_MS);

    const deadline = performance.now() + OBSERVATION_MS;

    const samples = await sampleUntil(harness, () => performance.now() >= deadline);

    expect(samples.length).toBeGreaterThanOrEqual(20);
    expect(Math.max(...samples.map((sample) => sample.running))).toBeLessThanOrEqual(1);
    expect(Math.max(...samples.map((sample) => sample.queued))).toBeLessThanOrEqual(1);
    expect(new Set(samples.flatMap((sample) => sample.runningIds)).size).toBeGreaterThanOrEqual(2);

    const slow = samples.filter((sample) => sample.healthMs >= HEALTH_BUDGET_MS);

    expect(slow.map((sample) => Math.round(sample.healthMs))).toEqual([]);
  } finally {
    await harness.close();
  }
});

test("a sweep killed mid-flight is reclaimed once at boot and never duplicated", async () => {
  const harness = await startCatalogHarness(CRASH_BOARDS);

  try {
    await harness.putSetting("catalog.sweep_interval_ms", String(SWEEP_INTERVAL_MS));
    await harness.putSetting("jobs.poll_interval_ms", String(SWEEP_INTERVAL_MS));

    await harness.seedPostings(CRASH_BOARD_TOKENS);
    await harness.runBackfillCycle();

    harness.fixture.setDelayMs(FEED_DELAY_MS);

    await harness.fixture.nextRequest();

    const running = sweepRows(await harness.jobs()).filter((job) => job.status === "running");

    expect(running.length).toBe(1);

    const crashedSweepId = running[0]?.id ?? "";

    await harness.app.crash();
    await harness.app.restart();

    const afterBoot = sweepRows(await harness.jobs());

    expect(afterBoot.map((job) => job.id)).toEqual([crashedSweepId]);
    expect(["queued", "running"]).toContain(afterBoot[0]?.status);

    await harness.moveClock(JOB_LEASE_MS + SWEEP_INTERVAL_MS);

    const deadline = performance.now() + SETTLE_WINDOW_MS;

    const samples = await sampleUntil(
      harness,
      (sample) => (sample.done >= 1 && sample.running === 0) || performance.now() >= deadline,
    );

    const settled = samples.at(-1);

    expect(Math.max(...samples.map((sample) => sample.running))).toBeLessThanOrEqual(1);
    expect(Math.max(...samples.map((sample) => sample.queued))).toBeLessThanOrEqual(1);
    expect(settled?.done).toBe(1);
    expect(settled?.running).toBe(0);
    expect(settled?.queued).toBe(1);

    const after = sweepRows(await harness.jobs()).find((job) => job.id === crashedSweepId);

    expect(after?.status).toBe("done");
  } finally {
    await harness.close();
  }
});
