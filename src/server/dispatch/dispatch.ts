import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  lte,
  notInArray,
  sql,
} from "drizzle-orm";

import type { Ats, BoardRegion } from "../catalog/board-feed.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { PostingLiveness, PostingLivenessChecker } from "./liveness.ts";

import {
  applications,
  attempts,
  bgJobs,
  companyBoards,
  killSwitches,
  mailboxes,
  postings,
  profiles,
  resumes,
  users,
} from "../platform/db/schema.ts";
import { applicationsLeft, dailyUsageSince } from "../billing/ledger.ts";
import { skipClosedPostingApplications } from "../catalog/posting-close.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import { getSetting } from "../platform/settings/index.ts";
import { localDayStart } from "../platform/local-time.ts";
import { publishEvent } from "../platform/sse/stream.ts";
import { parseSendWindow, planningWindow } from "./planning.ts";
import { APPLICATION_SEND_JOB_KIND } from "./executor.ts";

export const DISPATCH_TICK_JOB_KIND = "dispatch.tick";

export const TICK_INTERVAL_MS = 15_000;
const HOUR_MS = 3_600_000;
const WEEK_MS = 7 * 86_400_000;
const DEFAULT_CONCURRENCY = 10;

export interface DispatchSummary {
  claimed: number;
  skipped: number;
  blocked: number;
}

export interface DispatcherTick {
  run: () => Promise<DispatchSummary>;
  ensureQueued: (runAt?: number) => boolean;
}

export interface DispatchDeps {
  db: AppDatabase;
  clock: Clock;
  providerId: string;
  liveness: PostingLivenessChecker;
  enqueueSend: (applicationId: string) => string;
}

interface Block {
  scope: "global" | "user" | "posting";
  reason: string;
}

interface Candidate {
  id: string;
  userId: string;
  postingId: string;
  companyId: string;
  scheduledFor: number | null;
  ats: Ats;
  boardToken: string;
  region: BoardRegion;
  atsJobId: string;
}

function settingNumber(db: AppDatabase, key: string, fallback: number) {
  const raw = getSetting(db, key);
  const parsed = raw === null ? Number.NaN : Number(raw);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function createDispatcherTick(deps: DispatchDeps) {
  const { db, clock, providerId, liveness, enqueueSend } = deps;

  function ensureQueued(runAt?: number) {
    return enqueueJob(db, clock, DISPATCH_TICK_JOB_KIND, "{}", {
      dedupeKey: DISPATCH_TICK_JOB_KIND,
      maxAttempts: 2,
      runAt: runAt ?? clock.now(),
    }).inserted;
  }

  function timeZoneFor(userId: string) {
    const row = db
      .select({
        pendingTimezone: profiles.pendingTimezone,
        pendingTimezoneAt: profiles.pendingTimezoneAt,
        timezone: profiles.timezone,
      })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .get();

    if (row === undefined) {
      return "UTC";
    }

    const now = clock.now();

    if (
      row.pendingTimezone !== null &&
      row.pendingTimezoneAt !== null &&
      row.pendingTimezoneAt.getTime() <= now
    ) {
      return row.pendingTimezone;
    }

    return row.timezone ?? "UTC";
  }

  function userGate(userId: string, now: number, dailyCap: number) {
    const profile = db
      .select({ running: profiles.running })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .get();

    if (profile === undefined || !profile.running) {
      return { block: { reason: "paused", scope: "user" }, timeZone: "UTC" };
    }

    const user = db
      .select({ suspendedAt: users.suspendedAt })
      .from(users)
      .where(eq(users.id, userId))
      .get();

    if (user?.suspendedAt !== null && user?.suspendedAt !== undefined) {
      return { block: { reason: "suspended", scope: "user" }, timeZone: "UTC" };
    }

    const resume = db
      .select({ id: resumes.id })
      .from(resumes)
      .where(and(eq(resumes.userId, userId), eq(resumes.isCurrent, true)))
      .get();

    if (resume === undefined) {
      return { block: { reason: "no_resume", scope: "user" }, timeZone: "UTC" };
    }

    const mailbox = db
      .select({ status: mailboxes.status })
      .from(mailboxes)
      .where(eq(mailboxes.userId, userId))
      .get();

    if (mailbox?.status !== "active") {
      return { block: { reason: "no_mailbox", scope: "user" }, timeZone: "UTC" };
    }

    const timeZone = timeZoneFor(userId);

    if (applicationsLeft(db, userId, now) < 1) {
      return { block: { reason: "applications_left", scope: "user" }, timeZone };
    }

    if (dailyUsageSince(db, userId, localDayStart(now, timeZone)) >= dailyCap) {
      return { block: { reason: "daily_cap", scope: "user" }, timeZone };
    }

    const sending = db
      .select({ total: count() })
      .from(applications)
      .where(and(eq(applications.userId, userId), eq(applications.status, "sending")))
      .get();

    if ((sending?.total ?? 0) > 0) {
      return { block: { reason: "sending", scope: "user" }, timeZone };
    }

    return { block: null, timeZone };
  }

  function postingBlock(candidate: Candidate, now: number) {
    const hourlyLimit = settingNumber(db, `limits.ats_hourly.${candidate.ats}`, 120);

    const recent = db
      .select({ total: count() })
      .from(attempts)
      .innerJoin(applications, eq(attempts.applicationId, applications.id))
      .innerJoin(postings, eq(applications.postingId, postings.id))
      .where(and(eq(postings.ats, candidate.ats), gte(attempts.startedAt, now - HOUR_MS)))
      .get();

    if ((recent?.total ?? 0) >= hourlyLimit) {
      return { reason: "ats_hourly", scope: "posting" } satisfies Block;
    }

    const crowdPosting = db
      .select({ total: count() })
      .from(applications)
      .where(
        and(
          eq(applications.postingId, candidate.postingId),
          notInArray(applications.status, ["failed", "skipped", "withdrawn"]),
        ),
      )
      .get();

    if ((crowdPosting?.total ?? 0) >= settingNumber(db, "limits.crowd_per_posting", 20)) {
      return { reason: "crowd_posting", scope: "posting" } satisfies Block;
    }

    const crowdEmployer = db
      .select({ total: count() })
      .from(applications)
      .where(
        and(
          eq(applications.companyId, candidate.companyId),
          eq(applications.status, "sent"),
          gte(applications.sentAt, now - WEEK_MS),
        ),
      )
      .get();

    if ((crowdEmployer?.total ?? 0) >= settingNumber(db, "limits.crowd_per_employer_week", 50)) {
      return { reason: "crowd_employer", scope: "posting" } satisfies Block;
    }

    return null;
  }

  function skipClosed(candidate: Candidate, now: number) {
    const skipped = db.transaction((tx) => {
      tx.update(postings)
        .set({ closedAt: now })
        .where(and(eq(postings.id, candidate.postingId), isNull(postings.closedAt)))
        .run();

      return skipClosedPostingApplications(tx, now, [candidate.postingId]);
    });

    for (const application of skipped) {
      publishEvent(
        db,
        clock,
        "application.updated",
        JSON.stringify({ applicationId: application.applicationId, status: "skipped" }),
        application.userId,
      );
      publishEvent(
        db,
        clock,
        "home.updated",
        JSON.stringify({ applicationId: application.applicationId }),
        application.userId,
      );
    }
  }

  async function run() {
    const now = clock.now();
    const summary: DispatchSummary = { blocked: 0, claimed: 0, skipped: 0 };

    const switches = db.select().from(killSwitches).where(eq(killSwitches.enabled, 1)).all();

    if (
      switches.some((entry) => entry.scope === "global") ||
      switches.some((entry) => entry.scope === "provider" && entry.key === providerId)
    ) {
      return summary;
    }

    const atsOff = new Set(
      switches.filter((entry) => entry.scope === "ats").map((entry) => entry.key),
    );

    const employerOff = new Set(
      switches.filter((entry) => entry.scope === "employer").map((entry) => entry.key),
    );

    const concurrency = Math.max(1, settingNumber(db, "browser.concurrency", DEFAULT_CONCURRENCY));

    const sending = db
      .select({ total: count() })
      .from(applications)
      .where(eq(applications.status, "sending"))
      .get();

    const queuedSends = db
      .select({ total: count() })
      .from(bgJobs)
      .where(and(eq(bgJobs.kind, APPLICATION_SEND_JOB_KIND), eq(bgJobs.status, "queued")))
      .get();

    let freeSlots = Math.max(0, concurrency - (sending?.total ?? 0) - (queuedSends?.total ?? 0));

    if (freeSlots === 0) {
      return summary;
    }

    const rows: Candidate[] = db
      .select({
        ats: postings.ats,
        atsJobId: postings.atsJobId,
        boardToken: companyBoards.boardToken,
        companyId: applications.companyId,
        id: applications.id,
        postingId: applications.postingId,
        region: companyBoards.region,
        scheduledFor: applications.scheduledFor,
        userId: applications.userId,
      })
      .from(applications)
      .innerJoin(postings, eq(postings.id, applications.postingId))
      .innerJoin(companyBoards, eq(companyBoards.id, postings.boardId))
      .where(
        and(
          eq(applications.status, "ready"),
          isNotNull(applications.scheduledFor),
          lte(applications.scheduledFor, now),
        ),
      )
      .orderBy(desc(applications.scoreAtQueue), asc(applications.createdAt))
      .all();

    if (rows.length === 0) {
      return summary;
    }

    const byUser = new Map<string, Candidate[]>();

    for (const row of rows) {
      const list = byUser.get(row.userId) ?? [];

      list.push(row);
      byUser.set(row.userId, list);
    }

    const lastAttempts = db
      .select({ at: sql<number>`max(${attempts.startedAt})`, userId: attempts.userId })
      .from(attempts)
      .groupBy(attempts.userId)
      .all();

    const lastAttemptAt = new Map(lastAttempts.map((entry) => [entry.userId, entry.at]));

    const userIds = [...byUser.keys()].toSorted((left, right) => {
      const leftAt = lastAttemptAt.get(left) ?? 0;
      const rightAt = lastAttemptAt.get(right) ?? 0;

      return leftAt - rightAt || left.localeCompare(right);
    });

    const dailyCap = Math.max(0, settingNumber(db, "limits.daily_cap", 10));
    const window = parseSendWindow(getSetting(db, "limits.send_window"));
    const eligible: Candidate[] = [];

    for (const userId of userIds) {
      if (freeSlots === 0) {
        break;
      }

      const gate = userGate(userId, now, dailyCap);

      if (gate.block !== null) {
        summary.blocked += 1;

        continue;
      }

      const localWindow = planningWindow(now, gate.timeZone, window);

      if (now < localWindow.start || now >= localWindow.end) {
        summary.blocked += 1;

        continue;
      }

      const candidate = byUser.get(userId)?.at(0);

      if (candidate === undefined) {
        continue;
      }

      const todayStart = localDayStart(now, gate.timeZone);

      if (candidate.scheduledFor !== null && candidate.scheduledFor < todayStart) {
        summary.blocked += 1;

        continue;
      }

      if (atsOff.has(candidate.ats) || employerOff.has(candidate.companyId)) {
        summary.blocked += 1;

        continue;
      }

      if (postingBlock(candidate, now) !== null) {
        summary.blocked += 1;

        continue;
      }

      eligible.push(candidate);
    }

    const livenessByApplication = new Map<string, PostingLiveness>();

    await Promise.all(
      eligible.map(async (candidate) => {
        const status = await liveness.check({
          ats: candidate.ats,
          atsJobId: candidate.atsJobId,
          boardToken: candidate.boardToken,
          region: candidate.region,
        });

        livenessByApplication.set(candidate.id, status);
      }),
    );

    for (const candidate of eligible) {
      if (freeSlots === 0) {
        break;
      }

      const status = livenessByApplication.get(candidate.id) ?? "unknown";

      if (status === "closed") {
        skipClosed(candidate, now);
        summary.skipped += 1;

        continue;
      }

      if (status === "unknown") {
        summary.blocked += 1;

        continue;
      }

      enqueueSend(candidate.id);
      summary.claimed += 1;
      freeSlots -= 1;
    }

    return summary;
  }

  return { ensureQueued, run } satisfies DispatcherTick;
}
