import { and, eq } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";

import { applications, companies, postings } from "../platform/db/schema.ts";

export const ACTIVE_APPLICATION_STATUSES = [
  "preparing",
  "needs_review",
  "ready",
  "approved",
  "sending",
  "confirming",
] as const;

export interface ApplicationInput {
  userId: string;
  postingId: string;
  origin: "auto" | "manual";
  score: number | null;
}

/**
 * The immutable display copy an Application keeps of its Posting and Company (SPEC §5.4). It is read once, when the
 * Application is created, so every later screen reads user data from `app.sqlite` alone.
 */
export type PostingDisplay = Pick<
  typeof applications.$inferInsert,
  | "applyUrl"
  | "ats"
  | "companyDomain"
  | "companyId"
  | "companyName"
  | "companyNameNorm"
  | "locationRaw"
  | "postingTitle"
  | "postingUrl"
  | "salaryCurrency"
  | "salaryMaxMinor"
  | "salaryMinMinor"
  | "salaryPeriod"
>;

/**
 * Read the display fields an Application copies from its Posting and Company.
 * @param db The database to read.
 * @param postingId The Posting to read.
 * @returns The display fields, or undefined when the Posting or its Company is no longer in the catalog.
 */
export function postingDisplayFor(db: AppDatabase, postingId: string) {
  return db
    .select({
      applyUrl: postings.applyUrl,
      ats: postings.ats,
      companyDomain: companies.domain,
      companyId: postings.companyId,
      companyName: companies.name,
      companyNameNorm: companies.nameNorm,
      locationRaw: postings.locationRaw,
      postingTitle: postings.title,
      postingUrl: postings.url,
      salaryCurrency: postings.salaryCurrency,
      salaryMaxMinor: postings.salaryMaxMinor,
      salaryMinMinor: postings.salaryMinMinor,
      salaryPeriod: postings.salaryPeriod,
    })
    .from(postings)
    .innerJoin(companies, eq(companies.id, postings.companyId))
    .where(eq(postings.id, postingId))
    .get();
}

export function applicationFor(db: AppDatabase, userId: string, postingId: string) {
  return db
    .select()
    .from(applications)
    .where(and(eq(applications.userId, userId), eq(applications.postingId, postingId)))
    .get();
}

/**
 * Queue one Application for the user, copying the Posting's display fields onto the row. Returns null when the
 * Application already exists, and also when the Posting is no longer in the catalog: preparation needs the live
 * Posting, so an Application that cannot be prepared is not created.
 * @param db The database to write.
 * @param at Creation time, epoch milliseconds.
 * @param input The user, the Posting, the origin and the score.
 * @returns The new Application id, or null when nothing was created.
 */
export function createApplication(db: AppDatabase, at: number, input: ApplicationInput) {
  const existing = applicationFor(db, input.userId, input.postingId);

  if (existing !== undefined) {
    return null;
  }

  const display = postingDisplayFor(db, input.postingId);

  if (display === undefined) {
    return null;
  }

  const id = crypto.randomUUID();

  db.insert(applications)
    .values({
      ...display,
      id,
      userId: input.userId,
      postingId: input.postingId,
      origin: input.origin,
      status: "preparing",
      stage: "queued",
      stageLocked: false,
      boardPosition: null,
      scoreAtQueue: input.score,
      attempts: 0,
      createdAt: at,
      updatedAt: at,
    })
    .onConflictDoNothing()
    .run();

  return id;
}

export function activeApplicationCompanies(db: AppDatabase, userId: string) {
  const rows = db
    .select({ companyId: applications.companyId, status: applications.status })
    .from(applications)
    .where(eq(applications.userId, userId))
    .all();

  const activeCompanies = new Set<string>();

  for (const row of rows) {
    if (ACTIVE_APPLICATION_STATUSES.some((status) => status === row.status)) {
      activeCompanies.add(row.companyId);
    }
  }

  return activeCompanies;
}
