import { Hono } from "hono";
import { validJson } from "./validators.ts";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { Auth } from "../auth/index.ts";
import { readSessionUser } from "../auth/session.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import { openOrNull } from "../profile/personal-crypto.ts";
import type { ReviewService } from "../pipeline/reviews.ts";

import { newMatchesOf } from "../matching/new-matches.ts";
import { inProgressOf } from "../pipeline/in-progress.ts";

import { committedSince } from "../billing/ledger.ts";
import { billingAccountOf } from "../billing/plan-account.ts";
import {
  applicationEvents,
  applications,
  facts,
  mailThreads,
  messages,
  profiles,
} from "../platform/db/schema.ts";
import { getSetting } from "../platform/settings/index.ts";
import { createTimeZoneService } from "../profile/time-zone.ts";
import { addLocalDays, localDateAt, localDayStartFor } from "../platform/local-time.ts";
import { enqueuePlannerDay } from "../dispatch/planner.ts";
import { dueCheckins } from "../pipeline/checkins.ts";
import { notifyPaused } from "../notify/events.ts";
import { pauseByUser, resumeByUser } from "../profile/running-state.ts";
import { nextSendAtOf, sendQueueOf } from "../pipeline/send-queue.ts";
import { publishEvent } from "../platform/sse/stream.ts";
import { copy, failedReasonText } from "../../shared/copy.ts";
import { safeHttpUrl } from "../../shared/http-url.ts";
import { TIER_1_FACT_KEYS, TIER_2_FACT_KEYS } from "../../shared/facts.ts";

const MAX_REVIEW_ROWS = 4;
const MAX_INBOX_ROWS = 4;
const MAX_IN_PROGRESS_ROWS = 4;
const MAX_NEW_MATCH_ROWS = 3;
const REVIEW_HIDDEN_COMPANIES = 2;
const ACTIVITY_SENT_LIMIT = 3;
const ACTIVITY_FAILED_LIMIT = 1;

const runningBody = z.object({ running: z.boolean() });

const RANGE_KEYS = ["7D", "30D", "90D"] as const;

type RangeKey = (typeof RANGE_KEYS)[number];

interface RangeSpec {
  startOffsetDays: number;
  previousStartOffsetDays: number;
  per: "day" | "week";
  buckets: number;
  labelIndexes: readonly number[];
  labelKind: "weekday" | "dayMonth" | "month";
}

const RANGE_BY_KEY: Record<RangeKey, RangeSpec> = {
  "7D": {
    buckets: 7,
    labelIndexes: [0, 1, 2, 3, 4, 5, 6],
    labelKind: "weekday",
    per: "day",
    previousStartOffsetDays: -13,
    startOffsetDays: -6,
  },
  "30D": {
    buckets: 30,
    labelIndexes: [0, 7, 14, 21, 29],
    labelKind: "dayMonth",
    per: "day",
    previousStartOffsetDays: -59,
    startOffsetDays: -29,
  },
  "90D": {
    buckets: 13,
    labelIndexes: [0, 4, 8, 12],
    labelKind: "month",
    per: "week",
    previousStartOffsetDays: -181,
    startOffsetDays: -90,
  },
};

interface HomeRangeView {
  applicationsSent: number;
  sentDelta: number;
  replies: number;
  interviewsBooked: number;
  chart: {
    per: "day" | "week";
    labels: string[];
    points: { at: number; count: number }[];
  };
}

interface HomeInboxView {
  id: string;
  threadId: string;
  unread: boolean;
  company: string;
  text: string;
  detail: string | null;
  at: number;
  kind: string;
}

interface HomeActivitySentView {
  id: string;
  company: string;
  title: string;
  at: number;
  status: "sent" | "confirming";
}

interface HomeActivityFailedView {
  id: string;
  company: string;
  title: string;
  at: number;
  applyUrl: string | null;
  reason: string;
}

function dailyCapOf(db: AppDatabase) {
  const stored = getSetting(db, "limits.daily_cap");
  const parsed = stored === null ? Number.NaN : Number(stored);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}

function stageLabel(stage: string | null) {
  if (stage === "queued") {
    return copy.stages.queued;
  }

  if (stage === "applied") {
    return copy.stages.applied;
  }

  if (stage === "screening") {
    return copy.stages.screening;
  }

  if (stage === "interviewing") {
    return copy.stages.interviewing;
  }

  if (stage === "offer") {
    return copy.stages.offer;
  }

  if (stage === "closed") {
    return copy.stages.closed;
  }

  return null;
}

function displayNameOf(from: string) {
  const angle = from.indexOf("<");
  const name = (angle === -1 ? "" : from.slice(0, angle)).trim().replaceAll(/^"|"$/gu, "");

  return name === "" ? null : name;
}

function inboxPhrase(kind: string | null, subject: string, postingTitle: string | null) {
  if (kind === "ack") {
    return copy.home.inbox.ack;
  }

  if (kind === "screening") {
    return copy.home.inbox.screening;
  }

  if (kind === "rejection") {
    return copy.home.inbox.rejection(postingTitle);
  }

  if (kind === "offer") {
    return copy.home.inbox.offer;
  }

  if (kind === "interview") {
    return copy.home.inbox.interview(subject);
  }

  return copy.home.inbox.replied(subject);
}

function labelAt(spec: RangeSpec, at: number, zone: string) {
  if (spec.labelKind === "weekday") {
    return new Intl.DateTimeFormat(copy.home.dateLocale, {
      timeZone: zone,
      weekday: "short",
    }).format(new Date(at));
  }

  if (spec.labelKind === "dayMonth") {
    return new Intl.DateTimeFormat(copy.home.dateLocale, {
      day: "numeric",
      month: "short",
      timeZone: zone,
    }).format(new Date(at));
  }

  return new Intl.DateTimeFormat(copy.home.dateLocale, {
    month: "short",
    timeZone: zone,
  }).format(new Date(at));
}

function countIn(rows: readonly { at: number }[], start: number, end: number) {
  return rows.filter((row) => row.at >= start && row.at < end).length;
}

function rangeLabels(spec: RangeSpec, starts: readonly number[], zone: string) {
  return spec.labelIndexes.flatMap((index) => {
    const at = starts[index];

    return at === undefined ? [] : [labelAt(spec, at, zone)];
  });
}

function rangeView(
  spec: RangeSpec,
  now: number,
  zone: string,
  startFor: (offsetDays: number) => number,
  sentRows: readonly { at: number }[],
  replyRows: readonly { at: number }[],
  interviewRows: readonly { at: number }[],
) {
  const start = startFor(spec.startOffsetDays);
  const previousStart = startFor(spec.previousStartOffsetDays);
  const starts: number[] = [];

  for (let index = 0; index < spec.buckets; index += 1) {
    starts.push(startFor(spec.startOffsetDays + index * (spec.per === "day" ? 1 : 7)));
  }

  const points = starts.map((at, index) => {
    const next = starts[index + 1] ?? now + 1;

    return { at, count: countIn(sentRows, at, next) };
  });

  const applicationsSent = countIn(sentRows, start, now + 1);

  return {
    applicationsSent,
    chart: { labels: rangeLabels(spec, starts, zone), per: spec.per, points },
    interviewsBooked: countIn(interviewRows, start, now + 1),
    replies: countIn(replyRows, start, now + 1),
    sentDelta: applicationsSent - countIn(sentRows, previousStart, start),
  } satisfies HomeRangeView;
}

function failedReasonFor(reason: string | null) {
  return failedReasonText(reason) ?? copy.home.activity.failedDefault;
}

export function createHomeRoutes(deps: {
  db: AppDatabase;
  catalogDb: CatalogDatabase;
  clock: Clock;
  auth: Auth;
  personal: PersonalCrypto;
  reviews: ReviewService;
}) {
  const { db, catalogDb, clock, auth, personal, reviews } = deps;

  const routes = new Hono();
  const zones = createTimeZoneService({ db, clock });

  function profileOf(userId: string) {
    const row = db
      .select({ pauseReason: profiles.pauseReason, running: profiles.running })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .get();

    return row ?? { pauseReason: "onboarding" as const, running: false };
  }

  function activityOf(userId: string, now: number) {
    const candidateRows = db
      .select({
        at: sql<number>`coalesce(${applications.sentAt}, ${applications.updatedAt})`,
        company: applications.companyName,
        id: applications.id,
        status: applications.status,
        title: applications.postingTitle,
      })
      .from(applications)
      .where(
        and(eq(applications.userId, userId), inArray(applications.status, ["sent", "confirming"])),
      )
      .orderBy(desc(sql`coalesce(${applications.sentAt}, ${applications.updatedAt})`))
      .limit(ACTIVITY_SENT_LIMIT * 8)
      .all();

    const sentIds = candidateRows.filter((row) => row.status === "sent").map((row) => row.id);

    const confirmed =
      sentIds.length === 0
        ? []
        : db
            .select({ applicationId: mailThreads.applicationId })
            .from(mailThreads)
            .innerJoin(messages, eq(messages.threadId, mailThreads.id))
            .where(
              and(
                eq(mailThreads.userId, userId),
                eq(messages.direction, "in"),
                eq(messages.auth, "pass"),
                inArray(mailThreads.applicationId, sentIds),
              ),
            )
            .all();

    const confirmedIds = new Set(
      confirmed.flatMap((row) => (row.applicationId === null ? [] : [row.applicationId])),
    );

    const sentRows = candidateRows
      .filter((row) => row.status === "confirming" || confirmedIds.has(row.id))
      .slice(0, ACTIVITY_SENT_LIMIT);

    const failedRows = db
      .select({
        applyUrl: applications.applyUrl,
        at: sql<number>`coalesce(${applications.sentAt}, ${applications.updatedAt})`,
        company: applications.companyName,
        id: applications.id,
        postingUrl: applications.postingUrl,
        reason: applications.statusReason,
        title: applications.postingTitle,
      })
      .from(applications)
      .where(
        and(eq(applications.userId, userId), inArray(applications.status, ["failed", "skipped"])),
      )
      .orderBy(desc(sql`coalesce(${applications.sentAt}, ${applications.updatedAt})`))
      .limit(ACTIVITY_FAILED_LIMIT)
      .all();

    return {
      failed: failedRows.map(
        (row) =>
          ({
            applyUrl: safeHttpUrl(row.applyUrl) ?? safeHttpUrl(row.postingUrl),
            at: row.at,
            company: row.company,
            id: row.id,
            reason: failedReasonFor(row.reason),
            title: row.title,
          }) satisfies HomeActivityFailedView,
      ),
      sent: sentRows.map(
        (row) =>
          ({
            at: row.at > now ? now : row.at,
            company: row.company,
            id: row.id,
            status: row.status === "confirming" ? "confirming" : "sent",
            title: row.title,
          }) satisfies HomeActivitySentView,
      ),
    };
  }

  function strengthenOf(userId: string) {
    const rows = db
      .select({ confirmed: facts.confirmed, key: facts.key })
      .from(facts)
      .where(eq(facts.userId, userId))
      .all();

    const tier1 = new Set<string>(TIER_1_FACT_KEYS);
    const tier2 = new Set<string>(TIER_2_FACT_KEYS);

    const confirmedOf = (keys: Set<string>) =>
      rows.filter((row) => row.confirmed && keys.has(row.key)).length;

    if (confirmedOf(tier1) === 0) {
      return null;
    }

    const missing = 2 - Math.min(2, confirmedOf(tier2));

    return missing > 0 ? { missing } : null;
  }

  async function inboxViews(userId: string) {
    const rows = db
      .select({
        applicationId: mailThreads.applicationId,
        classification: messages.classification,
        companyName: applications.companyName,
        createdAt: messages.createdAt,
        fromEnc: messages.fromEnc,
        id: messages.id,
        postingTitle: applications.postingTitle,
        readAt: messages.readAt,
        stage: applications.stage,
        subjectEnc: messages.subjectEnc,
        threadId: messages.threadId,
      })
      .from(messages)
      .leftJoin(mailThreads, eq(mailThreads.id, messages.threadId))
      .leftJoin(applications, eq(applications.id, mailThreads.applicationId))
      .where(
        and(
          eq(messages.userId, userId),
          eq(messages.direction, "in"),
          eq(messages.auth, "pass"),
          or(isNull(messages.classification), sql`${messages.classification} IS NOT 'code'`),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(MAX_INBOX_ROWS)
      .all();

    const applicationIds = rows.flatMap((row) =>
      row.applicationId === null ? [] : [row.applicationId],
    );

    const stageEvents =
      applicationIds.length === 0
        ? []
        : db
            .select()
            .from(applicationEvents)
            .where(
              and(
                eq(applicationEvents.userId, userId),
                eq(applicationEvents.kind, "stage"),
                inArray(applicationEvents.applicationId, applicationIds),
              ),
            )
            .orderBy(asc(applicationEvents.at))
            .all();

    const latestEvent = new Map<string, (typeof stageEvents)[number]>();

    for (const event of stageEvents) {
      latestEvent.set(event.applicationId, event);
    }

    return Promise.all(
      rows.map(async (row) => {
        const subject =
          (await openOrNull({
            personal,
            scope: { column: "subject_enc", rowId: row.id, table: "messages" },
            sealed: row.subjectEnc,
            userId,
          })) ?? "";

        const from =
          (await openOrNull({
            personal,
            scope: { column: "from_enc", rowId: row.id, table: "messages" },
            sealed: row.fromEnc,
            userId,
          })) ?? "";

        const event = row.applicationId === null ? undefined : latestEvent.get(row.applicationId);

        const stage = stageLabel(row.stage);

        let detail: string | null = null;

        if (event !== undefined && event.toValue !== null) {
          const to = stageLabel(event.toValue);

          if (to !== null) {
            const fromStage = event.fromValue === null ? null : stageLabel(event.fromValue);

            detail =
              fromStage === null || event.toValue === "closed"
                ? copy.home.inbox.movedTo(to)
                : copy.home.inbox.movedFromTo(fromStage, to);
          }
        }

        if (detail === null && stage !== null) {
          detail = copy.home.inbox.filedUnder(stage);
        }

        return {
          at: row.createdAt.getTime(),
          company: row.companyName ?? displayNameOf(from) ?? from,
          detail,
          id: row.id,
          kind: row.classification ?? "other",
          text: inboxPhrase(row.classification, subject, row.postingTitle),
          threadId: row.threadId,
          unread: row.readAt === null,
        } satisfies HomeInboxView;
      }),
    );
  }

  routes.get("/home", async (context) => {
    const user = await readSessionUser(auth, context.req.raw.headers);

    if (user === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    const now = clock.now();
    const userId = user.id;
    const { timezone } = await zones.current(userId);
    const zone = timezone ?? "UTC";
    const today = localDateAt(now, zone);
    const dayStart = localDayStartFor(today, zone);
    const sentToday = committedSince(db, userId, dayStart);
    const dailyCap = dailyCapOf(db);
    const billing = billingAccountOf(db, userId, now);
    const left = billing.applicationsLeft;
    const profile = profileOf(userId);

    const startFor = (offsetDays: number) =>
      localDayStartFor(addLocalDays(today, offsetDays), zone);

    const oldestStart = startFor(RANGE_BY_KEY["90D"].previousStartOffsetDays);

    const sentRows = db
      .select({ at: applications.sentAt })
      .from(applications)
      .where(
        and(
          eq(applications.userId, userId),
          isNotNull(applications.sentAt),
          gte(applications.sentAt, oldestStart),
          lt(applications.sentAt, now + 1),
        ),
      )
      .all()
      .flatMap((row) => (row.at === null ? [] : [{ at: row.at }]));

    const replyRows = db
      .select({ at: messages.createdAt })
      .from(messages)
      .where(
        and(
          eq(messages.userId, userId),
          eq(messages.direction, "in"),
          eq(messages.auth, "pass"),
          or(isNull(messages.classification), sql`${messages.classification} IS NOT 'code'`),
          gte(messages.createdAt, new Date(oldestStart)),
          lt(messages.createdAt, new Date(now + 1)),
        ),
      )
      .all()
      .map((row) => ({ at: row.at.getTime() }));

    const interviewRows = db
      .select({ at: applicationEvents.at })
      .from(applicationEvents)
      .where(
        and(
          eq(applicationEvents.userId, userId),
          eq(applicationEvents.kind, "stage"),
          inArray(applicationEvents.toValue, ["interviewing", "offer"]),
          gte(applicationEvents.at, oldestStart),
          lt(applicationEvents.at, now + 1),
        ),
      )
      .all();

    const ranges: Record<RangeKey, HomeRangeView> = {
      "7D": rangeView(RANGE_BY_KEY["7D"], now, zone, startFor, sentRows, replyRows, interviewRows),
      "30D": rangeView(
        RANGE_BY_KEY["30D"],
        now,
        zone,
        startFor,
        sentRows,
        replyRows,
        interviewRows,
      ),
      "90D": rangeView(
        RANGE_BY_KEY["90D"],
        now,
        zone,
        startFor,
        sentRows,
        replyRows,
        interviewRows,
      ),
    };

    const approvedRows = db
      .select({ scheduledFor: applications.scheduledFor })
      .from(applications)
      .where(and(eq(applications.userId, userId), eq(applications.status, "approved")))
      .all();

    const readyToSend = db
      .select({ total: sql<number>`count(*)` })
      .from(applications)
      .where(and(eq(applications.userId, userId), eq(applications.status, "ready")))
      .get();

    const approvedReady = db
      .select({ total: sql<number>`count(*)` })
      .from(applications)
      .where(
        and(
          eq(applications.userId, userId),
          eq(applications.status, "approved"),
          eq(applications.stage, "ready"),
        ),
      )
      .get();

    const readyCompanies = db
      .select({ company: applications.companyName })
      .from(applications)
      .where(and(eq(applications.userId, userId), eq(applications.status, "ready")))
      .orderBy(asc(applications.readyAt))
      .limit(3)
      .all()
      .map((row) => row.company);

    const scheduledFor = approvedRows.map((row) => row.scheduledFor);

    const nextSendAt = nextSendAtOf({
      approved: approvedRows.length,
      now,
      scheduledFor,
    });

    const reviewList = reviews.list(userId);
    const inbox = await inboxViews(userId);
    const checkIns = dueCheckins({ db, now }, userId);

    return context.json({
      activity: activityOf(userId, now),
      applicationsLeft: left,
      checkInDue: checkIns.length,
      checkIns,
      dailyCap,
      endingGrant: billing.endingGrant,
      inProgress: inProgressOf(db, userId, now, MAX_IN_PROGRESS_ROWS),
      newMatches: newMatchesOf({ catalogDb, db }, userId, MAX_NEW_MATCH_ROWS),
      nextSendAt,
      now,
      pauseReason: profile.pauseReason,
      planApplications: billing.planApplications,
      planKind: billing.planKind,
      queue: sendQueueOf(scheduledFor, now),
      queued: approvedRows.length,
      ready: {
        approved: approvedReady?.total ?? 0,
        companies: readyCompanies,
        ready: readyToSend?.total ?? 0,
      },
      readyToSend: readyToSend?.total ?? 0,
      ranges,
      recentInbox: inbox,
      remainingToday: Math.max(0, Math.min(dailyCap, left) - sentToday),
      reviews: {
        applications: reviewList.reduce((total, review) => total + review.unlocked, 0),
        list: reviewList.slice(0, MAX_REVIEW_ROWS).map((review) => {
          const names = [...new Set(review.applications.map((application) => application.company))];
          const shown = Math.max(1, review.companies - REVIEW_HIDDEN_COMPANIES);

          return {
            companyCount: review.companies,
            companies: names.slice(0, shown),
            id: review.id,
            prompt: review.prompt,
            unlocked: review.unlocked,
          };
        }),
        total: reviewList.length,
      },
      running: profile.running,
      sentToday,
      strengthen: strengthenOf(userId),
      timeZone: zone,
      trialUsed: billing.trialUsed,
    });
  });

  routes.post("/running", validJson(runningBody), async (context) => {
    const user = await readSessionUser(auth, context.req.raw.headers);

    if (user === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    if (!user.emailVerified) {
      return context.json({ error: "email_unverified" }, 403);
    }

    const { running } = context.req.valid("json");
    const result = running ? resumeByUser(db, clock, user.id) : pauseByUser(db, clock, user.id);

    if (!result.ok) {
      return context.json({ error: "pause_blocked", pauseReason: result.reason }, 409);
    }

    if (running) {
      enqueuePlannerDay(db, clock, user.id);
    } else {
      notifyPaused(db, clock, { reason: "user", userId: user.id });
    }

    publishEvent(db, clock, "home.updated", JSON.stringify({ running }), user.id);

    return context.json({ pauseReason: running ? null : "user", running });
  });

  return routes;
}
