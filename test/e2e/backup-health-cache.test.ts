import { spawn } from "node:child_process";

import type { ChildProcess } from "node:child_process";

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import { expect, test } from "@playwright/test";

import { testAuthEnvironment } from "./auth.fixture.ts";
import { startAppServer } from "./app-server.ts";
import { copyTemplateDatabases } from "./template-databases.ts";
import { waitForReplicaTransactions } from "./replication.fixture.ts";

const healthSchema = z.object({
  status: z.string(),
  database: z.string(),
  backups: z
    .looseObject({ replication: z.string(), readAgeSeconds: z.number().nullable() })
    .optional(),
});

const clockOffsetSchema = z.object({ now: z.number(), offsetMs: z.number() });

async function timedHealth(url: string) {
  const started = performance.now();
  const response = await fetch(`${url}/api/health`);
  const body = healthSchema.parse(await response.json());

  return {
    latencyMs: performance.now() - started,
    replication: body.backups?.replication,
    readAgeSeconds: body.backups?.readAgeSeconds,
  };
}

async function waitForReplication(url: string) {
  await expect
    .poll(async () => (await timedHealth(url)).replication, { timeout: 30_000 })
    .toBe("ok");
}

async function startReplicatedServer(
  directory: string,
  extraEnvironment: Record<string, string> = {},
) {
  const databasePath = join(directory, "live.db");

  copyTemplateDatabases(databasePath);

  const configPath = join(directory, "litestream.yml");

  writeFileSync(
    configPath,
    `dbs:\n  - path: ${databasePath}\n    replicas:\n      - type: file\n        path: ${join(directory, "replica")}\n`,
  );

  const replicator: ChildProcess = spawn("litestream", ["replicate", "-config", configPath], {
    stdio: "ignore",
  });

  await waitForReplicaTransactions(directory);

  const server = await startAppServer(databasePath, {
    ...testAuthEnvironment,
    LITESTREAM_CONFIG_PATH: configPath,
    ...extraEnvironment,
  });

  return {
    server,
    stop: async () => {
      await server.stop();
      replicator.kill("SIGTERM");
    },
  };
}

const SLOW_LISTING_MS = 3000;
const CACHED_ANSWER_LIMIT_MS = 500;

test("health answers from the cached reading without waiting for a slow replica listing", async () => {
  test.setTimeout(120_000);

  const directory = mkdtempSync(join(tmpdir(), "overture-health-cache-"));

  try {
    const slowLitestream = join(directory, "slow-litestream");

    writeFileSync(
      slowLitestream,
      `#!/bin/sh\nsleep ${String(SLOW_LISTING_MS / 1000)}\nexec litestream "$@"\n`,
    );
    chmodSync(slowLitestream, 0o755);

    const { server, stop } = await startReplicatedServer(directory, {
      LITESTREAM_BINARY: slowLitestream,
    });

    try {
      await timedHealth(server.url);

      const latencies: number[] = [];
      const cold = await timedHealth(server.url);

      latencies.push(cold.latencyMs);

      expect(cold.replication).toBe("unknown");

      await expect
        .poll(
          async () => {
            const sample = await timedHealth(server.url);

            latencies.push(sample.latencyMs);

            return sample.replication;
          },
          { timeout: 30_000 },
        )
        .toBe("ok");

      expect(Math.max(...latencies)).toBeLessThan(CACHED_ANSWER_LIMIT_MS);
    } finally {
      await stop();
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a shorter read interval saved in Settings applies within one interval", async () => {
  test.setTimeout(120_000);

  const directory = mkdtempSync(join(tmpdir(), "overture-health-interval-"));

  try {
    const { server, stop } = await startReplicatedServer(directory);

    try {
      await waitForReplication(server.url);

      await expect
        .poll(async () => (await timedHealth(server.url)).readAgeSeconds, { timeout: 10_000 })
        .toBeGreaterThanOrEqual(1);

      const saved = await fetch(
        `${server.url}/__test__/settings/backups.replica_read_interval_ms`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ value: "1000" }),
        },
      );

      expect(saved.ok).toBe(true);

      const { offsetMs } = clockOffsetSchema.parse(
        await (await fetch(`${server.url}/__test__/clock`)).json(),
      );

      const offset = await fetch(`${server.url}/__test__/clock/offset`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ offsetMs: offsetMs + 10_000 }),
      });

      expect(clockOffsetSchema.parse(await offset.json()).offsetMs).toBe(offsetMs + 10_000);

      await expect
        .poll(async () => (await timedHealth(server.url)).replication, { timeout: 10_000 })
        .toBe("ok");
    } finally {
      await stop();
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a cached reading older than three intervals reports unknown", async () => {
  test.setTimeout(120_000);

  const directory = mkdtempSync(join(tmpdir(), "overture-health-stale-"));

  try {
    const { server, stop } = await startReplicatedServer(directory);

    try {
      await waitForReplication(server.url);

      const offset = await fetch(`${server.url}/__test__/clock/offset`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ offsetMs: 200_000 }),
      });

      expect(clockOffsetSchema.parse(await offset.json()).offsetMs).toBe(200_000);

      const stale = await timedHealth(server.url);

      expect(stale.replication).toBe("unknown");
      expect(stale.readAgeSeconds).toBeGreaterThan(90);
    } finally {
      await stop();
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
