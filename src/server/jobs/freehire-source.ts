import { z } from "zod";

import {
  FREEHIRE_SOURCES,
  atsJobIdOf,
  boardTokenOf,
  freehireWorkMode,
  timestampOf,
} from "../../shared/freehire.ts";

import type { Clock } from "../platform/ports/clock.ts";
import { createClock } from "../platform/ports/clock.ts";
import type { FetchLike, JobChange, JobSearchQuery, JobSource } from "./source.ts";
import { JobSourceError, isRetryableStatus } from "./source.ts";

export const FREEHIRE_DEFAULT_BASE_URL = "https://freehire.me";
export const FREEHIRE_MAX_PAGE_SIZE = 100;
export const FREEHIRE_MAX_OFFSET = 10_000;

const stringList = z.array(z.string()).nullable().optional();

const jobSchema = z
  .object({
    public_slug: z.string().min(1),
    source: z.string().min(1),
    external_id: z.string(),
    title: z.string(),
    company: z.string(),
    company_slug: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    apply_url: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    countries: stringList,
    regions: stringList,
    metros: stringList,
    cities: stringList,
    work_mode: z.string().nullable().optional(),
    skills: stringList,
    posted_at: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    closed_at: z.string().nullable().optional(),
    enrichment: z
      .object({
        category: z.string().nullable().optional(),
        seniority: z.string().nullable().optional(),
        employment_type: z.string().nullable().optional(),
        experience_years_min: z.number().nullable().optional(),
        salary_min: z.number().nullable().optional(),
        salary_max: z.number().nullable().optional(),
        salary_currency: z.string().nullable().optional(),
        salary_period: z.string().nullable().optional(),
        visa_sponsorship: z.boolean().nullable().optional(),
      })
      .loose()
      .nullable()
      .optional(),
    reality: z
      .object({
        class: z.string().nullable().optional(),
        age_days: z.number().nullable().optional(),
        repost_count: z.number().nullable().optional(),
        fake_freshness: z.boolean().nullable().optional(),
      })
      .loose()
      .nullable()
      .optional(),
  })
  .loose();

const searchSchema = z.object({
  data: z.array(jobSchema),
  meta: z
    .object({
      total: z.number(),
      limit: z.number().optional(),
      offset: z.number().optional(),
      ignored_params: z.array(z.object({ param: z.string() }).loose()).optional(),
    })
    .loose(),
});

const detailSchema = z.object({ data: jobSchema });

const changesSchema = z.object({
  data: z.array(
    z
      .object({
        public_slug: z.string().min(1),
        seq: z.number(),
        kind: z.string(),
        at: z.string(),
      })
      .loose(),
  ),
  meta: z
    .object({
      has_more: z.boolean(),
      next_cursor: z.string().nullable().optional(),
      available_since: z.string().optional(),
    })
    .loose(),
});

type RawJob = z.infer<typeof jobSchema>;

function normaliseJob(raw: RawJob) {
  const enrichment = raw.enrichment ?? null;
  const reality = raw.reality ?? null;

  return {
    apply_url: raw.apply_url ?? null,
    cities: raw.cities ?? null,
    closed_at: raw.closed_at ?? null,
    company: raw.company,
    company_slug: raw.company_slug ?? null,
    countries: raw.countries ?? null,
    created_at: raw.created_at ?? null,
    description: raw.description ?? null,
    enrichment:
      enrichment === null
        ? null
        : {
            category: enrichment.category ?? null,
            employment_type: enrichment.employment_type ?? null,
            experience_years_min: enrichment.experience_years_min ?? null,
            salary_currency: enrichment.salary_currency ?? null,
            salary_max: enrichment.salary_max ?? null,
            salary_min: enrichment.salary_min ?? null,
            salary_period: enrichment.salary_period ?? null,
            seniority: enrichment.seniority ?? null,
            visa_sponsorship: enrichment.visa_sponsorship ?? null,
          },
    external_id: raw.external_id,
    location: raw.location ?? null,
    metros: raw.metros ?? null,
    posted_at: raw.posted_at ?? null,
    public_slug: raw.public_slug,
    reality:
      reality === null
        ? null
        : {
            age_days: reality.age_days ?? null,
            class: reality.class ?? null,
            fake_freshness: reality.fake_freshness ?? null,
            repost_count: reality.repost_count ?? null,
          },
    regions: raw.regions ?? null,
    skills: raw.skills ?? null,
    source: raw.source,
    title: raw.title,
    updated_at: raw.updated_at ?? null,
    url: raw.url ?? null,
    work_mode: freehireWorkMode(raw.work_mode),
  };
}

function commaList(values: readonly string[] | undefined) {
  return values === undefined || values.length === 0 ? undefined : values.join(",");
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export interface FreehireSourceOptions {
  baseUrl?: string;
  apiKey?: string;
  clock?: Clock;
  fetchImpl?: FetchLike;
  /** At most one request starts in this window; freehire's own paged reads allow 2 a second. */
  minIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
}

async function sleepFor(ms: number) {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * The freehire implementation of the job source port. It owns the wire format: the endpoint, comma-separated
 * facets, the source restriction to senders we have, offset paging, a two-request-a-second pace and backoff on
 * 429/5xx. It never guesses a missing field; `apply_url` and `work_mode` arrive as null.
 * @param options The endpoint, credentials and pacing; every value has a production default or a test override.
 * @returns The source the pulls and contract tests share.
 */
export function createFreehireJobSource(options: FreehireSourceOptions = {}) {
  const baseUrl = (options.baseUrl ?? FREEHIRE_DEFAULT_BASE_URL).replace(/\/+$/u, "");
  const clock = options.clock ?? createClock();
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? sleepFor;
  const minIntervalMs = options.minIntervalMs ?? 500;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 4);
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  const timeoutMs = options.timeoutMs ?? 20_000;
  let nextStartAt = 0;

  async function pace() {
    const now = clock.now();
    const earliest = Math.max(nextStartAt, now);

    nextStartAt = earliest + minIntervalMs;

    if (earliest > now) {
      await sleep(earliest - now);
    }
  }

  function delayFor(attempt: number, retryAfterHeader: string | null) {
    const retryAfterSeconds = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);

    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
      return Math.min(retryAfterSeconds * 1000, maxDelayMs);
    }

    return Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
  }

  const requestJson: (path: string, params: URLSearchParams) => Promise<JsonValue> = async (
    path,
    params,
  ) => {
    const url = `${baseUrl}/api/v1${path}${params.size === 0 ? "" : `?${params.toString()}`}`;

    const attemptRequest: (attempt: number) => Promise<JsonValue> = async (attempt) => {
      await pace();

      let response: Response;
      const headers = new Headers({ accept: "application/json" });

      if (options.apiKey !== undefined && options.apiKey !== "") {
        headers.set("authorization", `Bearer ${options.apiKey}`);
      }

      try {
        response = await fetchImpl(url, {
          headers,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (attempt + 1 >= maxAttempts) {
          throw new JobSourceError(0, `freehire request failed: ${String(error)}`);
        }

        await sleep(delayFor(attempt, null));

        return attemptRequest(attempt + 1);
      }

      if (!response.ok) {
        const { status } = response;

        if (!isRetryableStatus(status) || attempt + 1 >= maxAttempts) {
          throw new JobSourceError(status, `freehire answered HTTP ${String(status)} for ${url}`);
        }

        await sleep(delayFor(attempt, response.headers.get("retry-after")));

        return attemptRequest(attempt + 1);
      }

      return jsonValueSchema.parse(await response.json());
    };

    return attemptRequest(0);
  };

  return {
    search: async (query: JobSearchQuery) => {
      const limit = Math.min(
        Math.max(1, query.limit ?? FREEHIRE_MAX_PAGE_SIZE),
        FREEHIRE_MAX_PAGE_SIZE,
      );

      const offset = Math.max(0, query.offset ?? 0);
      const params = new URLSearchParams();

      const facets = [
        ["category", commaList(query.categories)],
        ["countries", commaList(query.countries)],
        ["regions", commaList(query.regions)],
        ["metros", commaList(query.metros)],
        ["cities", commaList(query.cities)],
        ["work_mode", commaList(query.workModes)],
        ["source", FREEHIRE_SOURCES.join(",")],
      ] as const;

      for (const [name, value] of facets) {
        if (value !== undefined) {
          params.set(name, value);
        }
      }

      if (query.keywords !== undefined && query.keywords.length > 0) {
        params.set("q", query.keywords.join(" "));
        params.set("q_fields", "title");
      }

      params.set("sort", "created_at");
      params.set("order", "desc");
      params.set("limit", String(limit));
      params.set("offset", String(offset));

      const parsed = searchSchema.parse(await requestJson("/jobs/search", params));

      return {
        ignoredParams: (parsed.meta.ignored_params ?? []).map((entry) => entry.param),
        jobs: parsed.data.map(normaliseJob),
        total: parsed.meta.total,
      };
    },
    changes: async ({ cursor = null, since = null }) => {
      const params = new URLSearchParams({ limit: "100" });

      if (cursor !== null) {
        params.set("cursor", cursor);
      } else if (since !== null) {
        params.set("since", new Date(since).toISOString());
      }

      const parsed = changesSchema.parse(await requestJson("/jobs/changes", params));

      return {
        changes: parsed.data.flatMap((row) => {
          let kind: JobChange["kind"] | null = null;

          if (row.kind === "closed") {
            kind = "closed";
          } else if (row.kind === "reopened") {
            kind = "reopened";
          } else if (row.kind === "opened") {
            kind = "opened";
          }

          const at = timestampOf(row.at);

          return kind === null || at === null
            ? []
            : [{ at, kind, publicSlug: row.public_slug, seq: row.seq }];
        }),
        hasMore: parsed.meta.has_more,
        nextCursor: parsed.meta.next_cursor ?? null,
      };
    },
    getJob: async (publicSlug: string) => {
      const params = new URLSearchParams();

      try {
        const parsed = detailSchema.parse(
          await requestJson(`/jobs/${encodeURIComponent(publicSlug)}`, params),
        );

        return normaliseJob(parsed.data);
      } catch (error) {
        if (error instanceof JobSourceError && error.status === 404) {
          return null;
        }

        throw error;
      }
    },
  } satisfies JobSource;
}

/**
 * Split freehire's `<board>:<job id>` external id into what a sender needs. Kept beside the adapter so every caller
 * reads the same token.
 * @param externalId freehire's external id.
 * @returns The board token and the employer's job id.
 */
export function splitExternalId(externalId: string) {
  return { atsJobId: atsJobIdOf(externalId), boardToken: boardTokenOf(externalId) };
}
