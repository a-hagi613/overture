import { z } from "zod";

import { contentHash } from "./content-hash.ts";
import {
  isoFromTimestamp,
  joinDistinctLocations,
  FeedError,
  UNCONDITIONAL_FETCHER,
} from "./board-feed.ts";
import { limiterFor } from "./rate-limiter.ts";

import type {
  BoardCondition,
  BoardFeed,
  FeedContent,
  FeedPosting,
  UnconditionalFetcher,
} from "./board-feed.ts";

const stringField = z
  .string()
  .nullish()
  .transform((value) => value ?? "");

export const ASHBY_DEFAULT_BASE_URL = "https://api.ashbyhq.com";

export const ASHBY_LIMITS = { maxConcurrent: 4, minIntervalMs: 500 } as const;

const BOARD_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;

const jobSchema = z.object({
  id: z.string(),
  title: stringField,
  location: z.string().nullish(),
  secondaryLocations: z.array(z.object({ location: z.string().nullish() })).nullish(),
  jobUrl: stringField,
  publishedAt: z.union([z.number(), z.string()]).nullish(),
  isListed: z.boolean().nullish(),
  department: z.string().nullish(),
  team: z.string().nullish(),
  descriptionPlain: z.string().nullish(),
  descriptionHtml: z.string().nullish(),
});

const boardSchema = z.object({ jobs: z.array(jobSchema).default([]) });

export function createAshbyFeed(
  baseUrl: string = ASHBY_DEFAULT_BASE_URL,
  fetcher: UnconditionalFetcher = UNCONDITIONAL_FETCHER,
) {
  const limiter = limiterFor("ashby", ASHBY_LIMITS);

  const assertToken = (boardToken: string) => {
    if (!BOARD_TOKEN_RE.test(boardToken)) {
      throw new FeedError(400, `${baseUrl}/posting-api/job-board/${boardToken}`);
    }
  };

  const fetchBoard = async (boardToken: string, condition: BoardCondition) => {
    assertToken(boardToken);
    void condition;

    const url = `${baseUrl}/posting-api/job-board/${boardToken}?includeCompensation=true`;
    const response = await limiter.run(async () => fetcher(url));

    if (response.status === 404) {
      return { status: "gone" } as const;
    }

    const parsed = boardSchema.parse(response.json);

    const postings: FeedPosting[] = parsed.jobs
      .filter((job) => job.jobUrl !== "" && job.isListed !== false)
      .map((job) => {
        const content: FeedContent = {
          descriptionText: job.descriptionPlain?.trim() || null,
          department: job.department?.trim() || null,
          locationRaw: null,
        };

        return {
          atsJobId: job.id,
          title: job.title,
          url: job.jobUrl,
          locationRaw: joinDistinctLocations([
            job.location ?? null,
            ...(job.secondaryLocations ?? []).map((secondary) => secondary.location),
          ]),
          language: null,
          postedAt: isoFromTimestamp(job.publishedAt),
          sourceUpdatedAt: null,
          descriptionPending: false,
          content,
        };
      });

    return {
      status: "ok",
      postings,
      etag: null,
      bodyHash: contentHash(JSON.stringify(response.json)),
    } as const;
  };

  return { fetchBoard } satisfies BoardFeed;
}
