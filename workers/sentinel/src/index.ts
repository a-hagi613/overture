import { describeDegradedMetrics } from "../../../src/shared/degraded.ts";

import type { R2BucketBinding } from "./bucket.ts";

import { pushAlert } from "./alert.ts";
import { r2Bucket } from "./bucket.ts";
import { probeHealth } from "./health.ts";
import { opsHealthProblems, probeOpsHealth } from "./ops-health.ts";
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

import type { SentinelRunRecord, SentinelState } from "./state.ts";
import type { UsageMetric, UsageResult } from "./usage.ts";
import type { ManifestFreshness } from "./workable.ts";

export interface SentinelEnv {
  FILES: R2BucketBinding;
  OVERTURE_HEALTH_URL: string;
  ALERT_NTFY_URL?: string;
  CLOUDFLARE_ACCOUNT_TAG?: string;
  CLOUDFLARE_ANALYTICS_TOKEN?: string;
  CLOUDFLARE_GRAPHQL_URL?: string;
  /** The signed ops endpoint; when unset the ops checks stay off and the public probe is unchanged. */
  OVERTURE_OPS_HEALTH_URL?: string;
  OVERTURE_OPS_HEALTH_SECRET?: string;
}

export interface SentinelRunOptions {
  now: () => number;
  fetch?: typeof fetch;
}

export interface SentinelRun {
  health: "ok" | "failing";
  manifest: ManifestFreshness;
  usage: UsageResult | "unconfigured" | "failed";
  /** Present only when the signed ops endpoint is configured. */
  ops?: "ok" | "failing" | "failed";
  degraded: boolean;
  /** What this run did to `ops/degraded.json`. `kept` means usage was unknown and the flag stood. */
  flag: "written" | "unchanged" | "cleared" | "kept" | "absent" | "failed";
  alerts: string[];
  errors: string[];
}

interface AlertRequest {
  key: string;
  windowMs: number;
  title: string;
  body: string;
  tags: "warning" | "rotating_light" | "white_check_mark";
}

interface UsageOutcome {
  usage: SentinelRun["usage"];
  degraded: boolean;
  flag: SentinelRun["flag"];
}

interface SentinelContext {
  env: SentinelEnv;
  state: SentinelState;
  fetch: typeof fetch;
  at: number;
  alerts: string[];
  errors: string[];
}

const DEFAULT_GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";
const HEALTH_REPEAT_MS = 6 * 3_600_000;
const CONDITION_REPEAT_MS = 24 * 3_600_000;
const FAILURE_REPEAT_MS = 6 * 3_600_000;
const UNCONFIGURED_REPEAT_MS = 24 * 3_600_000;
const DETAIL_LIMIT = 240;
const RUN_LIST_LIMIT = 20;

function truncate(text: string) {
  return text.length > DETAIL_LIMIT ? `${text.slice(0, DETAIL_LIMIT)}…` : text;
}

async function notify(context: SentinelContext, request: AlertRequest) {
  if (!shouldAlert(context.state, request.key, context.at, request.windowMs)) {
    return false;
  }

  const delivery = await pushAlert(context.env.ALERT_NTFY_URL, {
    title: request.title,
    body: request.body,
    tags: request.tags,
  });

  if (!delivery.delivered) {
    context.errors.push(`${request.key} not delivered: ${delivery.detail}`);
    context.errors.splice(0, Math.max(0, context.errors.length - RUN_LIST_LIMIT));

    return false;
  }

  markAlert(context.state, request.key, context.at);
  context.alerts.push(request.key);

  return true;
}

async function checkOpsHealth(context: SentinelContext) {
  const url = context.env.OVERTURE_OPS_HEALTH_URL;
  const secret = context.env.OVERTURE_OPS_HEALTH_SECRET;

  if (url === undefined || url === "" || secret === undefined || secret === "") {
    return "unconfigured" as const;
  }

  const probe = await probeOpsHealth(url, secret, context.fetch, () => context.at);

  if (!probe.ok || probe.body === undefined) {
    context.state.ops = "failing";

    await notify(context, {
      key: "ops.health",
      windowMs: HEALTH_REPEAT_MS,
      title: "Overture ops health check failing",
      body: `${url}: ${probe.detail}`,
      tags: "rotating_light",
    });

    return "failed" as const;
  }

  const problems = opsHealthProblems(probe.body);

  if (problems.length === 0) {
    if (context.state.ops === "failing") {
      await notify(context, {
        key: "ops.recovered",
        windowMs: CONDITION_REPEAT_MS,
        title: "Overture resource ceilings recovered",
        body: "RAM, NVMe, event-loop lag and ATS failures are inside their ceilings again",
        tags: "white_check_mark",
      });
    }

    context.state.ops = "ok";

    return "ok" as const;
  }

  context.state.ops = "failing";

  await notify(context, {
    key: "ops.thresholds",
    windowMs: FAILURE_REPEAT_MS,
    title: "Overture resources over their ceiling",
    body: problems.join("; "),
    tags: "rotating_light",
  });

  return "failing" as const;
}

async function checkHealth(context: SentinelContext) {
  const probe = await probeHealth(context.env.OVERTURE_HEALTH_URL, context.fetch);

  if (probe.ok) {
    if (context.state.health === "failing") {
      await notify(context, {
        key: "health.recovered",
        windowMs: CONDITION_REPEAT_MS,
        title: "Overture health recovered",
        body: `${context.env.OVERTURE_HEALTH_URL} answers ok again`,
        tags: "white_check_mark",
      });
    }

    context.state.health = "ok";

    return "ok" as const;
  }

  await notify(context, {
    key: "health",
    windowMs: HEALTH_REPEAT_MS,
    title: "Overture health check failing",
    body: `${context.env.OVERTURE_HEALTH_URL}: ${probe.detail}`,
    tags: "rotating_light",
  });

  context.state.health = "failing";

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

async function checkManifest(context: SentinelContext) {
  const freshness = await manifestFreshness(r2Bucket(context.env.FILES), context.at);
  const problem = manifestProblem(freshness);

  if (problem === null) {
    if (context.state.manifest === "failing" && freshness.state === "fresh") {
      await notify(context, {
        key: "workable.recovered",
        windowMs: CONDITION_REPEAT_MS,
        title: "Workable snapshot fresh again",
        body: `the manifest is ${describeAge(freshness.ageMs)} old`,
        tags: "white_check_mark",
      });
    }

    context.state.manifest = "ok";

    return freshness;
  }

  await notify(context, {
    key: "workable",
    windowMs: CONDITION_REPEAT_MS,
    title: "Workable snapshot stale",
    body: problem,
    tags: "rotating_light",
  });

  context.state.manifest = "failing";

  return freshness;
}

function percent(metric: { used: number; allowance: number }) {
  return String(Math.round(shareOf(metric) * 100));
}

async function warnUsage(context: SentinelContext, metrics: readonly UsageMetric[]) {
  await Promise.all(
    metrics.map(async (metric) => {
      await notify(context, {
        key: `usage.${metric.id}.warn`,
        windowMs: CONDITION_REPEAT_MS,
        title: `Overture usage: ${metric.id} at ${percent(metric)}%`,
        body: `${metric.id}: ${String(Math.round(metric.used))} of ${String(metric.allowance)} ${metric.unit} used this month`,
        tags: "warning",
      });
    }),
  );
}

async function readUsage(context: SentinelContext) {
  const { CLOUDFLARE_ACCOUNT_TAG: accountTag, CLOUDFLARE_ANALYTICS_TOKEN: token } = context.env;

  if (accountTag === undefined || accountTag === "" || token === undefined || token === "") {
    await notify(context, {
      key: "usage.unconfigured",
      windowMs: UNCONFIGURED_REPEAT_MS,
      title: "Overture sentinel usage check unconfigured",
      body: "CLOUDFLARE_ACCOUNT_TAG and CLOUDFLARE_ANALYTICS_TOKEN are not set, so nothing watches R2, Queues or Workers CPU",
      tags: "warning",
    });

    return "unconfigured";
  }

  try {
    return await fetchUsage(
      {
        accountTag,
        token,
        graphqlUrl: context.env.CLOUDFLARE_GRAPHQL_URL ?? DEFAULT_GRAPHQL_URL,
      },
      context.at,
      context.fetch,
    );
  } catch (error) {
    const detail = truncate(error instanceof Error ? error.message : String(error));

    context.errors.push(`usage read failed: ${detail}`);

    await notify(context, {
      key: "usage.error",
      windowMs: FAILURE_REPEAT_MS,
      title: "Overture sentinel cannot read usage",
      body: detail,
      tags: "warning",
    });

    return "failed";
  }
}

async function applyDegradedFlag(context: SentinelContext, metrics: readonly UsageMetric[]) {
  const since = context.state.degradedSince ?? new Date(context.at).toISOString();
  const isNew = context.state.degradedSince === null;

  context.state.degradedSince = since;

  try {
    const written = await writeDegradedFlag(r2Bucket(context.env.FILES), metrics, since);

    return { flag: written ? ("written" as const) : ("unchanged" as const), isNew };
  } catch (error) {
    const detail = truncate(error instanceof Error ? error.message : String(error));

    context.errors.push(`degraded flag write failed: ${detail}`);

    return { flag: "failed" as const, isNew };
  }
}

async function checkUsage(context: SentinelContext) {
  const usage = await readUsage(context);

  if (usage === "unconfigured" || usage === "failed") {
    const degraded = context.state.degradedSince !== null;

    return {
      usage,
      degraded,
      flag: degraded ? "kept" : "absent",
    } satisfies UsageOutcome;
  }

  await warnUsage(context, warnMetrics(usage.metrics));

  const over = degradedMetrics(usage.metrics);

  if (over.length > 0) {
    const { flag, isNew } = await applyDegradedFlag(context, over);

    if (isNew) {
      await notify(context, {
        key: "usage.degraded",
        windowMs: FAILURE_REPEAT_MS,
        title: "Overture is degraded",
        body: `${describeDegradedMetrics(
          over.map((metric) => ({
            metric: metric.id,
            used: metric.used,
            allowance: metric.allowance,
            share: shareOf(metric),
          })),
        )}; the app stops non-essential R2 writes and calls Haiku no more (rules-only email_classify)`,
        tags: "rotating_light",
      });
    }

    return { usage, degraded: true, flag } satisfies UsageOutcome;
  }

  if (context.state.degradedSince === null) {
    return { usage, degraded: false, flag: "absent" } satisfies UsageOutcome;
  }

  try {
    await clearDegradedFlag(r2Bucket(context.env.FILES));
  } catch (error) {
    const detail = truncate(error instanceof Error ? error.message : String(error));

    context.errors.push(`degraded flag clear failed: ${detail}`);

    return { usage, degraded: true, flag: "failed" } satisfies UsageOutcome;
  }

  context.state.degradedSince = null;

  await notify(context, {
    key: "usage.recovered",
    windowMs: CONDITION_REPEAT_MS,
    title: "Overture usage within allowances again",
    body: "the degraded flag was cleared",
    tags: "white_check_mark",
  });

  return { usage, degraded: false, flag: "cleared" } satisfies UsageOutcome;
}

function usageSummary(usage: SentinelRun["usage"]) {
  if (usage === "unconfigured") {
    return "unconfigured" as const;
  }

  if (usage === "failed") {
    return "failed" as const;
  }

  return "ok" as const;
}

/**
 * One sentinel run: probe the app from outside Fly, judge the Workable snapshot's age, then read
 * month-to-date Cloudflare usage. Alert thresholds are 70% (ntfy) and 90% (ntfy plus the degraded
 * flag at `ops/degraded.json`). The sentinel never revokes an R2 token: that would stop the
 * Litestream backups (ADR 0033).
 *
 * The run records itself in `ops/sentinel-state.json` as `lastRun`, which is how an operator sees
 * that the cron is alive and what it found; a failed write throws so Cloudflare marks the
 * invocation as an error.
 * @param env the Worker bindings, variables and secrets
 * @param options the clock, and an injectable fetch so tests answer from a local replay server
 * @returns what this run saw, which alerts it pushed and what happened to the flag
 */
export async function runSentinel(env: SentinelEnv, options: SentinelRunOptions) {
  const read = await readState(r2Bucket(env.FILES));

  const context: SentinelContext = {
    env,
    state: read.state,
    fetch: options.fetch ?? fetch,
    at: options.now(),
    alerts: [],
    errors: read.error === null ? [] : [read.error],
  };

  const health = await checkHealth(context);
  const manifest = await checkManifest(context);
  const { usage, degraded, flag } = await checkUsage(context);
  const ops = await checkOpsHealth(context);

  const record: SentinelRunRecord = {
    at: new Date(context.at).toISOString(),
    health,
    manifest: manifest.state,
    usage: usageSummary(usage),
    degraded,
    flag,
    alerts: context.alerts.slice(0, RUN_LIST_LIMIT),
    errors: context.errors.slice(0, RUN_LIST_LIMIT),
  };

  if (ops !== "unconfigured") {
    record.ops = ops;
  }

  context.state.lastRun = record;

  await writeState(r2Bucket(env.FILES), context.state);

  const result: SentinelRun = {
    health,
    manifest,
    usage,
    degraded,
    flag,
    alerts: context.alerts,
    errors: context.errors,
  };

  if (ops !== "unconfigured") {
    result.ops = ops;
  }

  return result;
}

const sentinel = {
  scheduled: (
    controller: { cron: string; scheduledTime: number },
    env: SentinelEnv,
    ctx: { waitUntil: (promise: Promise<unknown>) => void },
  ) => {
    ctx.waitUntil(runSentinel(env, { now: () => controller.scheduledTime }));
  },
};

export default sentinel;
