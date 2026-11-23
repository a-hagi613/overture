import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

import { expect, test } from "@playwright/test";
import { z } from "zod";

import { startAppServer } from "./app-server.ts";
import { readSseEventUntil } from "./sse.ts";

import type { AppServer } from "./app-server.ts";

const FIXTURE_DIR = join(import.meta.dir, "fixtures", "workable");
const FEED_PATH = join(FIXTURE_DIR, "workable-trim.xml.gz");
const TARGETS_PATH = join(FIXTURE_DIR, "targets.json");
const INGEST_KIND = "catalog.workable";
const HEALTH_BUDGET_MS = 300;
const RSS_BUDGET_MB = 200;

const passSummarySchema = z.object({
  outcome: z.string(),
  rows: z.number(),
  feedJobs: z.number(),
  distinctReferences: z.number(),
  duplicates: z.number(),
  rssDeltaMB: z.number(),
  elapsedMs: z.number(),
});

const jobSchema = z.object({
  id: z.string(),
  status: z.string(),
  lastError: z.string().nullable(),
});

const postingRowSchema = z.object({
  id: z.string(),
  ats: z.string(),
  atsJobId: z.string(),
  title: z.string(),
  companyId: z.string(),
  applyUrl: z.string().nullable(),
  url: z.string(),
  locationRaw: z.string().nullable(),
  countryCode: z.string().nullable(),
  language: z.string().nullable(),
  workplace: z.string(),
  employmentType: z.string(),
  descriptionText: z.string().nullable(),
  closedAt: z.number().nullable(),
  lastSeenAt: z.number(),
});

const postingsResponseSchema = z.object({ postings: z.array(postingRowSchema) });

const tagsResponseSchema = z.object({
  postingTags: z.array(
    z.object({
      postingId: z.string(),
      dimension: z.string(),
      value: z.string(),
      source: z.string(),
    }),
  ),
});

const searchResponseSchema = z.object({
  hits: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      company: z.string(),
      ats: z.string(),
    }),
  ),
});

const enqueueSchema = z.object({ id: z.string() });

const uniqueTemplateSchema = z.object({
  version: z.literal(1),
  reference: z.string(),
  title: z.string(),
  company: z.string(),
  url: z.string(),
  applyUrl: z.string(),
  postedAt: z.string().nullable(),
  locationRaw: z.string().nullable(),
  department: z.string().nullable(),
  descriptionText: z.string(),
  tags: z.object({
    role: z.string().nullable(),
    subrole: z.string().nullable(),
    seniority: z.string().nullable(),
    workplace: z.string(),
    employmentType: z.string(),
    language: z.string().nullable(),
    countryCode: z.string().nullable(),
    region: z.string().nullable(),
    city: z.string().nullable(),
  }),
});

interface Harness {
  app: AppServer;
  outDir: string;
  close: () => Promise<void>;
}

async function runPass(outDir: string, asOf: string) {
  const child = Bun.spawn({
    cmd: [
      "bun",
      "run",
      "scripts/workable-feed-pass.ts",
      "--feed",
      FEED_PATH,
      "--targets",
      TARGETS_PATH,
      "--out-dir",
      outDir,
      "--as-of",
      asOf,
    ],
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  if (code !== 0) {
    throw new Error(`the Workable pass failed: ${stderr}`);
  }

  return passSummarySchema.parse(JSON.parse(stdout));
}

function outDirForRun() {
  return mkdtempSync(join(tmpdir(), "overture-workable-out-"));
}

async function startHarness(outDir: string) {
  const directory = mkdtempSync(join(tmpdir(), "overture-workable-"));

  const app = await startAppServer(join(directory, "overture.db"), {
    OBJECT_STORE_ROOT: outDir,
    R2_ACCOUNT_ID: "",
    R2_ACCESS_KEY_ID: "",
    R2_SECRET_ACCESS_KEY: "",
    R2_BUCKET_FILES: "",
    R2_ENDPOINT: "",
  });

  return {
    app,
    outDir,
    close: async () => {
      await app.stop();
    },
  };
}

async function setKillSwitch(harness: Harness, enabled: boolean) {
  const response = await fetch(`${harness.app.url}/__test__/kill-switches/ats/workable`, {
    body: JSON.stringify({ enabled, reason: "e2e", setBy: "owner" }),
    headers: { "content-type": "application/json" },
    method: "PUT",
  });

  expect(response.ok).toBe(true);
}

async function readJob(harness: Harness, jobId: string) {
  const response = await fetch(`${harness.app.url}/__test__/jobs/${jobId}`);

  return jobSchema.parse(await response.json());
}

async function runIngest(harness: Harness) {
  const queued = await fetch(`${harness.app.url}/__test__/jobs/enqueue`, {
    body: JSON.stringify({ kind: INGEST_KIND, payload: "{}" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  const { id } = enqueueSchema.parse(await queued.json());

  const sample: (samples: number[]) => Promise<number[]> = async (samples) => {
    const started = performance.now();
    const health = await fetch(`${harness.app.url}/api/health`);

    await health.json();
    samples.push(performance.now() - started);

    const job = await readJob(harness, id);

    if (job.status !== "queued" && job.status !== "running") {
      expect(job.status).toBe("done");
      expect(job.lastError).toBeNull();

      return samples;
    }

    await Bun.sleep(20);

    return sample(samples);
  };

  return sample([]);
}

async function postings(harness: Harness) {
  const response = await fetch(`${harness.app.url}/__test__/catalog/postings`);

  return postingsResponseSchema.parse(await response.json()).postings;
}

async function postingTags(harness: Harness) {
  const response = await fetch(`${harness.app.url}/__test__/catalog/posting-tags`);

  return tagsResponseSchema.parse(await response.json()).postingTags;
}

async function search(harness: Harness, query: string) {
  const response = await fetch(
    `${harness.app.url}/__test__/search?q=${encodeURIComponent(query)}&limit=50`,
  );

  return searchResponseSchema.parse(await response.json());
}

function snapshotRows(outDir: string, snapshot: string) {
  const text = gunzipSync(readFileSync(join(outDir, snapshot))).toString("utf8");

  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => uniqueTemplateSchema.parse(JSON.parse(line)));
}

function writeSnapshotWithout(outDir: string, snapshot: string, reference: string) {
  const text = gunzipSync(readFileSync(join(outDir, snapshot))).toString("utf8");

  const kept = text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .filter(
      (line) => z.object({ reference: z.string() }).parse(JSON.parse(line)).reference !== reference,
    );

  const lines = `${kept.join("\n")}\n`;
  const name = "workable/2026-11-23.jsonl.gz";
  const contentHash = createHash("sha256").update(lines).digest("hex");
  const gzipped = gzipSync(Buffer.from(lines));

  writeFileSync(join(outDir, name), gzipped);
  writeFileSync(
    join(outDir, "workable", "manifest.json"),
    `${JSON.stringify({
      version: 1,
      snapshot: name,
      fetchedAt: "2026-11-23T05:00:00.000Z",
      sourceLastModified: null,
      feedJobs: 300,
      distinctReferences: 300,
      duplicates: 0,
      rows: kept.length,
      bytes: gzipped.byteLength,
      contentHash,
    })}\n`,
  );

  return { rows: kept, contentHash };
}

function writeTruncatedSnapshot(outDir: string, snapshot: string, keepRows: number) {
  const text = gunzipSync(readFileSync(join(outDir, snapshot))).toString("utf8");
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const kept = lines.slice(0, keepRows);
  const body = `${kept.join("\n")}\n`;
  const name = "workable/2026-11-24.jsonl.gz";
  const contentHash = createHash("sha256").update(body).digest("hex");
  const gzipped = gzipSync(Buffer.from(body));

  writeFileSync(join(outDir, name), gzipped);
  writeFileSync(
    join(outDir, "workable", "manifest.json"),
    `${JSON.stringify({
      version: 1,
      snapshot: name,
      fetchedAt: "2026-11-19T00:00:00.000Z",
      sourceLastModified: null,
      feedJobs: keepRows,
      distinctReferences: keepRows,
      duplicates: 0,
      rows: keepRows,
      bytes: gzipped.byteLength,
      contentHash,
    })}\n`,
  );

  return { contentHash, rows: kept.length };
}

test.describe.configure({ mode: "serial", timeout: 180_000 });

test("the recorded Workable trim ingests once, stays searchable, and closes what left the snapshot", async () => {
  const outDir = outDirForRun();
  const firstPass = await runPass(outDir, "2026-11-21T06:14:41Z");

  expect(firstPass.outcome).toBe("written");
  expect(firstPass.feedJobs).toBe(300);
  expect(firstPass.distinctReferences).toBe(300);
  expect(firstPass.duplicates).toBe(0);
  expect(firstPass.rows).toBeGreaterThan(0);
  expect(firstPass.rssDeltaMB).toBeLessThanOrEqual(RSS_BUDGET_MB);
  expect(firstPass.elapsedMs).toBeLessThan(300_000);

  const harness = await startHarness(outDir);

  try {
    await runIngest(harness);

    expect(await postings(harness)).toHaveLength(0);

    await setKillSwitch(harness, false);

    const samples = await runIngest(harness);

    expect(Math.max(...samples)).toBeLessThan(HEALTH_BUDGET_MS);

    const rows = snapshotRows(outDir, "workable/2026-11-21.jsonl.gz");
    const ingested = await postings(harness);

    expect(ingested).toHaveLength(rows.length);
    expect(new Set(ingested.map((row) => row.atsJobId)).size).toBe(rows.length);
    expect(ingested.every((row) => row.ats === "workable")).toBe(true);
    expect(ingested.every((row) => row.closedAt === null)).toBe(true);
    expect(ingested.every((row) => row.applyUrl?.includes("/j/") === true)).toBe(true);
    expect(ingested.every((row) => row.descriptionText !== null)).toBe(true);

    const [sample] = rows;

    expect(sample).toBeDefined();

    const stored = ingested.find((row) => row.atsJobId === sample?.reference);

    expect(stored?.title).toBe(sample?.title);
    expect(stored?.url).toBe(sample?.applyUrl);
    expect(stored?.countryCode).toBe(sample?.tags.countryCode);
    expect(stored?.workplace).toBe(sample?.tags.workplace);

    const tags = await postingTags(harness);

    expect(tags.length).toBeGreaterThan(0);
    expect(tags.every((tag) => tag.source === "rules")).toBe(true);

    const found = await search(harness, sample?.title ?? "");

    expect(found.hits.some((hit) => hit.ats === "workable")).toBe(true);

    const targetsFile: unknown = JSON.parse(
      readFileSync(join(outDir, "workable-targets.json"), "utf8"),
    );

    expect(targetsFile).toMatchObject({ version: 1, roles: [] });

    const lastSeen = new Map(ingested.map((row) => [row.id, row.lastSeenAt]));
    const secondPass = await runPass(outDir, "2026-11-22T06:14:41Z");

    expect(secondPass.rows).toBe(firstPass.rows);
    expect(secondPass.rssDeltaMB).toBeLessThanOrEqual(RSS_BUDGET_MB);

    await runIngest(harness);

    const unchanged = await postings(harness);

    expect(unchanged.map((row) => [row.id, row.lastSeenAt])).toEqual([...lastSeen]);

    const [removed] = rows;

    expect(removed).toBeDefined();

    const shortened = writeSnapshotWithout(
      outDir,
      "workable/2026-11-21.jsonl.gz",
      removed?.reference ?? "",
    );

    expect(shortened.rows).toHaveLength(rows.length - 1);

    await runIngest(harness);

    const afterClose = await postings(harness);
    const closed = afterClose.find((row) => row.atsJobId === removed?.reference);

    expect(closed?.closedAt).not.toBeNull();
    expect(afterClose.filter((row) => row.closedAt !== null)).toHaveLength(1);
  } finally {
    await harness.close();
  }
});

test("a truncated and stale snapshot alerts and never closes the catalogue", async () => {
  const outDir = outDirForRun();

  await runPass(outDir, "2026-11-21T11:15:27Z");

  const harness = await startHarness(outDir);

  try {
    await setKillSwitch(harness, false);
    await runIngest(harness);

    const before = await postings(harness);

    expect(before.length).toBeGreaterThan(10);
    expect(before.every((row) => row.closedAt === null)).toBe(true);

    writeTruncatedSnapshot(outDir, "workable/2026-11-21.jsonl.gz", 10);

    const alert = readSseEventUntil(`${harness.app.url}/__test__/events`, null, (event) => {
      if (event.event !== "alert.raised") {
        return false;
      }

      const parsed = z
        .object({ kind: z.string(), detail: z.object({ reason: z.string() }) })
        .safeParse(JSON.parse(event.data));

      return (
        parsed.success &&
        parsed.data.kind === "workable.feed" &&
        parsed.data.detail.reason === "row_drop"
      );
    });

    await runIngest(harness);

    expect(await alert).not.toBeNull();

    const after = await postings(harness);

    expect(after).toHaveLength(before.length);
    expect(after.every((row) => row.closedAt === null)).toBe(true);
  } finally {
    await harness.close();
  }
});
