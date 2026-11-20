import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { z } from "zod";

const fixtureJobSchema = z.object({
  id: z.union([z.number(), z.string()]).transform(String),
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

const fixtureBoardSchema = z.object({ jobs: z.array(fixtureJobSchema).default([]) });

export interface FixtureStats {
  requestCount: number;
  maxInFlight: number;
  arrivalTimes: number[];
  paths: string[];
  detailCounts: Record<string, number>;
}

export interface BoardMutation {
  titleUpdates?: Record<string, string>;
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

export interface GreenhouseFixtureServer {
  url: string;
  stop: () => void;
  stats: () => FixtureStats;
  setNotFound: (tokens: string[]) => void;
  mutateBoard: (token: string, mutation: BoardMutation) => void;
}

interface MutableJob {
  id: string;
  title: string;
  absoluteUrl: string;
  locationName: string;
  updatedAt: string;
  firstPublished: string;
  language: string;
  content: string | null;
  departments: { name: string | null }[];
}

export type FixtureServer = GreenhouseFixtureServer;

function hashBody(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

const arrivalTimes: number[] = [];
const paths: string[] = [];

export function startGreenhouseFixtureServer(): GreenhouseFixtureServer {
  const boards = new Map<string, MutableJob[]>();
  const removedJobIds = new Set<string>();
  const notFoundTokens = new Set<string>();
  const detailCounts: Record<string, number> = {};
  const state = { requestCount: 0, maxInFlight: 0, inFlight: 0, delayMs: 0 };

  for (const entry of readdirSync(join(process.cwd(), "test/e2e/fixtures/greenhouse"), {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const parsed = fixtureBoardSchema.parse(
      JSON.parse(readFileSync(join(process.cwd(), "test/e2e/fixtures/greenhouse", entry.name, "board.json"), "utf8")),
    );
    const jobs = parsed.jobs.map((job) => ({
      id: job.id,
      title: job.title,
      absoluteUrl: job.absolute_url,
      locationName: job.location?.name ?? "",
      updatedAt: job.updated_at,
      firstPublished: job.first_published,
      language: job.language,
      content: job.content ?? null,
      departments: (job.departments ?? []).map((department) => ({ name: department?.name ?? null })),
    }));

    boards.set(entry.name, jobs);
  }

  const server: Server = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? "/", "http://127.0.0.1");
    const finish = (status: number, body: string, headers: Record<string, string> = {}) => {
      response.writeHead(status, { "content-type": "application/json", ...headers });
      response.end(body);
      state.inFlight -= 1;
    };

    state.requestCount += 1;
    state.inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    arrivalTimes.push(performance.now());
    paths.push(pathname);

    const boardMatch = /^\/v1\/boards\/(?<token>[A-Za-z0-9_-]+)\/jobs$/u.exec(pathname);

    if (boardMatch?.groups !== undefined) {
      const { token = "" } = boardMatch.groups;
      const jobs = (boards.get(token) ?? []).filter((job) => !removedJobIds.has(`${token}/${job.id}`));
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
      const ifNoneMatch = request.headers["if-none-match"];

      if (typeof ifNoneMatch === "string" && ifNoneMatch === etag) {
        finish(304, "");

        return;
      }

      finish(200, body, { etag });

      return;
    }

    const jobMatch = /^\/v1\/boards\/(?<token>[A-Za-z0-9_-]+)\/jobs\/(?<jobId>[A-Za-z0-9_-]+)$/u.exec(pathname);

    if (jobMatch?.groups === undefined) {
      finish(404, JSON.stringify({ error: "not found" }));

      return;
    }

    const jobId = jobMatch.groups.jobId ?? "";

    if (notFoundTokens.has(jobId)) {
      finish(404, JSON.stringify({ error: "not found" }));

      return;
    }

    const jobs = boards.get(jobMatch.groups.token ?? "") ?? [];
    const job = jobs.find((candidate) => candidate.id === jobId);

    if (job === undefined) {
      finish(404, JSON.stringify({ error: "not found" }));

      return;
    }

    detailCounts[jobId] = (detailCounts[jobId] ?? 0) + 1;
    finish(200, JSON.stringify(job));
  });

  void server.listen(0, "127.0.0.1");

  return {
    url: "",
    stop: () => {
      server.close();
    },
    stats: (): FixtureStats => ({
      requestCount: state.requestCount,
      maxInFlight: state.maxInFlight,
      arrivalTimes: [...arrivalTimes],
      paths: [...paths],
      detailCounts: { ...detailCounts },
    }),
    setNotFound: (tokens) => {
      for (const token of tokens) {
        notFoundTokens.add(token);
      }
    },
    mutateBoard: (token, mutation) => {
      const jobs = boards.get(token) ?? [];

      for (const job of jobs) {
        const title = mutation.titleUpdates?.[job.id];

        if (title !== undefined) {
          job.title = title;
        }

        const updatedAt = mutation.updatedAtUpdates?.[job.id];

        if (updatedAt !== undefined) {
          job.updatedAt = updatedAt;
        }
      }

      for (const jobId of mutation.removeJobIds ?? []) {
        removedJobIds.add(`${token}/${jobId}`);
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
    },
  } satisfies GreenhouseFixtureServer;
}
