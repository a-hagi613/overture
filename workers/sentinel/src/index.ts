import { DEGRADED_THRESHOLD, describeDegradedMetrics } from "../../../src/shared/degraded.ts";

import type { R2BucketBinding } from "./bucket.ts";

import { pushAlert } from "./alert.ts";
import { r2Bucket } from "./bucket.ts";
import { probeHealth } from "./health.ts";
import { markAlert, readState, shouldAlert, writeState } from "./state.ts";
import {
  clearDegradedFlag,
  degradedMetrics,
  fetchUsage,
  shareOf,
  warnMetrics,
  writeDegradedFlag,
} from "./usage.ts";
import { describeAge, manifestFreshness } from "./workable.ts";

import type { SentinelState } from "./state.ts";
import type { UsageResult } from "./usage.ts";
import type { ManifestFreshness } from "./workable.ts";

export interface SentinelEnv {
  FILES: R2BucketBinding;
  OVERTURE_HEALTH_URL: string;
  ALERT_NTFY_URL?: string;
  CLOUDFLARE_ACCOUNT_TAG?: string;
  CLOUDFLARE_ANALYTICS_TOKEN?: string;
  CLOUDFLARE_GRAPHQL_URL?: string;
}

export interface SentinelDeps {
  now: () => number;
  fetch: typeof fetch;
  log: (line: string) => void;
}

export interface SentinelRun {
  health: "ok" | "failing";
  manifest: ManifestFreshness;
  usage: UsageResult | "unconfigured" | "failed";
  degraded: boolean;
  alerts: string[];
}

const DEFAULT_GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";
const HEALTH_REPEAT_MS = 6 * 3_600_000;
const CONDITION_REPEAT_MS = 24 * 3_600_000;
const FAILURE_REPEAT_MS = 6 * 3_600_000;
const UNCONFIGURED_REPEAT_MS = 24 * 3_600_000;

function defaultDeps(): SentinelDeps {
  return {
    now: () => Date.now(),
    fetch,
    log: (line) => {
      console.log(line);
    },
  };
}

async function notify(
  env: SentinelEnv,
  state: SentinelState,
  key: string,
  at: number,
  windowMs: number,
  title: string,
  body: string,
  tags: "warning" | "rotating_light" | "white_check_mark",
) {
  if (!shouldAlert(state, key, at, windowMs)) {
    return false;
  }

  const delivered = await pushAlert(env.ALERT_NTFY_URL, { title, body, tags });

  if (!delivered) {
    return false;
  }

  markAlert(state, key, at);

  return true;
}

async function checkHealth(
  env: SentinelEnv,
  state: SentinelState,
  deps: SentinelDeps,
  at: number,
  alerts: string[],
) {
  const probe = await probeHealth(env.OVERTURE_HEALTH_URL, deps.fetch);

  if (probe.ok) {
    if (state.health === "failing") {
      const sent = await notify(
        env,
        state,
        "health.recovered",
        at,
        CONDITION_REPEAT_MS,
        "Overture health recovered",
        `${env.OVERTURE_HEALTH_URL} answers ok again`,
        "white_check_mark",
      );

      if (sent) {
        alerts.push("health.recovered");
      }
    }

    state.health = "ok";

    return "ok" as const;
  }

  const sent = await notify(
    env,
    state,
    "health",
    at,
    HEALTH_REPEAT_MS,
    "Overture health check failing",
    `${env.OVERTURE_HEALTH_URL}: ${probe.detail}`,
    "rotating_light",
  );

  if (sent) {
    alerts.push("health");
  }

  state.health = "failing";

  return "failing" as const;
}

function manifestProblem(freshness: ManifestFreshness) {
  if (freshness.state === "missing") {
    return "the Workable snapshot manifest is missing from R2";
  }

  if (freshness.state === "unreadable") {
    return `the Workable snapshot manifest cannot be read: ${freshness.detail}`;
  }

  if (freshness.state === "stale") {
    return `the Workable snapshot is ${describeAge(freshness.ageMs)} old (limit 26 h)`;
  }

  return null;
}

async function checkManifest(
  env: SentinelEnv,
  bucket: ReturnType<typeof r2Bucket>,
  state: SentinelState,
  deps: SentinelDeps,
  at: number,
  alerts: string[],
) {
  const freshness = await manifestFreshness(bucket, at);
  const problem = manifestProblem(freshness);

  if (problem === null) {
    if (state.manifest === "failing" && freshness.state === "fresh") {
      const sent = await notify(
        env,
        state,
        "workable.recovered",
        at,
        CONDITION_REPEAT_MS,
        "Workable snapshot fresh again",
        `the manifest is ${describeAge(freshness.ageMs)} old`,
        "white_check_mark",
      );

      if (sent) {
        alerts.push("workable.recovered");
      }
    }

    state.manifest = "ok";

    return freshness;
  }

  const sent = await notify(
    env,
    state,
    "workable",
    at,
    CONDITION_REPEAT_MS,
    "Workable snapshot stale",
    problem,
    "rotating_light",
  );

  if (sent) {
    alerts.push("workable");
  }

  state.manifest = "failing";

  return freshness;
}

function percent(metric: { used: number; allowance: number }) {
  return String(Math.round(shareOf(metric) * 100));
}

async function checkUsage(
  env: SentinelEnv,
  bucket: ReturnType<typeof r2Bucket>,
  state: SentinelState,
  deps: SentinelDeps,
  at: number,
  alerts: string[],
): Promise<{ usage: SentinelRun["usage"]; degraded: boolean }> {
  if (
    env.CLOUDFLARE_ACCOUNT_TAG === undefined ||
    env.CLOUDFLARE_ACCOUNT_TAG === "" ||
    env.CLOUDFLARE_ANALYTICS_TOKEN === undefined ||
    env.CLOUDFLARE_ANALYTICS_TOKEN === ""
  ) {
    const sent = await notify(
      env,
      state,
      "usage.unconfigured",
      at,
      UNCONFIGURED_REPEAT_MS,
      "Overture sentinel usage check unconfigured",
      "CLOUDFLARE_ACCOUNT_TAG and CLOUDFLARE_ANALYTICS_TOKEN are not set, so nothing watches R2, Queues or Workers CPU",
      "warning",
    );

    if (sent) {
      alerts.push("usage.unconfigured");
    }

    return { usage: "unconfigured", degraded: state.degradedSince !== null };
  }

  let usage: UsageResult;

  try {
    usage = await fetchUsage(
      {
        accountTag: env.CLOUDFLARE_ACCOUNT_TAG,
        token: env.CLOUDFLARE_ANALYTICS_TOKEN,
        graphqlUrl: env.CLOUDFLARE_GRAPHQL_URL ?? DEFAULT_GRAPHQL_URL,
      },
      at,
      deps.fetch,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);

    const sent = await notify(
      env,
      state,
      "usage.error",
      at,
      FAILURE_REPEAT_MS,
      "Overture sentinel cannot read usage",
      detail,
      "warning",
    );

    if (sent) {
      alerts.push("usage.error");
    }

    // Usage is unknown, so an existing degraded flag is left in place rather than cleared.
    return { usage: "failed", degraded: state.degradedSince !== null };
  }

  for (const metric of warnMetrics(usage.metrics)) {
    const key = `usage.${metric.id}.${shareOf(metric) >= DEGRADED_THRESHOLD ? "degraded" : "warn"}`;

    const sent = await notify(
      env,
      state,
      key,
      at,
      CONDITION_REPEAT_MS,
      `Overture usage: ${metric.id} at ${percent(metric)}%`,
      `${metric.id}: ${String(Math.round(metric.used))} of ${String(metric.allowance)} ${metric.unit} used this month`,
      shareOf(metric) >= DEGRADED_THRESHOLD ? "rotating_light" : "warning",
    );

    if (sent) {
      alerts.push(key);
    }
  }

  const over = degradedMetrics(usage.metrics);

  if (over.length > 0) {
    const since = state.degradedSince ?? new Date(at).toISOString();

    await writeDegradedFlag(bucket, over, since);

    if (state.degradedSince === null) {
      const sent = await notify(
        env,
        state,
        "usage.degraded",
        at,
        FAILURE_REPEAT_MS,
        "Overture is degraded",
        `the app will stop non-essential R2 writes and classify mail by rules only: ${describeDegradedMetrics(
          over.map((metric) => ({
            metric: metric.id,
            used: metric.used,
            allowance: metric.allowance,
            share: shareOf(metric),
          })),
        )}`,
        "rotating_light",
      );

      if (sent) {
        alerts.push("usage.degraded");
      }
    }

    state.degradedSince = since;

    return { usage, degraded: true };
  }

  if (state.degradedSince !== null) {
    await clearDegradedFlag(bucket);
    state.degradedSince = null;

    const sent = await notify(
      env,
      state,
      "usage.recovered",
      at,
      CONDITION_REPEAT_MS,
      "Overture usage within allowances again",
      "the degraded flag was cleared",
      "white_check_mark",
    );

    if (sent) {
      alerts.push("usage.recovered");
    }
  }

  return { usage, degraded: false };
}

/**
 * One sentinel run: probe the app from outside Fly, judge the Workable snapshot's age, then read
 * month-to-date Cloudflare usage. Alert thresholds are 70% (ntfy) and 90% (ntfy plus the degraded
 * flag at `ops/degraded.json`). The sentinel never revokes an R2 token: that would stop the
 * Litestream backups (ADR 0033).
 * @param env the Worker bindings, variables and secrets
 * @param overrides test hooks for the clock, fetch and log
 * @returns what this run saw and which alerts it pushed
 */
export async function runSentinel(env: SentinelEnv, overrides: Partial<SentinelDeps> = {}) {
  const deps = { ...defaultDeps(), ...overrides };
  const at = deps.now();
  const bucket = r2Bucket(env.FILES);
  const state = await readState(bucket);
  const alerts: string[] = [];

  const health = await checkHealth(env, state, deps, at, alerts);
  const manifest = await checkManifest(env, bucket, state, deps, at, alerts);
  const { usage, degraded } = await checkUsage(env, bucket, state, deps, at, alerts);

  await writeState(bucket, state);

  deps.log(
    `overture sentinel: health=${health} manifest=${manifest.state} usage=${
      typeof usage === "string" ? usage : "ok"
    } degraded=${degraded ? "yes" : "no"} alerts=${alerts.join(",") || "none"}`,
  );

  return { health, manifest, usage, degraded, alerts } satisfies SentinelRun;
}

export default {
  scheduled: (
    _controller: { cron: string; scheduledTime: number },
    env: SentinelEnv,
    ctx: { waitUntil: (promise: Promise<unknown>) => void },
  ) => {
    ctx.waitUntil(runSentinel(env));
  },
};
