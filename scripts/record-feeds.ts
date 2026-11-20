import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import {
  GREENHOUSE_DEFAULT_BASE_URL,
  GREENHOUSE_LIMITS,
} from "../src/server/catalog/greenhouse-feed.ts";
import { limiterFor } from "../src/server/catalog/rate-limiter.ts";
import {
  LEVER_DEFAULT_BASE_URL,
  LEVER_EU_DEFAULT_BASE_URL,
  LEVER_LIMITS,
  LEVER_PAGE_SIZE,
} from "../src/server/catalog/lever-feed.ts";
import { ASHBY_DEFAULT_BASE_URL, ASHBY_LIMITS } from "../src/server/catalog/ashby-feed.ts";

const greenhouseJobSchema = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string().nullish().default(""),
  absolute_url: z.string().nullish().default(""),
  location: z.object({ name: z.string().nullish() }).nullish(),
  updated_at: z.string().nullish().default(""),
  first_published: z.string().nullish().default(""),
  language: z.string().nullish().default(""),
  internal_job_id: z.number().nullish(),
  requisition_id: z.string().nullish(),
  pay_input_ranges: z
    .array(
      z.object({
        min_cents: z.number().nullish(),
        max_cents: z.number().nullish(),
        currency_type: z.string().nullish(),
        interval: z.string().nullish(),
      }),
    )
    .nullish(),
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
  applyUrl: z.string().nullish(),
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
  applyUrl: z.string().nullish(),
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
const LEVER_EU_FIXTURE_ROOT = "test/e2e/fixtures/lever-eu";
const ASHBY_FIXTURE_ROOT = "test/e2e/fixtures/ashby";
const GREENHOUSE_BOARDS = ["vercel", "stripe", "cloudflare"];
const LEVER_BOARDS = ["spotify", "olo"];
const ASHBY_BOARDS = ["linear", "ramp"];

const GREENHOUSE_CANDIDATES = [
  "anthropic",
  "figma",
  "discord",
  "coinbase",
  "instacart",
  "doordash",
  "reddit",
  "robinhood",
  "databricks",
  "mongodb",
  "gitlab",
  "hashicorp",
  "twilio",
  "dropbox",
  "airtable",
  "brex",
];

const LEVER_CANDIDATES = [
  "palantir",
  "mistral",
  "n8n",
  "qonto",
  "swile",
  "gorgias",
  "ledgy",
  "wefox",
  "trade-republic",
  "sennder",
  "contentsquare",
  "backmarket",
  "alan",
  "pigment",
  "pennylane",
  "spendesk",
  "aavelabs",
  "anagramsecurity",
];

const LEVER_EU_CANDIDATES = [...LEVER_CANDIDATES, "spotify", "olo"];

const REQUISITION_PLACEHOLDERS: ReadonlySet<string> = new Set(["tbd", "tba", "n/a", "none", "-"]);

const ASHBY_CANDIDATES = [
  "openai",
  "notion",
  "vanta",
  "retool",
  "decagon",
  "sierra",
  "cohere",
  "elevenlabs",
  "harvey",
  "glean",
  "ramp",
  "linear",
];

const JOBS_PER_BOARD = 4;
const CONTENT_LIMIT = 4000;
const PAGINATED_CONTENT_LIMIT = 600;
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

async function tryFetchJson<T>(url: string, schema: z.ZodType<T>) {
  const response = await fetch(url);

  if (response.status === 404) {
    return null;
  }

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
    internal_job_id: job.internal_job_id ?? null,
    requisition_id: job.requisition_id ?? null,
    pay_input_ranges: (job.pay_input_ranges ?? []).map((range) => ({
      min_cents: range.min_cents ?? null,
      max_cents: range.max_cents ?? null,
      currency_type: range.currency_type ?? null,
      interval: range.interval ?? null,
    })),
    content: job.content?.slice(0, CONTENT_LIMIT) ?? null,
    departments: (job.departments ?? []).map((department) => ({
      name: department.name ?? null,
    })),
  };
}

function greenhouseDetailUrl(boardToken: string, jobId: string | number) {
  return `${GREENHOUSE_DEFAULT_BASE_URL}/v1/boards/${boardToken}/jobs/${String(jobId)}?content=true&pay_transparency=true`;
}

async function pullGreenhouse(boardToken: string) {
  const list = await greenhouseLimiter.run(async () =>
    fetchJson(`${GREENHOUSE_DEFAULT_BASE_URL}/v1/boards/${boardToken}/jobs`, greenhouseListSchema),
  );

  const jobs = list.jobs.slice(0, JOBS_PER_BOARD);

  const recorded = await Promise.all(
    jobs.map(async (job) => {
      const detail = await greenhouseLimiter.run(async () =>
        fetchJson(greenhouseDetailUrl(boardToken, job.id), greenhouseJobSchema),
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

function trimLever(job: z.infer<typeof leverJobSchema>, contentLimit = CONTENT_LIMIT) {
  return {
    id: job.id,
    text: job.text ?? "",
    hostedUrl: job.hostedUrl ?? "",
    applyUrl: job.applyUrl ?? null,
    createdAt: job.createdAt ?? null,
    workplaceType: job.workplaceType ?? null,
    categories: job.categories ?? null,
    description: job.description?.slice(0, contentLimit) ?? null,
    descriptionPlain: job.descriptionPlain?.slice(0, contentLimit) ?? null,
    lists: (job.lists ?? []).slice(0, LIST_LIMIT).map((list) => ({
      text: list.text ?? null,
      content: list.content?.slice(0, contentLimit) ?? null,
    })),
    additionalPlain: job.additionalPlain?.slice(0, contentLimit) ?? null,
  };
}

async function pullLeverPages(baseUrl: string, boardToken: string) {
  const pages: z.infer<typeof leverListSchema>[] = [];

  const fetchFrom: (skip: number) => Promise<"gone" | null> = async (skip) => {
    const page = await leverLimiter.run(async () =>
      tryFetchJson(
        `${baseUrl}/v0/postings/${boardToken}?mode=json&limit=${String(LEVER_PAGE_SIZE)}&skip=${String(skip)}`,
        leverListSchema,
      ),
    );

    if (page === null) {
      return "gone";
    }

    pages.push(page);

    return page.length < LEVER_PAGE_SIZE ? null : fetchFrom(skip + LEVER_PAGE_SIZE);
  };

  if ((await fetchFrom(0)) === "gone") {
    return null;
  }

  return pages.flat();
}

async function pullLever(boardToken: string) {
  const jobs = await pullLeverPages(LEVER_DEFAULT_BASE_URL, boardToken);
  const trimmed = (jobs ?? []).slice(0, JOBS_PER_BOARD).map((job) => trimLever(job));

  return { boardToken, jobs: trimmed };
}

function trimAshby(job: z.infer<typeof ashbyJobSchema>, contentLimit = CONTENT_LIMIT) {
  return {
    id: job.id,
    title: job.title ?? "",
    location: job.location ?? null,
    secondaryLocations: job.secondaryLocations ?? [],
    jobUrl: job.jobUrl ?? "",
    applyUrl: job.applyUrl ?? null,
    publishedAt: job.publishedAt ?? null,
    isListed: job.isListed ?? null,
    isRemote: job.isRemote ?? null,
    workplaceType: job.workplaceType ?? null,
    employmentType: job.employmentType ?? null,
    department: job.department ?? null,
    team: job.team ?? null,
    descriptionPlain: job.descriptionPlain?.slice(0, contentLimit) ?? null,
    descriptionHtml: job.descriptionHtml?.slice(0, contentLimit) ?? null,
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

const targetNames: string[] = [];
const targetSlugs = new Map<string, string[]>();

for (const argument of process.argv.slice(2)) {
  const [name, slugs] = argument.split(":");
  const target = (name ?? "").toLowerCase();

  targetNames.push(target);

  if (slugs !== undefined) {
    targetSlugs.set(
      target,
      slugs.split(",").filter((slug) => slug !== ""),
    );
  }
}

const wants = (ats: string) => targetNames.length === 0 || targetNames.includes(ats);
const candidatesFor = (target: string, fallback: string[]) => targetSlugs.get(target) ?? fallback;

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

interface GreenhouseScan {
  boardToken: string;
  jobs: number;
  payRangeJobs: string[];
  talentPoolJobs: string[];
  placeholderRequisitions: string[];
  written: boolean;
}

async function scanGreenhouse(boardToken: string) {
  const list = await greenhouseLimiter.run(async () =>
    tryFetchJson(
      `${GREENHOUSE_DEFAULT_BASE_URL}/v1/boards/${boardToken}/jobs`,
      greenhouseListSchema,
    ),
  );

  if (list === null) {
    return null;
  }

  const payRangeChecks = await Promise.all(
    list.jobs.slice(0, 6).map(async (job) => {
      const detail = await greenhouseLimiter.run(async () =>
        tryFetchJson(greenhouseDetailUrl(boardToken, job.id), greenhouseJobSchema),
      );

      return { job, detail };
    }),
  );

  const payRangeJobs = payRangeChecks.flatMap(({ job, detail }) =>
    (detail?.pay_input_ranges ?? []).length > 0 ? [String(job.id)] : [],
  );

  const talentPoolJobs = list.jobs.flatMap((job) =>
    job.internal_job_id === null || job.internal_job_id === undefined ? [String(job.id)] : [],
  );

  const placeholderRequisitions = list.jobs.flatMap((job) =>
    job.requisition_id !== null &&
    job.requisition_id !== undefined &&
    REQUISITION_PLACEHOLDERS.has(job.requisition_id.trim().toLowerCase())
      ? [job.requisition_id]
      : [],
  );

  const interesting =
    talentPoolJobs.length > 0 || payRangeJobs.length > 0 || placeholderRequisitions.length > 0;

  const recorded = interesting ? await pullGreenhouse(boardToken) : null;

  if (recorded !== null) {
    await writeBoard(GREENHOUSE_FIXTURE_ROOT, recorded, true);
  }

  return {
    boardToken,
    jobs: list.jobs.length,
    payRangeJobs,
    talentPoolJobs,
    placeholderRequisitions,
    written: recorded !== null,
  } satisfies GreenhouseScan;
}

if (wants("greenhouse-extra")) {
  const scans = (
    await Promise.all(
      candidatesFor("greenhouse-extra", GREENHOUSE_CANDIDATES).map(async (boardToken) =>
        scanGreenhouse(boardToken),
      ),
    )
  ).flatMap((scan) => (scan === null ? [] : [scan]));

  process.stdout.write(`greenhouse scan\n${JSON.stringify(scans, null, 2)}\n`);
}

interface LeverScan {
  boardToken: string;
  region: "us" | "eu";
  postings: number;
  workplaceTypes: Record<string, number>;
  withApplyUrl: number;
  sampleJobIds: string[];
  written: boolean;
}

function scanSummary(
  region: "us" | "eu",
  boardToken: string,
  jobs: z.infer<typeof leverListSchema>,
) {
  const workplaceTypes: Record<string, number> = {};

  for (const job of jobs) {
    const key = job.workplaceType ?? "none";
    workplaceTypes[key] = (workplaceTypes[key] ?? 0) + 1;
  }

  return {
    boardToken,
    region,
    postings: jobs.length,
    workplaceTypes,
    withApplyUrl: jobs.filter((job) => job.applyUrl !== null && job.applyUrl !== undefined).length,
    sampleJobIds: jobs.slice(0, 3).map((job) => job.id),
    written: false,
  } satisfies LeverScan;
}

async function writeLeverRegion(region: "us" | "eu", boardToken: string) {
  const baseUrl = region === "eu" ? LEVER_EU_DEFAULT_BASE_URL : LEVER_DEFAULT_BASE_URL;
  const jobs = await pullLeverPages(baseUrl, boardToken);

  if (jobs === null || jobs.length === 0) {
    return null;
  }

  const contentLimit = jobs.length > LEVER_PAGE_SIZE ? PAGINATED_CONTENT_LIMIT : CONTENT_LIMIT;

  await writeBoard(
    region === "eu" ? LEVER_EU_FIXTURE_ROOT : LEVER_FIXTURE_ROOT,
    { boardToken, jobs: jobs.map((job) => trimLever(job, contentLimit)) },
    false,
  );

  return { ...scanSummary(region, boardToken, jobs), written: true };
}

if (wants("lever-all")) {
  const scans = (
    await Promise.all(
      candidatesFor("lever-all", LEVER_CANDIDATES).map(async (boardToken) =>
        writeLeverRegion("us", boardToken),
      ),
    )
  ).flatMap((scan) => (scan === null ? [] : [scan]));

  process.stdout.write(`lever scan\n${JSON.stringify(scans, null, 2)}\n`);
}

if (wants("lever-eu")) {
  const pairs = (
    await Promise.all(
      candidatesFor("lever-eu", LEVER_EU_CANDIDATES).map(async (boardToken) => {
        const eu = await writeLeverRegion("eu", boardToken);

        if (eu === null) {
          return null;
        }

        if (LEVER_BOARDS.includes(boardToken)) {
          return { boardToken, eu, us: null };
        }

        return { boardToken, eu, us: await writeLeverRegion("us", boardToken) };
      }),
    )
  ).flatMap((pair) => (pair === null ? [] : [pair]));

  process.stdout.write(`lever eu pairs\n${JSON.stringify(pairs, null, 2)}\n`);
}

interface AshbyScan {
  boardToken: string;
  jobs: number;
  unlisted: string[];
  hybridWithIsRemote: string[];
  withApplyUrl: number;
  written: boolean;
}

if (wants("ashby-extra")) {
  const scans = (
    await Promise.all(
      candidatesFor("ashby-extra", ASHBY_CANDIDATES).map(async (boardToken) => {
        const board = await ashbyLimiter.run(async () =>
          tryFetchJson(
            `${ASHBY_DEFAULT_BASE_URL}/posting-api/job-board/${boardToken}?includeCompensation=true`,
            ashbyBoardSchema,
          ),
        );

        if (board === null) {
          return null;
        }

        const unlisted = board.jobs.flatMap((job) => (job.isListed === false ? [job.id] : []));

        const hybridWithIsRemote = board.jobs.flatMap((job) =>
          job.workplaceType?.toLowerCase() === "hybrid" && job.isRemote === true ? [job.id] : [],
        );

        const interesting = unlisted.length > 0;

        if (interesting) {
          const listed = board.jobs.filter((job) => job.isListed !== false && job.jobUrl !== "");

          const kept = [
            ...listed.slice(0, JOBS_PER_BOARD),
            ...board.jobs.filter((job) => job.isListed === false),
          ];

          await writeBoard(
            ASHBY_FIXTURE_ROOT,
            { boardToken, jobs: kept.map((job) => trimAshby(job, PAGINATED_CONTENT_LIMIT)) },
            false,
          );
        }

        return {
          boardToken,
          jobs: board.jobs.length,
          unlisted,
          hybridWithIsRemote,
          withApplyUrl: board.jobs.filter(
            (job) => job.applyUrl !== null && job.applyUrl !== undefined,
          ).length,
          written: interesting,
        } satisfies AshbyScan;
      }),
    )
  ).flatMap((scan) => (scan === null ? [] : [scan]));

  process.stdout.write(`ashby scan\n${JSON.stringify(scans, null, 2)}\n`);
}
