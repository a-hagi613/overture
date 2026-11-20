import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import {
  GREENHOUSE_DEFAULT_BASE_URL,
  GREENHOUSE_LIMITS,
} from "../src/server/catalog/greenhouse-feed.ts";
import { limiterFor } from "../src/server/catalog/rate-limiter.ts";
import { LEVER_DEFAULT_BASE_URL, LEVER_LIMITS } from "../src/server/catalog/lever-feed.ts";
import { ASHBY_DEFAULT_BASE_URL, ASHBY_LIMITS } from "../src/server/catalog/ashby-feed.ts";

const greenhouseJobSchema = z.object({
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

const greenhouseListSchema = z.object({ jobs: z.array(greenhouseJobSchema) });

const greenhouseQuestionFieldSchema = z.object({
  name: z.string().nullish().default(""),
  type: z.string().nullish().default(""),
  values: z
    .array(
      z.object({
        label: z.string().nullish().default(""),
        value: z.union([z.string(), z.number(), z.boolean()]).nullish(),
      }),
    )
    .nullish()
    .default([]),
});

const greenhouseQuestionSchema = z.object({
  label: z.string().nullish().default(""),
  required: z.boolean().nullish().default(false),
  fields: z.array(greenhouseQuestionFieldSchema).nullish().default([]),
});

const greenhouseQuestionsSchema = z.object({
  id: z.union([z.number(), z.string()]),
  questions: z.array(greenhouseQuestionSchema).nullish().default([]),
});

const leverJobSchema = z.object({
  id: z.string(),
  text: z.string().nullish().default(""),
  hostedUrl: z.string().nullish().default(""),
  createdAt: z.union([z.number(), z.string()]).nullish(),
  workplaceType: z.string().nullish(),
  categories: z
    .object({
      location: z.string().nullish(),
      allLocations: z.array(z.string().nullish()).nullish(),
      department: z.string().nullish(),
      team: z.string().nullish(),
      commitment: z.string().nullish(),
    })
    .nullish(),
  description: z.string().nullish(),
  descriptionPlain: z.string().nullish(),
  lists: z.array(z.object({ text: z.string().nullish(), content: z.string().nullish() })).nullish(),
  additionalPlain: z.string().nullish(),
});

const leverListSchema = z.array(leverJobSchema);

const ashbyJobSchema = z.object({
  id: z.string(),
  title: z.string().nullish().default(""),
  location: z.string().nullish(),
  secondaryLocations: z.array(z.object({ location: z.string().nullish() })).nullish(),
  jobUrl: z.string().nullish().default(""),
  publishedAt: z.union([z.number(), z.string()]).nullish(),
  isListed: z.boolean().nullish(),
  isRemote: z.boolean().nullish(),
  workplaceType: z.string().nullish(),
  employmentType: z.string().nullish(),
  department: z.string().nullish(),
  team: z.string().nullish(),
  descriptionPlain: z.string().nullish(),
  descriptionHtml: z.string().nullish(),
  compensation: z.unknown().nullish(),
});

const ashbyBoardSchema = z.object({ jobs: z.array(ashbyJobSchema).default([]) });

const GREENHOUSE_FIXTURE_ROOT = "test/e2e/fixtures/greenhouse";
const LEVER_FIXTURE_ROOT = "test/e2e/fixtures/lever";
const ASHBY_FIXTURE_ROOT = "test/e2e/fixtures/ashby";
const GREENHOUSE_BOARDS = ["vercel", "stripe", "cloudflare"];
const LEVER_BOARDS = ["spotify", "olo"];
const ASHBY_BOARDS = ["linear", "ramp"];
const JOBS_PER_BOARD = 4;
const CONTENT_LIMIT = 4000;
const LIST_LIMIT = 3;

const greenhouseLimiter = limiterFor("greenhouse", GREENHOUSE_LIMITS);
const leverLimiter = limiterFor("lever", LEVER_LIMITS);
const ashbyLimiter = limiterFor("ashby", ASHBY_LIMITS);

async function fetchJson<T>(url: string, schema: z.ZodType<T>) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${String(response.status)}`);
  }

  return schema.parse(await response.json());
}

function trimGreenhouse(job: z.infer<typeof greenhouseJobSchema>) {
  return {
    id: job.id,
    title: job.title ?? "",
    absolute_url: job.absolute_url ?? "",
    location:
      job.location === null || job.location === undefined
        ? null
        : { name: job.location.name ?? "" },
    updated_at: job.updated_at ?? "",
    first_published: job.first_published ?? "",
    language: job.language ?? "",
    content: job.content?.slice(0, CONTENT_LIMIT) ?? null,
    departments: (job.departments ?? []).map((department) => ({
      name: department.name ?? null,
    })),
  };
}

async function pullGreenhouse(boardToken: string) {
  const list = await greenhouseLimiter.run(async () =>
    fetchJson(`${GREENHOUSE_DEFAULT_BASE_URL}/v1/boards/${boardToken}/jobs`, greenhouseListSchema),
  );

  const jobs = list.jobs.slice(0, JOBS_PER_BOARD);

  const recorded = await Promise.all(
    jobs.map(async (job) => {
      const detail = await greenhouseLimiter.run(async () =>
        fetchJson(
          `${GREENHOUSE_DEFAULT_BASE_URL}/v1/boards/${boardToken}/jobs/${String(
            job.id,
          )}?content=true`,
          greenhouseJobSchema,
        ),
      );

      const questions = await greenhouseLimiter.run(async () =>
        fetchJson(
          `${GREENHOUSE_DEFAULT_BASE_URL}/v1/boards/${boardToken}/jobs/${String(
            job.id,
          )}?questions=true`,
          greenhouseQuestionsSchema,
        ),
      );

      return { job: trimGreenhouse(detail), questions };
    }),
  );

  return {
    boardToken,
    jobs: recorded.map((entry) => entry.job),
    questions: recorded.map((entry) => entry.questions),
  };
}

async function pullGreenhouseContent(boardToken: string) {
  const list = await greenhouseLimiter.run(async () =>
    fetchJson(
      `${GREENHOUSE_DEFAULT_BASE_URL}/v1/boards/${boardToken}/jobs?content=true`,
      greenhouseListSchema,
    ),
  );

  return {
    boardToken,
    jobs: list.jobs.slice(0, JOBS_PER_BOARD).map((job) => trimGreenhouse(job)),
  };
}

function trimLever(job: z.infer<typeof leverJobSchema>) {
  return {
    id: job.id,
    text: job.text ?? "",
    hostedUrl: job.hostedUrl ?? "",
    createdAt: job.createdAt ?? null,
    workplaceType: job.workplaceType ?? null,
    categories: job.categories ?? null,
    description: job.description?.slice(0, CONTENT_LIMIT) ?? null,
    descriptionPlain: job.descriptionPlain?.slice(0, CONTENT_LIMIT) ?? null,
    lists: (job.lists ?? []).slice(0, LIST_LIMIT).map((list) => ({
      text: list.text ?? null,
      content: list.content?.slice(0, CONTENT_LIMIT) ?? null,
    })),
    additionalPlain: job.additionalPlain?.slice(0, CONTENT_LIMIT) ?? null,
  };
}

async function pullLever(boardToken: string) {
  const jobs = await leverLimiter.run(async () =>
    fetchJson(`${LEVER_DEFAULT_BASE_URL}/v0/postings/${boardToken}?mode=json`, leverListSchema),
  );

  const trimmed = jobs.slice(0, JOBS_PER_BOARD).map((job) => trimLever(job));

  return { boardToken, jobs: trimmed };
}

function trimAshby(job: z.infer<typeof ashbyJobSchema>) {
  return {
    id: job.id,
    title: job.title ?? "",
    location: job.location ?? null,
    secondaryLocations: job.secondaryLocations ?? [],
    jobUrl: job.jobUrl ?? "",
    publishedAt: job.publishedAt ?? null,
    isListed: job.isListed ?? null,
    isRemote: job.isRemote ?? null,
    workplaceType: job.workplaceType ?? null,
    employmentType: job.employmentType ?? null,
    department: job.department ?? null,
    team: job.team ?? null,
    descriptionPlain: job.descriptionPlain?.slice(0, CONTENT_LIMIT) ?? null,
    descriptionHtml: job.descriptionHtml?.slice(0, CONTENT_LIMIT) ?? null,
    compensation: job.compensation ?? null,
  };
}

async function pullAshby(boardToken: string) {
  const board = await ashbyLimiter.run(async () =>
    fetchJson(
      `${ASHBY_DEFAULT_BASE_URL}/posting-api/job-board/${boardToken}?includeCompensation=true`,
      ashbyBoardSchema,
    ),
  );

  const trimmed = board.jobs
    .filter((job) => job.isListed !== false && job.jobUrl !== "")
    .slice(0, JOBS_PER_BOARD)
    .map((job) => trimAshby(job));

  return { boardToken, jobs: trimmed };
}

async function writeBoard(
  root: string,
  board: { boardToken: string; jobs: { id: string | number }[] },
  perJobFiles: boolean,
) {
  if (perJobFiles) {
    mkdirSync(join(root, board.boardToken, "jobs"), { recursive: true });

    await Promise.all(
      board.jobs.map(async (job) => {
        await Bun.write(
          join(root, board.boardToken, "jobs", `${String(job.id)}.json`),
          JSON.stringify(job, null, 2),
        );
      }),
    );
  } else {
    mkdirSync(join(root, board.boardToken), { recursive: true });
  }

  await Bun.write(
    join(root, board.boardToken, "board.json"),
    JSON.stringify({ jobs: board.jobs }, null, 2),
  );
}

const targets = process.argv.slice(2).map((arg) => arg.toLowerCase());
const wants = (ats: string) => targets.length === 0 || targets.includes(ats);

const greenhouseRecorded = (
  await Promise.all(
    GREENHOUSE_BOARDS.map(async (boardToken) =>
      wants("greenhouse") ? await pullGreenhouse(boardToken) : null,
    ),
  )
).filter((board): board is Awaited<ReturnType<typeof pullGreenhouse>> => board !== null);

await Promise.all(
  greenhouseRecorded.map(async (board) => {
    await writeBoard(GREENHOUSE_FIXTURE_ROOT, board, true);

    await Promise.all(
      board.questions.map(async (recorded) => {
        await Bun.write(
          join(
            GREENHOUSE_FIXTURE_ROOT,
            board.boardToken,
            "jobs",
            `${String(recorded.id)}.questions.json`,
          ),
          JSON.stringify(recorded, null, 2),
        );
      }),
    );

    process.stdout.write(
      `recorded ${String(board.jobs.length)} jobs for greenhouse board ${board.boardToken}\n`,
    );
  }),
);

const greenhouseContentRecorded = (
  await Promise.all(
    GREENHOUSE_BOARDS.map(async (boardToken) =>
      wants("greenhouse") ? await pullGreenhouseContent(boardToken) : null,
    ),
  )
).filter((board): board is Awaited<ReturnType<typeof pullGreenhouseContent>> => board !== null);

await Promise.all(
  greenhouseContentRecorded.map(async (board) => {
    const directory = join(GREENHOUSE_FIXTURE_ROOT, board.boardToken);

    mkdirSync(directory, { recursive: true });
    await Bun.write(join(directory, "content.json"), JSON.stringify({ jobs: board.jobs }, null, 2));

    process.stdout.write(
      `recorded ${String(board.jobs.length)} content jobs for greenhouse board ${board.boardToken}\n`,
    );
  }),
);

const leverRecorded = (
  await Promise.all(
    LEVER_BOARDS.map(async (boardToken) => (wants("lever") ? await pullLever(boardToken) : null)),
  )
).filter((board): board is Awaited<ReturnType<typeof pullLever>> => board !== null);

await Promise.all(
  leverRecorded.map(async (board) => {
    await writeBoard(LEVER_FIXTURE_ROOT, board, false);

    process.stdout.write(
      `recorded ${String(board.jobs.length)} jobs for lever board ${board.boardToken}\n`,
    );
  }),
);

const ashbyRecorded = (
  await Promise.all(
    ASHBY_BOARDS.map(async (boardToken) => (wants("ashby") ? await pullAshby(boardToken) : null)),
  )
).filter((board): board is Awaited<ReturnType<typeof pullAshby>> => board !== null);

await Promise.all(
  ashbyRecorded.map(async (board) => {
    await writeBoard(ASHBY_FIXTURE_ROOT, board, false);

    process.stdout.write(
      `recorded ${String(board.jobs.length)} jobs for ashby board ${board.boardToken}\n`,
    );
  }),
);
