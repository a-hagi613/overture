import { and, count, desc, eq, gt, inArray, isNotNull, sql, sum } from "drizzle-orm";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";

import { isOnline, lastSeenAt } from "../auth/presence.ts";
import { applicationsLeft, ledgerBalances } from "../billing/ledger.ts";
import { companies, postings } from "../platform/db/catalog-schema.ts";
import {
  adminAudit,
  applicationEvents,
  applications,
  attempts,
  grants,
  llmUsage,
  matches,
  profiles,
  resumes,
  sessions,
  subscriptions,
  targets,
} from "../platform/db/schema.ts";

/** What one timeline row says happened. */
export type UserActivityKind =
  | "admin"
  | "application"
  | "attempt"
  | "grant"
  | "onboarded"
  | "resume"
  | "signed_in"
  | "subscription"
  | "targets";

export interface UserActivity {
  at: number;
  kind: UserActivityKind;
  /** A short machine-written line: a status move, an outcome or an action name. */
  detail: string;
}

const PER_SOURCE = 40;
const TIMELINE_SIZE = 60;
const TOP_MATCHES = 10;
const RECENT_ATTEMPTS = 10;

const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/Edg\//u, "Edge"],
  [/Firefox\//u, "Firefox"],
  [/Chrome\//u, "Chrome"],
  [/Safari\//u, "Safari"],
];

const PLATFORMS: readonly (readonly [RegExp, string])[] = [
  [/iPhone|iPad/u, "iOS"],
  [/Android/u, "Android"],
  [/Mac OS X/u, "macOS"],
  [/Windows/u, "Windows"],
  [/Linux/u, "Linux"],
];

function signInsOf(db: AppDatabase, userId: string) {
  return db
    .select({ at: sessions.createdAt, userAgent: sessions.userAgent })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.createdAt))
    .limit(PER_SOURCE)
    .all()
    .map((row) => ({
      at: row.at.getTime(),
      detail: deviceOf(row.userAgent),
      kind: "signed_in" as const,
    })) satisfies UserActivity[];
}

/**
 * A short device name from a user agent, so the timeline shows "Chrome on macOS" rather than the
 * whole header.
 * @param userAgent The stored header, or null.
 * @returns A browser and platform, or "unknown device".
 */
export function deviceOf(userAgent: string | null) {
  if (userAgent === null || userAgent.trim() === "") {
    return "unknown device";
  }

  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? "Browser";
  const platform = PLATFORMS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? "unknown";

  return `${browser} on ${platform}`;
}

function profileActivityOf(db: AppDatabase, userId: string) {
  const rows: UserActivity[] = [];

  const profile = db
    .select({ onboardedAt: profiles.onboardedAt })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .get();

  if (profile?.onboardedAt !== null && profile?.onboardedAt !== undefined) {
    rows.push({
      at: profile.onboardedAt.getTime(),
      detail: "finished onboarding",
      kind: "onboarded",
    });
  }

  for (const resume of db
    .select({ at: resumes.uploadedAt })
    .from(resumes)
    .where(eq(resumes.userId, userId))
    .orderBy(desc(resumes.uploadedAt))
    .limit(PER_SOURCE)
    .all()) {
    rows.push({ at: resume.at.getTime(), detail: "uploaded a resume", kind: "resume" });
  }

  const target = db
    .select({ at: targets.updatedAt })
    .from(targets)
    .where(eq(targets.userId, userId))
    .get();

  if (target !== undefined) {
    rows.push({ at: target.at.getTime(), detail: "saved job targets", kind: "targets" });
  }

  return rows;
}

function billingActivityOf(db: AppDatabase, userId: string) {
  const grantRows = db
    .select({ at: grants.createdAt, quantity: grants.quantity, source: grants.source })
    .from(grants)
    .where(eq(grants.userId, userId))
    .orderBy(desc(grants.createdAt))
    .limit(PER_SOURCE)
    .all()
    .map((row) => ({
      at: row.at,
      detail: `${String(row.quantity)} applications granted (${row.source})`,
      kind: "grant" as const,
    }));

  const subscriptionRows = db
    .select({ at: subscriptions.updatedAt, plan: subscriptions.plan, status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .orderBy(desc(subscriptions.updatedAt))
    .limit(PER_SOURCE)
    .all()
    .map((row) => ({
      at: row.at,
      detail: `${row.plan} plan ${row.status}`,
      kind: "subscription" as const,
    }));

  return [...grantRows, ...subscriptionRows] satisfies UserActivity[];
}

function applicationActivityOf(db: AppDatabase, userId: string) {
  const moves = db
    .select({
      at: applicationEvents.at,
      company: applications.companyName,
      from: applicationEvents.fromValue,
      source: applicationEvents.source,
      title: applications.postingTitle,
      to: applicationEvents.toValue,
    })
    .from(applicationEvents)
    .innerJoin(applications, eq(applications.id, applicationEvents.applicationId))
    .where(and(eq(applicationEvents.userId, userId), eq(applicationEvents.kind, "status")))
    .orderBy(desc(applicationEvents.at))
    .limit(PER_SOURCE)
    .all()
    .map((row) => ({
      at: row.at,
      detail: `${row.title} at ${row.company}: ${row.from ?? "new"} → ${row.to ?? "?"} (${row.source})`,
      kind: "application" as const,
    }));

  const tries = db
    .select({
      at: attempts.startedAt,
      company: applications.companyName,
      outcome: attempts.outcome,
      provider: attempts.provider,
      title: applications.postingTitle,
    })
    .from(attempts)
    .innerJoin(applications, eq(applications.id, attempts.applicationId))
    .where(eq(attempts.userId, userId))
    .orderBy(desc(attempts.startedAt))
    .limit(PER_SOURCE)
    .all()
    .map((row) => ({
      at: row.at,
      detail: `${row.provider} send for ${row.title} at ${row.company}: ${row.outcome ?? "running"}`,
      kind: "attempt" as const,
    }));

  const audits = db
    .select({ action: adminAudit.action, at: adminAudit.at })
    .from(adminAudit)
    .where(eq(adminAudit.targetUserId, userId))
    .orderBy(desc(adminAudit.at))
    .limit(PER_SOURCE)
    .all()
    .map((row) => ({ at: row.at, detail: row.action, kind: "admin" as const }));

  return [...moves, ...tries, ...audits] satisfies UserActivity[];
}

/**
 * Everything a person did or had done for them, newest first: sign-ins, onboarding, billing,
 * application moves, browser sends and admin actions. It reads rows the product already keeps, so
 * nothing new is stored about the person.
 * @param db The application database.
 * @param userId The person.
 * @returns At most sixty rows, newest first.
 */
export function userTimeline(db: AppDatabase, userId: string) {
  return [
    ...signInsOf(db, userId),
    ...profileActivityOf(db, userId),
    ...billingActivityOf(db, userId),
    ...applicationActivityOf(db, userId),
  ]
    .toSorted((left, right) => right.at - left.at)
    .slice(0, TIMELINE_SIZE);
}

function matchQueueOf(db: AppDatabase, catalogDb: CatalogDatabase, userId: string) {
  const totals = db
    .select({
      scored: sql<number>`coalesce(sum(case when ${matches.score} is not null then 1 else 0 end), 0)`,
      total: count(),
    })
    .from(matches)
    .where(eq(matches.userId, userId))
    .get() ?? { scored: 0, total: 0 };

  const top = db
    .select({
      codeRank: matches.codeRank,
      postingId: matches.postingId,
      score: matches.score,
      scoredAt: matches.scoredAt,
    })
    .from(matches)
    .where(eq(matches.userId, userId))
    .orderBy(sql`${matches.score} is null`, desc(matches.score), desc(matches.codeRank))
    .limit(TOP_MATCHES)
    .all();

  const ids = top.map((row) => row.postingId);

  const details = new Map(
    ids.length === 0
      ? []
      : catalogDb
          .select({
            company: companies.name,
            id: postings.id,
            location: postings.locationRaw,
            status: postings.status,
            title: postings.title,
          })
          .from(postings)
          .innerJoin(companies, eq(companies.id, postings.companyId))
          .where(inArray(postings.id, ids))
          .all()
          .map((row) => [row.id, row]),
  );

  return {
    scored: totals.scored,
    top: top.map((row) => {
      const posting = details.get(row.postingId);

      return {
        codeRank: row.codeRank,
        company: posting?.company ?? null,
        location: posting?.location ?? null,
        open: posting?.status === "open",
        postingId: row.postingId,
        score: row.score,
        scoredAt: row.scoredAt,
        title: posting?.title ?? null,
      };
    }),
    total: totals.total,
  };
}

function spendOf(db: AppDatabase, userId: string) {
  const byPurpose = db
    .select({
      calls: count(),
      costMicros: sum(llmUsage.costMicros),
      purpose: llmUsage.purpose,
    })
    .from(llmUsage)
    .where(eq(llmUsage.userId, userId))
    .groupBy(llmUsage.purpose)
    .all()
    .map((row) => ({
      calls: row.calls,
      costMicros: Number(row.costMicros ?? 0),
      purpose: row.purpose,
    }))
    .toSorted((left, right) => right.costMicros - left.costMicros);

  const byProvider = db
    .select({
      attempts: count(),
      browserMs: sum(attempts.browserMs),
      costMicros: sum(attempts.costMicros),
      provider: attempts.provider,
    })
    .from(attempts)
    .where(eq(attempts.userId, userId))
    .groupBy(attempts.provider)
    .all()
    .map((row) => ({
      attempts: row.attempts,
      browserMs: Number(row.browserMs ?? 0),
      costMicros: Number(row.costMicros ?? 0),
      provider: row.provider,
    }));

  const llmMicros = byPurpose.reduce((total, row) => total + row.costMicros, 0);
  const browserMicros = byProvider.reduce((total, row) => total + row.costMicros, 0);

  return {
    browser: byProvider,
    browserMicros,
    llm: byPurpose,
    llmMicros,
    totalMicros: llmMicros + browserMicros,
  };
}

function recentAttemptsOf(db: AppDatabase, userId: string) {
  return db
    .select({
      applicationId: attempts.applicationId,
      browserMs: attempts.browserMs,
      company: applications.companyName,
      costMicros: attempts.costMicros,
      endedAt: attempts.endedAt,
      errorCode: attempts.errorCode,
      id: attempts.id,
      outcome: attempts.outcome,
      provider: attempts.provider,
      providerSessionId: attempts.providerSessionId,
      startedAt: attempts.startedAt,
      title: applications.postingTitle,
    })
    .from(attempts)
    .innerJoin(applications, eq(applications.id, attempts.applicationId))
    .where(eq(attempts.userId, userId))
    .orderBy(desc(attempts.startedAt))
    .limit(RECENT_ATTEMPTS)
    .all();
}

function creditsOf(db: AppDatabase, userId: string, now: number) {
  const balances = ledgerBalances(db, userId);

  return {
    available: applicationsLeft(db, userId, now),
    reserved: balances.reserved,
    used: balances.used,
  };
}

function presenceOf(db: AppDatabase, userId: string, now: number) {
  const signedIn =
    db
      .select({ total: count() })
      .from(sessions)
      .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date(now))))
      .get()?.total ?? 0;

  const lastSignIn = db
    .select({ at: sessions.createdAt })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.createdAt))
    .limit(1)
    .get();

  return {
    lastSeenAt: lastSeenAt(userId),
    lastSignInAt: lastSignIn?.at.getTime() ?? null,
    online: isOnline(userId, now),
    signedInSessions: signedIn,
  };
}

function onboardingOf(db: AppDatabase, userId: string) {
  const profile = db
    .select({
      onboardedAt: profiles.onboardedAt,
      pauseReason: profiles.pauseReason,
      running: profiles.running,
      step: profiles.onboardingStep,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .get();

  return {
    onboardedAt: profile?.onboardedAt?.getTime() ?? null,
    pauseReason: profile?.pauseReason ?? null,
    running: profile?.running ?? false,
    step: profile?.step ?? 1,
  };
}

function applicationCountsOf(db: AppDatabase, userId: string) {
  const counts: Record<string, number> = {};

  for (const row of db
    .select({ status: applications.status, total: count() })
    .from(applications)
    .where(eq(applications.userId, userId))
    .groupBy(applications.status)
    .all()) {
    counts[row.status] = row.total;
  }

  return counts;
}

/**
 * The admin's full picture of one person: whether they are online, where onboarding stands, their
 * credits, their match queue with the best matches, what they cost, their latest browser sends and
 * an activity timeline.
 * @param db The application database.
 * @param catalogDb The catalog, for the titles of matched postings.
 * @param userId The person.
 * @param now The current instant.
 * @returns The insight payload `GET /api/admin/users/:id/insight` returns.
 */
export function buildUserInsight(
  db: AppDatabase,
  catalogDb: CatalogDatabase,
  userId: string,
  now: number,
) {
  return {
    applications: applicationCountsOf(db, userId),
    attempts: recentAttemptsOf(db, userId),
    credits: creditsOf(db, userId, now),
    onboarding: onboardingOf(db, userId),
    presence: presenceOf(db, userId, now),
    queue: matchQueueOf(db, catalogDb, userId),
    spend: spendOf(db, userId),
    timeline: userTimeline(db, userId),
  };
}

export type UserInsight = ReturnType<typeof buildUserInsight>;

/**
 * Counts for the users list: who is signed in (an unexpired session) per user id.
 * @param db The application database.
 * @param now The current instant.
 * @returns The ids of users holding at least one unexpired session.
 */
export function signedInUserIds(db: AppDatabase, now: number) {
  return new Set(
    db
      .selectDistinct({ userId: sessions.userId })
      .from(sessions)
      .where(and(isNotNull(sessions.userId), gt(sessions.expiresAt, new Date(now))))
      .all()
      .map((row) => row.userId),
  );
}
