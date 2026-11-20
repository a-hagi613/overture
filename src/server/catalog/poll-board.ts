import { and, eq, inArray, sql } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import { companyBoards, postings } from "../platform/db/schema.ts";
import { contentHash } from "./content-hash.ts";
import type { GreenhouseFeed, GreenhouseFeedJob } from "./greenhouse-feed.ts";

export interface PollBoardReport {
  added: number;
  updated: number;
  closed: number;
}

const ACTIVE_INTERVAL_MS = 30 * 60_000;
const QUIET_INTERVAL_MS = 2 * 3_600_000;
const INACTIVE_INTERVAL_MS = 12 * 3_600_000;

function nextPollAtMs(now: number, latestChangeMs: number | null): number {
  if (latestChangeMs === null) {
    return now + INACTIVE_INTERVAL_MS;
  }

  if (now - latestChangeMs < RECENT_CHANGE_WINDOW_MS) {
    return now + ACTIVE_INTERVAL_MS;
  }

  if (now - latestChangeMs < 7 * RECENT_CHANGE_WINDOW_MS) {
    return now + QUIET_INTERVAL_MS;
  }

  return now + INACTIVE_INTERVAL_MS;
}

const RECENT_CHANGE_WINDOW_MS = 24 * 3_600_000;

async function upsertChangedJobs(
  db: AppDatabase,
  board: { id: string; companyId: string; ats: "greenhouse" },
  jobs: GreenhouseFeedJob[],
  now: number,
): Promise<PollBoardReport> {
  const report: PollBoardReport = { added: 0, updated: 0, closed: 0 };
  const seenJobIds = new Set<string>();

  for (const job of jobs) {
    seenJobIds.add(String(job.id));

    const existing = db
      .select()
      .from(postings)
      .where(and(eq(postings.boardId, board.id), eq(postings.atsJobId, String(job.id))))
      .get();

    const jobUpdatedAtMs = job.updatedAt === null ? null : Date.parse(job.updatedAt);
    const unchanged =
      existing !== undefined && existing.closedAt === null && existing.sourceUpdatedAt === job.updatedAtMs;

    if (unchanged) {
      continue;
    }

    const content = await feed.fetchJobContent(board.boardToken, job.id);
    const descriptionGz = content === null ? null : Bun.gzipSync(Buffer.from(content, "utf8"));
    const descriptionHash = content === null ? null : contentHash(content);

    if (existing === undefined) {
      db.insert(postings)
        .values({
          boardId: board.id,
          companyId: board.companyId,
          ats: board.ats,
          atsJobId: String(job.id),
          url: job.absoluteUrl ?? "",
          applyUrlNorm: applyUrlNorm(job.absoluteUrl ?? ""),
          title: job.title,
          titleNorm: titleNorm(job.title),
          department: null,
          locationRaw: job.locationName,
          countryCode: null,
          postedAt: job.updatedAt === null ? null : Date.parse(job.postedAt ?? job.updatedAt),
          sourceUpdatedAt: job.updatedAtMs,
          firstSeenAt: now,
          lastSeenAt: now,
          missingPolls: 0,
          dedupeKey: dedupeKeyFor(board.companyId, job.title),
          descriptionGz,
          descriptionHash,
        })
        .onConflictDoNothing()
        .run();
    } else {
      db.update(postings)
        .set({
          title: job.title,
          applyUrlNorm: applyUrlNorm(job.absoluteUrl ?? ""),
          descriptionGz,
          descriptionHash,
          lastSeenAt: now,
          missingPolls: 0,
        })
        .where(eq(postings.id, existing.id))
        .run();
    }
  }

  return report;
}
