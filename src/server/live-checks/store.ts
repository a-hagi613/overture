import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { LiveCheckResult } from "./types.ts";

import { liveCheckResults } from "../platform/db/schema.ts";

const detailSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));

function parseDetail(text: string) {
  return detailSchema.parse(JSON.parse(text));
}

export function recordLiveCheckResult(
  db: AppDatabase,
  clock: Clock,
  runId: string,
  result: LiveCheckResult,
) {
  db.insert(liveCheckResults)
    .values({
      id: crypto.randomUUID(),
      runId,
      checkName: result.check,
      ok: result.ok,
      startedAt: result.startedAt,
      durationMs: result.durationMs,
      detail: JSON.stringify(result.detail),
      createdAt: clock.now(),
    })
    .run();
}

export function latestLiveCheckAt(db: AppDatabase) {
  const row = db
    .select({ startedAt: liveCheckResults.startedAt })
    .from(liveCheckResults)
    .orderBy(desc(liveCheckResults.startedAt))
    .limit(1)
    .get();

  return row?.startedAt ?? null;
}

export function previousCheckDetail(db: AppDatabase, checkName: string) {
  const row = db
    .select({ detail: liveCheckResults.detail })
    .from(liveCheckResults)
    .where(eq(liveCheckResults.checkName, checkName))
    .orderBy(desc(liveCheckResults.startedAt))
    .limit(1)
    .get();

  if (row === undefined) {
    return null;
  }

  try {
    return parseDetail(row.detail);
  } catch {
    return null;
  }
}

export function readLiveCheckResults(db: AppDatabase, limit: number) {
  return db
    .select()
    .from(liveCheckResults)
    .orderBy(desc(liveCheckResults.startedAt))
    .limit(limit)
    .all()
    .map((row) => ({
      id: row.id,
      runId: row.runId,
      check: row.checkName,
      ok: row.ok,
      startedAt: row.startedAt,
      durationMs: row.durationMs,
      detail: parseDetail(row.detail),
      createdAt: row.createdAt,
    }));
}
