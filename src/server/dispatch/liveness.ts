import { z } from "zod";

import type { Ats as RegistryAts } from "../../shared/ats.ts";
import type { BoardRegion } from "../catalog/board-feed.ts";

import { ASHBY_DEFAULT_BASE_URL } from "../catalog/ashby-feed.ts";
import { GREENHOUSE_DEFAULT_BASE_URL } from "../catalog/greenhouse-feed.ts";
import { LEVER_DEFAULT_BASE_URL, LEVER_EU_DEFAULT_BASE_URL } from "../catalog/lever-feed.ts";
import { limiterFor } from "../catalog/rate-limiter.ts";

export const POSTING_LIVENESS = ["open", "closed", "unknown"] as const;

export type PostingLiveness = (typeof POSTING_LIVENESS)[number];

/** The feed base URLs the liveness checker may ask. Any board without one is unknown, never closed. */
export interface LivenessEnv {
  GREENHOUSE_FEED_BASE_URL?: string | undefined;
  LEVER_EU_FEED_BASE_URL?: string | undefined;
  LEVER_FEED_BASE_URL?: string | undefined;
  ASHBY_FEED_BASE_URL?: string | undefined;
}

export interface LivenessTarget {
  ats: RegistryAts | "workable";
  boardToken: string;
  region: BoardRegion;
  atsJobId: string;
}

export interface PostingLivenessChecker {
  check: (target: LivenessTarget) => Promise<PostingLiveness>;
}

const ashbyBoardSchema = z.object({
  jobs: z.array(z.object({ id: z.string() }).loose()).default([]),
});

const TIMEOUT_MS = 10_000;

const limiter = limiterFor("liveness", {
  maxConcurrent: 2,
  minIntervalMs: 250,
});

async function fetchStatus(url: string) {
  try {
    const response = await limiter.run(async () =>
      fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) }),
    );

    return response.status;
  } catch {
    return null;
  }
}

async function fetchJson(url: string) {
  try {
    const response = await limiter.run(async () =>
      fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) }),
    );

    if (!response.ok) {
      return { json: null, status: response.status };
    }

    const json: unknown = await response.json();

    return { json, status: response.status };
  } catch {
    return { json: null, status: null };
  }
}

/**
 * Builds the per-ATS liveness checker. Workable answers `open` without a request: its daily snapshot is the
 * closure signal (`catalog/poll-board.ts`), and a form that 404s at send ends as a form change.
 *
 * @param env The environment holding the feed base URLs.
 * @returns The liveness checker every dispatch tick uses.
 */
export function createPostingLiveness(env: LivenessEnv) {
  const greenhouseBase = (env.GREENHOUSE_FEED_BASE_URL ?? GREENHOUSE_DEFAULT_BASE_URL).replace(
    /\/+$/u,
    "",
  );

  const leverBase = (env.LEVER_FEED_BASE_URL ?? LEVER_DEFAULT_BASE_URL).replace(/\/+$/u, "");

  const leverEuBase = (env.LEVER_EU_FEED_BASE_URL ?? LEVER_EU_DEFAULT_BASE_URL).replace(
    /\/+$/u,
    "",
  );

  const ashbyBase = (env.ASHBY_FEED_BASE_URL ?? ASHBY_DEFAULT_BASE_URL).replace(/\/+$/u, "");

  async function greenhouse(target: LivenessTarget) {
    const status = await fetchStatus(
      `${greenhouseBase}/v1/boards/${target.boardToken}/jobs/${target.atsJobId}`,
    );

    if (status === 404) {
      return "closed";
    }

    return status !== null && status >= 200 && status < 300 ? "open" : "unknown";
  }

  async function lever(target: LivenessTarget) {
    const base = target.region === "eu" ? leverEuBase : leverBase;
    const status = await fetchStatus(`${base}/v0/postings/${target.boardToken}/${target.atsJobId}`);

    if (status === 404) {
      return "closed";
    }

    return status !== null && status >= 200 && status < 300 ? "open" : "unknown";
  }

  async function ashby(target: LivenessTarget) {
    const result = await fetchJson(
      `${ashbyBase}/posting-api/job-board/${target.boardToken.toLowerCase()}?includeCompensation=true`,
    );

    if (result.status === 404) {
      return "closed";
    }

    if (result.status === null || result.status < 200 || result.status >= 300) {
      return "unknown";
    }

    const parsed = ashbyBoardSchema.safeParse(result.json);

    if (!parsed.success) {
      return "unknown";
    }

    return parsed.data.jobs.some((job) => job.id === target.atsJobId) ? "open" : "closed";
  }

  return {
    check: async (target) => {
      switch (target.ats) {
        case "workable": {
          return "open";
        }

        case "greenhouse": {
          return greenhouse(target);
        }

        case "lever": {
          return lever(target);
        }

        case "ashby": {
          return ashby(target);
        }

        default: {
          return "unknown";
        }
      }
    },
  } satisfies PostingLivenessChecker;
}
