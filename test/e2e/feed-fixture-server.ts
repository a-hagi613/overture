import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { join } from "node:path";

import { z } from "zod";

import type { Ats } from "../../src/server/catalog/board-feed.ts";

const greenhouseJobSchema = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string().default(""),
  absolute_url: z.string().default(""),
  location: z.object({ name: z.string().default("") }).nullish(),
  updated_at: z.string().default("2026-01-01T00:00:00Z"),
  first_published: z.string().default("2026-01-01T00:00:00Z"),
  language: z.string().default("en"),
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
  departments: z
    .array(z.object({ name: z.string().nullish() }))
    .nullish()
    .default([]),
});

const greenhouseBoardSchema = z.object({ jobs: z.array(greenhouseJobSchema).default([]) });

const leverJobSchema = z.object({
  id: z.string(),
  text: z.string().default(""),
  hostedUrl: z.string().default(""),
  applyUrl: z.string().nullish(),
  createdAt: z.number().default(0),
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
  lists: z
    .array(z.object({ text: z.string().nullish(), content: z.string().nullish() }))
    .nullish()
    .default([]),
  additionalPlain: z.string().nullish(),
});

const leverBoardSchema = z.object({ jobs: z.array(leverJobSchema).default([]) });

const ashbyJobSchema = z.object({
  id: z.string(),
  title: z.string().default(""),
  location: z.string().nullish(),
  secondaryLocations: z
    .array(z.object({ location: z.string().nullish() }))
    .nullish()
    .default([]),
  jobUrl: z.string().default(""),
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

const recordedQuestionsSchema = z.object({
  id: z.union([z.string(), z.number()]),
  questions: z.array(z.record(z.string(), z.unknown())).default([]),
});

const ifNoneMatchSchema = z
  .union([z.string(), z.array(z.string())])
  .nullish()
  .transform((value) => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)));

export interface AtsStats {
  requestCount: number;
  maxInFlight: number;
  arrivalGapsMs: number[];
}

export interface FixtureStats {
  requestCount: number;
  maxInFlight: number;
  arrivalGapsMs: number[];
  paths: string[];
  urls: string[];
  detailCounts: Record<string, number>;
  questionsRequests: number;
  perAts: Record<Ats, AtsStats>;
}

export interface BoardMutation {
  titleUpdates?: Record<string, string>;
  locationUpdates?: Record<string, string>;
  descriptionUpdates?: Record<string, string>;
  updatedAtUpdates?: Record<string, string>;
  removeJobIds?: string[];
  addJobs?: {
    id: string;
    title: string;
    updatedAt: string;
    firstPublished: string;
    absoluteUrl: string;
    locationName: string;
  }[];
}

export interface FeedFixtureServer {
  url: string;
  stop: () => void;
  stats: () => FixtureStats;
  setNotFound: (ats: Ats, tokens: string[]) => void;
  setDelayMs: (delayMs: number) => void;
  nextRequest: () => Promise<string>;
  mutateBoard: (ats: Ats, token: string, mutation: BoardMutation) => void;
  seedBoard: (ats: Ats, token: string, spec: BulkBoardSpec) => void;
  jobs: (ats: Ats, token: string) => FixtureJob[];
}

interface MutableGreenhouseJob {
  id: number | string;
  title: string;
  absoluteUrl: string;
  locationName: string;
  updatedAt: string;
  firstPublished: string;
  language: string;
  internalJobId: number | null;
  requisitionId: string | null;
  payInputRanges: {
    min_cents: number | null;
    max_cents: number | null;
    currency_type: string | null;
    interval: string | null;
  }[];
  content: string | null;
  departments: { name: string | null }[];
}

interface MutableLeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl: string | null;
  createdAt: number;
  workplaceType: string | null;
  categories: {
    location: string | null;
    allLocations: string[];
    department: string | null;
    team: string | null;
    commitment: string | null;
  };
  description: string | null;
  descriptionPlain: string | null;
  lists: { text: string | null; content: string | null }[];
  additionalPlain: string | null;
}

interface MutableAshbyJob {
  id: string;
  title: string;
  location: string | null;
  secondaryLocations: { location: string | null }[];
  jobUrl: string;
  applyUrl: string | null;
  publishedAt: number | string | null;
  isListed: boolean | null;
  isRemote: boolean | null;
  workplaceType: string | null;
  employmentType: string | null;
  department: string | null;
  team: string | null;
  descriptionPlain: string | null;
  descriptionHtml: string | null;
  compensation: unknown;
}

export interface SyntheticBoardSpec {
  jobCount: number;
  descriptionKb: number;
}

export interface ReplayedBoardSpec {
  jobCount: number;
  sourceToken: string;
}

export type BulkBoardSpec = SyntheticBoardSpec | ReplayedBoardSpec;

export interface FixtureJob {
  atsJobId: string;
  title: string;
  url: string;
  sourceUpdatedAt: string | null;
  descriptionText: string;
}

const BULK_TITLES = [
  "Senior Backend Engineer",
  "Staff Data Engineer",
  "Principal Product Designer",
  "Engineering Manager, Platform",
  "Machine Learning Engineer",
  "Security Engineer",
  "Site Reliability Engineer",
  "Technical Program Manager",
  "Senior Frontend Engineer",
  "Customer Success Manager",
] as const;

const BULK_LOCATIONS = [
  "Berlin, Germany",
  "Remote - Germany",
  "London, United Kingdom",
  "Toronto, Canada",
] as const;

const BULK_UPDATED_AT = "2026-11-01T09:00:00Z";
const BULK_FIRST_PUBLISHED = "2026-10-01T09:00:00Z";

function pick<T>(values: readonly [T, ...T[]], index: number) {
  return values[index % values.length] ?? values[0];
}

function bulkHtml(kb: number, seed: number) {
  const paragraph = `<p>Role ${String(seed)}: we are building thoughtful software with care, and we would like you to help us ship it to real users who depend on it daily, with rigor and kindness.</p><ul><li>Ship &amp; own services</li><li>Mentor &amp; review code</li><li>Work with product &amp; design</li></ul>`;

  return paragraph.repeat(Math.ceil((kb * 1024) / paragraph.length));
}

function bulkPlain(kb: number, seed: number) {
  const paragraph = `Role ${String(seed)}: we are building thoughtful software with care, and we would like you to help us ship it to real users who depend on it daily, with rigor and kindness. The salary range is $120,000 - $150,000 per year depending on experience.`;

  return paragraph.repeat(Math.ceil((kb * 1024) / paragraph.length));
}

function bulkGreenhouseJobs(token: string, spec: SyntheticBoardSpec) {
  return Array.from({ length: spec.jobCount }, (_unused, index) => ({
    id: `gh-${token}-${String(index)}`,
    title: pick(BULK_TITLES, index),
    absoluteUrl: `https://boards.example.com/${token}/jobs/${String(index)}`,
    locationName: pick(BULK_LOCATIONS, index),
    updatedAt: BULK_UPDATED_AT,
    firstPublished: BULK_FIRST_PUBLISHED,
    language: "en",
    internalJobId: 5_000_000_000 + index,
    requisitionId: null,
    payInputRanges: [],
    content: bulkHtml(spec.descriptionKb, index),
    departments: [{ name: "Engineering" }],
  }));
}

function replayedGreenhouseJobs(
  token: string,
  source: MutableGreenhouseJob[],
  spec: ReplayedBoardSpec,
) {
  return Array.from({ length: spec.jobCount }, (_unused, index) => {
    const template = source[index % source.length];

    if (template === undefined) {
      throw new Error(`the ${spec.sourceToken} fixture has no recorded jobs`);
    }

    return {
      id: `gh-${token}-${String(index)}`,
      title: template.title,
      absoluteUrl: `https://boards.example.com/${token}/jobs/${String(index)}`,
      locationName: template.locationName,
      updatedAt: template.updatedAt,
      firstPublished: template.firstPublished,
      language: template.language,
      internalJobId: template.internalJobId,
      requisitionId: template.requisitionId,
      payInputRanges: template.payInputRanges,
      content: template.content,
      departments: template.departments,
    };
  });
}

function bulkLeverJobs(token: string, spec: SyntheticBoardSpec) {
  return Array.from({ length: spec.jobCount }, (_unused, index) => {
    const location = pick(BULK_LOCATIONS, index);

    return {
      id: `lv-${token}-${String(index)}`,
      text: pick(BULK_TITLES, index),
      hostedUrl: `https://jobs.example.com/${token}/lv-${String(index)}`,
      applyUrl: `https://jobs.example.com/${token}/lv-${String(index)}/apply`,
      createdAt: Date.parse(BULK_FIRST_PUBLISHED),
      workplaceType: "onsite",
      categories: {
        location,
        allLocations: [location],
        department: "Engineering",
        team: null,
        commitment: "Full-time",
      },
      description: null,
      descriptionPlain: bulkPlain(spec.descriptionKb, index),
      lists: [],
      additionalPlain: null,
    };
  });
}

function bulkAshbyJobs(token: string, spec: SyntheticBoardSpec) {
  return Array.from({ length: spec.jobCount }, (_unused, index) => ({
    id: `ash-${token}-${String(index)}`,
    title: pick(BULK_TITLES, index),
    location: pick(BULK_LOCATIONS, index),
    secondaryLocations: [],
    jobUrl: `https://jobs.ashbyhq.com/${token}/ash-${String(index)}`,
    applyUrl: `https://jobs.ashbyhq.com/${token}/ash-${String(index)}/application`,
    publishedAt: Date.parse(BULK_FIRST_PUBLISHED),
    isListed: true,
    isRemote: false,
    workplaceType: "onsite",
    employmentType: "FullTime",
    department: "Engineering",
    team: null,
    descriptionPlain: bulkPlain(spec.descriptionKb, index),
    descriptionHtml: null,
    compensation: null,
  }));
}

function ifNoneMatchFrom(header: string | string[] | undefined) {
  return ifNoneMatchSchema.parse(header);
}

function hashBody(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function responseDelayMs(delayMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function newAtsTracker() {
  const arrivalGapsMs: number[] = [];
  const arrivals: number[] = [];

  return { requestCount: 0, maxInFlight: 0, arrivalGapsMs, arrivals };
}

function readBoardFile<T>(root: string, token: string, schema: z.ZodType<T>) {
  const raw: unknown = JSON.parse(
    readFileSync(join(process.cwd(), root, token, "board.json"), "utf8"),
  );

  return schema.parse(raw);
}

function loadDirectories(root: string) {
  return readdirSync(join(process.cwd(), root), { withFileTypes: true }).filter((entry) =>
    entry.isDirectory(),
  );
}

const LEVER_EU_FIXTURE_ROOT = "test/e2e/fixtures/lever-eu";

function readGreenhouseBoard(token: string) {
  const root = "test/e2e/fixtures/greenhouse";
  const contentPath = join(process.cwd(), root, token, "content.json");
  const boardPath = join(process.cwd(), root, token, "board.json");
  const file = existsSync(contentPath) ? contentPath : boardPath;

  return greenhouseBoardSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

function loadGreenhouseQuestions() {
  const byPosting = new Map<string, unknown>();

  for (const entry of loadDirectories("test/e2e/fixtures/greenhouse")) {
    const jobsDirectory = join("test/e2e/fixtures/greenhouse", entry.name, "jobs");

    if (!existsSync(jobsDirectory)) {
      continue;
    }

    for (const file of readdirSync(jobsDirectory)) {
      if (!file.endsWith(".questions.json")) {
        continue;
      }

      const parsed = recordedQuestionsSchema.parse(
        JSON.parse(readFileSync(join(jobsDirectory, file), "utf8")),
      );

      byPosting.set(`${entry.name}/${String(parsed.id)}`, parsed);
    }
  }

  return byPosting;
}

function loadGreenhouseBoards() {
  const boards = new Map<string, MutableGreenhouseJob[]>();

  for (const entry of loadDirectories("test/e2e/fixtures/greenhouse")) {
    const parsed = readGreenhouseBoard(entry.name);

    boards.set(
      entry.name,
      parsed.jobs.map((job) => ({
        id: job.id,
        title: job.title,
        absoluteUrl: job.absolute_url,
        locationName: job.location?.name ?? "",
        updatedAt: job.updated_at,
        firstPublished: job.first_published,
        language: job.language,
        internalJobId: job.internal_job_id ?? null,
        requisitionId: job.requisition_id ?? null,
        payInputRanges: (job.pay_input_ranges ?? []).map((range) => ({
          min_cents: range.min_cents ?? null,
          max_cents: range.max_cents ?? null,
          currency_type: range.currency_type ?? null,
          interval: range.interval ?? null,
        })),
        content: job.content ?? null,
        departments: (job.departments ?? []).map((department) => ({
          name: department.name ?? null,
        })),
      })),
    );
  }

  return boards;
}

function loadLeverBoards(root: string) {
  const boards = new Map<string, MutableLeverJob[]>();

  for (const entry of loadDirectories(root)) {
    const parsed = readBoardFile(root, entry.name, leverBoardSchema);

    boards.set(
      entry.name,
      parsed.jobs.map((job) => ({
        id: job.id,
        text: job.text,
        hostedUrl: job.hostedUrl,
        applyUrl: job.applyUrl ?? null,
        createdAt: job.createdAt,
        workplaceType: job.workplaceType ?? null,
        categories: {
          location: job.categories?.location ?? null,
          allLocations: (job.categories?.allLocations ?? []).filter(
            (value): value is string => value !== null && value !== undefined,
          ),
          department: job.categories?.department ?? null,
          team: job.categories?.team ?? null,
          commitment: job.categories?.commitment ?? null,
        },
        description: job.description ?? null,
        descriptionPlain: job.descriptionPlain ?? null,
        lists: (job.lists ?? []).map((list) => ({
          text: list.text ?? null,
          content: list.content ?? null,
        })),
        additionalPlain: job.additionalPlain ?? null,
      })),
    );
  }

  return boards;
}

function loadAshbyBoards() {
  const boards = new Map<string, MutableAshbyJob[]>();

  for (const entry of loadDirectories("test/e2e/fixtures/ashby")) {
    const parsed = readBoardFile("test/e2e/fixtures/ashby", entry.name, ashbyBoardSchema);

    boards.set(
      entry.name,
      parsed.jobs.map((job) => ({
        id: job.id,
        title: job.title,
        location: job.location ?? null,
        secondaryLocations: (job.secondaryLocations ?? []).map((secondary) => ({
          location: secondary.location ?? null,
        })),
        jobUrl: job.jobUrl,
        applyUrl: job.applyUrl ?? null,
        publishedAt: job.publishedAt ?? null,
        isListed: job.isListed ?? null,
        isRemote: job.isRemote ?? null,
        workplaceType: job.workplaceType ?? null,
        employmentType: job.employmentType ?? null,
        department: job.department ?? null,
        team: job.team ?? null,
        descriptionPlain: job.descriptionPlain ?? null,
        descriptionHtml: job.descriptionHtml ?? null,
        compensation: job.compensation ?? null,
      })),
    );
  }

  return boards;
}

function serializeGreenhouseJob(job: MutableGreenhouseJob, wantsContent: boolean) {
  const base = {
    id: job.id,
    title: job.title,
    absolute_url: job.absoluteUrl,
    location: { name: job.locationName },
    updated_at: job.updatedAt,
    first_published: job.firstPublished,
    language: job.language,
    internal_job_id: job.internalJobId,
    requisition_id: job.requisitionId,
  };

  if (wantsContent) {
    return { ...base, content: job.content, departments: job.departments };
  }

  return base;
}

function serializeLeverJob(job: MutableLeverJob) {
  return {
    id: job.id,
    text: job.text,
    hostedUrl: job.hostedUrl,
    applyUrl: job.applyUrl,
    createdAt: job.createdAt,
    workplaceType: job.workplaceType,
    categories: {
      location: job.categories.location,
      allLocations: job.categories.allLocations,
      department: job.categories.department,
      team: job.categories.team,
      commitment: job.categories.commitment,
    },
    description: job.description,
    descriptionPlain: job.descriptionPlain,
    lists: job.lists,
    additionalPlain: job.additionalPlain,
  };
}

function serializeAshbyJob(job: MutableAshbyJob) {
  return {
    id: job.id,
    title: job.title,
    location: job.location,
    secondaryLocations: job.secondaryLocations,
    jobUrl: job.jobUrl,
    applyUrl: job.applyUrl,
    publishedAt: job.publishedAt,
    isListed: job.isListed,
    isRemote: job.isRemote,
    workplaceType: job.workplaceType,
    employmentType: job.employmentType,
    department: job.department,
    team: job.team,
    descriptionPlain: job.descriptionPlain,
    descriptionHtml: job.descriptionHtml,
    compensation: job.compensation,
  };
}

function snapshotAts(stats: {
  requestCount: number;
  maxInFlight: number;
  arrivalGapsMs: number[];
  arrivals: number[];
}) {
  return {
    requestCount: stats.requestCount,
    maxInFlight: stats.maxInFlight,
    arrivalGapsMs: stats.arrivalGapsMs,
  };
}

export async function startFeedFixtureServer() {
  const greenhouseBoards = loadGreenhouseBoards();
  const greenhouseQuestions = loadGreenhouseQuestions();
  const leverBoards = loadLeverBoards("test/e2e/fixtures/lever");
  const leverEuBoards = loadLeverBoards(LEVER_EU_FIXTURE_ROOT);
  const ashbyBoards = loadAshbyBoards();
  const removedJobIds = new Set<string>();

  const notFoundTokens = new Map<Ats, Set<string>>([
    ["greenhouse", new Set<string>()],
    ["lever", new Set<string>()],
    ["ashby", new Set<string>()],
  ]);

  const state = { requestCount: 0, maxInFlight: 0, inFlight: 0, delayMs: 0 };
  const detailCounts: Record<string, number> = {};
  const arrivalTimes: number[] = [];
  const requestWaiters: ((path: string) => void)[] = [];

  const perAts = {
    greenhouse: newAtsTracker(),
    lever: newAtsTracker(),
    ashby: newAtsTracker(),
  };

  const paths: string[] = [];
  let questionsRequests = 0;
  const urls: string[] = [];

  function mutateGreenhouse(token: string, mutation: BoardMutation) {
    const existingGreenhouseJobs = greenhouseBoards.get(token);
    const jobs = existingGreenhouseJobs ?? [];
    greenhouseBoards.set(token, jobs);

    for (const job of jobs) {
      const title = mutation.titleUpdates?.[String(job.id)];

      if (title !== undefined) {
        job.title = title;
      }

      const locationName = mutation.locationUpdates?.[String(job.id)];

      if (locationName !== undefined) {
        job.locationName = locationName;
      }

      const updatedAt = mutation.updatedAtUpdates?.[String(job.id)];

      if (updatedAt !== undefined) {
        job.updatedAt = updatedAt;
      }
    }

    for (const jobId of mutation.removeJobIds ?? []) {
      removedJobIds.add(`greenhouse/${token}/${jobId}`);
    }

    for (const added of mutation.addJobs ?? []) {
      jobs.push({
        id: added.id,
        title: added.title,
        absoluteUrl: added.absoluteUrl,
        locationName: added.locationName,
        updatedAt: added.updatedAt,
        firstPublished: added.firstPublished,
        language: "en",
        internalJobId: 9_000_000 + jobs.length,
        requisitionId: null,
        payInputRanges: [],
        content: null,
        departments: [],
      });
    }
  }

  function mutateLever(token: string, mutation: BoardMutation) {
    const existingLeverJobs = leverBoards.get(token);
    const jobs = existingLeverJobs ?? [];
    leverBoards.set(token, jobs);

    for (const job of jobs) {
      const title = mutation.titleUpdates?.[job.id];

      if (title !== undefined) {
        job.text = title;
      }

      const location = mutation.locationUpdates?.[job.id];

      if (location !== undefined) {
        job.categories.location = location;
        job.categories.allLocations = [];
      }

      const description = mutation.descriptionUpdates?.[job.id];

      if (description !== undefined) {
        job.descriptionPlain = description;
      }
    }

    for (const jobId of mutation.removeJobIds ?? []) {
      removedJobIds.add(`lever/${token}/${jobId}`);
    }

    for (const added of mutation.addJobs ?? []) {
      jobs.push({
        id: added.id,
        text: added.title,
        hostedUrl: added.absoluteUrl,
        applyUrl: null,
        createdAt: Date.parse(added.firstPublished),
        workplaceType: "onsite",
        categories: {
          location: added.locationName,
          allLocations: [added.locationName],
          department: null,
          team: null,
          commitment: null,
        },
        description: null,
        descriptionPlain: null,
        lists: [],
        additionalPlain: null,
      });
    }
  }

  function mutateAshby(token: string, mutation: BoardMutation) {
    const existingAshbyJobs = ashbyBoards.get(token);
    const jobs = existingAshbyJobs ?? [];
    ashbyBoards.set(token, jobs);

    for (const job of jobs) {
      const title = mutation.titleUpdates?.[job.id];

      if (title !== undefined) {
        job.title = title;
      }

      const location = mutation.locationUpdates?.[job.id];

      if (location !== undefined) {
        job.location = location;
      }

      const description = mutation.descriptionUpdates?.[job.id];

      if (description !== undefined) {
        job.descriptionPlain = description;
      }
    }

    for (const jobId of mutation.removeJobIds ?? []) {
      removedJobIds.add(`ashby/${token}/${jobId}`);
    }

    for (const added of mutation.addJobs ?? []) {
      jobs.push({
        id: added.id,
        title: added.title,
        location: added.locationName,
        secondaryLocations: [],
        jobUrl: added.absoluteUrl,
        applyUrl: null,
        publishedAt: added.firstPublished,
        isListed: true,
        isRemote: false,
        workplaceType: "onsite",
        employmentType: null,
        department: null,
        team: null,
        descriptionPlain: null,
        descriptionHtml: null,
        compensation: null,
      });
    }
  }

  async function handleRequest(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const { pathname, search } = url;
    const wantsQuestions = url.searchParams.get("questions") === "true";
    const route = routeFor(pathname);

    if (route === null) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "unknown path" }));

      return;
    }

    const { ats } = route;
    const now = performance.now();

    state.requestCount += 1;
    state.inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    arrivalTimes.push(now);
    paths.push(`${pathname}${search}`);
    urls.push(request.url ?? pathname);

    requestWaiters.shift()?.(pathname);

    const atsStats = perAts[ats];
    atsStats.requestCount += 1;

    const previousArrival = atsStats.arrivals.at(-1);

    if (previousArrival !== undefined) {
      atsStats.arrivalGapsMs.push(now - previousArrival);
    }

    atsStats.arrivals.push(now);

    const finish = (status: number, body: string, headers: Record<string, string> = {}) => {
      response.writeHead(status, { "content-type": "application/json", ...headers });
      response.end(body);
      state.inFlight -= 1;
    };

    await responseDelayMs(state.delayMs);

    if (route.name === "greenhouse-list") {
      const { token } = route;

      if (notFoundTokens.get("greenhouse")?.has(token)) {
        finish(404, JSON.stringify({ error: "board not found" }));

        return;
      }

      const jobs = (greenhouseBoards.get(token) ?? []).filter(
        (job) => !removedJobIds.has(`greenhouse/${token}/${String(job.id)}`),
      );

      const wantsContent = url.searchParams.get("content") === "true";

      const body = JSON.stringify({
        jobs: jobs.map((job) => serializeGreenhouseJob(job, wantsContent)),
      });

      const etag = `"${hashBody(body)}"`;

      const ifNoneMatch = ifNoneMatchFrom(request.headers["if-none-match"]);

      if (ifNoneMatch === etag) {
        finish(304, "");

        return;
      }

      finish(200, body, { etag });

      return;
    }

    if (route.name === "greenhouse-job") {
      const { token, jobId } = route;

      if (wantsQuestions) {
        questionsRequests += 1;

        const recorded = greenhouseQuestions.get(`${token}/${jobId}`);

        finish(200, JSON.stringify(recorded ?? { id: jobId, questions: [] }));

        return;
      }

      if (notFoundTokens.get("greenhouse")?.has(token)) {
        finish(404, JSON.stringify({ error: "board not found" }));

        return;
      }

      const job = (greenhouseBoards.get(token) ?? []).find(
        (candidate) => String(candidate.id) === jobId,
      );

      if (job === undefined || removedJobIds.has(`greenhouse/${token}/${jobId}`)) {
        finish(404, JSON.stringify({ error: "job not found" }));

        return;
      }

      detailCounts[`${token}/${jobId}`] = (detailCounts[`${token}/${jobId}`] ?? 0) + 1;
      finish(
        200,
        JSON.stringify({
          ...job,
          internal_job_id: job.internalJobId,
          requisition_id: job.requisitionId,
          pay_input_ranges: job.payInputRanges,
          content: job.content,
          departments: job.departments,
          location: { name: job.locationName },
        }),
      );

      return;
    }

    if (route.name === "lever-list") {
      const { token } = route;

      if (notFoundTokens.get("lever")?.has(token)) {
        finish(404, JSON.stringify({ error: "board not found" }));

        return;
      }

      const allJobs =
        (route.region === "eu" ? leverEuBoards.get(token) : leverBoards.get(token)) ?? [];

      const jobs = allJobs.filter((job) => !removedJobIds.has(`lever/${token}/${job.id}`));
      const { searchParams } = new URL(request.url ?? "/", "http://127.0.0.1");
      const { limit: limitParam, skip: skipParam } = Object.fromEntries(searchParams);
      const limit = Number(limitParam ?? jobs.length);
      const skip = Number(skipParam ?? 0);
      const page = jobs.slice(skip, skip + limit);

      finish(200, JSON.stringify(page.map((job) => serializeLeverJob(job))));

      return;
    }

    const { token } = route;

    if (notFoundTokens.get("ashby")?.has(token)) {
      finish(404, JSON.stringify({ error: "board not found" }));

      return;
    }

    const jobs = (ashbyBoards.get(token) ?? []).filter(
      (job) => !removedJobIds.has(`ashby/${token}/${job.id}`),
    );

    finish(200, JSON.stringify({ jobs: jobs.map((job) => serializeAshbyJob(job)) }));
  }

  const server: Server = createServer((request, response) => {
    void handleRequest(request, response);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const port = z.object({ port: z.number() }).safeParse(address);

  if (!port.success) {
    server.close();

    throw new Error("the fixture server did not bind to a port");
  }

  return {
    url: `http://127.0.0.1:${String(port.data.port)}`,
    stop: () => {
      server.close();
    },
    stats: () => ({
      requestCount: state.requestCount,
      maxInFlight: state.maxInFlight,
      arrivalGapsMs: arrivalTimes.slice(1).map((time, index) => time - (arrivalTimes[index] ?? 0)),
      paths: [...paths],
      urls: [...urls],
      detailCounts: { ...detailCounts },
      questionsRequests,
      perAts: {
        greenhouse: snapshotAts(perAts.greenhouse),
        lever: snapshotAts(perAts.lever),
        ashby: snapshotAts(perAts.ashby),
      },
    }),
    setNotFound: (ats, tokens) => {
      for (const token of tokens) {
        notFoundTokens.get(ats)?.add(token);
      }
    },
    setDelayMs: (delayMs) => {
      state.delayMs = delayMs;
    },
    nextRequest: async () =>
      new Promise((resolve) => {
        requestWaiters.push(resolve);
      }),
    mutateBoard: (ats, token, mutation) => {
      if (ats === "greenhouse") {
        mutateGreenhouse(token, mutation);
      }

      if (ats === "lever") {
        mutateLever(token, mutation);
      }

      if (ats === "ashby") {
        mutateAshby(token, mutation);
      }
    },
    seedBoard: (ats, token, spec) => {
      if (ats === "greenhouse") {
        if ("sourceToken" in spec) {
          greenhouseBoards.set(
            token,
            replayedGreenhouseJobs(token, greenhouseBoards.get(spec.sourceToken) ?? [], spec),
          );
        } else {
          greenhouseBoards.set(token, bulkGreenhouseJobs(token, spec));
        }
      }

      if (ats === "lever" && !("sourceToken" in spec)) {
        leverBoards.set(token, bulkLeverJobs(token, spec));
      }

      if (ats === "ashby" && !("sourceToken" in spec)) {
        ashbyBoards.set(token, bulkAshbyJobs(token, spec));
      }
    },
    jobs: (ats, token) => {
      if (ats === "greenhouse") {
        return (greenhouseBoards.get(token) ?? []).map((job) => ({
          atsJobId: String(job.id),
          title: job.title,
          url: job.absoluteUrl,
          sourceUpdatedAt: job.updatedAt,
          descriptionText: job.content ?? "",
        }));
      }

      if (ats === "lever") {
        return (leverBoards.get(token) ?? []).map((job) => ({
          atsJobId: job.id,
          title: job.text,
          url: job.hostedUrl,
          sourceUpdatedAt: null,
          descriptionText: job.descriptionPlain ?? "",
        }));
      }

      return (ashbyBoards.get(token) ?? []).map((job) => ({
        atsJobId: job.id,
        title: job.title,
        url: job.jobUrl,
        sourceUpdatedAt: null,
        descriptionText: job.descriptionPlain ?? "",
      }));
    },
  } satisfies FeedFixtureServer;
}

const GREENHOUSE_BOARD_RE = /^\/v1\/boards\/(?<token>[A-Za-z0-9_-]+)\/jobs$/u;

const GREENHOUSE_JOB_RE =
  /^\/v1\/boards\/(?<token>[A-Za-z0-9_-]+)\/jobs\/(?<jobId>[A-Za-z0-9_-]+)$/u;

const LEVER_BOARD_RE = /^\/v0\/postings\/(?<token>[A-Za-z0-9_-]+)$/u;
const ASHBY_BOARD_RE = /^\/posting-api\/job-board\/(?<token>[A-Za-z0-9_-]+)$/u;

function routeFor(rawPathname: string) {
  const region = rawPathname.startsWith("/eu/") ? "eu" : "us";
  const pathname = region === "eu" ? rawPathname.slice(3) : rawPathname;
  const boardMatch = GREENHOUSE_BOARD_RE.exec(pathname);

  if (boardMatch?.groups !== undefined) {
    return {
      name: "greenhouse-list",
      ats: "greenhouse",
      token: boardMatch.groups.token ?? "",
    } as const;
  }

  const jobMatch = GREENHOUSE_JOB_RE.exec(pathname);

  if (jobMatch?.groups !== undefined) {
    return {
      name: "greenhouse-job",
      ats: "greenhouse",
      token: jobMatch.groups.token ?? "",
      jobId: jobMatch.groups.jobId ?? "",
    } as const;
  }

  const leverMatch = LEVER_BOARD_RE.exec(pathname);

  if (leverMatch?.groups !== undefined) {
    return {
      name: "lever-list",
      ats: "lever",
      region,
      token: leverMatch.groups.token ?? "",
    } as const;
  }

  const ashbyMatch = ASHBY_BOARD_RE.exec(pathname);

  if (ashbyMatch?.groups !== undefined) {
    return { name: "ashby-list", ats: "ashby", token: ashbyMatch.groups.token ?? "" } as const;
  }

  return null;
}
