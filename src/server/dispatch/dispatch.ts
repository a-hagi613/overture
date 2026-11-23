import { and, asc, count, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";

import { z } from "zod";

import type { BoardRegion } from "../catalog/board-feed.ts";
import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { PostingLiveness, PostingLivenessChecker } from "./liveness.ts";

import {
  applicationEvents,
  applications,
  attempts,
  bgJobs,
  killSwitches,
  mailboxes,
  profiles,
  resumes,
  users,
} from "../platform/db/schema.ts";
import { companyBoards, postings } from "../platform/db/catalog-schema.ts";

import { applicationsLeft, dailyUsageSince } from "../billing/ledger.ts";
import { skipClosedPostingApplications } from "../catalog/posting-close.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import { getSetting } from "../platform/settings/index.ts";
import { publishEvent } from "../platform/sse/stream.ts";
import { localDayStart } from "../platform/local-time.ts";
import { approvalProblem, openApprovedPlan } from "../pipeline/approved-plan.ts";
import { enqueueApplicationPrepare } from "../pipeline/prepare-jobs.ts";
import { stageForStatus } from "../pipeline/stage.ts";
import { pauseForBlocker } from "../profile/running-state.ts";
import { parseSendWindow, planningWindow } from "./planning.ts";
import { APPLICATION_SEND_JOB_KIND } from "./executor.ts";
import { browserSessionAvailability, freeSendSlots } from "./browser/session-slots.ts";

export const DISPATCH_TICK_JOB_KIND = "dispatch.tick";

export const TICK_INTERVAL_MS = 15_000;
const HOUR_MS = 3_600_000;
const WEEK_MS = 7 * 86_400_000;

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
  catalogDb: CatalogDatabase;
  clock: Clock;
  providerId: string;
  liveness: PostingLivenessChecker;
  enqueueSend: (applicationId: string) => string;
  personal: PersonalCrypto;
}

interface Block {
  scope: "global" | "user" | "posting";
  reason: string;
}

const DISPATCHABLE_ATS = ["greenhouse", "lever", "ashby", "workable"] as const;

type DispatchAts = (typeof DISPATCHABLE_ATS)[number];

function isDispatchAts(ats: string): ats is DispatchAts {
  return DISPATCHABLE_ATS.some((name) => name === ats);
}

interface Candidate {
  id: string;
  userId: string;
  postingId: string;
  companyId: string;
  scheduledFor: number | null;
  ats: DispatchAts;
  boardToken: string;
  region: BoardRegion;
  atsJobId: string;
}

function settingNumber(db: AppDatabase, key: string, fallback: number) {
  const raw = getSetting(db, key);
  const parsed = raw === null ? Number.NaN : Number(raw);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const sendJobPayloadSchema = z.object({ applicationId: z.string().min(1) });

function sendJobApplicationId(payload: string) {
  try {
    const parsed = sendJobPayloadSchema.safeParse(JSON.parse(payload));

    return parsed.success ? parsed.data.applicationId : null;
  } catch {
    return null;
  }
}

function activeSendWork(db: AppDatabase) {
  const sending = db
    .select({ applicationId: applications.id, userId: applications.userId })
    .from(applications)
    .where(eq(applications.status, "sending"))
    .all();

  const queuedOrRunningIds = db
    .select({ payload: bgJobs.payload })
    .from(bgJobs)
    .where(
      and(
        eq(bgJobs.kind, APPLICATION_SEND_JOB_KIND),
        inArray(bgJobs.status, ["queued", "running"]),
      ),
    )
    .all()
    .map((job) => sendJobApplicationId(job.payload))
    .filter((applicationId): applicationId is string => applicationId !== null);

  const userByApplication = new Map(sending.map((row) => [row.applicationId, row.userId]));

  const unresolved = queuedOrRunningIds.filter(
    (applicationId) => !userByApplication.has(applicationId),
  );

  if (unresolved.length > 0) {
    for (const row of db
      .select({ applicationId: applications.id, userId: applications.userId })
      .from(applications)
      .where(inArray(applications.id, unresolved))
      .all()) {
      userByApplication.set(row.applicationId, row.userId);
    }
  }

  return {
    applicationIds: new Set([...userByApplication.keys(), ...queuedOrRunningIds]),
    userIds: new Set(userByApplication.values()),
  };
}

export function createDispatcherTick(deps: DispatchDeps) {
  const { db, clock, providerId, liveness, enqueueSend, personal } = deps;

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

  function userGate(
    userId: string,
    now: number,
    dailyCap: number,
    activeSendUsers: ReadonlySet<string>,
  ) {
    const profile = db
      .select({ running: profiles.running })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .get();

    if (profile === undefined || !profile.running) {
      return { block: { reason: "paused", scope: "user" }, timeZone: "UTC" };
    }

    const user = db
      .select({ role: users.role, suspendedAt: users.suspendedAt })
      .from(users)
      .where(eq(users.id, userId))
      .get();

    if (user?.role === "demo") {
      return { block: { reason: "demo", scope: "user" }, timeZone: "UTC" };
    }

    if (user?.suspendedAt !== null && user?.suspendedAt !== undefined) {
      return { block: { reason: "suspended", scope: "user" }, timeZone: "UTC" };
    }

    const resume = db
      .select({ id: resumes.id })
      .from(resumes)
      .where(and(eq(resumes.userId, userId), eq(resumes.isCurrent, true)))
      .get();

    if (resume === undefined) {
      pauseForBlocker(db, clock, userId, "no_resume");

      return { block: { reason: "no_resume", scope: "user" }, timeZone: "UTC" };
    }

    const mailbox = db
      .select({ status: mailboxes.status })
      .from(mailboxes)
      .where(eq(mailboxes.userId, userId))
      .get();

    if (mailbox?.status !== "active") {
      pauseForBlocker(db, clock, userId, "no_mailbox");

      return { block: { reason: "no_mailbox", scope: "user" }, timeZone: "UTC" };
    }

    const timeZone = timeZoneFor(userId);

    if (applicationsLeft(db, userId, now) < 1) {
      return { block: { reason: "applications_left", scope: "user" }, timeZone };
    }

    if (dailyUsageSince(db, userId, localDayStart(now, timeZone)) >= dailyCap) {
      return { block: { reason: "daily_cap", scope: "user" }, timeZone };
    }

    if (activeSendUsers.has(userId)) {
      return { block: { reason: "sending", scope: "user" }, timeZone };
    }

    return { block: null, timeZone };
  }

  function atsHourlyUsed(ats: DispatchAts, now: number) {
    const recent = db
      .select({ total: count() })
      .from(attempts)
      .innerJoin(applications, eq(attempts.applicationId, applications.id))
      .where(and(eq(applications.ats, ats), gte(attempts.startedAt, now - HOUR_MS)))
      .get();

    return recent?.total ?? 0;
  }

  function crowdPostingUsed(postingId: string) {
    const crowdPosting = db
      .select({ total: count() })
      .from(applications)
      .where(
        and(
          eq(applications.postingId, postingId),
          inArray(applications.status, ["sending", "confirming", "sent"]),
        ),
      )
      .get();

    return crowdPosting?.total ?? 0;
  }

  function crowdEmployerUsed(companyId: string, now: number) {
    const crowdEmployer = db
      .select({ total: count() })
      .from(applications)
      .where(
        and(
          eq(applications.companyId, companyId),
          eq(applications.status, "sent"),
          gte(applications.sentAt, now - WEEK_MS),
        ),
      )
      .get();

    return crowdEmployer?.total ?? 0;
  }

  interface TickHeadroom {
    atsHourly: Map<string, number>;
    crowdPosting: Map<string, number>;
    crowdEmployer: Map<string, number>;
  }

  function headroomFor(ats: DispatchAts, now: number, headroom: TickHeadroom) {
    const used = headroom.atsHourly.get(ats) ?? atsHourlyUsed(ats, now);

    headroom.atsHourly.set(ats, used);

    return used;
  }

  function postingBlock(candidate: Candidate, now: number, headroom: TickHeadroom) {
    const hourlyLimit = settingNumber(db, `limits.ats_hourly.${candidate.ats}`, 120);

    if (headroomFor(candidate.ats, now, headroom) >= hourlyLimit) {
      return { reason: "ats_hourly", scope: "posting" } satisfies Block;
    }

    const postingUsed =
      headroom.crowdPosting.get(candidate.postingId) ?? crowdPostingUsed(candidate.postingId);

    headroom.crowdPosting.set(candidate.postingId, postingUsed);

    if (postingUsed >= settingNumber(db, "limits.crowd_per_posting", 20)) {
      return { reason: "crowd_posting", scope: "posting" } satisfies Block;
    }

    const employerUsed =
      headroom.crowdEmployer.get(candidate.companyId) ??
      crowdEmployerUsed(candidate.companyId, now);

    headroom.crowdEmployer.set(candidate.companyId, employerUsed);

    if (employerUsed >= settingNumber(db, "limits.crowd_per_employer_week", 50)) {
      return { reason: "crowd_employer", scope: "posting" } satisfies Block;
    }

    return null;
  }

  function takeHeadroom(candidate: Candidate, headroom: TickHeadroom) {
    headroom.atsHourly.set(candidate.ats, (headroom.atsHourly.get(candidate.ats) ?? 0) + 1);

    headroom.crowdPosting.set(
      candidate.postingId,
      (headroom.crowdPosting.get(candidate.postingId) ?? 0) + 1,
    );

    headroom.crowdEmployer.set(
      candidate.companyId,
      (headroom.crowdEmployer.get(candidate.companyId) ?? 0) + 1,
    );
  }

  function skipClosed(candidate: Candidate, now: number) {
    deps.catalogDb
      .update(postings)
      .set({ closedAt: now, status: "closed" })
      .where(and(eq(postings.id, candidate.postingId), isNull(postings.closedAt)))
      .run();

    const skipped = db.transaction((tx) =>
      skipClosedPostingApplications(tx, now, [candidate.postingId]),
    );

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

  function sendBackToReady(candidate: Candidate, problem: string, now: number) {
    const claim = db
      .update(applications)
      .set({
        approvedAt: null,
        approvedPlanEnc: null,
        approvedPlanSha256: null,
        changes: JSON.stringify([problem]),
        scheduledFor: null,
        stage: stageForStatus("ready"),
        status: "ready",
        statusReason: null,
        updatedAt: now,
      })
      .where(and(eq(applications.id, candidate.id), eq(applications.status, "approved")))
      .returning({ id: applications.id })
      .all()
      .at(0);

    if (claim === undefined) {
      return;
    }

    db.insert(applicationEvents)
      .values({
        applicationId: candidate.id,
        at: now,
        detail: JSON.stringify({ changes: [problem] }),
        fromValue: "approved",
        id: crypto.randomUUID(),
        kind: "status",
        source: "system",
        toValue: "ready",
        userId: candidate.userId,
      })
      .run();

    enqueueApplicationPrepare(db, clock, candidate.id);

    publishEvent(
      db,
      clock,
      "application.updated",
      JSON.stringify({ applicationId: candidate.id, status: "ready" }),
      candidate.userId,
    );
    publishEvent(db, clock, "home.updated", JSON.stringify({ approved: false }), candidate.userId);
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

    const activeSends = activeSendWork(db);
    let freeSlots = freeSendSlots(activeSends.applicationIds.size, browserSessionAvailability());

    if (freeSlots === 0) {
      return summary;
    }

    const dueApplications = db
      .select({
        companyId: applications.companyId,
        id: applications.id,
        postingId: applications.postingId,
        scheduledFor: applications.scheduledFor,
        userId: applications.userId,
      })
      .from(applications)
      .where(
        and(
          eq(applications.status, "approved"),
          isNotNull(applications.scheduledFor),
          lte(applications.scheduledFor, now),
        ),
      )
      .orderBy(asc(applications.approvedAt), asc(applications.createdAt))
      .all()
      .filter((row) => !activeSends.applicationIds.has(row.id));

    const postingRows = new Map(
      deps.catalogDb
        .select({
          ats: postings.ats,
          atsJobId: postings.atsJobId,
          boardToken: companyBoards.boardToken,
          id: postings.id,
          region: companyBoards.region,
        })
        .from(postings)
        .innerJoin(companyBoards, eq(companyBoards.id, postings.boardId))
        .where(
          inArray(
            postings.id,
            dueApplications.map((row) => row.postingId),
          ),
        )
        .all()
        .map((row) => [row.id, row]),
    );

    const rows: Candidate[] = dueApplications.flatMap((application) => {
      const posting = postingRows.get(application.postingId);

      if (posting === undefined || !isDispatchAts(posting.ats)) {
        return [];
      }

      return [
        {
          ats: posting.ats,
          atsJobId: posting.atsJobId,
          boardToken: posting.boardToken,
          companyId: application.companyId,
          id: application.id,
          postingId: application.postingId,
          region: posting.region,
          scheduledFor: application.scheduledFor,
          userId: application.userId,
        },
      ];
    });

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

    const headroom: TickHeadroom = {
      atsHourly: new Map(),
      crowdEmployer: new Map(),
      crowdPosting: new Map(),
    };

    for (const userId of userIds) {
      if (freeSlots === 0) {
        break;
      }

      const gate = userGate(userId, now, dailyCap, activeSends.userIds);

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

      if (postingBlock(candidate, now, headroom) !== null) {
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

    const approvalPlans = new Map(
      await Promise.all(
        eligible.map(async (candidate) => {
          const plan = await openApprovedPlan({
            applicationId: candidate.id,
            db,
            personal,
            userId: candidate.userId,
          }).catch(() => null);

          return [candidate.id, plan] as const;
        }),
      ),
    );

    const sendable: Candidate[] = [];
    const stale: { candidate: Candidate; problem: string }[] = [];

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

      const approved = approvalPlans.get(candidate.id) ?? null;

      const problem =
        approved === null
          ? "The plan could not be read"
          : approvalProblem(db, candidate.userId, approved.plan);

      if (problem !== null) {
        stale.push({ candidate, problem });
        summary.blocked += 1;

        continue;
      }

      if (postingBlock(candidate, now, headroom) !== null) {
        summary.blocked += 1;

        continue;
      }

      takeHeadroom(candidate, headroom);
      sendable.push(candidate);
      freeSlots -= 1;
    }

    for (const { candidate, problem } of stale) {
      sendBackToReady(candidate, problem, now);
    }

    for (const candidate of sendable) {
      enqueueSend(candidate.id);
      summary.claimed += 1;
    }

    return summary;
  }

  return { ensureQueued, run } satisfies DispatcherTick;
}
