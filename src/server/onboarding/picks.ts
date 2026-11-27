import { and, asc, eq } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { PostingDisplay } from "../matching/applications.ts";
import type {
  OnboardingBatchStatus,
  OnboardingPickFailureReason,
  OnboardingPickStatus,
  OnboardingPickView,
  OnboardingPlanKind,
} from "../../shared/onboarding.ts";

import { applications, onboardingBatches, onboardingPicks } from "../platform/db/schema.ts";
import { jobPostingsById } from "../jobs/job-posting.ts";
import { displayFromJobPosting } from "./freehire-job.ts";
import { onboardingPickLimitFor, pickStatusOfApplication } from "../../shared/onboarding.ts";

export interface PickPreparationResult {
  applicationId: string | null;
  reason: OnboardingPickFailureReason | null;
  status: OnboardingPickStatus;
}

function batchStatusAfter(results: readonly PickPreparationResult[]) {
  const sendable = results.filter(
    (result) =>
      result.status === "prepared" ||
      result.status === "preparing" ||
      result.status === "needs_answer",
  );

  if (sendable.length > 0) {
    return "prepared" as const;
  }

  if (results.length > 0) {
    return "failed" as const;
  }

  return "prepared" as const;
}

function isFailureReason(value: string | null): value is OnboardingPickFailureReason {
  return (
    value === "posting_closed" ||
    value === "apply_unsupported" ||
    value === "language" ||
    value === "company_excluded" ||
    value === "already_applied" ||
    value === "prepare_failed"
  );
}

/**
 * The durable onboarding picks: chosen ids, the batch lifecycle and an immutable display snapshot per pick, written
 * before Stripe and reused by every return, refresh and tab. It stores no plan-specific limit; the plan only sets how
 * many picks are allowed.
 * @param deps The application database, the read-only catalog and the clock.
 * @returns The save, read, batch and preparation helpers the onboarding routes share.
 */
export function createOnboardingPicks(deps: { db: AppDatabase; clock: Clock }) {
  const { db, clock } = deps;

  function ensureBatch(userId: string, now: number) {
    const existing = db
      .select()
      .from(onboardingBatches)
      .where(eq(onboardingBatches.userId, userId))
      .get();

    if (existing !== undefined) {
      return existing;
    }

    db.insert(onboardingBatches)
      .values({
        createdAt: now,
        id: `onboarding-batch:${userId}`,
        planKind: null,
        status: "picking",
        updatedAt: now,
        userId,
      })
      .onConflictDoNothing()
      .run();

    return db.select().from(onboardingBatches).where(eq(onboardingBatches.userId, userId)).get();
  }

  function readBatch(userId: string) {
    return db.select().from(onboardingBatches).where(eq(onboardingBatches.userId, userId)).get();
  }

  function planKindOf(userId: string) {
    const row = readBatch(userId);

    return row?.planKind ?? null;
  }

  function setPlanKind(userId: string, planKind: OnboardingPlanKind) {
    const now = clock.now();

    ensureBatch(userId, now);
    db.update(onboardingBatches)
      .set({ planKind, updatedAt: now })
      .where(eq(onboardingBatches.userId, userId))
      .run();
  }

  function pickRows(userId: string) {
    return db
      .select({
        applicationId: onboardingPicks.applicationId,
        applicationStatus: applications.status,
        applicationReason: applications.statusReason,
        applyUrl: onboardingPicks.applyUrl,
        companyName: onboardingPicks.companyName,
        createdAt: onboardingPicks.createdAt,
        locationRaw: onboardingPicks.locationRaw,
        postingId: onboardingPicks.postingId,
        postingTitle: onboardingPicks.postingTitle,
        reason: onboardingPicks.statusReason,
        status: onboardingPicks.status,
      })
      .from(onboardingPicks)
      .leftJoin(applications, eq(applications.id, onboardingPicks.applicationId))
      .where(eq(onboardingPicks.userId, userId))
      .orderBy(asc(onboardingPicks.createdAt))
      .all();
  }

  function view(userId: string) {
    const batch = readBatch(userId);

    const picks: OnboardingPickView[] = pickRows(userId).map((row) => {
      const live =
        row.applicationId === null || row.applicationStatus === null
          ? row.status
          : pickStatusOfApplication(row.applicationStatus, row.applicationReason);

      return {
        applicationId: row.applicationId,
        applyUrl: row.applyUrl,
        company: row.companyName,
        location: row.locationRaw,
        postingId: row.postingId,
        reason: isFailureReason(row.reason) ? row.reason : null,
        status: live,
        title: row.postingTitle,
      };
    });

    return {
      batchStatus: batch?.status ?? "picking",
      pickLimit: onboardingPickLimitFor(batch?.planKind ?? null),
      planKind: batch?.planKind ?? null,
      picks,
      selected: picks.map((pick) => pick.postingId),
    };
  }

  function save(userId: string, postingIds: readonly string[]) {
    const unique = [...new Set(postingIds)];
    const batch = readBatch(userId);
    const limit = onboardingPickLimitFor(batch?.planKind ?? null);

    if (unique.length > limit) {
      return null;
    }

    const snapshots = new Map<string, PostingDisplay>();

    if (unique.length > 0) {
      const resolved = jobPostingsById({ catalogDb, db }, unique);

      if (resolved.size !== unique.length) {
        return null;
      }

      for (const posting of resolved.values()) {
        if (!posting.open) {
          return null;
        }

        snapshots.set(posting.postingId, displayFromJobPosting(posting));
      }
    }

    const now = clock.now();

    db.transaction((tx) => {
      ensureBatch(userId, now);

      const existing = tx
        .select()
        .from(onboardingPicks)
        .where(eq(onboardingPicks.userId, userId))
        .all();

      for (const row of existing) {
        if (
          !unique.includes(row.postingId) &&
          row.applicationId === null &&
          row.status === "picked"
        ) {
          tx.delete(onboardingPicks)
            .where(
              and(eq(onboardingPicks.userId, userId), eq(onboardingPicks.postingId, row.postingId)),
            )
            .run();
        }
      }

      for (const postingId of unique) {
        const display = snapshots.get(postingId);

        if (display === undefined) {
          continue;
        }

        const row = existing.find((candidate) => candidate.postingId === postingId);

        if (row === undefined) {
          tx.insert(onboardingPicks)
            .values({
              ...display,
              applicationId: null,
              createdAt: now,
              id: crypto.randomUUID(),
              postingId,
              status: "picked",
              statusReason: null,
              updatedAt: now,
              userId,
            })
            .run();
        } else if (row.applicationId === null) {
          tx.update(onboardingPicks)
            .set({ ...display, updatedAt: now })
            .where(eq(onboardingPicks.id, row.id))
            .run();
        }
      }

      tx.update(onboardingBatches)
        .set({ updatedAt: now })
        .where(eq(onboardingBatches.userId, userId))
        .run();
    });

    return view(userId);
  }

  function markStatus(userId: string, status: OnboardingBatchStatus, failureReason?: string) {
    const now = clock.now();

    ensureBatch(userId, now);
    db.update(onboardingBatches)
      .set({ failureReason: failureReason ?? null, status, updatedAt: now })
      .where(eq(onboardingBatches.userId, userId))
      .run();
  }

  function forPreparation(userId: string) {
    return db
      .select()
      .from(onboardingPicks)
      .where(eq(onboardingPicks.userId, userId))
      .orderBy(asc(onboardingPicks.createdAt))
      .all();
  }

  function applyPreparation(
    userId: string,
    results: ReadonlyMap<string, PickPreparationResult & { postingId: string }>,
  ) {
    const now = clock.now();

    db.transaction((tx) => {
      for (const result of results.values()) {
        tx.update(onboardingPicks)
          .set({
            applicationId: result.applicationId,
            status: result.status,
            statusReason: result.reason,
            updatedAt: now,
          })
          .where(
            and(
              eq(onboardingPicks.userId, userId),
              eq(onboardingPicks.postingId, result.postingId),
            ),
          )
          .run();
      }

      const status = batchStatusAfter([...results.values()]);

      tx.update(onboardingBatches)
        .set({ status, updatedAt: now })
        .where(eq(onboardingBatches.userId, userId))
        .run();
    });
  }

  return {
    applyPreparation,
    ensureBatch,
    forPreparation,
    markStatus,
    planKindOf,
    readBatch,
    save,
    setPlanKind,
    view,
  };
}

export type OnboardingPicksService = ReturnType<typeof createOnboardingPicks>;
