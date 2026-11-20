import { createHash } from "node:crypto";

import { z } from "zod";

import { limiterFor } from "./rate-limiter.ts";

import type { RateLimiterOptions } from "./rate-limiter.ts";

export const GREENHOUSE_DEFAULT_BASE_URL = "https://boards-api.greenhouse.io";

const GREENHOUSE_LIMITS: RateLimiterOptions = { maxConcurrent: 4, minIntervalMs: 500 };

export class FeedError extends Error {
  readonly status: number;

  constructor(status: number, url: string) {
    super(`GET ${url} failed: ${String(status)}`);
    this.name = "FeedError";
    this.status = status;
  }
}

const jobSchema = z.object({
  id: z.number(),
  title: z.string(),
  absolute_url: z.string().nullish(),
  location: z.object({ name: z.string() }).nullish(),
  updated_at: z.string().nullish(),
  content: z.string().nullish(),
});

const listResponseSchema = z.object({ jobs: z.array(jobSchema) });

const detailResponseSchema = z.object({ content: z.string().nullish() });

export type FetchJson = (url: string) => Promise<unknown>;

export interface GreenhouseFeedJob {
  id: string;
  title: string;
  absoluteUrl: string | null;
  locationName: string | null;
  updatedAt: string | null;
}

export interface GreenhouseFeed {
  listJobs: (boardToken: string) => Promise<GreenhouseFeedJob[]>;
  fetchJobContent: (boardToken: string, jobId: string) => Promise<string | null>;
}

export function greenhouseFetchJson(): FetchJson {
  return async (url) => {
    const response = await fetch(url);

    if (!response.ok) {
      throw new FeedError(response.status, url);
    }

    return response.json();
  };
}

export function createGreenhouseFeed(
  baseUrl: string = GREENHOUSE_DEFAULT_BASE_URL,
  fetchJson: FetchJson = greenhouseFetchJson(),
): GreenhouseFeed {
  const limiter = limiterFor("greenhouse", GREENHOUSE_LIMITS);

  const fetchParsed = async <S extends z.ZodType>(schema: S, url: string): Promise<z.output<S>> => {
    const json = await limiter.run(async () => fetchJson(url));

    return schema.parse(json);
  };

  const listJobs = async (boardToken: string): Promise<GreenhouseFeedJob[]> => {
    const response = await fetchParsed(listResponseSchema, `${baseUrl}/v1/boards/${boardToken}/jobs`);

    return response.jobs.map((job) => ({
      id: String(job.id),
      title: job.title,
      absoluteUrl: job.absolute_url ?? null,
      locationName: job.location?.name ?? null,
      updatedAt: job.updated_at ?? null,
    }));
  };

  const fetchJobContent = async (boardToken: string, jobId: string): Promise<string | null> => {
    const response = await fetchParsed(
      detailResponseSchema,
      `${baseUrl}/v1/boards/${boardToken}/jobs/${jobId}`,
    );

    return response.content ?? null;
  };

  return {
    listJobs,
    fetchJobContent,
  } satisfies GreenhouseFeed;
}

export function contentHash(content: string) {
  return createHash("sha256").update(content).digest("hex");
}
