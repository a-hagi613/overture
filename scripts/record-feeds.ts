import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import {
  GREENHOUSE_DEFAULT_BASE_URL,
  GREENHOUSE_LIMITS,
} from "../src/server/catalog/greenhouse-feed.ts";
import { limiterFor } from "../src/server/catalog/rate-limiter.ts";

const fixtureJobSchema = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string().nullish().default(""),
  absolute_url: z.string().nullish().default(""),
  location: z.object({ name: z.string().nullish() }).nullish(),
  updated_at: z.string().nullish().default(""),
  first_published: z.string().nullish().default(""),
  language: z.string().nullish().default(""),
  content: z.string().nullish(),
  departments: z.array(z.object({ name: z.string().nullish() })).nullish(),
});

const listResponseSchema = z.object({ jobs: z.array(fixtureJobSchema) });
const detailResponseSchema = fixtureJobSchema;

const FIXTURE_ROOT = "test/e2e/fixtures/greenhouse";
const BOARDS = ["vercel", "stripe", "cloudflare"];
const JOBS_PER_BOARD = 4;
const CONTENT_LIMIT = 4000;

const limiter = limiterFor("greenhouse", GREENHOUSE_LIMITS);

async function fetchList(boardToken: string) {
  const url = `${GREENHOUSE_DEFAULT_BASE_URL}/v1/boards/${boardToken}/jobs`;
  const response = await limiter.run(async () => await fetch(url));

  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${String(response.status)}`);
  }

  return listResponseSchema.parse(await response.json());
}

async function fetchDetail(boardToken: string, rawJobId: number | string) {
  const jobId = String(rawJobId);
  const url = `${GREENHOUSE_DEFAULT_BASE_URL}/v1/boards/${boardToken}/jobs/${jobId}?content=true`;
  const response = await limiter.run(async () => await fetch(url));

  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${String(response.status)}`);
  }

  return detailResponseSchema.parse(await response.json());
}

async function pullBoard(boardToken: string) {
  const list = await fetchList(boardToken);
  const jobs = list.jobs.slice(0, JOBS_PER_BOARD);

  const details = await Promise.all(jobs.map(async (job) => await fetchDetail(boardToken, job.id)));

  const trimmed = details.map((detail) => ({
    id: detail.id,
    title: detail.title ?? "",
    absolute_url: detail.absolute_url ?? "",
    location:
      detail.location === null || detail.location === undefined
        ? null
        : { name: detail.location.name ?? "" },
    updated_at: detail.updated_at ?? "",
    first_published: detail.first_published ?? "",
    language: detail.language ?? "",
    content:
      detail.content === null || detail.content === undefined
        ? null
        : detail.content.slice(0, CONTENT_LIMIT),
    departments: (detail.departments ?? []).map((department) => ({
      name: department.name ?? null,
    })),
  }));

  mkdirSync(join(FIXTURE_ROOT, boardToken, "jobs"), { recursive: true });

  await Promise.all(
    trimmed.map(async (job) => {
      await Bun.write(
        join(FIXTURE_ROOT, boardToken, "jobs", `${job.id}.json`),
        JSON.stringify(job, null, 2),
      );
    }),
  );

  await Bun.write(
    join(FIXTURE_ROOT, boardToken, "board.json"),
    JSON.stringify({ jobs: trimmed }, null, 2),
  );

  return { boardToken, jobCount: trimmed.length };
}

const recorded = await Promise.all(BOARDS.map(async (boardToken) => await pullBoard(boardToken)));

for (const board of recorded) {
  process.stdout.write(`recorded ${String(board.jobCount)} jobs for board ${board.boardToken}\n`);
}
