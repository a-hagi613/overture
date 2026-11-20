import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
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
  detailCounts: Record<string, number>;
  perAts: Record<Ats, AtsStats>;
}

export interface BoardMutation {
  titleUpdates?: Record<string, string>;
  locationUpdates?: Record<string, string>;
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
}

interface MutableGreenhouseJob {
  id: number | string;
  title: string;
  absoluteUrl: string;
  locationName: string;
  updatedAt: string;
  firstPublished: string;
  language: string;
  content: string | null;
  departments: { name: string | null }[];
}

interface MutableLeverJob {
  id: string;
  text: string;
  hostedUrl: string;
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

function loadGreenhouseBoards() {
  const boards = new Map<string, MutableGreenhouseJob[]>();

  for (const entry of loadDirectories("test/e2e/fixtures/greenhouse")) {
    const parsed = readBoardFile("test/e2e/fixtures/greenhouse", entry.name, greenhouseBoardSchema);

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
        content: job.content ?? null,
        departments: (job.departments ?? []).map((department) => ({
          name: department.name ?? null,
        })),
      })),
    );
  }

  return boards;
}

function loadLeverBoards() {
  const boards = new Map<string, MutableLeverJob[]>();

  for (const entry of loadDirectories("test/e2e/fixtures/lever")) {
    const parsed = readBoardFile("test/e2e/fixtures/lever", entry.name, leverBoardSchema);

    boards.set(
      entry.name,
      parsed.jobs.map((job) => ({
        id: job.id,
        text: job.text,
        hostedUrl: job.hostedUrl,
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

function serializeLeverJob(job: MutableLeverJob) {
  return {
    id: job.id,
    text: job.text,
    hostedUrl: job.hostedUrl,
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
  const leverBoards = loadLeverBoards();
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
    }

    for (const jobId of mutation.removeJobIds ?? []) {
      removedJobIds.add(`lever/${token}/${jobId}`);
    }

    for (const added of mutation.addJobs ?? []) {
      jobs.push({
        id: added.id,
        text: added.title,
        hostedUrl: added.absoluteUrl,
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
    const { pathname } = new URL(request.url ?? "/", "http://127.0.0.1");
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
    paths.push(pathname);

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

      const body = JSON.stringify({
        jobs: jobs.map((job) => ({
          id: job.id,
          title: job.title,
          absolute_url: job.absoluteUrl,
          location: { name: job.locationName },
          updated_at: job.updatedAt,
          first_published: job.firstPublished,
          language: job.language,
          content: job.content,
          departments: job.departments,
        })),
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
      finish(200, JSON.stringify(job));

      return;
    }

    if (route.name === "lever-list") {
      const { token } = route;

      if (notFoundTokens.get("lever")?.has(token)) {
        finish(404, JSON.stringify({ error: "board not found" }));

        return;
      }

      const jobs = (leverBoards.get(token) ?? []).filter(
        (job) => !removedJobIds.has(`lever/${token}/${job.id}`),
      );

      finish(200, JSON.stringify(jobs.map((job) => serializeLeverJob(job))));

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
      detailCounts: { ...detailCounts },
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
  } satisfies FeedFixtureServer;
}

const GREENHOUSE_BOARD_RE = /^\/v1\/boards\/(?<token>[A-Za-z0-9_-]+)\/jobs$/u;

const GREENHOUSE_JOB_RE =
  /^\/v1\/boards\/(?<token>[A-Za-z0-9_-]+)\/jobs\/(?<jobId>[A-Za-z0-9_-]+)$/u;

const LEVER_BOARD_RE = /^\/v0\/postings\/(?<token>[A-Za-z0-9_-]+)$/u;
const ASHBY_BOARD_RE = /^\/posting-api\/job-board\/(?<token>[A-Za-z0-9_-]+)$/u;

function routeFor(pathname: string) {
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
    return { name: "lever-list", ats: "lever", token: leverMatch.groups.token ?? "" } as const;
  }

  const ashbyMatch = ASHBY_BOARD_RE.exec(pathname);

  if (ashbyMatch?.groups !== undefined) {
    return { name: "ashby-list", ats: "ashby", token: ashbyMatch.groups.token ?? "" } as const;
  }

  return null;
}
