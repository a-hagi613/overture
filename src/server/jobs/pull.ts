import { eq, isNotNull } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { jobPullRuns, jobPullState, profiles, targets } from "../platform/db/schema.ts";
import { atsForFreehireSource, timestampOf } from "../../shared/freehire.ts";
import type { FreehireJobRecord } from "../../shared/freehire.ts";
import { getSetting, getSettingNumber, setSetting } from "../platform/settings/index.ts";
import { publishEvent } from "../platform/sse/stream.ts";
import { logError } from "../platform/log.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import type { JobHandlers } from "../platform/jobs/queue.ts";
import type { ApplyTarget } from "./apply-link.ts";
import { resolveApplyTarget } from "./apply-link.ts";
import { promotePlaceValues } from "../places/resolve.ts";
import type { JobSearchPage, JobSource } from "./source.ts";
import type { PullPreferences } from "./preferences.ts";
import { paidUserIds, pullPreferencesFor, queryKeyOf, searchQueryFor } from "./preferences.ts";
import type { JobStore } from "./store.ts";

export const JOBS_PULL_JOB_KIND = "jobs.pull";
export const JOBS_PULL_USER_JOB_KIND = "jobs.pull.user";

const PULL_DEDUPE_KEY = JOBS_PULL_JOB_KIND;
const PAGE_SIZE = 100;
const MAX_OFFSET = 10_000;
const ALERT_AFTER_FAILURES = 3;
const FAILURE_SETTING = "jobs.pull_failures";
const CURSOR_SETTING = "jobs.changes_cursor";

const stringArray = z.array(z.string());

function stringArrayFromColumn(value: string) {
  return stringArray.parse(JSON.parse(value));
}

/** One grouped pull's tally, also written to the event log and to `job_pull_runs`. */
export interface PullCounters {
  fetched: number;
  kept: number;
  droppedClosed: number;
  droppedDuplicate: number;
  droppedNoLink: number;
  droppedUnsupported: number;
}

function emptyCounters() {
  return {
    droppedClosed: 0,
    droppedDuplicate: 0,
    droppedNoLink: 0,
    droppedUnsupported: 0,
    fetched: 0,
    kept: 0,
  };
}

export interface PullMember {
  userId: string;
  queryKey: string;
}

interface PullMemberRow {
  userId: string;
  roles: string;
  locations: string;
  unresolvedLocations: string;
  lastFullPullAt: number | null;
  lastFreshPullAt: number | null;
  lastQueryKey: string | null;
}

interface Group {
  key: string;
  members: PullMember[];
  preferences: PullPreferences;
}

export interface PullDeps {
  db: AppDatabase;
  clock: Clock;
  source: JobSource;
  store: JobStore;
  /** Builds a job's application target; defaults to the freehire adapter's resolver. */
  applyTarget?: (job: FreehireJobRecord) => Promise<ApplyTarget | null>;
  /** Whether the source has an API key, which turns on the change feed. */
  hasApiKey?: boolean;
  onAlert?: (detail: Record<string, string | number | boolean | null>) => void;
}

function preferencesOf(row: Pick<PullMemberRow, "roles" | "locations" | "unresolvedLocations">) {
  const places = promotePlaceValues([
    ...stringArrayFromColumn(row.locations),
    ...stringArrayFromColumn(row.unresolvedLocations),
  ]);

  return pullPreferencesFor({
    locations: places.ids,
    roles: stringArrayFromColumn(row.roles),
  });
}

function dueGroups(
  rows: readonly PullMemberRow[],
  now: number,
  intervalHours: number,
  paid: ReadonlySet<string>,
) {
  const groups = new Map<string, Group>();

  for (const row of rows) {
    const preferences = preferencesOf(row);
    const queryKey = queryKeyOf(preferences);
    const neverPulled = row.lastFullPullAt === null;
    const preferencesChanged = row.lastQueryKey !== queryKey;

    const freshDue =
      paid.has(row.userId) &&
      (row.lastFreshPullAt === null || row.lastFreshPullAt + intervalHours * 3_600_000 <= now);

    if (!neverPulled && !preferencesChanged && !freshDue) {
      continue;
    }

    const group = groups.get(queryKey) ?? { key: queryKey, members: [], preferences };

    group.members.push({ queryKey, userId: row.userId });
    groups.set(queryKey, group);
  }

  return [...groups.values()];
}

function groupNeedsFullPull(group: Group, rows: readonly PullMemberRow[]) {
  return group.members.some((member) => {
    const row = rows.find((candidate) => candidate.userId === member.userId);

    return (
      row !== undefined && (row.lastFullPullAt === null || row.lastQueryKey !== member.queryKey)
    );
  });
}

const collectPages: (
  source: JobSource,
  group: Group,
  mode: "full" | "fresh",
  since: number | null,
  maxPages: number,
  page: number,
  pages: JobSearchPage[],
) => Promise<JobSearchPage[]> = async (source, group, mode, since, maxPages, page, pages) => {
  if (page >= maxPages) {
    return pages;
  }

  const offset = page * PAGE_SIZE;

  if (offset + PAGE_SIZE > MAX_OFFSET) {
    return pages;
  }

  const result = await source.search({
    ...searchQueryFor(group.preferences),
    limit: PAGE_SIZE,
    offset,
  });

  pages.push(result);

  const complete = result.jobs.length < PAGE_SIZE;

  const pastSince =
    mode === "fresh" &&
    since !== null &&
    result.jobs.every((job) => {
      const created = timestampOf(job.created_at);

      return created !== null && created < since;
    });

  return complete || pastSince
    ? pages
    : collectPages(source, group, mode, since, maxPages, page + 1, pages);
};

/**
 * The pull engine shared by the periodic tick and the immediate onboarding trigger. A group of users with the same
 * roles and places costs one freehire request per page; a failed pull keeps every job already stored and only moves a
 * failure counter and an alert.
 * @param deps The database, clock, source, store and alert hook.
 * @returns The tick, one user's full pull, the change poll and the pre-prepare liveness check.
 */
export function createPullService(deps: PullDeps) {
  const { db, clock, source, store } = deps;

  const applyTarget =
    deps.applyTarget ?? (async (job: FreehireJobRecord) => await resolveApplyTarget(job));

  function pullEnabled() {
    return getSetting(db, "jobs.pull_enabled") !== "false";
  }

  function recordRun(input: {
    groupKey: string;
    mode: "full" | "fresh";
    userCount: number;
    startedAt: number;
    counters: PullCounters;
    error?: string;
  }) {
    db.insert(jobPullRuns)
      .values({
        droppedClosed: input.counters.droppedClosed,
        droppedDuplicate: input.counters.droppedDuplicate,
        droppedNoLink: input.counters.droppedNoLink,
        droppedUnsupported: input.counters.droppedUnsupported,
        error: input.error ?? null,
        fetched: input.counters.fetched,
        finishedAt: clock.now(),
        groupKey: input.groupKey,
        id: crypto.randomUUID(),
        kept: input.counters.kept,
        mode: input.mode,
        startedAt: input.startedAt,
        userCount: input.userCount,
      })
      .run();
  }

  function noteFailure(
    groupKey: string,
    userCount: number,
    mode: "full" | "fresh" | "changes",
    error: Error,
  ) {
    const previous = Number(getSetting(db, FAILURE_SETTING) ?? "0");
    const failures = Number.isFinite(previous) ? previous + 1 : 1;

    setSetting(db, clock, FAILURE_SETTING, String(failures), "system:jobs.pull");

    publishEvent(
      db,
      clock,
      "jobs.pull.failed",
      JSON.stringify({
        error: error.message,
        failures,
        groupKey,
        mode,
        userCount,
      }),
    );

    if (failures >= ALERT_AFTER_FAILURES) {
      deps.onAlert?.({ failures, groupKey });
    }
  }

  function noteSuccess() {
    if (Number(getSetting(db, FAILURE_SETTING) ?? "0") !== 0) {
      setSetting(db, clock, FAILURE_SETTING, "0", "system:jobs.pull");
    }
  }

  async function pullGroup(group: Group, mode: "full" | "fresh", since: number | null) {
    const startedAt = clock.now();
    const counters = emptyCounters();
    const maxPages = Math.max(1, getSettingNumber(db, "jobs.pull_max_pages"));

    try {
      const pages = await collectPages(source, group, mode, since, maxPages, 0, []);

      await storePagesAt(group.key, pages, 0, counters, mode, since);

      const finishedAt = clock.now();

      for (const member of group.members) {
        const set = {
          lastFreshPullAt: finishedAt,
          lastQueryKey: member.queryKey,
          updatedAt: finishedAt,
        };

        if (mode === "full") {
          Object.assign(set, { lastFullPullAt: finishedAt });
        }

        db.insert(jobPullState)
          .values({
            lastFreshPullAt: finishedAt,
            lastFullPullAt: mode === "full" ? finishedAt : null,
            lastQueryKey: member.queryKey,
            updatedAt: finishedAt,
            userId: member.userId,
          })
          .onConflictDoUpdate({ set, target: jobPullState.userId })
          .run();
      }

      recordRun({
        counters,
        groupKey: group.key,
        mode,
        startedAt,
        userCount: group.members.length,
      });

      publishEvent(
        db,
        clock,
        "jobs.pull",
        JSON.stringify({ counters, groupKey: group.key, mode, userCount: group.members.length }),
      );

      noteSuccess();

      return { counters, failed: false as const };
    } catch (error) {
      recordRun({
        counters,
        error: error instanceof Error ? error.message : String(error),
        groupKey: group.key,
        mode,
        startedAt,
        userCount: group.members.length,
      });

      noteFailure(
        group.key,
        group.members.length,
        mode,
        error instanceof Error ? error : new Error(String(error)),
      );
      logError("jobs.pull", error);

      return { counters, failed: true as const };
    }
  }

  const storePagesAt: (
    groupKey: string,
    pages: readonly JobSearchPage[],
    index: number,
    counters: PullCounters,
    mode: "full" | "fresh",
    since: number | null,
  ) => Promise<void> = async (groupKey, pages, index, counters, mode, since) => {
    const page = pages[index];

    if (page === undefined) {
      return;
    }

    if (page.ignoredParams.length > 0) {
      publishEvent(
        db,
        clock,
        "jobs.pull.ignored",
        JSON.stringify({ groupKey, params: page.ignoredParams }),
      );
    }

    await storeJobAt(page.jobs, 0, counters, mode, since);

    return storePagesAt(groupKey, pages, index + 1, counters, mode, since);
  };

  const storeJobAt: (
    pageJobs: readonly FreehireJobRecord[],
    index: number,
    counters: PullCounters,
    mode: "full" | "fresh",
    since: number | null,
  ) => Promise<void> = async (pageJobs, index, counters, mode, since) => {
    const job = pageJobs[index];

    if (job === undefined) {
      return;
    }

    counters.fetched += 1;

    const created = timestampOf(job.created_at);

    if (mode === "fresh" && since !== null && created !== null && created < since) {
      return storeJobAt(pageJobs, index + 1, counters, mode, since);
    }

    if (job.closed_at !== null) {
      counters.droppedClosed += 1;

      return storeJobAt(pageJobs, index + 1, counters, mode, since);
    }

    if (atsForFreehireSource(job.source) === null) {
      counters.droppedUnsupported += 1;

      return storeJobAt(pageJobs, index + 1, counters, mode, since);
    }

    const target = await applyTarget(job);

    if (target === null) {
      counters.droppedNoLink += 1;

      return storeJobAt(pageJobs, index + 1, counters, mode, since);
    }

    const outcome = store.upsert(job, target);

    if (outcome.status === "duplicate") {
      counters.droppedDuplicate += 1;
    } else if (outcome.status === "kept") {
      counters.kept += 1;
    }

    return storeJobAt(pageJobs, index + 1, counters, mode, since);
  };

  const pullNextGroup: (
    groups: readonly Group[],
    rows: readonly PullMemberRow[],
    now: number,
    index: number,
  ) => Promise<void> = async (groups, rows, now, index) => {
    const group = groups[index];

    if (group === undefined) {
      return;
    }

    const full = groupNeedsFullPull(group, rows);

    const since = full
      ? null
      : Math.min(
          ...group.members.map((member) => {
            const row = rows.find((candidate) => candidate.userId === member.userId);

            return row?.lastFreshPullAt ?? now;
          }),
        );

    const result = await pullGroup(group, full ? "full" : "fresh", since);

    if (result.failed) {
      return;
    }

    return pullNextGroup(groups, rows, now, index + 1);
  };

  async function runTick(now = clock.now()) {
    if (!pullEnabled()) {
      return 0;
    }

    const intervalHours = getSettingNumber(db, "jobs.fresh_pull_interval_hours", {
      fallback: 3,
      minimum: 1,
    });

    const rows = db
      .select({
        lastFreshPullAt: jobPullState.lastFreshPullAt,
        lastFullPullAt: jobPullState.lastFullPullAt,
        lastQueryKey: jobPullState.lastQueryKey,
        locations: targets.locations,
        roles: targets.roles,
        unresolvedLocations: targets.unresolvedLocations,
        userId: targets.userId,
      })
      .from(targets)
      .innerJoin(profiles, eq(profiles.userId, targets.userId))
      .leftJoin(jobPullState, eq(jobPullState.userId, targets.userId))
      .where(isNotNull(profiles.onboardedAt))
      .all();

    const paid = paidUserIds(db, now);

    const groups = dueGroups(rows, now, intervalHours, paid);

    await pullNextGroup(groups, rows, now, 0);

    try {
      await runChanges();
    } catch (error) {
      noteFailure(
        "jobs.changes",
        0,
        "changes",
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    return groups.length;
  }

  async function runUser(userId: string) {
    if (!pullEnabled()) {
      return null;
    }

    const row = db
      .select({
        lastFreshPullAt: jobPullState.lastFreshPullAt,
        lastFullPullAt: jobPullState.lastFullPullAt,
        lastQueryKey: jobPullState.lastQueryKey,
        locations: targets.locations,
        roles: targets.roles,
        unresolvedLocations: targets.unresolvedLocations,
        userId: targets.userId,
      })
      .from(targets)
      .leftJoin(jobPullState, eq(jobPullState.userId, targets.userId))
      .where(eq(targets.userId, userId))
      .get();

    if (row === undefined) {
      return null;
    }

    const preferences = preferencesOf(row);
    const queryKey = queryKeyOf(preferences);

    return await pullGroup(
      { key: queryKey, members: [{ queryKey, userId }], preferences },
      "full",
      null,
    );
  }

  async function runChanges() {
    if (!pullEnabled() || source.changes === undefined || deps.hasApiKey !== true) {
      return 0;
    }

    const pages = Math.max(1, getSettingNumber(db, "jobs.changes_pages"));
    const { changes } = source;

    const pollPage: (
      remaining: number,
      start: string | null,
      closed: number,
    ) => Promise<number> = async (remaining, start, closed) => {
      if (remaining <= 0) {
        return closed;
      }

      const result = await changes({
        cursor: start,
        since: start === null ? clock.now() - 86_400_000 : null,
      });

      const slugs = result.changes
        .filter((change) => change.kind === "closed")
        .map((change) => change.publicSlug);

      const nextClosed = closed + store.closeMany(slugs, clock.now());

      if (result.nextCursor !== null) {
        setSetting(db, clock, CURSOR_SETTING, result.nextCursor, "system:jobs.pull");
      }

      return result.hasMore ? pollPage(remaining - 1, result.nextCursor, nextClosed) : nextClosed;
    };

    const closed = await pollPage(pages, getSetting(db, CURSOR_SETTING), 0);

    if (closed > 0) {
      publishEvent(db, clock, "jobs.changed", JSON.stringify({ closed }));
    }

    return closed;
  }

  async function jobIsOpen(publicSlug: string) {
    if (source.getJob === undefined) {
      return true;
    }

    const job = await source.getJob(publicSlug);

    if (job?.closed_at !== null) {
      store.close(publicSlug, clock.now());

      return false;
    }

    return true;
  }

  return { jobIsOpen, runChanges, runTick, runUser };
}

export type PullService = ReturnType<typeof createPullService>;

/**
 * Queues the periodic pull tick, once.
 * @param db The application database.
 * @param clock The clock the run time is computed from.
 * @param runAt When the tick should run; defaults to the tick interval.
 * @returns Whether a new row was inserted.
 */
export function ensurePullQueued(db: AppDatabase, clock: Clock, runAt?: number) {
  const minutes = getSettingNumber(db, "jobs.pull_tick_minutes", { fallback: 15, minimum: 1 });

  return enqueueJob(db, clock, JOBS_PULL_JOB_KIND, "{}", {
    dedupeKey: PULL_DEDUPE_KEY,
    maxAttempts: 1,
    runAt: runAt ?? clock.now() + minutes * 60_000,
  }).inserted;
}

/**
 * Queues one user's full pull right after onboarding or a preference change, so they do not wait for the tick.
 * @param db The application database.
 * @param clock The clock the run time is computed from.
 * @param userId The account.
 * @returns The queued job.
 */
export function enqueueUserPull(db: AppDatabase, clock: Clock, userId: string) {
  return enqueueJob(db, clock, JOBS_PULL_USER_JOB_KIND, JSON.stringify({ userId }), {
    dedupeKey: `${JOBS_PULL_USER_JOB_KIND}:${userId}`,
    maxAttempts: 2,
  });
}

const userPullPayload = z.object({ userId: z.string().min(1) });

/**
 * The background-job handlers. The tick reschedules itself in `finally`, so a failed pull never stops the loop.
 * @param db The application database the tick reschedules itself in.
 * @param clock The clock the next tick is scheduled from.
 * @param service The pull service.
 * @returns The handlers `main.ts` merges into the worker.
 */
export function createPullJobHandlers(db: AppDatabase, clock: Clock, service: PullService) {
  return {
    [JOBS_PULL_JOB_KIND]: async () => {
      try {
        await service.runTick();
      } finally {
        ensurePullQueued(db, clock);
      }
    },
    [JOBS_PULL_USER_JOB_KIND]: async (payload) => {
      const { userId } = userPullPayload.parse(JSON.parse(payload));

      await service.runUser(userId);
    },
  } satisfies JobHandlers;
}
