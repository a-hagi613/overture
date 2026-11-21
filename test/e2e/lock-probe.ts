import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { z } from "zod";

const BUSY_PRIMARY_CODE = 5;
const PAUSE_MS = 5;

const sqliteErrorSchema = z.object({
  errcode: z.number().optional(),
  code: z.string().optional(),
  message: z.string(),
});

function isBusy(cause: unknown) {
  const parsed = sqliteErrorSchema.safeParse(cause);

  if (!parsed.success) {
    return false;
  }

  const { code, errcode } = parsed.data;

  return (
    code?.startsWith("SQLITE_BUSY") === true ||
    (errcode !== undefined && errcode % 256 === BUSY_PRIMARY_CODE)
  );
}

const probeArgumentsSchema = z.tuple([
  z.string().min(1),
  z.string().min(1),
  z.string().min(1),
  z.string().min(1),
]);

const probeArguments = probeArgumentsSchema.safeParse(process.argv.slice(2));

if (!probeArguments.success) {
  throw new Error(
    "usage: bun run test/e2e/lock-probe.ts <database> <stop-file> <health-url> <busy-timeout-ms>",
  );
}

const [databasePath, stopFile, healthUrl, busyTimeoutArgument] = probeArguments.data;

const database = new DatabaseSync(databasePath);

database.exec(`PRAGMA busy_timeout = ${busyTimeoutArgument}`);

let lockAttempts = 0;
let busyTimeouts = 0;
let maxLockWaitMs = 0;
let healthChecks = 0;
let maxHealthMs = 0;

function probeLock() {
  const started = performance.now();

  try {
    database.exec("BEGIN IMMEDIATE");
    database.exec("COMMIT");

    lockAttempts += 1;
  } catch (error) {
    if (!isBusy(error)) {
      throw error;
    }

    busyTimeouts += 1;
  }

  maxLockWaitMs = Math.max(maxLockWaitMs, performance.now() - started);
}

const probe: () => Promise<void> = async () => {
  if (existsSync(stopFile)) {
    return;
  }

  probeLock();

  const healthStarted = performance.now();
  const response = await fetch(healthUrl);
  const body = await response.text();

  if (!response.ok || !body.includes('"database":"ok"')) {
    throw new Error(
      `the server was not healthy during the run: ${String(response.status)} ${body}`,
    );
  }

  healthChecks += 1;
  maxHealthMs = Math.max(maxHealthMs, performance.now() - healthStarted);

  await Bun.sleep(PAUSE_MS);
  await probe();
};

process.stdout.write("ready\n");

await probe();

database.close();

process.stdout.write(
  `${JSON.stringify({
    lockAttempts,
    busyTimeouts,
    maxLockWaitMs: Math.round(maxLockWaitMs),
    healthChecks,
    maxHealthMs: Math.round(maxHealthMs),
  })}\n`,
);
