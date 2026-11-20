import { and, eq } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";

import { applications } from "../platform/db/schema.ts";

export const QUEUED_STATUSES = [
  "preparing",
  "needs_review",
  "ready",
  "sending",
  "confirming",
] as const;

export interface ApplicationInput {
  userId: string;
  postingId: string;
  companyId: string;
  origin: "auto" | "manual";
  score: number | null;
}

export function applicationFor(db: AppDatabase, userId: string, postingId: string) {
  return db
    .select()
    .from(applications)
    .where(and(eq(applications.userId, userId), eq(applications.postingId, postingId)))
    .get();
}

export function createApplication(db: AppDatabase, at: number, input: ApplicationInput) {
  const existing = applicationFor(db, input.userId, input.postingId);

  if (existing !== undefined) {
    return null;
  }

  const id = crypto.randomUUID();

  db.insert(applications)
    .values({
      id,
      userId: input.userId,
      postingId: input.postingId,
      companyId: input.companyId,
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

  const companies = new Set<string>();

  for (const row of rows) {
    if (QUEUED_STATUSES.some((status) => status === row.status)) {
      companies.add(row.companyId);
    }
  }

  return companies;
}
