import { createHmac, timingSafeEqual } from "node:crypto";
import { statfs } from "node:fs/promises";
import { totalmem } from "node:os";
import { dirname, resolve } from "node:path";

import { eq, gte } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { applications, attempts } from "../platform/db/schema.ts";
import { measureSqliteQuery } from "../platform/telemetry/sqlite-metrics.ts";

/** The signed ops endpoint the sentinel polls (WS-21, issue #634). */
export const OPS_HEALTH_PATH = "/internal/ops/health";

/** The epoch-millisecond header the signature covers. */
export const OPS_HEALTH_TIMESTAMP_HEADER = "x-overture-ops-timestamp";

/** The lowercase-hex HMAC-SHA256 signature header. */
export const OPS_HEALTH_SIGNATURE_HEADER = "x-overture-ops-signature";

/** How far a signed request's timestamp may be from the receiver's clock. */
export const OPS_HEALTH_MAX_SKEW_MS = 5 * 60_000;

/** The ATS failure window the health answer summarizes. */
export const OPS_HEALTH_ATS_WINDOW_MS = 60 * 60_000;

const NOT_AN_ATTEMPT = new Set(["posting_closed", "duplicate", "needs_review"]);

/**
 * The HMAC the sentinel sends and this endpoint verifies: `METHOD\npath\ntimestamp`.
 * @param secret The shared ops secret.
 * @param timestamp The epoch-millisecond timestamp as a string.
 * @param method The request method.
 * @param path The signed path.
 * @returns Lowercase hex.
 */
export function opsHealthSignature(
  secret: string,
  timestamp: string,
  method = "GET",
  path = OPS_HEALTH_PATH,
) {
  return createHmac("sha256", secret).update(`${method}\n${path}\n${timestamp}`).digest("hex");
}

function headerValue(
  context: { req: { header: (name: string) => string | undefined } },
  name: string,
) {
  return context.req.header(name) ?? null;
}

function refuse(context: Context, status: 401 | 403) {
  return context.json({ error: status === 401 ? "unauthorized" : "forbidden" }, status);
}

export interface InternalOpsHealthDeps {
  db: AppDatabase;
  clock: Clock;
  secret: string;
  /** The application database path; its directory is the filesystem measured (`/data` on Fly). */
  databasePath: string;
  /** The rolling p95 the event-loop sampler keeps. Null before the first sample. */
  eventLoopLagP95Ms?: () => number | null;
  /** Test seams. */
  readMemory?: () => { rssBytes: number; totalBytes: number };
  readDisk?: (mount: string) => { usedRatio: number } | Promise<{ usedRatio: number }>;
}

function defaultReadMemory() {
  return { rssBytes: process.memoryUsage().rss, totalBytes: totalmem() };
}

async function defaultReadDisk(mount: string) {
  const stats = await statfs(mount);

  return {
    usedRatio: stats.blocks === 0 ? 0 : 1 - stats.bavail / stats.blocks,
  };
}

/**
 * The authenticated ops answer. It exists so the sentinel can page on RAM, disk, event-loop lag and
 * an ATS failure spike without the public `/api/health` exposing the machine's internals: the public
 * probe still answers only `status`/`database`/backups.
 *
 * A missing, expired or wrong signature fails closed with a 401 (and a 403 when the route is mounted
 * with no secret). The body carries ratios and bounded counts, never a user or job identifier.
 * @param deps The database, clock, shared secret, data directory, lag reader and test seams.
 * @returns The mounted route.
 */
export function createInternalOpsHealthRoutes(deps: InternalOpsHealthDeps) {
  const { db, clock, secret, databasePath } = deps;
  const mount = dirname(resolve(databasePath));
  const readMemory = deps.readMemory ?? defaultReadMemory;
  const readDisk = deps.readDisk ?? defaultReadDisk;
  const routes = new Hono();

  routes.get(OPS_HEALTH_PATH, async (context) => {
    if (secret.trim().length === 0) {
      return refuse(context, 403);
    }

    const timestamp = headerValue(context, OPS_HEALTH_TIMESTAMP_HEADER);
    const signature = headerValue(context, OPS_HEALTH_SIGNATURE_HEADER);

    if (timestamp === null || signature === null) {
      return refuse(context, 401);
    }

    const timestampMs = Number(timestamp);

    if (
      !Number.isFinite(timestampMs) ||
      Math.abs(clock.now() - timestampMs) > OPS_HEALTH_MAX_SKEW_MS
    ) {
      return refuse(context, 401);
    }

    const expected = opsHealthSignature(secret, timestamp, context.req.method, OPS_HEALTH_PATH);
    const given = Buffer.from(signature.toLowerCase(), "hex");
    const wanted = Buffer.from(expected, "hex");

    if (given.byteLength !== wanted.byteLength || !timingSafeEqual(given, wanted)) {
      return refuse(context, 401);
    }

    const memory = readMemory();
    const disk = await readDisk(mount);

    const since = clock.now() - OPS_HEALTH_ATS_WINDOW_MS;

    const rows = measureSqliteQuery("app", "select", () =>
      db
        .select({ outcome: attempts.outcome })
        .from(attempts)
        .innerJoin(applications, eq(applications.id, attempts.applicationId))
        .where(gte(attempts.startedAt, since))
        .all(),
    );

    const attempted = rows.filter(
      (row) => row.outcome !== null && !NOT_AN_ATTEMPT.has(row.outcome),
    );

    const failures = attempted.filter((row) => row.outcome !== "sent").length;

    context.header("Cache-Control", "no-store");

    return context.json({
      ats: {
        attempts: attempted.length,
        failureRate: attempted.length === 0 ? 0 : failures / attempted.length,
        failures,
        windowMs: OPS_HEALTH_ATS_WINDOW_MS,
      },
      at: clock.now(),
      disk: {
        mount,
        usedRatio: disk.usedRatio,
      },
      eventLoopLag: {
        p95Ms: deps.eventLoopLagP95Ms?.() ?? null,
      },
      memory: {
        rssBytes: memory.rssBytes,
        totalBytes: memory.totalBytes,
        usedRatio: memory.totalBytes === 0 ? 0 : memory.rssBytes / memory.totalBytes,
      },
      status: "ok",
    });
  });

  return routes;
}
