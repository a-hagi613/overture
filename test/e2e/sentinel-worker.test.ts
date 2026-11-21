import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { expect, test } from "@playwright/test";

import type { R2BucketBinding, SentinelBucket } from "../../workers/sentinel/src/bucket.ts";

import { runSentinel } from "../../workers/sentinel/src/index.ts";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 21, 15, 0, 0, 0);

function fixture(name: string) {
  return readFileSync(join(process.cwd(), "test/e2e/fixtures/sentinel", name), "utf8");
}

function diskBucket(root: string): SentinelBucket {
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
  };
}

interface Recording {
  alerts: { title: string; body: string; tags: string }[];
}

interface Servers {
  healthUrl: string;
  graphqlUrl: string;
  ntfyUrl: string;
  recording: Recording;
  setHealth: (status: number, body: string) => void;
  setGraphql: (status: number, body: string) => void;
  stop: () => Promise<void>;
}

async function startServers(): Promise<Servers> {
  let health = { status: 200, body: fixture("health-ok.json") };
  let graphql = { status: 200, body: fixture("usage-graphql.json") };
  const recording: Recording = { alerts: [] };

  const healthServer = Bun.serve({
    port: 0,
    fetch: () => new Response(health.body, { status: health.status }),
  });

  const graphqlServer = Bun.serve({
    port: 0,
    fetch: () => new Response(graphql.body, { status: graphql.status }),
  });

  const ntfyServer = Bun.serve({
    port: 0,
    async fetch(request) {
      recording.alerts.push({
        title: request.headers.get("title") ?? "",
        body: await request.text(),
        tags: request.headers.get("tags") ?? "",
      });

      return new Response("ok");
    },
  });

  return {
    healthUrl: `http://127.0.0.1:${String(healthServer.port)}/api/health`,
    graphqlUrl: `http://127.0.0.1:${String(graphqlServer.port)}/graphql`,
    ntfyUrl: `http://127.0.0.1:${String(ntfyServer.port)}/topic`,
    recording,
    setHealth: (status, body) => {
      health = { status, body };
    },
    setGraphql: (status, body) => {
      graphql = { status, body };
    },
    stop: async () => {
      await Promise.all([healthServer.stop(true), graphqlServer.stop(true), ntfyServer.stop(true)]);
    },
  };
}

interface Harness {
  servers: Servers;
  bucket: SentinelBucket;
  env: Parameters<typeof runSentinel>[0];
  writeManifest: (fetchedAt: number) => Promise<void>;
  logs: string[];
}

async function startHarness(): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "overture-sentinel-"));
  const servers = await startServers();
  const bucket = diskBucket(root);
  const logs: string[] = [];

  const files: R2BucketBinding = {
    get: async (key) => {
      const text = await bucket.get(key);

      return text === null ? null : { text: async () => text };
    },
    put: async (key, value) => bucket.put(key, value),
    delete: async (key) => bucket.delete(key),
  };

  return {
    servers,
    bucket,
    logs,
    env: {
      FILES: files,
      OVERTURE_HEALTH_URL: servers.healthUrl,
      ALERT_NTFY_URL: servers.ntfyUrl,
      CLOUDFLARE_ACCOUNT_TAG: "0123456789abcdef0123456789abcdef",
      CLOUDFLARE_ANALYTICS_TOKEN: "sentinel-test-token",
      CLOUDFLARE_GRAPHQL_URL: servers.graphqlUrl,
    },
    writeManifest: async (fetchedAt) => {
      await bucket.put(
        "workable/manifest.json",
        `${JSON.stringify({
          version: 1,
          snapshot: "workable/2026-11-21.jsonl.gz",
          fetchedAt: new Date(fetchedAt).toISOString(),
          sourceLastModified: new Date(fetchedAt).toISOString(),
          feedJobs: 170_000,
          distinctReferences: 5000,
          duplicates: 400,
          rows: 5000,
          bytes: 1_000_000,
          contentHash: "a".repeat(64),
        })}\n`,
      );
    },
  };
}

async function run(harness: Harness, at = NOW) {
  return runSentinel(harness.env, {
    now: () => at,
    log: (line) => {
      harness.logs.push(line);
    },
  });
}

/** The recorded answer with one metric scaled, so a threshold scenario keeps the recorded shape. */
function usageAt(id: string, used: number) {
  const payload = JSON.parse(fixture("usage-graphql.json")) as {
    data: { viewer: { accounts: Record<string, unknown>[] } };
  };

  const account = payload.data.viewer.accounts[0];

  if (account === undefined) {
    throw new Error("the recorded GraphQL answer carries no account");
  }

  if (id === "r2.class_a_operations") {
    account.r2OperationsAdaptiveGroups = [
      { dimensions: { actionStatus: "success", actionType: "PutObject" }, sum: { requests: used } },
    ];
  } else if (id === "queues.billable_operations") {
    account.queueMessageOperationsAdaptiveGroups = [
      {
        dimensions: { actionType: "WriteMessage", queueID: "q" },
        sum: { billableOperations: used },
      },
    ];
  } else {
    throw new Error(`unknown metric ${id}`);
  }

  return JSON.stringify(payload);
}

test("a healthy app, a fresh manifest and low usage alert nothing", async () => {
  const harness = await startHarness();

  harness.setHealth(200, fixture("health-ok.json"));
  await harness.writeManifest(NOW - HOUR);

  const result = await run(harness);

  expect(result.health).toBe("ok");
  expect(result.manifest.state).toBe("fresh");
  expect(result.degraded).toBe(false);
  expect(harness.servers.recording.alerts).toHaveLength(0);
  expect(await harness.bucket.get("ops/degraded.json")).toBeNull();

  await harness.servers.stop();
});

test("a failing health probe and a missing manifest alert once each", async () => {
  const harness = await startHarness();

  harness.setHealth(503, "upstream unavailable");

  const first = await run(harness);

  expect(first.health).toBe("failing");
  expect(first.manifest.state).toBe("missing");
  expect(first.alerts).toEqual(expect.arrayContaining(["health", "workable"]));
  expect(harness.servers.recording.alerts).toHaveLength(2);

  const second = await run(harness, NOW + 10 * 60_000);

  expect(second.alerts).toHaveLength(0);
  expect(harness.servers.recording.alerts).toHaveLength(2);

  harness.setHealth(200, fixture("health-ok.json"));
  await harness.writeManifest(NOW + 20 * 60_000 - HOUR);

  const recovered = await run(harness, NOW + 20 * 60_000);

  expect(recovered.alerts).toEqual(expect.arrayContaining(["health.recovered"]));
  expect(harness.servers.recording.alerts.at(-1)?.title).toContain("recovered");

  await harness.servers.stop();
});

test("70% of an allowance pushes one ntfy warning and leaves the app normal", async () => {
  const harness = await startHarness();

  await harness.writeManifest(NOW - HOUR);
  harness.servers.setGraphql(200, usageAt("r2.class_a_operations", 750_000));

  const result = await run(harness);

  expect(result.degraded).toBe(false);
  expect(result.alerts).toContain("usage.r2.class_a_operations.warn");
  expect(harness.servers.recording.alerts[0]?.title).toContain("70%");
  expect(harness.servers.recording.alerts[0]?.body).toContain("750000");
  expect(await harness.bucket.get("ops/degraded.json")).toBeNull();

  await harness.servers.stop();
});

test("90% writes the degraded flag the app reads, and clears it on recovery", async () => {
  const harness = await startHarness();

  await harness.writeManifest(NOW - HOUR);
  harness.servers.setGraphql(200, usageAt("r2.class_a_operations", 950_000));

  const degraded = await run(harness);

  expect(degraded.degraded).toBe(true);
  expect(degraded.alerts).toContain("usage.r2.class_a_operations.degraded");
  expect(degraded.alerts).toContain("usage.degraded");

  const flag = JSON.parse((await harness.bucket.get("ops/degraded.json")) ?? "null") as {
    version: number;
    degraded: boolean;
    since: string;
    metrics: { metric: string; share: number }[];
  };

  expect(flag.version).toBe(1);
  expect(flag.degraded).toBe(true);
  expect(flag.since).toBe(new Date(NOW).toISOString());
  expect(flag.metrics[0]?.metric).toBe("r2.class_a_operations");
  expect(flag.metrics[0]?.share).toBeCloseTo(0.95);

  const again = await run(harness, NOW + 10 * 60_000);

  expect(again.degraded).toBe(true);
  expect(again.alerts).not.toContain("usage.degraded");

  harness.servers.setGraphql(200, usageAt("r2.class_a_operations", 100_000));

  const recovered = await run(harness, NOW + 20 * 60_000);

  expect(recovered.degraded).toBe(false);
  expect(recovered.alerts).toContain("usage.recovered");
  expect(await harness.bucket.get("ops/degraded.json")).toBeNull();

  await harness.servers.stop();
});

test("an unreadable GraphQL answer alerts but never clears the degraded flag", async () => {
  const harness = await startHarness();

  await harness.writeManifest(NOW - HOUR);
  harness.servers.setGraphql(200, usageAt("r2.class_a_operations", 950_000));
  await run(harness);
  expect(await harness.bucket.get("ops/degraded.json")).not.toBeNull();

  harness.servers.setGraphql(500, "upstream error");

  const failed = await run(harness, NOW + 10 * 60_000);

  expect(failed.usage).toBe("failed");
  expect(failed.degraded).toBe(true);
  expect(failed.alerts).toContain("usage.error");
  expect(await harness.bucket.get("ops/degraded.json")).not.toBeNull();

  await harness.servers.stop();
});

test("the cron stays under 10k invocations a month and sets a CPU limit", async () => {
  const wrangler = await readFile(join(process.cwd(), "workers/sentinel/wrangler.jsonc"), "utf8");

  const cron = /\*\/10 \* \* \* \*/u.exec(wrangler);
  const cpu = /"cpu_ms":\s*(?<cpu>\d+)/u.exec(wrangler);

  expect(cron).not.toBeNull();
  expect(cpu?.groups?.cpu).toBeDefined();

  const runsPerMonth = 6 * 24 * 30;

  expect(runsPerMonth).toBeLessThanOrEqual(10_000);
  expect(Number(cpu?.groups?.cpu)).toBeGreaterThan(0);
});
