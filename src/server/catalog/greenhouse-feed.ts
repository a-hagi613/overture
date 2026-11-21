import { z } from "zod";

import { contentHash } from "./content-hash.ts";
import { FeedError } from "./board-feed.ts";
import { htmlToText } from "./html-to-text.ts";
import { limiterFor } from "./rate-limiter.ts";

import type {
  BoardCondition,
  BoardFeed,
  BoardRegion,
  FeedResponse,
  FeedPosting,
} from "./board-feed.ts";
import type { SalaryPeriod, SalaryRange } from "../../shared/tag-taxonomy.ts";

export const GREENHOUSE_DEFAULT_BASE_URL = "https://boards-api.greenhouse.io";

export const GREENHOUSE_LIMITS = { maxConcurrent: 4, minIntervalMs: 500 } as const;

const BOARD_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;

const GREENHOUSE_BOARD_HOSTS: ReadonlySet<string> = new Set([
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "job-boards.eu.greenhouse.io",
]);

const jobSchema = z.object({
  id: z.union([z.number(), z.string()]).transform(String),
  title: z.string(),
  absolute_url: z.string().nullish(),
  location: z.object({ name: z.string().nullish() }).nullish(),
  updated_at: z.string().nullish(),
  first_published: z.string().nullish(),
  language: z.string().nullish(),
  company_name: z.string().nullish(),
  internal_job_id: z.number().nullish(),
});

const listResponseSchema = z.object({ jobs: z.array(jobSchema) });

const contentJobSchema = jobSchema.extend({
  content: z.string().nullish(),
  departments: z.array(z.object({ name: z.string().nullish() })).nullish(),
});

const contentResponseSchema = z.object({ jobs: z.array(contentJobSchema) });

const payInputRangeSchema = z.object({
  min_cents: z.number().nullish(),
  max_cents: z.number().nullish(),
  currency_type: z.string().nullish(),
  interval: z.string().nullish(),
});

const detailResponseSchema = z.object({
  content: z.string().nullish(),
  departments: z.array(z.object({ name: z.string().nullish() })).nullish(),
  location: z.object({ name: z.string().nullish() }).nullish(),
  pay_input_ranges: z.array(payInputRangeSchema).nullish(),
});

const SALARY_PERIOD_BY_INTERVAL: ReadonlyMap<string, SalaryPeriod> = new Map([
  ["year", "year"],
  ["month", "month"],
  ["week", "week"],
  ["day", "day"],
  ["hour", "hour"],
]);

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

export function greenhouseBoardTokenFromUrl(raw: string) {
  let parsed: URL;

  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (!GREENHOUSE_BOARD_HOSTS.has(parsed.hostname.toLowerCase())) {
    return null;
  }

  const embedToken = parsed.searchParams.get("for");

  if (embedToken !== null && embedToken !== "") {
    return embedToken;
  }

  const token = parsed.pathname.split("/").find((segment) => segment.length > 0);

  if (token === undefined || token === "embed" || token === "jobs") {
    return null;
  }

  return token;
}

function isPresent(value: number | null | undefined) {
  return value !== null && value !== undefined;
}

function salaryFromInputRanges(ranges: z.infer<typeof payInputRangeSchema>[]) {
  const range = ranges.find(
    (candidate) => isPresent(candidate.min_cents) || isPresent(candidate.max_cents),
  );

  if (range === undefined) {
    return null;
  }

  const minMinor = isPresent(range.min_cents) ? range.min_cents : null;
  const maxMinor = isPresent(range.max_cents) ? range.max_cents : null;

  if (minMinor === null && maxMinor === null) {
    return null;
  }

  const interval = range.interval?.toLowerCase() ?? "";

  return {
    currency: range.currency_type?.toUpperCase() ?? null,
    minMinor,
    maxMinor,
    period: SALARY_PERIOD_BY_INTERVAL.get(interval) ?? null,
  } satisfies SalaryRange;
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

  const fetchBoard = async (boardToken: string, condition: BoardCondition, region: BoardRegion) => {
    assertToken(boardToken);
    void region;

    const url = `${baseUrl}/v1/boards/${boardToken}/jobs`;
    const response = await limiter.run(async () => fetcher(url, { ifNoneMatch: condition.etag }));

    if (response.status === 304) {
      return { status: "not_modified" } as const;
    }

    if (response.status === 404) {
      return { status: "gone" } as const;
    }

    const parsed = listResponseSchema.parse(response.json);

    const postings: FeedPosting[] = parsed.jobs
      .filter((job) => job.internal_job_id !== null)
      .map((job) => ({
        atsJobId: job.id,
        title: job.title,
        url: job.absolute_url ?? "",
        applyUrl: null,
        locationRaw: job.location?.name ?? null,
        workplaceType: null,
        employmentType: null,
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

  const fetchBoardContent = async (boardToken: string, region: BoardRegion) => {
    assertToken(boardToken);
    void region;

    const url = `${baseUrl}/v1/boards/${boardToken}/jobs?content=true`;
    const response = await limiter.run(async () => fetcher(url, { ifNoneMatch: null }));

    if (response.status === 304) {
      return { status: "not_modified" } as const;
    }

    if (response.status === 404) {
      return { status: "gone" } as const;
    }

    const parsed = contentResponseSchema.parse(response.json);

    const postings: FeedPosting[] = parsed.jobs
      .filter((job) => job.internal_job_id !== null)
      .map((job) => ({
        atsJobId: job.id,
        title: job.title,
        url: job.absolute_url ?? "",
        applyUrl: null,
        locationRaw: job.location?.name ?? null,
        workplaceType: null,
        employmentType: null,
        language: job.language ?? null,
        postedAt: job.first_published ?? null,
        sourceUpdatedAt: job.updated_at ?? null,
        descriptionPending: false,
        content: {
          descriptionText: htmlToText(job.content ?? null),
          department: job.departments?.[0]?.name ?? null,
          locationRaw: job.location?.name ?? null,
          salary: null,
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

    const url = `${baseUrl}/v1/boards/${boardToken}/jobs/${atsJobId}?content=true&pay_transparency=true`;

    try {
      const response = await limiter.run(async () => fetcher(url, { ifNoneMatch: null }));

      if (response.status === 404) {
        return {
          descriptionText: null,
          department: null,
          locationRaw: null,
          salary: null,
        };
      }

      const parsed = detailResponseSchema.parse(response.json);

      return {
        descriptionText: htmlToText(parsed.content ?? null),
        department: parsed.departments?.[0]?.name ?? null,
        locationRaw: parsed.location?.name ?? null,
        salary: salaryFromInputRanges(parsed.pay_input_ranges ?? []),
      };
    } catch (error) {
      if (error instanceof FeedError && error.status === 404) {
        return {
          descriptionText: null,
          department: null,
          locationRaw: null,
          salary: null,
        };
      }

      throw error;
    }
  };

  return { fetchBoard, fetchBoardContent, fetchPostingDetail } satisfies BoardFeed;
}
