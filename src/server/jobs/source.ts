import type { FreehireJobRecord, FreehireWorkMode } from "../../shared/freehire.ts";

/**
 * One search against a job source. Values inside a facet OR together; different facets AND together. Geography is
 * the source's own exception: `countries`, `regions`, `metros` and `cities` widen each other.
 */
export interface JobSearchQuery {
  /** freehire category slugs, such as `software_engineering`. Empty means every category. */
  categories?: readonly string[];
  /** ISO-3166-1 alpha-2 country codes, lower case. */
  countries?: readonly string[];
  /** freehire region slugs (`eu`, `north_america`, …). */
  regions?: readonly string[];
  /** freehire metro names. */
  metros?: readonly string[];
  /** City names as freehire spells them. */
  cities?: readonly string[];
  /** Work formats. Only used to narrow a pull; a blank work mode is never a hard filter. */
  workModes?: readonly FreehireWorkMode[];
  /** Full-text title words, from free-text role targets. */
  keywords?: readonly string[];
  /** 1–100. */
  limit?: number;
  offset?: number;
}

export interface JobSearchPage {
  jobs: readonly FreehireJobRecord[];
  total: number;
  /** Parameters freehire ignored, so a broken filter is visible instead of silently broad. */
  ignoredParams: readonly string[];
}

export const JOB_CHANGE_KINDS = ["opened", "closed", "reopened"] as const;

export type JobChangeKind = (typeof JOB_CHANGE_KINDS)[number];

export interface JobChange {
  publicSlug: string;
  seq: number;
  kind: JobChangeKind;
  at: number;
}

export interface JobChangePage {
  changes: readonly JobChange[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * The port every job source implements. A source only has to answer searches, the change feed when it has one, and
 * a single job lookup for the pre-prepare liveness check.
 */
export interface JobSource {
  search: (query: JobSearchQuery) => Promise<JobSearchPage>;
  /** Present only for sources that publish a change feed, like freehire with an API key. */
  changes?: (options: { cursor?: string | null; since?: number | null }) => Promise<JobChangePage>;
  /** Present only for sources that can answer one posting by its public id. */
  getJob?: (publicSlug: string) => Promise<FreehireJobRecord | null>;
}

/** The one shape an injected fetcher has to satisfy; it keeps tests free of Bun's `preconnect` helpers. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class JobSourceError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "JobSourceError";
    this.status = status;
  }
}

/**
 * Whether a failed request is worth retrying: freehire's rate limit and any server-side failure.
 * @param status The HTTP status.
 * @returns True for 429 and 5xx.
 */
export function isRetryableStatus(status: number) {
  return status === 429 || status >= 500;
}
