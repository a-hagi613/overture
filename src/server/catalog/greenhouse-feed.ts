import { z } from "zod";

import { contentHash } from "./content-hash.ts";
import { FeedError } from "./board-feed.ts";
import { htmlToText } from "./html-to-text.ts";
import { limiterFor } from "./rate-limiter.ts";

import type { BoardCondition, BoardFeed, FeedResponse, FeedPosting } from "./board-feed.ts";

export const GREENHOUSE_DEFAULT_BASE_URL = "https://boards-api.greenhouse.io";

export const GREENHOUSE_LIMITS = { maxConcurrent: 4, minIntervalMs: 500 } as const;

const BOARD_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;

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

const contentJobSchema = jobSchema.extend({
  content: z.string().nullish(),
  departments: z.array(z.object({ name: z.string().nullish() })).nullish(),
});

const contentResponseSchema = z.object({ jobs: z.array(contentJobSchema) });

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

  const fetchBoard = async (boardToken: string, condition: BoardCondition) => {
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

    const postings: FeedPosting[] = parsed.jobs.map((job) => ({
      atsJobId: job.id,
      title: job.title,
      url: job.absolute_url ?? "",
      locationRaw: job.location?.name ?? null,
      language: job.language ?? null,
      postedAt: job.first_published ?? null,
      sourceUpdatedAt: job.updated_at ?? null,
      descriptionPending: true,
      content: null,
    }));

    return {
      status: "ok",
      postings,
      etag: response.etag,
      bodyHash: contentHash(JSON.stringify(response.json)),
    } as const;
  };

  const fetchBoardContent = async (boardToken: string) => {
    assertToken(boardToken);

    const url = `${baseUrl}/v1/boards/${boardToken}/jobs?content=true`;
    const response = await limiter.run(async () => fetcher(url, { ifNoneMatch: null }));

    if (response.status === 304) {
      return { status: "not_modified" } as const;
    }

    if (response.status === 404) {
      return { status: "gone" } as const;
    }

    const parsed = contentResponseSchema.parse(response.json);

    const postings: FeedPosting[] = parsed.jobs.map((job) => ({
      atsJobId: job.id,
      title: job.title,
      url: job.absolute_url ?? "",
      locationRaw: job.location?.name ?? null,
      language: job.language ?? null,
      postedAt: job.first_published ?? null,
      sourceUpdatedAt: job.updated_at ?? null,
      descriptionPending: false,
      content: {
        descriptionText: htmlToText(job.content ?? null),
        department: job.departments?.[0]?.name ?? null,
        locationRaw: job.location?.name ?? null,
      },
    }));

    return {
      status: "ok",
      postings,
      etag: null,
      bodyHash: contentHash(JSON.stringify(response.json)),
    } as const;
  };

  const fetchPostingDetail = async (boardToken: string, atsJobId: string) => {
    assertToken(boardToken);

    const url = `${baseUrl}/v1/boards/${boardToken}/jobs/${atsJobId}?content=true`;

    try {
      const response = await limiter.run(async () => fetcher(url, { ifNoneMatch: null }));

      if (response.status === 404) {
        return {
          descriptionText: null,
          department: null,
          locationRaw: null,
        };
      }

      const parsed = detailResponseSchema.parse(response.json);

      return {
        descriptionText: htmlToText(parsed.content ?? null),
        department: parsed.departments?.[0]?.name ?? null,
        locationRaw: parsed.location?.name ?? null,
      };
    } catch (error) {
      if (error instanceof FeedError && error.status === 404) {
        return {
          descriptionText: null,
          department: null,
          locationRaw: null,
        };
      }

      throw error;
    }
  };

  return { fetchBoard, fetchBoardContent, fetchPostingDetail } satisfies BoardFeed;
}
