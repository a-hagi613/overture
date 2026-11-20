import { z } from "zod";

import { contentHash } from "./content-hash.ts";
import { limiterFor } from "./rate-limiter.ts";

export const GREENHOUSE_DEFAULT_BASE_URL = "https://boards-api.greenhouse.io";

export const GREENHOUSE_LIMITS = { maxConcurrent: 4, minIntervalMs: 500 } as const;

const BOARD_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;

export interface FeedResponse {
  status: number;
  etag: string | null;
  json: unknown;
}

export class FeedError extends Error {
  readonly status: number;

  constructor(status: number, url: string) {
    super(`GET ${url} failed: ${String(status)}`);
    this.name = "FeedError";
    this.status = status;
  }
}

export interface BoardCondition {
  etag: string | null;
  bodyHash: string | null;
}

export interface GreenhouseFeedJob {
  id: string;
  title: string;
  absoluteUrl: string | null;
  locationName: string | null;
  updatedAt: string | null;
  firstPublished: string | null;
  language: string | null;
}

export interface GreenhouseJobDetail {
  contentHtml: string | null;
  department: string | null;
  locationName: string | null;
}

export type BoardListResult =
  | { status: "ok"; jobs: GreenhouseFeedJob[]; etag: string | null; bodyHash: string }
  | { status: "not_modified" }
  | { status: "gone" };

export interface GreenhouseFeed {
  fetchBoardList: (boardToken: string, condition: BoardCondition) => Promise<BoardListResult>;
  fetchJobDetail: (boardToken: string, jobId: string) => Promise<GreenhouseJobDetail>;
}

const jobSchema = z.object({
  id: z.union([z.number(), z.string()]).transform(String),
  title: z.string(),
  absolute_url: z.string().nullish(),
  location: z.object({ name: z.string().nullish() }).nullish(),
  updated_at: z.string().nullish(),
  first_published: z.string().nullish(),
  language: z.string().nullish(),
  company_name: z.string().nullish(),
});

const listResponseSchema = z.object({ jobs: z.array(jobSchema) });

const detailResponseSchema = z.object({
  content: z.string().nullish(),
  departments: z.array(z.object({ name: z.string().nullish() })).nullish(),
  location: z.object({ name: z.string().nullish() }).nullish(),
});

export type FeedFetcher = (
  url: string,
  request: { ifNoneMatch: string | null },
) => Promise<FeedResponse>;

const GREENHOUSE_FETCHER: FeedFetcher = async (url, request) => {
  const headers: Record<string, string> = {};

  if (request.ifNoneMatch !== null) {
    headers["if-none-match"] = request.ifNoneMatch;
  }

  const response = await fetch(url, { headers });
  const etag = response.headers.get("etag");

  if (response.status === 304) {
    return { status: 304, etag, json: null };
  }

  if (response.status === 404) {
    return { status: 404, etag, json: null };
  }

  if (!response.ok) {
    throw new FeedError(response.status, url);
  }

  return { status: response.status, etag, json: await response.json() };
};

export function greenhouseFetchFetcher() {
  return GREENHOUSE_FETCHER;
}

export function createGreenhouseFeed(
  baseUrl: string = GREENHOUSE_DEFAULT_BASE_URL,
  fetcher: FeedFetcher = GREENHOUSE_FETCHER,
) {
  const limiter = limiterFor("greenhouse", GREENHOUSE_LIMITS);

  const assertToken = (boardToken: string) => {
    if (!BOARD_TOKEN_RE.test(boardToken)) {
      throw new FeedError(400, `${baseUrl}/v1/boards/${boardToken}/jobs`);
    }
  };

  const fetchBoardList = async (boardToken: string, condition: BoardCondition) => {
    assertToken(boardToken);

    const url = `${baseUrl}/v1/boards/${boardToken}/jobs`;
    const response = await limiter.run(async () => fetcher(url, { ifNoneMatch: condition.etag }));

    if (response.status === 304) {
      return { status: "not_modified" } as const;
    }

    if (response.status === 404) {
      return { status: "gone" } as const;
    }

    const parsed = listResponseSchema.parse(response.json);

    const jobs: GreenhouseFeedJob[] = parsed.jobs.map((job) => ({
      id: job.id,
      title: job.title,
      absoluteUrl: job.absolute_url ?? null,
      locationName: job.location?.name ?? null,
      updatedAt: job.updated_at ?? null,
      firstPublished: job.first_published ?? null,
      language: job.language ?? null,
    }));

    return {
      status: "ok",
      jobs,
      etag: response.etag,
      bodyHash: contentHash(JSON.stringify(response.json)),
    } as const;
  };

  const fetchJobDetail = async (boardToken: string, jobId: string) => {
    assertToken(boardToken);

    const url = `${baseUrl}/v1/boards/${boardToken}/jobs/${jobId}?content=true`;

    try {
      const response = await limiter.run(async () => fetcher(url, { ifNoneMatch: null }));

      if (response.status === 404) {
        return { contentHtml: null, department: null, locationName: null };
      }

      const parsed = detailResponseSchema.parse(response.json);

      return {
        contentHtml: parsed.content ?? null,
        department: parsed.departments?.[0]?.name ?? null,
        locationName: parsed.location?.name ?? null,
      };
    } catch (error) {
      if (error instanceof FeedError && error.status === 404) {
        return { contentHtml: null, department: null, locationName: null };
      }

      throw error;
    }
  };

  return { fetchBoardList, fetchJobDetail } satisfies GreenhouseFeed;
}
