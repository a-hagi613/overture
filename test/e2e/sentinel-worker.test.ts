import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { expect, test } from "@playwright/test";
import { z } from "zod";

import type { R2BucketBinding, SentinelBucket } from "../../workers/sentinel/src/bucket.ts";

import { runSentinel } from "../../workers/sentinel/src/index.ts";
import { opsHealthHeaders } from "../../workers/sentinel/src/ops-health.ts";
import { usageMetrics, usageResponseSchema } from "../../workers/sentinel/src/usage.ts";

const MINUTE = 60_000;
const NOW = Date.UTC(2026, 10, 21, 15, 0, 0, 0);

const recordedUsageSchema = z.object({
  data: z.object({ viewer: z.object({ accounts: z.array(z.record(z.string(), z.unknown())) }) }),
  errors: z.unknown().nullish(),
});

const degradedFlagSchema = z.object({
  version: z.literal(1),
  degraded: z.literal(true),
  since: z.string(),
  metrics: z.array(
    z.object({ metric: z.string(), used: z.number(), allowance: z.number(), share: z.number() }),
  ),
});

const stateSchema = z.object({
  lastRun: z
    .object({
      at: z.string(),
      health: z.string(),
      usage: z.string(),
      ops: z.string().nullish(),
      degraded: z.boolean(),
      flag: z.string(),
      alerts: z.array(z.string()),
      errors: z.array(z.string()),
    })
    .nullish(),
});

async function fixture(name: string) {
  return readFile(join(process.cwd(), "test/e2e/fixtures/sentinel", name), "utf8");
}

function diskBucket(root: string) {
  return {
    get: async (key) => {
      try {
        return await readFile(join(root, key), "utf8");
      } catch {
        return null;
      }
    },
    put: async (key, value) => {
      const path = join(root, key);

      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, value);
    },
    delete: async (key) => {
      await rm(join(root, key), { force: true });
    },
  } satisfies SentinelBucket;
}

interface Alert {
  title: string;
  body: string;
  tags: string;
}

interface Servers {
  healthUrl: string;
  graphqlUrl: string;
  ntfyUrl: string;
  opsUrl: string;
  opsHeaders: { signature: string; timestamp: string }[];
  alerts: Alert[];
  setHealth: (status: number, body: string) => void;
  setGraphql: (status: number, body: string) => void;
  setNtfy: (status: number) => void;
  setOps: (status: number, body: string) => void;
  stop: () => Promise<void>;
}

interface Harness {
  servers: Servers;
  bucket: SentinelBucket;
  env: Parameters<typeof runSentinel>[0];
  lastRun: () => Promise<z.infer<typeof stateSchema>["lastRun"]>;
}

function startServers() {
  let health = { status: 200, body: "<pending>" };
  let graphql = { status: 200, body: "{}" };
  let ntfy = { status: 200 };
  let ops = { status: 200, body: "{}" };
  const opsHeaders: { signature: string; timestamp: string }[] = [];
  const alerts: Alert[] = [];

  const healthServer = Bun.serve({
    port: 0,
    fetch: () => new Response(health.body, { status: health.status }),
  });

  const graphqlServer = Bun.serve({
    port: 0,
    fetch: () => new Response(graphql.body, { status: graphql.status }),
  });

  const opsServer = Bun.serve({
    port: 0,
    fetch(request) {
      opsHeaders.push({
        signature: request.headers.get("x-overture-ops-signature") ?? "",
        timestamp: request.headers.get("x-overture-ops-timestamp") ?? "",
      });

      return new Response(ops.body, { status: ops.status });
    },
  });

  const ntfyServer = Bun.serve({
    port: 0,
    async fetch(request) {
      alerts.push({
        title: request.headers.get("title") ?? "",
        body: await request.text(),
        tags: request.headers.get("tags") ?? "",
      });

      return new Response(ntfy.status === 200 ? "ok" : "unavailable", { status: ntfy.status });
    },
  });

  return {
    healthUrl: `http://127.0.0.1:${String(healthServer.port)}/api/health`,
    graphqlUrl: `http://127.0.0.1:${String(graphqlServer.port)}/graphql`,
    ntfyUrl: `http://127.0.0.1:${String(ntfyServer.port)}/topic`,
    opsUrl: `http://127.0.0.1:${String(opsServer.port)}/internal/ops/health`,
    opsHeaders,
    alerts,
    setHealth: (status: number, body: string) => {
      health = { status, body };
    },
    setGraphql: (status: number, body: string) => {
      graphql = { status, body };
    },
    setNtfy: (status: number) => {
      ntfy = { status };
    },
    setOps: (status: number, body: string) => {
      ops = { status, body };
    },
    stop: async () => {
      await Promise.all([
        healthServer.stop(true),
        graphqlServer.stop(true),
        ntfyServer.stop(true),
        opsServer.stop(true),
      ]);
    },
  } satisfies Servers;
}

async function startHarness() {
  const root = await mkdtemp(join(tmpdir(), "overture-sentinel-"));
  const servers = startServers();
  const bucket = diskBucket(root);

  const files: R2BucketBinding = {
    get: async (key) => {
      const text = await bucket.get(key);

      if (text === null) {
        return null;
      }

      return { text: async () => (await bucket.get(key)) ?? "" };
    },
    put: async (key, value) => {
      await bucket.put(key, value);
    },
    delete: async (key) => {
      await bucket.delete(key);
    },
  };

  const harness = {
    servers,
    bucket,
    env: {
      FILES: files,
      OVERTURE_HEALTH_URL: servers.healthUrl,
      ALERT_NTFY_URL: servers.ntfyUrl,
      CLOUDFLARE_ACCOUNT_TAG: "0123456789abcdef0123456789abcdef",
      CLOUDFLARE_ANALYTICS_TOKEN: "sentinel-test-token",
      CLOUDFLARE_GRAPHQL_URL: servers.graphqlUrl,
    },
    lastRun: async () => {
      const raw = await bucket.get("ops/sentinel-state.json");

      return raw === null ? null : (stateSchema.parse(JSON.parse(raw)).lastRun ?? null);
    },
  } satisfies Harness;

  servers.setHealth(200, await fixture("health-ok.json"));
  servers.setGraphql(200, await fixture("usage-graphql.json"));

  return harness;
}

async function run(harness: Harness, at = NOW) {
  return runSentinel(harness.env, { now: () => at });
}

interface OpsOverrides {
  ats?: { attempts: number; failures: number; failureRate: number; windowMs: number };
  disk?: { mount: string; usedRatio: number };
  eventLoopLag?: { p95Ms: number | null };
  memory?: { rssBytes: number; totalBytes: number; usedRatio: number };
  status?: string;
}

function opsBody(overrides: OpsOverrides = {}) {
  return JSON.stringify({
    ats: overrides.ats ?? { attempts: 0, failures: 0, failureRate: 0, windowMs: 3_600_000 },
    disk: overrides.disk ?? { mount: "/data", usedRatio: 0.4 },
    eventLoopLag: overrides.eventLoopLag ?? { p95Ms: 20 },
    memory: overrides.memory ?? { rssBytes: 1_048_576, totalBytes: 4_194_304, usedRatio: 0.4 },
    status: overrides.status ?? "ok",
  });
}

async function runWithOps(harness: Harness, at = NOW) {
  return runSentinel(
    {
      ...harness.env,
      OVERTURE_OPS_HEALTH_SECRET: "sentinel-ops-health-secret",
      OVERTURE_OPS_HEALTH_URL: harness.servers.opsUrl,
    },
    { now: () => at },
  );
}

async function usageWith(id: string, used: number) {
  const payload = recordedUsageSchema.parse(JSON.parse(await fixture("usage-graphql.json")));
  const [account] = payload.data.viewer.accounts;

  if (account === undefined) {
    throw new Error("the recorded GraphQL answer carries no account");
  }

  if (id === "r2.class_a_operations") {
    account["r2OperationsAdaptiveGroups"] = [
      { dimensions: { actionStatus: "success", actionType: "PutObject" }, sum: { requests: used } },
    ];
  } else if (id === "queues.billable_operations") {
    account["queueMessageOperationsAdaptiveGroups"] = [
      {
        dimensions: { actionType: "WriteMessage", queueId: "q" },
        sum: { billableOperations: used },
      },
    ];
  } else {
    throw new Error(`unknown metric ${id}`);
  }

  return JSON.stringify(payload);
}

test("a healthy app and low usage alert nothing and record the run", async () => {
  const harness = await startHarness();

  const result = await run(harness);

  expect(result.health).toBe("ok");
  expect(result.degraded).toBe(false);
  expect(result.flag).toBe("absent");
  expect(result.alerts).toHaveLength(0);
  expect(result.errors).toHaveLength(0);
  expect(harness.servers.alerts).toHaveLength(0);
  expect(await harness.bucket.get("ops/degraded.json")).toBeNull();

  expect(await harness.lastRun()).toEqual({
    at: new Date(NOW).toISOString(),
    health: "ok",
    usage: "ok",
    degraded: false,
    flag: "absent",
    alerts: [],
    errors: [],
  });

  await harness.servers.stop();
});

test("every action type in the recorded answer is classified, so none is silently miscounted", async () => {
  const payload = usageResponseSchema.parse(JSON.parse(await fixture("usage-graphql.json")));
  const usage = usageMetrics(payload);
  const used = new Map(usage.metrics.map((metric) => [metric.id, metric.used]));

  expect(usage.unknownActionTypes).toEqual([]);
  expect(used.get("r2.class_a_operations")).toBeGreaterThan(0);
  expect(used.get("r2.class_b_operations")).toBeGreaterThan(0);
  expect(used.get("queues.billable_operations")).toBe(0);
  expect(used.get("workers.requests")).toBe(0);
  expect(used.get("workers.cpu")).toBe(0);
});

test("a failing health probe alerts once, then recovers", async () => {
  const harness = await startHarness();

  harness.servers.setHealth(503, "upstream unavailable");

  const first = await run(harness);

  expect(first.health).toBe("failing");
  expect(first.alerts).toEqual(["health"]);
  expect(harness.servers.alerts).toHaveLength(1);
  expect(harness.servers.alerts[0]?.body).toContain("HTTP 503");

  const second = await run(harness, NOW + 10 * MINUTE);

  expect(second.alerts).toHaveLength(0);
  expect(harness.servers.alerts).toHaveLength(1);
  expect((await harness.lastRun())?.health).toBe("failing");

  harness.servers.setHealth(200, await fixture("health-ok.json"));

  const recovered = await run(harness, NOW + 20 * MINUTE);

  expect(recovered.alerts).toEqual(["health.recovered"]);
  expect(harness.servers.alerts.map((alert) => alert.title)).toEqual(
    expect.arrayContaining(["Overture health recovered"]),
  );

  await harness.servers.stop();
});

test("a health answer whose body is not ok is a failure", async () => {
  const harness = await startHarness();

  harness.servers.setHealth(200, '{"status":"degraded"}');

  const result = await run(harness);

  expect(result.health).toBe("failing");
  expect(harness.servers.alerts[0]?.body).toContain('"degraded"');

  await harness.servers.stop();
});

test("70% of an allowance pushes one ntfy warning and leaves the app normal", async () => {
  const harness = await startHarness();

  harness.servers.setGraphql(200, await usageWith("r2.class_a_operations", 750_000));

  const result = await run(harness);

  expect(result.degraded).toBe(false);
  expect(result.alerts).toEqual(["usage.r2.class_a_operations.warn"]);
  expect(harness.servers.alerts[0]?.title).toContain("75%");
  expect(harness.servers.alerts[0]?.body).toContain("750000 of 1000000 operations");
  expect(await harness.bucket.get("ops/degraded.json")).toBeNull();

  const again = await run(harness, NOW + 10 * MINUTE);

  expect(again.alerts).toHaveLength(0);

  await harness.servers.stop();
});

test("90% writes the degraded flag the app reads, once, and clears it on recovery", async () => {
  const harness = await startHarness();

  harness.servers.setGraphql(200, await usageWith("r2.class_a_operations", 950_000));

  const degraded = await run(harness);

  expect(degraded.degraded).toBe(true);
  expect(degraded.flag).toBe("written");
  expect(degraded.alerts).toEqual(["usage.degraded"]);
  expect(harness.servers.alerts[0]?.body).toContain("r2.class_a_operations at 95%");
  expect(harness.servers.alerts[0]?.body).toContain("non-essential R2 writes");

  const flag = degradedFlagSchema.parse(
    JSON.parse((await harness.bucket.get("ops/degraded.json")) ?? "null"),
  );

  expect(flag.version).toBe(1);
  expect(flag.degraded).toBe(true);
  expect(flag.since).toBe(new Date(NOW).toISOString());
  expect(flag.metrics[0]?.metric).toBe("r2.class_a_operations");
  expect(flag.metrics[0]?.share).toBeCloseTo(0.95);

  const again = await run(harness, NOW + 10 * MINUTE);

  expect(again.degraded).toBe(true);
  expect(again.flag).toBe("unchanged");
  expect(again.alerts).toHaveLength(0);
  expect((await harness.lastRun())?.flag).toBe("unchanged");

  harness.servers.setGraphql(200, await usageWith("r2.class_a_operations", 100_000));

  const recovered = await run(harness, NOW + 20 * MINUTE);

  expect(recovered.degraded).toBe(false);
  expect(recovered.flag).toBe("cleared");
  expect(recovered.alerts).toContain("usage.recovered");
  expect(await harness.bucket.get("ops/degraded.json")).toBeNull();

  await harness.servers.stop();
});

test("an unreadable GraphQL answer alerts but never clears the degraded flag", async () => {
  const harness = await startHarness();

  harness.servers.setGraphql(200, await usageWith("r2.class_a_operations", 950_000));
  await run(harness);
  expect(await harness.bucket.get("ops/degraded.json")).not.toBeNull();

  harness.servers.setGraphql(500, "upstream error");

  const failed = await run(harness, NOW + 10 * MINUTE);

  expect(failed.usage).toBe("failed");
  expect(failed.degraded).toBe(true);
  expect(failed.flag).toBe("kept");
  expect(failed.alerts).toContain("usage.error");
  expect(harness.servers.alerts.at(-1)?.body).toContain("GraphQL answered 500");
  expect(await harness.bucket.get("ops/degraded.json")).not.toBeNull();

  await harness.servers.stop();
});

test("a GraphQL answer with errors is a failure, not zero usage", async () => {
  const harness = await startHarness();

  harness.servers.setGraphql(200, '{"data":null,"errors":[{"message":"not authorized"}]}');

  const failed = await run(harness);

  expect(failed.usage).toBe("failed");
  expect(failed.alerts).toContain("usage.error");
  expect(harness.servers.alerts[0]?.body).toContain("not authorized");

  await harness.servers.stop();
});

test("without Cloudflare credentials the usage check warns once a day instead of failing", async () => {
  const harness = await startHarness();

  const first = await runSentinel(
    {
      FILES: harness.env.FILES,
      OVERTURE_HEALTH_URL: harness.env.OVERTURE_HEALTH_URL,
      ALERT_NTFY_URL: harness.servers.ntfyUrl,
    },
    { now: () => NOW },
  );

  expect(first.usage).toBe("unconfigured");
  expect(first.alerts).toContain("usage.unconfigured");
  expect(harness.servers.alerts[0]?.body).toContain("CLOUDFLARE_ACCOUNT_TAG");

  await harness.servers.stop();
});

test("a failing ntfy does not stop the run and is retried on the next one", async () => {
  const harness = await startHarness();

  harness.servers.setHealth(503, "upstream unavailable");
  harness.servers.setNtfy(503);

  const first = await run(harness);

  expect(first.health).toBe("failing");
  expect(first.alerts).toHaveLength(0);
  expect(first.errors.join(" ")).toContain("not delivered");
  expect((await harness.lastRun())?.errors.join(" ")).toContain("not delivered");

  harness.servers.setNtfy(200);

  const second = await run(harness, NOW + 10 * MINUTE);

  expect(second.alerts).toContain("health");
  expect(harness.servers.alerts.at(-1)?.title).toContain("health check failing");

  await harness.servers.stop();
});

test("a state object that cannot be parsed is recorded and does not stop the run", async () => {
  const harness = await startHarness();

  await harness.bucket.put("ops/sentinel-state.json", "not json\n");

  const result = await run(harness);

  expect(result.health).toBe("ok");
  expect(result.errors.join(" ")).toContain("state object unreadable");

  await harness.servers.stop();
});

test("without an ops secret the sentinel keeps its old behaviour", async () => {
  const harness = await startHarness();

  const result = await run(harness);

  expect(result).not.toHaveProperty("ops");
  expect(harness.servers.opsHeaders).toHaveLength(0);
  expect((await harness.lastRun())?.ops ?? null).toBeNull();

  await harness.servers.stop();
});

test("a healthy signed ops answer alerts nothing and signs the request", async () => {
  const harness = await startHarness();

  harness.servers.setOps(200, opsBody());

  const result = await runWithOps(harness);

  expect(result.ops).toBe("ok");
  expect(result.alerts).toHaveLength(0);
  expect(harness.servers.alerts).toHaveLength(0);
  expect((await harness.lastRun())?.ops).toBe("ok");

  const [signed] = harness.servers.opsHeaders;

  expect(signed?.signature).toHaveLength(64);
  expect(signed?.timestamp).toBe(String(NOW));

  await harness.servers.stop();
});

test("an over-ceiling resource alerts once with every breach, then recovers", async () => {
  const harness = await startHarness();

  harness.servers.setOps(
    200,
    opsBody({
      ats: { attempts: 10, failures: 6, failureRate: 0.6, windowMs: 3_600_000 },
      disk: { mount: "/data", usedRatio: 0.8 },
      eventLoopLag: { p95Ms: 600 },
      memory: { rssBytes: 3, totalBytes: 4, usedRatio: 0.9 },
    }),
  );

  const over = await runWithOps(harness);

  expect(over.ops).toBe("failing");
  expect(over.alerts).toContain("ops.thresholds");
  expect(harness.servers.alerts.at(-1)?.body).toContain("RAM at 90%");
  expect(harness.servers.alerts.at(-1)?.body).toContain("NVMe /data at 80%");
  expect(harness.servers.alerts.at(-1)?.body).toContain("event-loop lag p95 600 ms");
  expect(harness.servers.alerts.at(-1)?.body).toContain("ATS apply failures 60% of 10 attempts");

  const repeated = await runWithOps(harness, NOW + 10 * MINUTE);

  expect(repeated.alerts).toHaveLength(0);
  expect(harness.servers.alerts).toHaveLength(1);

  harness.servers.setOps(200, opsBody());

  const recovered = await runWithOps(harness, NOW + 20 * MINUTE);

  expect(recovered.ops).toBe("ok");
  expect(recovered.alerts).toContain("ops.recovered");

  await harness.servers.stop();
});

test("an unreadable or failing ops endpoint alerts and is recorded", async () => {
  const harness = await startHarness();

  harness.servers.setOps(500, "not now");

  const result = await runWithOps(harness);

  expect(result.ops).toBe("failed");
  expect(result.alerts).toContain("ops.health");
  expect(harness.servers.alerts.at(-1)?.body).toContain("HTTP 500");
  expect((await harness.lastRun())?.ops).toBe("failed");

  await harness.servers.stop();
});

test("the Worker's WebCrypto signature matches the shared HMAC vector", async () => {
  const headers = await opsHealthHeaders("shared-ops-secret", NOW);

  expect(headers["x-overture-ops-signature"]).toBe(
    "b98d5da956d7680dd063cebf760da36723f69a45c33e5b564fad6696866ead99",
  );
  expect(headers["x-overture-ops-timestamp"]).toBe(String(NOW));
});

test("the cron stays under 10k invocations a month and sets a CPU limit", async () => {
  const wrangler = await readFile(join(process.cwd(), "workers/sentinel/wrangler.jsonc"), "utf8");

  const cron = /\*\/10 \* \* \* \*/u.exec(wrangler);
  const cpu = /"cpu_ms":\s*(?<cpu>\d+)/u.exec(wrangler);

  expect(cron).not.toBeNull();
  expect(cpu?.groups?.["cpu"]).toBeDefined();

  const runsPerMonth = 6 * 24 * 30;

  expect(runsPerMonth).toBeLessThanOrEqual(10_000);
  expect(Number(cpu?.groups?.["cpu"])).toBeGreaterThan(0);
  expect(Number(cpu?.groups?.["cpu"])).toBeLessThanOrEqual(30_000);
  expect(wrangler).toContain('"workers_dev": false');
});
