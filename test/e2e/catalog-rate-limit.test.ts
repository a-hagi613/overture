import { expect, test } from "@playwright/test";

import { startCatalogHarness } from "./catalog-harness.ts";

const BOARDS = ["vercel", "stripe", "cloudflare"];
const GREENHOUSE_CONCURRENCY = 4;
const GREENHOUSE_MIN_REQUEST_INTERVAL_MS = 480;

test("a backfill across boards respects the Greenhouse concurrency cap and request pacing", async () => {
  const harness = await startCatalogHarness(BOARDS);

  try {
    harness.fixture.setDelayMs(700);

    await harness.runBackfillCycle();

    const stats = harness.fixture.stats();

    expect(stats.requestCount).toBe(BOARDS.length + 4 * BOARDS.length);

    const overlappingRequests = stats.maxInFlight;

    expect(overlappingRequests).toBeLessThanOrEqual(GREENHOUSE_CONCURRENCY);
    expect(overlappingRequests).toBeGreaterThanOrEqual(2);

    for (const gap of stats.arrivalGapsMs) {
      expect(gap).toBeGreaterThanOrEqual(GREENHOUSE_MIN_REQUEST_INTERVAL_MS);
    }
  } finally {
    await harness.close();
  }
});
