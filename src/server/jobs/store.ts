import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";

import { timestampOf } from "../../shared/freehire.ts";
import type { FreehireJobRecord } from "../../shared/freehire.ts";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { jobPlaces, jobs, matches } from "../platform/db/schema.ts";
import { enqueueMatchRescoreJob } from "../matching/match-jobs.ts";
import type { ApplyTarget } from "./apply-link.ts";
import { jobPlaceRows } from "../places/job-places.ts";

export type StoreOutcome =
  | { status: "kept"; jobId: string }
  | { status: "duplicate" }
  | { status: "unsupported" };

function normalise(value: string) {
  return value.trim().toLowerCase().replaceAll(/\s+/gu, " ");
}

function lowerList(values: readonly string[] | null | undefined) {
  return (values ?? []).map((value) => value.trim().toLowerCase()).filter((value) => value !== "");
}

function uniqueLower(values: readonly string[] | null | undefined) {
  return [...new Set(lowerList(values))].toSorted();
}

/**
 * The employer, title and city triple that folds freehire's per-city copies into one job.
 * @param job The freehire record.
 * @returns The dedupe key.
 */
export function dedupeKeyOf(job: FreehireJobRecord) {
  const employer = normalise(job.company_slug ?? job.company);
  const cities = uniqueLower(job.cities).join("/");

  return `${employer}|${normalise(job.title)}|${cities}`;
}

function descriptionHash(description: string | null) {
  return description === null || description === ""
    ? null
    : createHash("sha256").update(description).digest("hex");
}

export interface JobStore {
  /** Stores one pulled job, or recognises a duplicate of a job already stored. */
  upsert: (job: FreehireJobRecord, target: ApplyTarget) => StoreOutcome;
  /** Marks one job closed by its freehire public slug. */
  close: (publicSlug: string, closedAt: number) => boolean;
  /** Marks a batch of jobs closed, which is what the change feed reports. */
  closeMany: (publicSlugs: readonly string[], closedAt: number) => number;
}

/**
 * The shared job table's writer. It deduplicates across users by public slug first, then by employer/title/places, and
 * keeps closing as an update so an application's stored link never points at a deleted row.
 * @param deps The application database and the clock every timestamp comes from.
 * @returns The store the pull uses.
 */
export function createJobStore(deps: { db: AppDatabase; clock: Clock }) {
  const { db, clock } = deps;

  function upsert(job: FreehireJobRecord, target: ApplyTarget) {
    const now = clock.now();
    const dedupeKey = dedupeKeyOf(job);

    const existingById = db
      .select({ descriptionHash: jobs.descriptionHash, id: jobs.id })
      .from(jobs)
      .where(eq(jobs.id, job.public_slug))
      .get();

    const nextHash = descriptionHash(job.description);

    const descriptionChanged =
      existingById !== undefined && existingById.descriptionHash !== nextHash;

    if (existingById === undefined) {
      const existingByKey = db
        .select({ id: jobs.id })
        .from(jobs)
        .where(eq(jobs.dedupeKey, dedupeKey))
        .get();

      if (existingByKey !== undefined) {
        return { status: "duplicate" } satisfies StoreOutcome;
      }
    }

    const enrichment = job.enrichment ?? null;
    const reality = job.reality ?? null;
    const closedAt = timestampOf(job.closed_at);
    const salaryPeriod = enrichment?.salary_period ?? null;

    const values: typeof jobs.$inferInsert = {
      applyUrl: target.applyUrl,
      applyVia: target.via,
      atsJobId: target.atsJobId,
      ageDays: reality?.age_days ?? null,
      boardToken: target.boardToken,
      category: enrichment?.category ?? null,
      cities: job.cities === null ? null : JSON.stringify(job.cities),
      closedAt,
      company: job.company,
      companyNorm: normalise(job.company),
      companySlug: job.company_slug,
      countries: JSON.stringify(lowerList(job.countries)),
      createdAt: now,
      dedupeKey,
      description: job.description,
      descriptionHash: nextHash,
      employmentType: enrichment?.employment_type ?? null,
      experienceYearsMin: enrichment?.experience_years_min ?? null,
      externalId: job.external_id,
      fakeFreshness: reality?.fake_freshness === true,
      firstSeenAt: now,
      freehireSource: job.source,
      id: job.public_slug,
      lastSeenAt: now,
      locationRaw: job.location,
      metros: job.metros === null ? null : JSON.stringify(job.metros),
      postedAt: timestampOf(job.posted_at),
      regions: job.regions === null ? null : JSON.stringify(job.regions),
      repostCount: reality?.repost_count ?? null,
      salaryCurrency: enrichment?.salary_currency ?? null,
      salaryMax: enrichment?.salary_max ?? null,
      salaryMin: enrichment?.salary_min ?? null,
      salaryPeriod:
        salaryPeriod === "year" ||
        salaryPeriod === "month" ||
        salaryPeriod === "day" ||
        salaryPeriod === "hour"
          ? salaryPeriod
          : null,
      seniority: enrichment?.seniority ?? null,
      skills: job.skills === null ? null : JSON.stringify(job.skills),
      source: target.ats,
      sourceCreatedAt: timestampOf(job.created_at),
      sourceUpdatedAt: timestampOf(job.updated_at),
      status: "open" as const,
      title: job.title.trim(),
      titleNorm: normalise(job.title),
      updatedAt: now,
      url: job.url === null || job.url === "" ? null : job.url,
      workMode: job.work_mode,
    };

    db.insert(jobs)
      .values(values)
      .onConflictDoUpdate({
        target: jobs.id,
        set: {
          applyUrl: values.applyUrl,
          applyVia: values.applyVia,
          closedAt: values.closedAt,
          description: values.description,
          descriptionHash: values.descriptionHash,
          lastSeenAt: now,
          status: "open",
          updatedAt: now,
        },
      })
      .run();

    const places = jobPlaceRows(job);

    db.delete(jobPlaces).where(eq(jobPlaces.jobId, values.id)).run();

    if (descriptionChanged) {
      for (const row of db
        .select({ userId: matches.userId })
        .from(matches)
        .where(eq(matches.postingId, values.id))
        .all()) {
        enqueueMatchRescoreJob(db, clock, row.userId, values.id);
      }
    }

    if (places.length > 0) {
      db.insert(jobPlaces)
        .values(
          places.map((place) => ({ jobId: values.id, kind: place.kind, placeId: place.placeId })),
        )
        .onConflictDoNothing()
        .run();
    }

    return { status: "kept", jobId: values.id } satisfies StoreOutcome;
  }

  function close(publicSlug: string, closedAt: number) {
    const rows = db
      .update(jobs)
      .set({ closedAt, status: "closed", updatedAt: clock.now() })
      .where(and(eq(jobs.id, publicSlug), eq(jobs.status, "open")))
      .returning({ id: jobs.id })
      .all();

    return rows.length > 0;
  }

  function closeMany(publicSlugs: readonly string[], closedAt: number) {
    if (publicSlugs.length === 0) {
      return 0;
    }

    const rows = db
      .update(jobs)
      .set({ closedAt, status: "closed", updatedAt: clock.now() })
      .where(and(inArray(jobs.id, [...publicSlugs]), eq(jobs.status, "open")))
      .returning({ id: jobs.id })
      .all();

    return rows.length;
  }

  return { close, closeMany, upsert } satisfies JobStore;
}
