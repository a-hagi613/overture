import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import { startAppServer } from "./app-server.ts";
import { startFeedFixtureServer } from "./feed-fixture-server.ts";
import { seedOwner } from "./matching-harness.ts";
import { extractSseEvents } from "./sse.ts";

import type { SseEvent } from "./sse.ts";

import type { AppServer } from "./app-server.ts";
import type { FeedFixtureServer } from "./feed-fixture-server.ts";

const postingRowSchema = z.object({
  id: z.string(),
  boardId: z.string(),
  atsJobId: z.string(),
  title: z.string(),
  titleNorm: z.string(),
  department: z.string().nullable(),
  locationRaw: z.string().nullable(),
  countryCode: z.string().nullable(),
  language: z.string().nullable(),
  workplace: z.string(),
  employmentType: z.string(),
  url: z.string(),
  applyUrl: z.string().nullable(),
  applyUrlNorm: z.string(),
  salaryMinMinor: z.number().nullable(),
  salaryMaxMinor: z.number().nullable(),
  salaryCurrency: z.string().nullable(),
  salaryPeriod: z.string().nullable(),
  descriptionText: z.string().nullable(),
  tagSource: z.string().nullable(),
  taggedAt: z.number().nullable(),
  descriptionHash: z.string().nullable(),
  closedAt: z.number().nullable(),
  missingPolls: z.number(),
  dedupeKey: z.string(),
  lastSeenAt: z.number(),
});

const boardRowSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  ats: z.string(),
  boardToken: z.string(),
  region: z.string(),
  status: z.string(),
  source: z.string(),
  etag: z.string().nullable(),
  contentHash: z.string().nullable(),
  lastPolledAt: z.number().nullable(),
  nextPollAt: z.number().nullable(),
  notFoundPolls: z.number(),
  consecutiveErrors: z.number(),
});

const postingsResponseSchema = z.object({ postings: z.array(postingRowSchema) });

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

const boardsResponseSchema = z.object({ boards: z.array(boardRowSchema) });

const jobRowSchema = z.object({
  id: z.string(),
  kind: z.string(),
  status: z.string(),
  runAt: z.number(),
  attempts: z.number(),
  lockedUntil: z.number().nullable(),
});

const jobsResponseSchema = z.object({ jobs: z.array(jobRowSchema) });
const clockResponseSchema = z.object({ now: z.number() });
const sweepWorkerStatusSchema = z.object({ running: z.boolean(), restarts: z.number() });
const sweepWorkerCrashSchema = z.object({ crashed: z.boolean() });
const companyCreatedSchema = z.object({ id: z.string() });
const boardCreatedSchema = z.object({ id: z.string() });
const enqueueSchema = z.object({ id: z.string() });
const jobPayloadSchema = z.object({ id: z.string() });

export interface PostingRow {
  id: string;
  boardId: string;
  atsJobId: string;
  title: string;
  titleNorm: string;
  department: string | null;
  locationRaw: string | null;
  countryCode: string | null;
  language: string | null;
  workplace: string;
  employmentType: string;
  url: string;
  applyUrl: string | null;
  applyUrlNorm: string;
  salaryMinMinor: number | null;
  salaryMaxMinor: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  descriptionText: string | null;
  tagSource: string | null;
  taggedAt: number | null;
  descriptionHash: string | null;
  closedAt: number | null;
  missingPolls: number;
  dedupeKey: string;
  lastSeenAt: number;
}

export interface PostingTagRow {
  postingId: string;
  dimension: string;
  value: string;
  source: string;
}

export interface BoardRow {
  id: string;
  companyId: string;
  ats: string;
  boardToken: string;
  region: string;
  status: string;
  source: string;
  etag: string | null;
  contentHash: string | null;
  lastPolledAt: number | null;
  nextPollAt: number | null;
  notFoundPolls: number;
  consecutiveErrors: number;
}

export interface JobRow {
  id: string;
  kind: string;
  status: string;
  runAt: number;
  attempts: number;
  lockedUntil: number | null;
}

const boardSpecSchema = z.union([
  z
    .string()
    .min(1)
    .transform((token) => ({
      ats: "greenhouse" as const,
      token,
      region: "us" as const,
      bulk: undefined,
    })),
  z.object({
    ats: z.enum(["greenhouse", "lever", "ashby", "personio"]),
    token: z.string().min(1),
    region: z.enum(["us", "eu"]).default("us"),
    bulk: z
      .union([
        z.object({
          jobCount: z.number().int().min(1).max(2000),
          descriptionKb: z.number().int().min(1).max(64),
        }),
        z.object({
          jobCount: z.number().int().min(1).max(2000),
          sourceToken: z.string().min(1),
        }),
      ])
      .optional(),
  }),
]);

export type BoardSpec = z.input<typeof boardSpecSchema>;

export interface CatalogHarness {
  app: AppServer;
  fixture: FeedFixtureServer;
  databasePath: string;
  companyId: string;
  boardIds: Record<string, string>;
  runBackfillCycle: () => Promise<void>;
  runOneJob: (kind: string) => Promise<string>;
  enqueueJob: (kind: string) => Promise<string>;
  waitForJob: (jobId: string) => Promise<void>;
  pollThroughScheduledSweep: (clockOffsetMs: number) => Promise<void>;
  seedPostings: (tokens: string[]) => Promise<void>;
  postings: () => Promise<PostingRow[]>;
  postingTags: () => Promise<PostingTagRow[]>;
  boards: () => Promise<BoardRow[]>;
  jobs: () => Promise<JobRow[]>;
  putSetting: (key: string, value: string) => Promise<void>;
  setKillSwitch: (scope: string, key: string, enabled: boolean) => Promise<void>;
  moveClock: (offsetMs: number) => Promise<void>;
  clockNow: () => Promise<number>;
  sweepWorkerStatus: () => Promise<{ running: boolean; restarts: number }>;
  crashSweepWorker: () => Promise<boolean>;
  close: () => Promise<void>;
}

type JsonValue = string | number | boolean | null | undefined | readonly JsonValue[] | JsonBody;

interface JsonBody {
  readonly [key: string]: JsonValue;
}

async function postJson(url: string, body: JsonBody) {
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

function jobDoneIds(events: SseEvent[]) {
  const done = new Set<string>();

  for (const event of events) {
    if (event.event !== "job.done") {
      continue;
    }

    done.add(jobPayloadSchema.parse(JSON.parse(event.data)).id);
  }

  return done;
}

async function waitForJobDone(
  appUrl: string,
  lastEventId: string,
  requiredJobIds: readonly string[] | null,
) {
  const wanted = requiredJobIds;

  const response = await fetch(`${appUrl}/__test__/events`, {
    headers: { "Last-Event-ID": lastEventId },
  });

  if (!response.ok || response.body === null) {
    throw new Error(`opening the events stream at ${appUrl}/__test__/events failed`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const settledDone = new Set<string>();

  let buffer = "";
  let cursor = lastEventId;

  function includeBatch(batch: SseEvent[]) {
    for (const jobDone of jobDoneIds(batch)) {
      settledDone.add(jobDone);
    }

    const lastOfBatch = batch.at(-1);

    if (lastOfBatch !== undefined) {
      cursor = lastOfBatch.id;
    }
  }

  function settled() {
    const matches = [...settledDone];

    if (wanted === null) {
      return matches.length > 0;
    }

    return wanted.some((jobId) => matches.includes(jobId));
  }

  async function readUntilSettled() {
    const { done: closed, value } = await reader.read();

    if (closed) {
      throw new Error("the events stream closed before the catalog jobs settled");
    }

    buffer += decoder.decode(value, { stream: true });

    const { events: batch, remainder } = extractSseEvents(buffer);

    buffer = remainder;
    includeBatch(batch);

    if (settled()) {
      await reader.cancel();

      return cursor;
    }

    return readUntilSettled();
  }

  return readUntilSettled();
}

export async function startCatalogHarness(
  boardSpecs: BoardSpec[],
  extraEnvironment: Record<string, string> = {},
) {
  const fixture = await startFeedFixtureServer();
  const directory = mkdtempSync(join(tmpdir(), "overture-catalog-"));
  const databasePath = join(directory, "overture.db");

  const app = await startAppServer(databasePath, {
    GREENHOUSE_FEED_BASE_URL: fixture.url,
    LEVER_FEED_BASE_URL: fixture.url,
    LEVER_EU_FEED_BASE_URL: `${fixture.url}/eu`,
    ASHBY_FEED_BASE_URL: fixture.url,
    PERSONIO_FEED_BASE_URL: `${fixture.url}/personio/{token}`,
    ...extraEnvironment,
  });

  const ownerSession = await seedOwner(app.url);

  const companyResponse = await postJson(`${app.url}/__test__/catalog/companies`, {
    name: "Fixture Dynamics",
    domain: "fixture.example",
  });

  const company = companyCreatedSchema.parse(await companyResponse.json());

  const specs = boardSpecs.map((spec) => boardSpecSchema.parse(spec));

  for (const spec of specs) {
    if (spec.bulk !== undefined) {
      fixture.seedBoard(spec.ats, spec.token, spec.bulk);
    }
  }

  const createdBoards = await Promise.all(
    specs.map(async (spec) => {
      const boardResponse = await postJson(`${app.url}/__test__/catalog/boards`, {
        companyId: company.id,
        ats: spec.ats,
        boardToken: spec.token,
        region: spec.region,
      });

      const board = boardCreatedSchema.parse(await boardResponse.json());

      return [spec.token, board.id] as const;
    }),
  );

  const boardIds: Record<string, string> = {};

  for (const [token, id] of createdBoards) {
    boardIds[token] = id;
  }

  let lastEventId = "";

  async function runBackfillCycle() {
    const enqueueResponse = await postJson(`${app.url}/__test__/jobs/enqueue`, {
      kind: "catalog.backfill",
      payload: "{}",
    });

    const enqueued = enqueueSchema.parse(await enqueueResponse.json());

    lastEventId = await waitForJobDone(app.url, lastEventId, [enqueued.id]);
  }

  async function runOneJob(kind: string) {
    const enqueuedId = await enqueueJob(kind);

    lastEventId = await waitForJobDone(app.url, lastEventId, [enqueuedId]);

    return enqueuedId;
  }

  async function enqueueJob(kind: string) {
    const enqueueResponse = await postJson(`${app.url}/__test__/jobs/enqueue`, {
      kind,
      payload: "{}",
    });

    return enqueueSchema.parse(await enqueueResponse.json()).id;
  }

  async function waitForJob(jobId: string) {
    lastEventId = await waitForJobDone(app.url, lastEventId, [jobId]);
  }

  async function pollThroughScheduledSweep(clockOffsetMs: number) {
    const queuedSweeps = (await listJobs())
      .filter((job) => job.kind === "catalog.sweep" && job.status === "queued")
      .map((job) => job.id);

    const offsetResponse = await postJson(`${app.url}/__test__/clock/offset`, {
      offsetMs: clockOffsetMs,
    });

    if (!offsetResponse.ok) {
      throw new Error("moving the clock failed");
    }

    await postJson(`${app.url}/__test__/jobs/enqueue`, {
      kind: "catalog.sweep",
      payload: "{}",
      runAt: (await clockNow()) + 3_600_000,
    });

    lastEventId = await waitForJobDone(
      app.url,
      lastEventId,
      queuedSweeps.length === 0 ? null : queuedSweeps,
    );
  }

  async function clockNow() {
    const response = await fetch(`${app.url}/__test__/clock`);
    const clock = clockResponseSchema.parse(await response.json());

    return clock.now;
  }

  async function postings() {
    const response = await fetch(`${app.url}/__test__/catalog/postings`);

    return postingsResponseSchema.parse(await response.json()).postings;
  }

  async function seedPostings(tokens: string[]) {
    await Promise.all(
      tokens.map(async (token) => {
        const spec = specs.find((candidate) => candidate.token === token);

        if (spec === undefined) {
          throw new Error(`no board spec for ${token}`);
        }

        const jobs = fixture.jobs(spec.ats, token);

        await postJson(`${app.url}/__test__/catalog/postings/bulk`, {
          postings: jobs.map((job) => ({
            boardId: boardIds[token] ?? "",
            companyId: company.id,
            ats: spec.ats,
            atsJobId: job.atsJobId,
            url: job.url,
            title: job.title,
            sourceUpdatedAt: job.sourceUpdatedAt === null ? null : Date.parse(job.sourceUpdatedAt),
            descriptionText: job.descriptionText,
          })),
        });
      }),
    );
  }

  async function postingTags() {
    const response = await fetch(`${app.url}/__test__/catalog/posting-tags`);

    return postingTagsResponseSchema.parse(await response.json()).postingTags;
  }

  async function boards() {
    const response = await fetch(`${app.url}/__test__/catalog/boards`);

    return boardsResponseSchema.parse(await response.json()).boards;
  }

  async function listJobs() {
    const response = await fetch(`${app.url}/__test__/jobs`);

    return jobsResponseSchema.parse(await response.json()).jobs;
  }

  async function putSetting(key: string, value: string) {
    const response = await fetch(`${app.url}/__test__/settings/${key}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value }),
    });

    if (!response.ok) {
      throw new Error(`setting ${key} failed`);
    }
  }

  async function setKillSwitch(scope: string, key: string, enabled: boolean) {
    const response = await fetch(`${app.url}/__test__/kill-switches/${scope}/${key}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled, reason: "catalog test", setBy: "owner" }),
    });

    if (!response.ok) {
      throw new Error(`kill switch ${scope}/${key} failed`);
    }
  }

  async function moveClock(offsetMs: number) {
    const response = await postJson(`${app.url}/__test__/clock/offset`, { offsetMs });

    if (!response.ok) {
      throw new Error("moving the clock failed");
    }
  }

  async function sweepWorkerStatus() {
    const response = await fetch(`${app.url}/__test__/catalog/sweep-worker`);

    return sweepWorkerStatusSchema.parse(await response.json());
  }

  async function crashSweepWorker() {
    const response = await postJson(`${app.url}/__test__/catalog/sweep-worker/crash`, {});

    return sweepWorkerCrashSchema.parse(await response.json()).crashed;
  }

  return {
    app,
    fixture,
    databasePath,
    companyId: company.id,
    boardIds,
    runBackfillCycle,
    runOneJob,
    enqueueJob,
    waitForJob,
    pollThroughScheduledSweep,
    seedPostings,
    postings,
    postingTags,
    boards,
    jobs: listJobs,
    putSetting,
    setKillSwitch,
    moveClock,
    clockNow,
    sweepWorkerStatus,
    crashSweepWorker,
    close: async () => {
      await ownerSession.owner.dispose();
      await app.stop();
      fixture.stop();
    },
  } satisfies CatalogHarness;
}
