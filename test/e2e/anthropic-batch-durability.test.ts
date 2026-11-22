import { z } from "zod";
import { expect, test } from "@playwright/test";

import { startAnthropicFixtureServer } from "./anthropic-fixture-server.ts";
import { startCatalogHarness } from "./catalog-harness.ts";

import type { CatalogHarness } from "./catalog-harness.ts";

const TAG_FALLBACK_JOB_KIND = "tag.llm_fallback";
const BATCH_POLL_JOB_KIND = "llm.batch_poll";

const batchRowSchema = z.object({
  id: z.string(),
  inputRevisionHash: z.string(),
  batchId: z.string().nullable(),
  status: z.string(),
  resultAppliedAt: z.number().nullable(),
});

const batchesResponseSchema = z.object({ batches: z.array(batchRowSchema) });

const usageResponseSchema = z.object({
  totals: z.object({ calls: z.number(), costMicros: z.number() }),
});

const postingTagsResponseSchema = z.object({
  postingTags: z.array(
    z.object({
      postingId: z.string(),
      dimension: z.string(),
      value: z.string(),
      source: z.string(),
    }),
  ),
});

interface AddedJob {
  id: string;
  title: string;
  updatedAt: string;
  firstPublished: string;
  absoluteUrl: string;
  locationName: string;
}

function addedJob(id: string, title: string) {
  return {
    id,
    title,
    updatedAt: "2026-11-20T10:00:00.000Z",
    firstPublished: "2026-11-20T10:00:00.000Z",
    absoluteUrl: `https://boards.example/batchdurable/jobs/${id}?gh_jid=${id}`,
    locationName: "Toronto, Ontario, Canada",
  } satisfies AddedJob;
}

interface JobRunNowBody {
  kind: string;
  payload: string;
}

async function postJson(url: string, body: JobRunNowBody) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`POST ${url} answered ${String(response.status)}`);
  }
}

async function batchRows(harness: CatalogHarness) {
  const response = await fetch(`${harness.app.url}/__test__/llm/batches`);

  return batchesResponseSchema.parse(await response.json()).batches;
}

async function llmUsage(harness: CatalogHarness) {
  const response = await fetch(`${harness.app.url}/__test__/llm/usage?purpose=tag_fallback`);

  return usageResponseSchema.parse(await response.json());
}

async function tagRowsFor(harness: CatalogHarness, postingId: string) {
  const response = await fetch(`${harness.app.url}/__test__/catalog/posting-tags`);

  return postingTagsResponseSchema
    .parse(await response.json())
    .postingTags.filter((row) => row.postingId === postingId);
}

async function postingIdsByTitle(harness: CatalogHarness, title: string) {
  return (await harness.postings())
    .filter((posting) => posting.title === title)
    .map((posting) => posting.id);
}

test("a crash mid-batch resumes the recorded Anthropic batch without submitting a second", async () => {
  test.setTimeout(180_000);

  const anthropic = await startAnthropicFixtureServer({ holdBatches: true });

  const harness = await startCatalogHarness(["batchdurable-a"], {
    ANTHROPIC_BASE_URL: anthropic.url,
    ANTHROPIC_API_KEY: "test-anthropic-key",
    ANTHROPIC_BATCH_POLL_INTERVAL_MS: "25",
  });

  try {
    harness.fixture.mutateBoard("greenhouse", "batchdurable-a", {
      addJobs: [
        addedJob("8001", "Wardrobe Stylist Coordinator"),
        addedJob("8002", "Wardrobe Stylist Coordinator"),
      ],
    });

    await harness.runBackfillCycle();

    await harness.enqueueJob(TAG_FALLBACK_JOB_KIND);

    await expect.poll(() => anthropic.batchesCreated(), { timeout: 30_000 }).toBe(1);
    await expect.poll(() => anthropic.batchesRetrieved(), { timeout: 30_000 }).toBeGreaterThan(0);

    await harness.app.crash();

    anthropic.releaseHeldBatches();

    await harness.app.restart();

    const recorded = await batchRows(harness);

    expect(recorded.length).toBe(1);
    expect(recorded[0]?.batchId).not.toBe(null);
    expect(recorded[0]?.status).toBe("in_progress");
    expect(recorded[0]?.resultAppliedAt).toBe(null);

    const jobs = await harness.jobs();

    expect(jobs.some((job) => job.kind === BATCH_POLL_JOB_KIND)).toBe(true);

    await postJson(`${harness.app.url}/__test__/jobs/run-now`, {
      kind: TAG_FALLBACK_JOB_KIND,
      payload: "{}",
    });

    await expect
      .poll(async () => (await batchRows(harness))[0]?.status, { timeout: 30_000 })
      .toBe("applied");

    const applied = await batchRows(harness);

    expect(applied.length).toBe(1);
    expect(applied[0]?.batchId).toBe(recorded[0]?.batchId);
    expect(applied[0]?.resultAppliedAt).not.toBe(null);
    expect(anthropic.batchesCreated()).toBe(1);
    expect(anthropic.requests().length).toBe(1);

    const usage = await llmUsage(harness);

    expect(usage.totals.calls).toBe(1);

    const postingIds = await postingIdsByTitle(harness, "Wardrobe Stylist Coordinator");

    expect(postingIds.length).toBe(2);

    const rowSets = await Promise.all(
      postingIds.map(async (postingId) => tagRowsFor(harness, postingId)),
    );

    for (const rows of rowSets) {
      expect(rows.length).toBe(1);
      expect(rows[0]?.value).toBe("Design");
      expect(rows[0]?.source).toBe("llm");
    }
  } finally {
    await harness.close();
    anthropic.stop();
  }
});
