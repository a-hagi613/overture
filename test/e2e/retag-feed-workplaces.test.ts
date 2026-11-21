import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import {
  CLOSED_POSTINGS,
  EXPECTED_POSTINGS_RESET,
  GREENHOUSE_POSTINGS,
  readRetagState,
  seedRetagCatalog,
} from "./retag-harness.ts";
import { expect, test } from "./app.fixture.ts";

const MAX_WRITE_LOCK_MS = 1000;
const HEALTH_URL = "/api/health";

const retagReportSchema = z.object({ boardsReset: z.number(), postingsReset: z.number() });

const probeSchema = z.object({
  lockAttempts: z.number(),
  busyTimeouts: z.number(),
  maxLockWaitMs: z.number(),
  healthChecks: z.number(),
  maxHealthMs: z.number(),
});

async function runRetag(databasePath: string) {
  const child = Bun.spawn({
    cmd: ["bun", "run", "scripts/retag-feed-workplace.ts", "--db", databasePath],
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`retag-feed-workplace exited ${String(exitCode)}: ${stderr}`);
  }

  return retagReportSchema.parse(JSON.parse(stdout));
}

type Reader = (text: string) => Promise<string>;

function readerFor(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  const reader = stream.getReader();

  const readUntilReady: Reader = async (text) => {
    const { done, value } = await reader.read();

    if (done) {
      throw new Error("the lock probe stopped before it was ready");
    }

    const next = text + decoder.decode(value, { stream: true });

    return next.includes("ready\n") ? next : readUntilReady(next);
  };

  const readToEnd: Reader = async (text) => {
    const { done, value } = await reader.read();

    return done ? text : readToEnd(text + decoder.decode(value, { stream: true }));
  };

  return { readUntilReady, readToEnd };
}

function parseProbeReport(text: string) {
  const line = text.split("\n").findLast((candidate) => candidate.startsWith("{"));

  if (line === undefined) {
    throw new Error(`the lock probe printed no report: ${text}`);
  }

  return probeSchema.parse(JSON.parse(line));
}

test("the retag script holds no write lock past one second, stays idempotent, and leaves the server responsive", async ({
  isolatedAppServer: { url, databasePath },
}) => {
  seedRetagCatalog(databasePath);

  const directory = mkdtempSync(join(tmpdir(), "overture-retag-"));
  const stopFile = join(directory, "probe.stop");

  const probe = Bun.spawn({
    cmd: [
      "bun",
      "run",
      "test/e2e/lock-probe.ts",
      databasePath,
      stopFile,
      `${url}${HEALTH_URL}`,
      String(MAX_WRITE_LOCK_MS),
    ],
    stderr: "pipe",
    stdout: "pipe",
  });

  try {
    const { readUntilReady, readToEnd } = readerFor(probe.stdout);
    const readyText = await readUntilReady("");
    const first = await runRetag(databasePath);

    writeFileSync(stopFile, "stop");

    const probeText = await readToEnd(readyText);
    const probeExitCode = await probe.exited;

    if (probeExitCode !== 0) {
      const stderr = await new Response(probe.stderr).text();

      throw new Error(`the lock probe exited ${String(probeExitCode)}: ${stderr}`);
    }

    const report = parseProbeReport(probeText);

    expect(report.busyTimeouts).toBe(0);
    expect(report.maxLockWaitMs).toBeLessThan(MAX_WRITE_LOCK_MS);
    expect(report.lockAttempts).toBeGreaterThan(0);
    expect(report.healthChecks).toBeGreaterThan(0);
    expect(report.maxHealthMs).toBeLessThan(MAX_WRITE_LOCK_MS);

    expect(first).toEqual({ boardsReset: 2, postingsReset: EXPECTED_POSTINGS_RESET });

    const second = await runRetag(databasePath);

    expect(second).toEqual({ boardsReset: 0, postingsReset: 0 });

    expect(readRetagState(databasePath)).toEqual({
      openFeedPostingsWithHash: 0,
      closedFeedPostingsWithHash: CLOSED_POSTINGS,
      greenhousePostingsWithHash: GREENHOUSE_POSTINGS,
      feedBoardsWithHash: 0,
      greenhouseBoardsWithHash: 1,
    });
  } finally {
    if (!existsSync(stopFile)) {
      writeFileSync(stopFile, "stop");
    }

    probe.kill();
  }
});
