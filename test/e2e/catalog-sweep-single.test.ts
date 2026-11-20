import { expect, test } from "@playwright/test";

import { startCatalogHarness } from "./catalog-harness.ts";

import type { BoardSpec, CatalogHarness, JobRow } from "./catalog-harness.ts";

const SWEEP_JOB_KIND = "catalog.sweep";

const SWEEP_INTERVAL_MS = 1000;
const FEED_DELAY_MS = 2500;
const HEALTH_BUDGET_MS = 1000;
const OBSERVATION_MS = 12 * SWEEP_INTERVAL_MS;

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

interface SweepSample {
  queued: number;
  running: number;
  runningIds: string[];
  healthMs: number;
}

function sweepRows(jobs: JobRow[]) {
  return jobs.filter((job) => job.kind === SWEEP_JOB_KIND);
}

async function sampleSweeps(harness: CatalogHarness) {
  const rows = sweepRows(await harness.jobs());
  const queued = rows.filter((job) => job.status === "queued");
  const active = rows.filter((job) => job.status === "running");

  const started = performance.now();
  const response = await fetch(`${harness.app.url}/api/health`);

  await response.json();

  return {
    queued: queued.length,
    running: active.length,
    runningIds: active.map((job) => job.id),
    healthMs: performance.now() - started,
  } satisfies SweepSample;
}

async function sampleUntil(harness: CatalogHarness, done: () => boolean) {
  const samples: SweepSample[] = [];

  async function step() {
    if (done()) {
      return samples;
    }

    samples.push(await sampleSweeps(harness));

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
