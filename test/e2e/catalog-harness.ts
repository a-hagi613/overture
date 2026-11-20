import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import { startAppServer } from "./app-server.ts";
import { startFeedFixtureServer } from "./feed-fixture-server.ts";
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
  workplace: z.string(),
  employmentType: z.string(),
  tagSource: z.string().nullable(),
  taggedAt: z.number().nullable(),
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
const boardsResponseSchema = z.object({ boards: z.array(boardRowSchema) });
const clockResponseSchema = z.object({ now: z.number() });
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
  workplace: string;
  employmentType: string;
  tagSource: string | null;
  taggedAt: number | null;
  closedAt: number | null;
  missingPolls: number;
  dedupeKey: string;
  lastSeenAt: number;
}

export interface BoardRow {
  id: string;
  companyId: string;
  ats: string;
  boardToken: string;
  status: string;
  source: string;
  etag: string | null;
  contentHash: string | null;
  lastPolledAt: number | null;
  nextPollAt: number | null;
  notFoundPolls: number;
  consecutiveErrors: number;
}

const boardSpecSchema = z.union([
  z
    .string()
    .min(1)
    .transform((token) => ({ ats: "greenhouse" as const, token })),
  z.object({
    ats: z.enum(["greenhouse", "lever", "ashby"]),
    token: z.string().min(1),
  }),
]);

export type BoardSpec = z.input<typeof boardSpecSchema>;

export interface CatalogHarness {
  app: AppServer;
  fixture: FeedFixtureServer;
  companyId: string;
  boardIds: Record<string, string>;
  runBackfillCycle: () => Promise<void>;
  pollThroughScheduledSweep: (clockOffsetMs: number) => Promise<void>;
  postings: () => Promise<PostingRow[]>;
  boards: () => Promise<BoardRow[]>;
  clockNow: () => Promise<number>;
  close: () => Promise<void>;
}

type JsonBody = Record<string, string | number>;

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
  requiredJobId: string | null,
  excludedJobId: string | null,
) {
  const response = await fetch(`${appUrl}/api/events`, {
    headers: { "Last-Event-ID": lastEventId },
  });

  if (!response.ok || response.body === null) {
    throw new Error(`opening the events stream at ${appUrl}/api/events failed`);
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
    const matches = [...settledDone].filter((jobId) => jobId !== excludedJobId);

    return requiredJobId === null ? matches.length > 0 : matches.includes(requiredJobId);
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

export async function startCatalogHarness(boardSpecs: BoardSpec[]) {
  const fixture = await startFeedFixtureServer();
  const directory = mkdtempSync(join(tmpdir(), "overture-catalog-"));
  const databasePath = join(directory, "overture.db");

  const app = await startAppServer(databasePath, {
    GREENHOUSE_FEED_BASE_URL: fixture.url,
    LEVER_FEED_BASE_URL: fixture.url,
    ASHBY_FEED_BASE_URL: fixture.url,
  });

  const companyResponse = await postJson(`${app.url}/__test__/catalog/companies`, {
    name: "Fixture Dynamics",
    domain: "fixture.example",
  });

  const company = companyCreatedSchema.parse(await companyResponse.json());

  const specs = boardSpecs.map((spec) => boardSpecSchema.parse(spec));

  const createdBoards = await Promise.all(
    specs.map(async (spec) => {
      const boardResponse = await postJson(`${app.url}/__test__/catalog/boards`, {
        companyId: company.id,
        ats: spec.ats,
        boardToken: spec.token,
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

    lastEventId = await waitForJobDone(app.url, lastEventId, enqueued.id, null);
  }

  async function pollThroughScheduledSweep(clockOffsetMs: number) {
    const offsetResponse = await postJson(`${app.url}/__test__/clock/offset`, {
      offsetMs: clockOffsetMs,
    });

    if (!offsetResponse.ok) {
      throw new Error("moving the clock failed");
    }

    const nudgeResponse = await postJson(`${app.url}/__test__/jobs/enqueue`, {
      kind: "catalog.sweep",
      payload: "{}",
      runAt: (await clockNow()) + 3_600_000,
    });

    const nudge = enqueueSchema.parse(await nudgeResponse.json());

    lastEventId = await waitForJobDone(app.url, lastEventId, null, nudge.id);
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

  async function boards() {
    const response = await fetch(`${app.url}/__test__/catalog/boards`);

    return boardsResponseSchema.parse(await response.json()).boards;
  }

  return {
    app,
    fixture,
    companyId: company.id,
    boardIds,
    runBackfillCycle,
    pollThroughScheduledSweep,
    postings,
    boards,
    clockNow,
    close: async () => {
      await app.stop();
      fixture.stop();
    },
  } satisfies CatalogHarness;
}
