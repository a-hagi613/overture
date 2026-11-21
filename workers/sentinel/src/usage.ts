import { z } from "zod";

import {
  DEGRADED_FLAG_KEY,
  DEGRADED_THRESHOLD,
  WARN_THRESHOLD,
  degradedFlagSchema,
} from "../../../src/shared/degraded.ts";

import type { SentinelBucket } from "./bucket.ts";

export interface UsageMetric {
  id: string;
  used: number;
  allowance: number;
  unit: string;
}

export type UsageResult = ReturnType<typeof usageMetrics>;

export interface UsageEnv {
  accountTag: string;
  token: string;
  graphqlUrl: string;
}

const GRAPHQL_TIMEOUT_MS = 20_000;

export const ALLOWANCES = {
  r2ClassA: 1_000_000,
  r2ClassB: 10_000_000,
  queuesOperations: 1_000_000,
  workersRequests: 10_000_000,
  workersCpuMs: 30_000_000,
} as const;

const CLASS_A_ACTIONS = new Set([
  "CompleteMultipartUpload",
  "CopyObject",
  "CreateMultipartUpload",
  "LifecycleStorageTierTransition",
  "ListBuckets",
  "ListMultipartUploads",
  "ListObjects",
  "ListObjectsV1",
  "ListObjectsV2",
  "ListParts",
  "PutBucket",
  "PutBucketCors",
  "PutBucketEncryption",
  "PutBucketLifecycleConfiguration",
  "PutObject",
  "UploadPart",
  "UploadPartCopy",
]);

const CLASS_B_ACTIONS = new Set([
  "GetBucketCors",
  "GetBucketEncryption",
  "GetBucketLifecycleConfiguration",
  "GetBucketLocation",
  "GetObject",
  "HeadBucket",
  "HeadObject",
  "UsageSummary",
]);

const FREE_ACTIONS = new Set([
  "AbortMultipartUpload",
  "DeleteBucket",
  "DeleteObject",
  "DeleteObjects",
  "DeleteObjectsByPrefix",
]);

export const USAGE_QUERY = `query SentinelUsage($accountTag: string!, $since: Time) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      r2OperationsAdaptiveGroups(limit: 10000, filter: { datetime_geq: $since }) {
        sum {
          requests
        }
        dimensions {
          actionStatus
          actionType
        }
      }
      queueMessageOperationsAdaptiveGroups(limit: 10000, filter: { datetime_geq: $since }) {
        sum {
          billableOperations
        }
        dimensions {
          queueId
          actionType
        }
      }
      workersInvocationsAdaptive(limit: 1, filter: { datetime_geq: $since }) {
        sum {
          requests
          cpuTimeUs
        }
      }
    }
  }
}`;

const r2GroupSchema = z.object({
  dimensions: z
    .object({
      actionStatus: z.string(),
      actionType: z.string(),
    })
    .nullish(),
  sum: z.object({ requests: z.number() }).nullish(),
});

const queueGroupSchema = z.object({
  dimensions: z.object({ actionType: z.string(), queueId: z.string() }).nullish(),
  sum: z.object({ billableOperations: z.number() }).nullish(),
});

const workersGroupSchema = z.object({
  sum: z.object({ requests: z.number(), cpuTimeUs: z.number() }).nullish(),
});

const accountSchema = z.object({
  r2OperationsAdaptiveGroups: z.array(r2GroupSchema).default([]),
  queueMessageOperationsAdaptiveGroups: z.array(queueGroupSchema).default([]),
  workersInvocationsAdaptive: z.array(workersGroupSchema).default([]),
});

export const usageResponseSchema = z.object({
  data: z
    .object({
      viewer: z.object({ accounts: z.array(accountSchema) }),
    })
    .nullish(),
  errors: z.array(z.object({ message: z.string().optional() })).nullish(),
});

export type UsageResponse = z.infer<typeof usageResponseSchema>;

export function usageMetrics(payload: UsageResponse) {
  const account = payload.data?.viewer.accounts[0];

  if (account === undefined) {
    throw new Error("GraphQL answer carried no account");
  }

  let classA = 0;
  let classB = 0;
  const unknownActionTypes = new Set<string>();

  for (const group of account.r2OperationsAdaptiveGroups) {
    const status = group.dimensions?.actionStatus ?? "";
    const actionType = group.dimensions?.actionType ?? "";
    const requests = group.sum?.requests ?? 0;

    if (status !== "" && status !== "success") {
      continue;
    }

    if (CLASS_A_ACTIONS.has(actionType)) {
      classA += requests;
    } else if (CLASS_B_ACTIONS.has(actionType)) {
      classB += requests;
    } else if (!FREE_ACTIONS.has(actionType)) {
      unknownActionTypes.add(actionType === "" ? "(missing)" : actionType);
      classA += requests;
    }
  }

  let queueOperations = 0;

  for (const group of account.queueMessageOperationsAdaptiveGroups) {
    queueOperations += group.sum?.billableOperations ?? 0;
  }

  let workerRequests = 0;
  let workerCpuMs = 0;

  for (const group of account.workersInvocationsAdaptive) {
    workerRequests += group.sum?.requests ?? 0;
    workerCpuMs += (group.sum?.cpuTimeUs ?? 0) / 1000;
  }

  const metrics: UsageMetric[] = [
    {
      id: "r2.class_a_operations",
      used: classA,
      allowance: ALLOWANCES.r2ClassA,
      unit: "operations",
    },
    {
      id: "r2.class_b_operations",
      used: classB,
      allowance: ALLOWANCES.r2ClassB,
      unit: "operations",
    },
    {
      id: "queues.billable_operations",
      used: queueOperations,
      allowance: ALLOWANCES.queuesOperations,
      unit: "operations",
    },
    {
      id: "workers.requests",
      used: workerRequests,
      allowance: ALLOWANCES.workersRequests,
      unit: "requests",
    },
    {
      id: "workers.cpu",
      used: Math.round(workerCpuMs),
      allowance: ALLOWANCES.workersCpuMs,
      unit: "cpu-ms",
    },
  ];

  return { metrics, unknownActionTypes: [...unknownActionTypes].toSorted() };
}

export function monthStart(at: number) {
  const date = new Date(at);

  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0);
}

/**
 * Reads month-to-date usage from the GraphQL Analytics API, the dataset behind the dashboard.
 * @param env account tag, token and URL of the GraphQL endpoint
 * @param at the instant the run started, in epoch milliseconds
 * @param fetchImpl an injectable fetch, so tests answer from a local replay server
 * @returns parsed per-metric usage for the metrics the sentinel watches
 */
export async function fetchUsage(env: UsageEnv, at: number, fetchImpl: typeof fetch = fetch) {
  const since = new Date(monthStart(at)).toISOString();

  const response = await fetchImpl(env.graphqlUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: USAGE_QUERY,
      variables: { accountTag: env.accountTag, since },
    }),
    redirect: "manual",
    signal: AbortSignal.timeout(GRAPHQL_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await response.text();

    throw new Error(`GraphQL answered ${String(response.status)}: ${detail.slice(0, 200)}`);
  }

  const payload = usageResponseSchema.parse(await response.json());
  const errors = payload.errors ?? [];

  if (errors.length > 0) {
    throw new Error(`GraphQL errors: ${errors.map((error) => error.message ?? "?").join("; ")}`);
  }

  return usageMetrics(payload);
}

export function shareOf(metric: { used: number; allowance: number }) {
  return metric.used / metric.allowance;
}

/**
 * Picks the metrics at the warning line.
 * @param metrics this month's metrics
 * @returns those at or above 70 % but below 90 %, which each push one warning
 */
export function warnMetrics(metrics: readonly UsageMetric[]) {
  return metrics.filter(
    (metric) => shareOf(metric) >= WARN_THRESHOLD && shareOf(metric) < DEGRADED_THRESHOLD,
  );
}

/**
 * Picks the metrics at the degraded line.
 * @param metrics this month's metrics
 * @returns those at or above 90 %, where the app must shed non-essential work
 */
export function degradedMetrics(metrics: readonly UsageMetric[]) {
  return metrics.filter((metric) => shareOf(metric) >= DEGRADED_THRESHOLD);
}

/**
 * Writes the flag the app reads, and only when its content changed: rewriting an unchanged object
 * every ten minutes would add Class A operations exactly when R2 is near its allowance (ADR 0033).
 * @param bucket the files bucket the app reads
 * @param metrics the metrics at or above the degraded line
 * @param since when this degraded period started, kept across runs so the app can report it
 * @returns whether the object on disk changed
 */
export async function writeDegradedFlag(
  bucket: SentinelBucket,
  metrics: readonly Pick<UsageMetric, "id" | "used" | "allowance">[],
  since: string,
) {
  const flag = degradedFlagSchema.parse({
    version: 1,
    degraded: true,
    since,
    metrics: metrics.map((metric) => ({
      metric: metric.id,
      used: metric.used,
      allowance: metric.allowance,
      share: shareOf(metric),
    })),
  });

  const body = `${JSON.stringify(flag)}\n`;

  if ((await bucket.get(DEGRADED_FLAG_KEY)) === body) {
    return false;
  }

  await bucket.put(DEGRADED_FLAG_KEY, body);

  return true;
}

export async function clearDegradedFlag(bucket: SentinelBucket) {
  await bucket.delete(DEGRADED_FLAG_KEY);
}
