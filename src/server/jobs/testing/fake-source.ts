import type { FreehireJobRecord } from "../../../shared/freehire.ts";

import type { JobChangePage, JobSearchPage, JobSearchQuery, JobSource } from "../source.ts";

export interface FakeJobSourceOptions {
  /** One entry per offset page (`offset / limit`). */
  pages?: readonly JobSearchPage[];
  /** A failing or bespoke search, which wins over `pages`. */
  search?: (query: JobSearchQuery) => Promise<JobSearchPage>;
  changes?: readonly JobChangePage[];
  jobs?: Readonly<Record<string, FreehireJobRecord>>;
}

export interface FakeJobSource extends JobSource {
  /** Every search the pull made, so a grouping test can prove one request served several users. */
  searches: JobSearchQuery[];
  /** Every change-feed call. */
  changeCalls: { cursor: string | null; since: number | null }[];
}

/**
 * A fixture-backed job source for tests. It performs no network call and answers pages in order, so the pull's
 * paging, grouping and dedupe contracts can be tested without freehire.
 * @param options The recorded pages, change pages and single jobs.
 * @returns The source plus the calls it received.
 */
export function createFakeJobSource(options: FakeJobSourceOptions = {}) {
  const searches: JobSearchQuery[] = [];
  const changeCalls: { cursor: string | null; since: number | null }[] = [];
  const pages = options.pages ?? [];
  const changePages = options.changes ?? [];
  const jobs = options.jobs ?? {};

  return {
    changeCalls,
    changes: async ({ cursor = null, since = null }) => {
      changeCalls.push({ cursor, since });

      const page = changePages[changeCalls.length - 1] ?? {
        changes: [],
        hasMore: false,
        nextCursor: null,
      };

      return await Promise.resolve(page);
    },
    getJob: async (publicSlug) => await Promise.resolve(jobs[publicSlug] ?? null),
    search: async (query) => {
      searches.push(query);

      if (options.search !== undefined) {
        return await options.search(query);
      }

      const limit = query.limit ?? 100;

      const page = pages[Math.trunc((query.offset ?? 0) / limit)] ?? {
        ignoredParams: [],
        jobs: [],
        total: 0,
      };

      return await Promise.resolve(page);
    },
    searches,
  } satisfies FakeJobSource;
}
