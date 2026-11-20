import { z } from "zod";
import { expect, test } from "@playwright/test";

import { startAnthropicFixtureServer } from "./anthropic-fixture-server.ts";
import { startCatalogHarness } from "./catalog-harness.ts";
import { readSseEventUntil } from "./sse.ts";

import type { CatalogHarness } from "./catalog-harness.ts";

type PostingTagRow = z.infer<typeof postingTagRowSchema>;

const TAG_FALLBACK_JOB_KIND = "tag.llm_fallback";

const appServerRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  tagSource: z.string().nullable(),
});

const postingTagRowSchema = z.object({
  postingId: z.string(),
  dimension: z.string(),
  value: z.string(),
  source: z.string(),
});

const postingTagsResponseSchema = z.object({ postingTags: z.array(postingTagRowSchema) });

const llmUsageResponseSchema = z.object({
  rows: z.array(
    z.object({
      id: z.string(),
      userId: z.string().nullable(),
      purpose: z.string(),
      model: z.string(),
      inputTokens: z.number(),
      cachedTokens: z.number(),
      outputTokens: z.number(),
      costMicros: z.number(),
      createdAt: z.number(),
    }),
  ),
  totals: z.object({
    calls: z.number(),
    inputTokens: z.number(),
    cachedTokens: z.number(),
    outputTokens: z.number(),
    costMicros: z.number(),
  }),
});

const clockResponseSchema = z.object({ now: z.number(), offsetMs: z.number() });
const jobIdSchema = z.object({ id: z.string() });

const jobRowSchema = z.object({
  id: z.string(),
  kind: z.string(),
  status: z.string(),
});

const jobsResponseSchema = z.object({ jobs: z.array(jobRowSchema) });

const alertDetailSchema = z.object({
  kind: z.string(),
  detail: z.object({
    cap: z.string(),
    purpose: z.string(),
    spentMicros: z.number(),
    estimatedMicros: z.number(),
    capMicros: z.number(),
    postingsWaiting: z.number(),
  }),
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
    absoluteUrl: `https://boards.example/tagco/jobs/${id}?gh_jid=${id}`,
    locationName: "Toronto, Ontario, Canada",
  } satisfies AddedJob;
}

async function tagRowsFor(harness: CatalogHarness, postingId: string) {
  const response = await fetch(`${harness.app.url}/__test__/catalog/posting-tags`);

  return postingTagsResponseSchema
    .parse(await response.json())
    .postingTags.filter((row: PostingTagRow) => row.postingId === postingId);
}

async function postingByTitle(harness: CatalogHarness, title: string) {
  const postings = await harness.postings();

  for (const posting of postings) {
    if (posting.title === title) {
      return appServerRowSchema.parse(posting);
    }
  }

  return null;
}

async function llmUsage(harness: CatalogHarness, query: string) {
  const response = await fetch(`${harness.app.url}/__test__/llm/usage${query}`);

  return llmUsageResponseSchema.parse(await response.json());
}

async function setSetting(harness: CatalogHarness, key: string, value: string) {
  const response = await fetch(`${harness.app.url}/__test__/settings/${key}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value }),
  });

  expect(response.ok).toBe(true);
}

async function startTagHarness(boardToken: string) {
  const anthropic = await startAnthropicFixtureServer();

  const harness = await startCatalogHarness([boardToken], {
    ANTHROPIC_BASE_URL: anthropic.url,
    ANTHROPIC_API_KEY: "test-anthropic-key",
  });

  return { harness, anthropic };
}

test("unclassified Postings are tagged from recorded Haiku batch responses", async () => {
  const boardToken = "tagfallback-a";
  const { harness, anthropic } = await startTagHarness(boardToken);

  try {
    harness.fixture.mutateBoard("greenhouse", boardToken, {
      addJobs: [
        addedJob("7001", "Wardrobe Stylist Coordinator"),
        addedJob("7002", "Wardrobe Stylist Coordinator"),
        addedJob("7003", "Full Stack Developer"),
      ],
    });

    await harness.runBackfillCycle();

    const requestsBefore = anthropic.requests().length;

    await harness.runOneJob(TAG_FALLBACK_JOB_KIND);

    const requests = anthropic.requests();
    const [capturedRequest] = requests;

    expect(requestsBefore).toBe(0);
    expect(requests.length).toBe(1);
    expect(capturedRequest?.title).toBe("Wardrobe Stylist Coordinator");
    expect(capturedRequest?.model).toBe("claude-haiku-4-5");
    expect(capturedRequest?.cacheControl).toBe("ephemeral");
    expect(capturedRequest?.outputFormatType).toBe("json_schema");

    const first = await postingByTitle(harness, "Wardrobe Stylist Coordinator");

    expect(first).not.toBe(null);
    expect(first?.tagSource).toBe("llm");

    const rows = await tagRowsFor(harness, first?.id ?? "");
    const [roleRow] = rows;

    expect(rows.length).toBe(1);
    expect(roleRow?.dimension).toBe("role");
    expect(roleRow?.value).toBe("Design");
    expect(roleRow?.source).toBe("llm");

    const postings = await harness.postings();

    const wardrobePostings = postings.filter(
      (posting) => posting.title === "Wardrobe Stylist Coordinator",
    );

    expect(wardrobePostings.length).toBe(2);

    const rowSets = await Promise.all(
      wardrobePostings.map(async (posting) => tagRowsFor(harness, posting.id)),
    );

    for (const postingRows of rowSets) {
      const [tagRow] = postingRows;

      expect(postingRows.length).toBe(1);
      expect(tagRow?.value).toBe("Design");
      expect(tagRow?.source).toBe("llm");
    }

    const classified = await postingByTitle(harness, "Full Stack Developer");

    expect(classified?.tagSource).toBe("rules");

    const classifiedRows = await tagRowsFor(harness, classified?.id ?? "");

    const classifiedRoleRow = classifiedRows.find((row) => row.dimension === "role");

    expect(classifiedRoleRow?.value).toBe("Software Engineering");
    expect(classifiedRoleRow?.source).toBe("rules");
  } finally {
    await harness.close();
    anthropic.stop();
  }
});

test("over the tagging cap nothing is sent until the next day", async () => {
  const boardToken = "tagfallback-b";
  const { harness, anthropic } = await startTagHarness(boardToken);

  try {
    harness.fixture.mutateBoard("greenhouse", boardToken, {
      addJobs: [addedJob("7101", "Community Engagement Coordinator")],
    });

    await harness.runBackfillCycle();

    await harness.runOneJob(TAG_FALLBACK_JOB_KIND);

    const afterFirstSend = await llmUsage(harness, "?purpose=tag_fallback");

    expect(afterFirstSend.totals.calls).toBe(1);
    expect(afterFirstSend.rows[0]?.costMicros).toBeGreaterThan(0);

    const spentMicros = afterFirstSend.totals.costMicros;

    harness.fixture.mutateBoard("greenhouse", boardToken, {
      addJobs: [addedJob("7102", "Executive Assistant to the CEO")],
    });

    await harness.runBackfillCycle();

    await setSetting(harness, "llm.cap_tagging_day_usd", "0.001");

    await harness.runOneJob(TAG_FALLBACK_JOB_KIND);

    const batchesAfterBlockedRun = anthropic.batchesCreated();

    expect(batchesAfterBlockedRun).toBe(1);
    expect(spentMicros).toBeGreaterThan(0);

    const blockedUsage = await llmUsage(harness, "?purpose=tag_fallback");

    expect(blockedUsage.totals.calls).toBe(1);

    const waiting = await postingByTitle(harness, "Executive Assistant to the CEO");

    expect(waiting).not.toBe(null);
    expect(waiting?.tagSource).toBe("rules");

    const waitingRows = await tagRowsFor(harness, waiting?.id ?? "");

    expect(waitingRows.length).toBe(0);

    const alert = await readSseEventUntil(`${harness.app.url}/api/events`, "", (event) => {
      if (event.event !== "alert.raised") {
        return false;
      }

      const parsed = alertDetailSchema.safeParse(JSON.parse(event.data));

      return (
        parsed.success && parsed.data.kind === "llm.cap" && parsed.data.detail.cap === "tagging"
      );
    });

    expect(alert).not.toBe(null);

    const clockResponse = await fetch(`${harness.app.url}/__test__/clock`);
    const clock = clockResponseSchema.parse(await clockResponse.json());
    const realNow = clock.now - clock.offsetMs;
    const nextDay = Math.floor(realNow / 86_400_000) * 86_400_000 + 86_400_000 + 60_000;

    const jobsResponse = await fetch(`${harness.app.url}/__test__/jobs`);

    const jobs = jobsResponseSchema
      .parse(await jobsResponse.json())
      .jobs.filter((job) => job.kind === TAG_FALLBACK_JOB_KIND && job.status === "queued");

    expect(jobs.length).toBe(1);

    const scheduledTagJobId = jobs[0]?.id ?? "";

    const offsetResponse = await fetch(`${harness.app.url}/__test__/clock/offset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ offsetMs: nextDay - realNow }),
    });

    expect(offsetResponse.ok).toBe(true);

    await fetch(`${harness.app.url}/__test__/jobs/run-due`, { method: "POST" });

    const tagJobDone = await readSseEventUntil(
      `${harness.app.url}/api/events`,
      "",
      (event) =>
        event.event === "job.done" &&
        jobIdSchema.parse(JSON.parse(event.data)).id === scheduledTagJobId,
    );

    expect(tagJobDone).not.toBe(null);

    expect(anthropic.batchesCreated()).toBe(2);
    expect(anthropic.requests().map((request) => request.title)).toEqual([
      "Community Engagement Coordinator",
      "Executive Assistant to the CEO",
    ]);

    const taggedNextDay = await postingByTitle(harness, "Executive Assistant to the CEO");

    expect(taggedNextDay?.tagSource).toBe("llm");

    const nextDayRows = await tagRowsFor(harness, taggedNextDay?.id ?? "");

    expect(nextDayRows.length).toBe(1);
    expect(nextDayRows[0]?.value).toBe("Administrative");
    expect(nextDayRows[0]?.source).toBe("llm");
  } finally {
    await harness.close();
    anthropic.stop();
  }
});

test("LLM usage and cost are queryable", async () => {
  const boardToken = "tagfallback-d";
  const { harness, anthropic } = await startTagHarness(boardToken);

  try {
    harness.fixture.mutateBoard("greenhouse", boardToken, {
      addJobs: [addedJob("7301", "Wardrobe Stylist Coordinator")],
    });

    await harness.runBackfillCycle();

    await harness.runOneJob(TAG_FALLBACK_JOB_KIND);

    const usage = await llmUsage(harness, "?purpose=tag_fallback&limit=10");

    expect(usage.totals.calls).toBe(1);
    expect(usage.rows.length).toBe(1);

    const [row] = usage.rows;

    expect(row?.purpose).toBe("tag_fallback");
    expect(row?.model).toBe("claude-haiku-4-5");
    expect(row?.inputTokens).toBe(465);
    expect(row?.cachedTokens).toBe(126);
    expect(row?.outputTokens).toBe(12);
    expect(row?.costMicros).toBeGreaterThan(0);
    expect(usage.totals.costMicros).toBe(row?.costMicros);

    const withoutPurpose = await llmUsage(harness, "?limit=10");

    expect(withoutPurpose.totals.calls).toBe(1);

    const otherPurpose = await llmUsage(harness, "?purpose=score&limit=10");

    expect(otherPurpose.totals.calls).toBe(0);
    expect(otherPurpose.rows.length).toBe(0);
  } finally {
    await harness.close();
    anthropic.stop();
  }
});
