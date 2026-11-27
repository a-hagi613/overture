import { and, eq } from "drizzle-orm";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";

import { applications } from "../platform/db/schema.ts";
import { companies, postings } from "../platform/db/catalog-schema.ts";
import { recordApplicationEvent } from "../applications/events.ts";

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
  origin: "pick" | "manual";
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
export function postingDisplayFor(db: CatalogDatabase, postingId: string) {
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
 * @param deps The application database to write and the catalog database to read the display fields from.
 * @param at Creation time, epoch milliseconds.
 * @param input The user, the Posting, the origin and the score.
 * @param snapshot The display snapshot taken when the person picked, used when the Posting has left the catalog.
 * @returns The new Application id, or null when nothing was created.
 */
export function createApplication(
  deps: { db: AppDatabase; catalogDb?: CatalogDatabase },
  at: number,
  input: ApplicationInput,
  snapshot?: PostingDisplay,
) {
  const { db, catalogDb } = deps;
  const existing = applicationFor(db, input.userId, input.postingId);

  if (existing !== undefined) {
    return null;
  }

  const display =
    snapshot ??
    (catalogDb === undefined ? undefined : postingDisplayFor(catalogDb, input.postingId));

  if (display === undefined) {
    return null;
  }

  return insertApplication(db, at, input, display, {
    stage: "queued",
    status: "preparing",
    statusReason: null,
  });
}

/**
 * Create one tracked Application for a pick that can no longer be prepared, from its frozen snapshot alone. It keeps
 * the employer and title visible in the Tracker and Closed, and the unique user/posting index keeps it to one row.
 * @param db The application database.
 * @param at Creation time, epoch milliseconds.
 * @param input The user, the Posting and the frozen display snapshot.
 * @returns The new Application id, or null when nothing was created.
 */
export function createClosedApplication(
  db: AppDatabase,
  at: number,
  input: { display: PostingDisplay; postingId: string; reason: string; userId: string },
) {
  const existing = applicationFor(db, input.userId, input.postingId);

  if (existing !== undefined) {
    return null;
  }

  return insertApplication(
    db,
    at,
    { origin: "pick", postingId: input.postingId, score: null, userId: input.userId },
    input.display,
    { stage: "closed", status: "failed", statusReason: input.reason },
  );
}

function insertApplication(
  db: AppDatabase,
  at: number,
  input: ApplicationInput,
  display: PostingDisplay,
  initial: {
    stage: "closed" | "queued";
    status: "failed" | "preparing";
    statusReason: string | null;
  },
) {
  const id = crypto.randomUUID();

  const inserted = db
    .insert(applications)
    .values({
      ...display,
      id,
      userId: input.userId,
      postingId: input.postingId,
      origin: input.origin,
      status: initial.status,
      statusReason: initial.statusReason,
      stage: initial.stage,
      stageLocked: false,
      boardPosition: null,
      scoreAtQueue: input.score,
      attempts: 0,
      createdAt: at,
      updatedAt: at,
    })
    .onConflictDoNothing()
    .returning({ id: applications.id })
    .all()
    .at(0);

  if (inserted !== undefined) {
    recordApplicationEvent(
      db,
      { now: () => at },
      {
        applicationId: inserted.id,
        detail: { score: input.score },
        fromValue: null,
        kind: initial.status === "failed" ? "status" : "stage",
        reason: initial.statusReason ?? "selected_by_user",
        source: "user",
        toValue: initial.status === "failed" ? "failed" : "queued",
        userId: input.userId,
      },
    );

    return inserted.id;
  }

  return applicationFor(db, input.userId, input.postingId)?.id ?? null;
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
