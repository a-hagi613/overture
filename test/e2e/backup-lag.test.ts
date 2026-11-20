import { spawn } from "node:child_process";

import type { ChildProcess } from "node:child_process";

import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import { expect, test } from "@playwright/test";

import { testAuthEnvironment } from "./auth.fixture.ts";
import { startAppServer } from "./app-server.ts";

const replicasCaughtUpSchema = z.object({
  replication: z.literal("ok"),
  lagSeconds: z.number(),
  replicaTxid: z.string(),
});

const healthResponseSchema = z.object({
  status: z.string(),
  database: z.string(),
  backups: z.looseObject({ replication: z.string() }).optional(),
});

const clockResponseSchema = z.object({ now: z.number() });

const replicationLevels = [0, 1, 2, 3, 9];

let directory = "";
let replicator: ChildProcess | undefined;
let server: Awaited<ReturnType<typeof startAppServer>> | undefined;

test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "overture-backup-lag-"));

  const databasePath = join(directory, "live.db");

  copyFileSync(join(process.cwd(), "test/e2e/.tmp/template.db"), databasePath);

  const configPath = join(directory, "litestream.yml");

  writeFileSync(
    configPath,
    `dbs:\n  - path: ${databasePath}\n    replicas:\n      - type: file\n        path: ${join(directory, "replica")}\n`,
  );

  replicator = spawn("litestream", ["replicate", "-config", configPath], { stdio: "ignore" });
  server = await startAppServer(databasePath, {
    ...testAuthEnvironment,
    LITESTREAM_CONFIG_PATH: configPath,
  });
});

test.afterAll(async () => {
  if (server !== undefined) {
    await server.stop();
  }

  if (replicator !== undefined) {
    replicator.kill("SIGTERM");
  }

  if (directory !== "") {
    setReplicaLevelPermissions(directory, 0o755);
    rmSync(directory, { force: true, recursive: true });
  }
});

function replicaLevelPath(directoryPath: string, level: number) {
  return join(directoryPath, "replica", "ltx", String(level));
}

function setReplicaLevelPermissions(directoryPath: string, mode: number) {
  for (const level of replicationLevels) {
    mkdirSync(replicaLevelPath(directoryPath, level), { recursive: true });
    chmodSync(replicaLevelPath(directoryPath, level), mode);
  }
}

async function readReplicaBackups() {
  if (server === undefined) {
    return null;
  }

  try {
    const response = await fetch(`${server.url}/api/health`);

    if (!response.ok) {
      return null;
    }

    const body = healthResponseSchema.parse(await response.json());

    if (body.backups?.replication !== "ok") {
      return null;
    }

    return replicasCaughtUpSchema.parse(body.backups);
  } catch {
    return null;
  }
}

test("an idle database reports lag 0, a pending write reports lag, and a replicated write clears it", async () => {
  test.setTimeout(150_000);

  await expect
    .poll(async () => (await readReplicaBackups())?.replication, { timeout: 30_000 })
    .toBe("ok");

  const idle = await readReplicaBackups();

  expect(idle?.lagSeconds).toBe(0);

  setReplicaLevelPermissions(directory, 0o555);

  const serverUrl = server?.url ?? "";
  const clock = await fetch(`${serverUrl}/__test__/clock`);
  const { now } = clockResponseSchema.parse(await clock.json());

  const enqueue = await fetch(`${serverUrl}/__test__/jobs/enqueue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "test.ping",
      payload: '{"msg":"backup lag"}',
      runAt: now + 60 * 60_000,
    }),
  });

  expect(enqueue.ok).toBe(true);

  await expect
    .poll(async () => (await readReplicaBackups())?.lagSeconds, { timeout: 60_000 })
    .toBeGreaterThan(0);

  setReplicaLevelPermissions(directory, 0o755);

  await expect
    .poll(async () => (await readReplicaBackups())?.lagSeconds, { timeout: 60_000 })
    .toBe(0);
});
